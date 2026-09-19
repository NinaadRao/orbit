/*
 * Bring-your-own-key LLM adapters. The browser talks straight to the provider you chose.
 * There is no Orbit server in the middle and nothing is sent anywhere else.
 *
 * Internal message format (Anthropic-like):
 *   { role: 'user'|'assistant', content: [ {type:'text',text}
 *        | {type:'image', mime, b64}
 *        | {type:'tool_use', id, name, input}
 *        | {type:'tool_result', tool_use_id, content} ] }
 */
(function (root) {
  'use strict';

  const PROVIDERS = {
    anthropic: { label: 'Anthropic', sub: 'Claude models', base: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5', needsKey: true, vision: true },
    openai: { label: 'OpenAI', sub: 'GPT models', base: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', needsKey: true, vision: true },
    google: { label: 'Google', sub: 'Gemini models', base: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.0-flash', needsKey: true, vision: true },
    custom: { label: 'Custom', sub: 'Ollama, OpenRouter, any OpenAI-compatible', base: '', defaultModel: '', needsKey: false, vision: true },
  };
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  function cleanBase(url) {
    let u;
    try { u = new URL(url); } catch (e) { throw new Error('That endpoint is not a valid URL.'); }
    if (u.username || u.password) throw new Error('Do not put credentials in the URL.');
    const local = LOCAL_HOSTS.includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Custom endpoints must use https (http is only allowed for localhost).');
    return u.origin + u.pathname.replace(/\/+$/, '');
  }
  function endpointOf(cfg) {
    if (cfg.provider === 'custom') return cleanBase(cfg.baseUrl || '');
    return PROVIDERS[cfg.provider].base;
  }
  function originOf(cfg) { try { return new URL(endpointOf(cfg)).origin; } catch (e) { return ''; } }

  // ---------- SSE ----------
  async function* sseEvents(resp) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const dataLines = [];
        let event = '';
        for (const line of raw.split(/\r?\n/)) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
          else if (line.startsWith('event:')) event = line.slice(6).trim();
        }
        if (dataLines.length) yield { event, data: dataLines.join('\n') };
      }
    }
    if (buf.trim().startsWith('data:')) yield { event: '', data: buf.trim().slice(5).trim() };
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }
  async function fetchWithRetry(url, init, signal) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      let resp;
      try { resp = await fetch(url, Object.assign({}, init, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })); }
      catch (e) {
        if (e && e.name === 'AbortError') throw e;
        last = new Error('Could not reach the provider. Check your connection, the endpoint, and that its CORS settings allow browser calls.');
        last.network = true;
        await sleep(400 * Math.pow(2, attempt) + Math.random() * 250, signal);
        continue;
      }
      if (resp.ok) return resp;
      let msg = '';
      try { const j = await resp.json(); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { /* ignore */ }
      const err = new Error(resp.status + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300));
      err.status = resp.status;
      if ((resp.status === 429 || resp.status >= 500) && attempt < 2) { last = err; await sleep(600 * Math.pow(2, attempt) + Math.random() * 300, signal); continue; }
      throw err;
    }
    throw last || new Error('Request failed.');
  }

  // ---------- Anthropic ----------
  function toAnthropic(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: m.content.map((c) => {
        if (c.type === 'image') return { type: 'image', source: { type: 'base64', media_type: c.mime, data: c.b64 } };
        return c;
      }),
    }));
  }
  async function streamAnthropic(cfg, req, hooks) {
    const body = { model: cfg.model, max_tokens: req.maxTokens || 1500, system: req.system, messages: toAnthropic(req.messages), stream: true };
    if (req.tools && req.tools.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    const resp = await fetchWithRetry(PROVIDERS.anthropic.base + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body),
    }, req.signal);
    const out = { text: '', toolCalls: [], stop: '' };
    const blocks = {};
    for await (const ev of sseEvents(resp)) {
      let d; try { d = JSON.parse(ev.data); } catch (e) { continue; }
      if (d.type === 'content_block_start') blocks[d.index] = d.content_block.type === 'tool_use' ? { id: d.content_block.id, name: d.content_block.name, json: '' } : null;
      else if (d.type === 'content_block_delta') {
        if (d.delta.type === 'text_delta') { out.text += d.delta.text; hooks.onText && hooks.onText(out.text); }
        else if (d.delta.type === 'input_json_delta' && blocks[d.index]) blocks[d.index].json += d.delta.partial_json;
      } else if (d.type === 'content_block_stop' && blocks[d.index]) {
        let input = {}; try { input = blocks[d.index].json ? JSON.parse(blocks[d.index].json) : {}; } catch (e) { input = {}; }
        out.toolCalls.push({ id: blocks[d.index].id, name: blocks[d.index].name, input });
        blocks[d.index] = null;
      } else if (d.type === 'message_delta' && d.delta && d.delta.stop_reason) out.stop = d.delta.stop_reason;
      else if (d.type === 'error') throw new Error((d.error && d.error.message) || 'Provider error');
    }
    return out;
  }

  // ---------- OpenAI-compatible ----------
  function toOpenAI(system, messages) {
    const out = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
        const calls = m.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } }));
        const msg = { role: 'assistant', content: text || null };
        if (calls.length) msg.tool_calls = calls;
        out.push(msg);
      } else {
        const results = m.content.filter((c) => c.type === 'tool_result');
        for (const r of results) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: String(r.content) });
        const rest = m.content.filter((c) => c.type !== 'tool_result');
        if (rest.length) {
          if (rest.every((c) => c.type === 'text')) out.push({ role: 'user', content: rest.map((c) => c.text).join('\n') });
          else out.push({ role: 'user', content: rest.map((c) => (c.type === 'image' ? { type: 'image_url', image_url: { url: 'data:' + c.mime + ';base64,' + c.b64 } } : { type: 'text', text: c.text })) });
        }
      }
    }
    return out;
  }
  async function streamOpenAI(cfg, req, hooks) {
    const base = cfg.provider === 'custom' ? cleanBase(cfg.baseUrl || '') : PROVIDERS.openai.base;
    const body = { model: cfg.model, messages: toOpenAI(req.system, req.messages), stream: true };
    if (req.tools && req.tools.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
    const resp = await fetchWithRetry(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) }, req.signal);
    const out = { text: '', toolCalls: [], stop: '' };
    const acc = {};
    for await (const ev of sseEvents(resp)) {
      if (ev.data.trim() === '[DONE]') break;
      let d; try { d = JSON.parse(ev.data); } catch (e) { continue; }
      const ch = d.choices && d.choices[0];
      if (!ch) continue;
      const delta = ch.delta || {};
      if (delta.content) { out.text += delta.content; hooks.onText && hooks.onText(out.text); }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index == null ? 0 : tc.index;
        acc[i] = acc[i] || { id: '', name: '', json: '' };
        if (tc.id) acc[i].id = tc.id;
        if (tc.function && tc.function.name) acc[i].name += tc.function.name;
        if (tc.function && tc.function.arguments) acc[i].json += tc.function.arguments;
      }
      if (ch.finish_reason) out.stop = ch.finish_reason;
    }
    for (const k of Object.keys(acc)) {
      let input = {}; try { input = acc[k].json ? JSON.parse(acc[k].json) : {}; } catch (e) { input = {}; }
      out.toolCalls.push({ id: acc[k].id || 'call_' + k, name: acc[k].name, input });
    }
    return out;
  }

  // ---------- Google Gemini ----------
  function toGemini(messages) {
    const names = {};
    const contents = [];
    for (const m of messages) {
      const parts = [];
      for (const c of m.content) {
        if (c.type === 'text') parts.push({ text: c.text });
        else if (c.type === 'image') parts.push({ inlineData: { mimeType: c.mime, data: c.b64 } });
        else if (c.type === 'tool_use') { names[c.id] = c.name; parts.push({ functionCall: { name: c.name, args: c.input || {} } }); }
        else if (c.type === 'tool_result') parts.push({ functionResponse: { name: names[c.tool_use_id] || 'tool', response: { result: String(c.content) } } });
      }
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    return contents;
  }
  function geminiSchema(s) {
    // Gemini accepts a subset of JSON schema: drop unsupported keys.
    if (Array.isArray(s)) return s.map(geminiSchema);
    if (s && typeof s === 'object') {
      const o = {};
      for (const k of Object.keys(s)) { if (k === 'additionalProperties' || k === '$schema') continue; o[k] = geminiSchema(s[k]); }
      return o;
    }
    return s;
  }
  async function streamGoogle(cfg, req, hooks) {
    const body = { systemInstruction: { parts: [{ text: req.system }] }, contents: toGemini(req.messages) };
    if (req.tools && req.tools.length) body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.schema) })) }];
    const url = PROVIDERS.google.base + '/v1beta/models/' + encodeURIComponent(cfg.model) + ':streamGenerateContent?alt=sse';
    const resp = await fetchWithRetry(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body) }, req.signal);
    const out = { text: '', toolCalls: [], stop: '' };
    let n = 0;
    for await (const ev of sseEvents(resp)) {
      let d; try { d = JSON.parse(ev.data); } catch (e) { continue; }
      const c = d.candidates && d.candidates[0];
      if (!c) continue;
      for (const p of (c.content && c.content.parts) || []) {
        if (p.text) { out.text += p.text; hooks.onText && hooks.onText(out.text); }
        if (p.functionCall) out.toolCalls.push({ id: 'g' + (++n), name: p.functionCall.name, input: p.functionCall.args || {} });
      }
      if (c.finishReason) out.stop = c.finishReason;
    }
    return out;
  }

  // One model turn. Resolves { text, toolCalls, stop }.
  async function chat(cfg, req, hooks) {
    if (!PROVIDERS[cfg.provider]) throw new Error('Pick a provider first.');
    if (PROVIDERS[cfg.provider].needsKey && !cfg.apiKey) throw new Error('Add your API key first.');
    if (!cfg.model) throw new Error('Type a model name first.');
    const h = hooks || {};
    if (cfg.provider === 'anthropic') return streamAnthropic(cfg, req, h);
    if (cfg.provider === 'google') return streamGoogle(cfg, req, h);
    return streamOpenAI(cfg, req, h);
  }
  async function ping(cfg) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await chat(cfg, { system: 'You are a connection test.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word: ok' }] }], maxTokens: 16, signal: ctl.signal }, {});
      return r.text.trim() || '(empty reply)';
    } finally { clearTimeout(t); }
  }

  root.LLM = { PROVIDERS, chat, ping, originOf, cleanBase, endpointOf };
})(self);
