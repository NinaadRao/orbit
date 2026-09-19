/* Coach chat (your own model, your own key) and the coach setup page. */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, LLM = root.LLM, Coach = root.Coach, Crypt = root.Crypt;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};

  // Conversation lives in memory only. Closing the app forgets it; your data and plan are unaffected.
  const msgs = [];
  const hist = [];
  let busy = false, ctl = null, liveText = '', liveEl = null, chatEl = null;

  function hostOf(cfg) { try { return new URL(LLM.endpointOf(cfg)).host; } catch (e) { return 'your provider'; } }
  function scrollDown() { if (chatEl) chatEl.scrollTop = chatEl.scrollHeight; }

  function proposalCard(p) {
    const box = h('div', { class: 'proposal' });
    const draw = () => {
      U.clear(box);
      U.put(box, h('div', { class: 'pt' }, p.title), ...p.rows.map((r) => h('div', { class: 'kv' }, h('span', null, r[0]), h('b', null, r[1]))), p.reason ? h('div', { class: 'muted small' }, p.reason) : null);
      if (p.status === 'pending') {
        U.put(box, h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn good', onclick: async () => { try { const ev = await p.run(); p.seq = ev && ev.seq; p.status = 'applied'; U.toast('Applied.'); } catch (e) { U.toast(String(e.message || e), 'warn'); } draw(); } }, 'Apply'),
          h('button', { type: 'button', class: 'btn quiet', onclick: () => { p.status = 'dismissed'; draw(); } }, 'Not now')));
      } else if (p.status === 'applied') {
        U.put(box, h('div', { class: 'row' }, U.chip('Applied', 'good'), p.seq ? h('button', { type: 'button', class: 'btn quiet small', onclick: async () => { await Store.voidEvent(p.seq); p.status = 'undone'; draw(); } }, 'Undo') : null));
      } else U.put(box, U.chip(p.status === 'undone' ? 'Undone' : 'Dismissed', 'line'));
    };
    draw();
    return box;
  }

  function drawChat() {
    if (!chatEl) return;
    U.clear(chatEl);
    if (!msgs.length) {
      U.put(chatEl, h('div', { class: 'msg ai' }, 'Ask me how your week is going, whether your calories look right, or tell me something like "shoulders feel beat" or "I weighed 70.6 kg this morning". I can suggest changes, but nothing changes until you tap Apply.'),
        h('div', { class: 'suggest' }, ...['How is my week going?', 'Am I eating enough protein?', 'Should I change my calories?', 'My chest press felt too heavy'].map((q) => h('button', { type: 'button', class: 'pill', onclick: () => send(q) }, q))));
    }
    for (const m of msgs) {
      chatEl.appendChild(h('div', { class: 'msg ' + m.role }, m.text));
      for (const p of m.proposals || []) chatEl.appendChild(proposalCard(p));
    }
    liveEl = null;
    if (busy) { liveEl = h('div', { class: 'msg ai' }, liveText || 'Thinking...'); chatEl.appendChild(liveEl); }
    scrollDown();
  }

  async function send(text) {
    text = String(text || '').trim().slice(0, 2000);
    if (!text || busy) return;
    if (!root.App.aiReady()) return U.toast('Connect your AI first.', 'warn');
    const cfg = root.App.llmConfig();
    msgs.push({ role: 'user', text });
    busy = true; liveText = ''; ctl = new AbortController(); drawChat(); syncComposer();
    const n = hist.length;
    try {
      const res = await Coach.turn(cfg, hist, [{ type: 'text', text }], { signal: ctl.signal, onText: (t) => { liveText = t; if (liveEl) { liveEl.textContent = t; scrollDown(); } } });
      msgs.push({ role: 'ai', text: res.text || (res.proposals.length ? 'I have a suggestion for you:' : '(no reply)'), proposals: res.proposals });
    } catch (e) {
      hist.length = n;
      msgs.push({ role: 'err', text: e && e.name === 'AbortError' ? 'Stopped.' : String(e && e.message ? e.message : e).slice(0, 400) });
    }
    busy = false; ctl = null; drawChat(); syncComposer();
  }

  let sendBtn = null, inputEl = null;
  function syncComposer() {
    if (!sendBtn) return;
    sendBtn.textContent = '';
    sendBtn.appendChild(busy ? h('span', null, 'Stop') : U.icon('send', 20));
    sendBtn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  }

  Screens.coach = function () {
    const ready = root.App.aiReady();
    const cfg = root.App.llmConfig();
    chatEl = h('div', { class: 'chat', 'aria-live': 'polite' });
    const page = h('div', { class: 'page' }, UI.header('Coach', 'Your model. Your key. Your call.', { right: h('a', { class: 'iconbtn', href: '#/coach/setup', 'aria-label': 'Coach settings' }, U.icon('key', 20)) }));
    if (!ready) {
      U.put(page, UI.scroller(UI.card(h('div', { class: 'ct' }, 'Connect your own AI'), h('div', { class: 'muted' }, 'The coach runs on a model you choose, with a key you own. There is no Orbit server and no shared AI, so it costs the app nothing and your data goes nowhere else.'),
        UI.btn('Set up the coach', { href: '#/coach/setup' }), UI.btn('Paste a key for this session', { kind: 'quiet', onClick: () => Screens.keySheet(() => root.App.render()) })),
        h('div', { class: 'muted small' }, 'Everything else in Orbit works without it.')));
      return page;
    }
    inputEl = h('textarea', { class: 'inp', rows: 1, maxlength: 2000, placeholder: 'Ask or tell the coach something', 'aria-label': 'Message' });
    sendBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => { if (busy) { if (ctl) ctl.abort(); return; } const t = inputEl.value; inputEl.value = ''; send(t); } });
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });
    syncComposer();
    U.put(page, chatEl,
      h('div', { class: 'notice' }, 'Sends your numbers (no photos, no name) to ' + hostOf(cfg) + '. Changes need your tap.'),
      h('div', { class: 'composer' }, inputEl, sendBtn));
    page.afterMount = drawChat;
    return page;
  };

  // ---------- quick key entry (used by Fuel and Coach) ----------
  function parseKeyText(text) {
    const t = String(text || '').trim().slice(0, 4096);
    try {
      const j = JSON.parse(t);
      const v = j && (j.apiKey || j.api_key || j.key || j.ANTHROPIC_API_KEY || j.OPENAI_API_KEY || j.GEMINI_API_KEY || j.GOOGLE_API_KEY);
      if (typeof v === 'string') return v.trim();
    } catch (e) { /* not JSON */ }
    for (const line of t.split(/\r?\n/)) {
      let l = line.trim();
      if (!l || l.startsWith('#')) continue;
      l = l.replace(/^export\s+/, '');
      const eq = l.indexOf('=');
      const v = (eq >= 0 ? l.slice(eq + 1) : l).trim().replace(/^['"]|['"]$/g, '');
      if (v) return v;
    }
    return '';
  }
  function keyOk(k) { return /^[\x21-\x7e]{8,400}$/.test(k); }

  Screens.keySheet = function (onDone) {
    const cfg = root.App.llmConfig();
    const k = UI.field({ label: 'API key', type: 'password', autocomplete: 'off', placeholder: 'Paste your key', hint: 'Held in memory until you close the app. Never saved, never in backups.' });
    U.sheet('Use your key · ' + (LLM.PROVIDERS[cfg.provider] || {}).label, h('div', { class: 'stack' }, k, h('div', { class: 'muted small' }, 'Provider and model come from Coach settings. It is sent only to ' + hostOf(cfg) + '.')), [{ label: 'Cancel' }, { label: 'Use key', kind: 'primary', run: () => {
      const v = k.input.value.trim();
      if (!keyOk(v)) { U.toast('That does not look like an API key.', 'warn'); return false; }
      root.App.setKey(v, 'typed');
      if (onDone) setTimeout(onDone, 0);
    } }]);
  };

  // ---------- Coach setup ----------
  const CSP_ORIGINS = ['https://api.anthropic.com', 'https://api.openai.com', 'https://generativelanguage.googleapis.com'];
  function customNote(cfg) {
    if (cfg.provider !== 'custom' || !cfg.baseUrl) return null;
    let origin = '';
    try { origin = new URL(LLM.cleanBase(cfg.baseUrl)).origin; } catch (e) { return h('div', { class: 'warnbox' }, e.message); }
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (local || CSP_ORIGINS.includes(origin)) return h('div', { class: 'muted small' }, 'Allowed by Orbit\'s security policy.');
    return h('div', { class: 'warnbox' }, origin + ' is not allowed yet. Orbit only talks to origins listed in index.html (connect-src). Add that origin there once, reload, and it will work. This keeps a rogue script from sending your data elsewhere.');
  }

  Screens.coachSetup = function () {
    const set = Store.getSettings(), c = set.coach, cfg = root.App.llmConfig();
    const P = LLM.PROVIDERS;
    const setCoach = (patch) => Store.saveSettings({ coach: Object.assign({}, c, patch) });
    const provPills = UI.pills({ label: 'Provider', items: Object.keys(P).map((k) => P[k].label), values: new Set([P[c.provider].label]), multi: false, onChange: (v) => {
      const label = Array.from(v)[0], id = Object.keys(P).find((k) => P[k].label === label);
      setCoach({ provider: id, model: '' }).then(() => root.App.render());
    } });
    const model = UI.field({ label: 'Model', value: c.model, placeholder: P[c.provider].defaultModel || 'model name', maxlength: 80, hint: 'Leave empty for the default. Model names change; use one from your provider\'s docs.' });
    model.input.addEventListener('change', () => setCoach({ model: model.input.value.trim() }));
    const base = c.provider === 'custom' ? UI.field({ label: 'Endpoint (OpenAI-compatible)', value: c.baseUrl, placeholder: 'http://localhost:11434/v1', maxlength: 200, hint: 'Ollama, LM Studio, OpenRouter and similar. Must be https, or http on localhost.' }) : null;
    if (base) base.input.addEventListener('change', () => setCoach({ baseUrl: base.input.value.trim() }).then(() => root.App.render()));

    // key area
    const keyBox = h('div', { class: 'stack' });
    const modeSeg = UI.seg({ label: 'Where should the key live?', options: [{ value: 'session', label: 'Just this session' }, { value: 'vault', label: 'Encrypted here' }, { value: 'file', label: 'From a key file' }], value: c.keyMode, onChange: (v) => { setCoach({ keyMode: v }).then(() => root.App.render()); } });
    const status = root.App.hasKey() ? U.chip('Key loaded (' + root.App.keyState.source + ')', 'good') : U.chip('No key loaded', 'line');
    if (c.keyMode === 'session') {
      const k = UI.field({ label: 'API key', type: 'password', placeholder: 'Paste your key', hint: 'Kept in memory only. Closing the app forgets it.' });
      U.put(keyBox, k, UI.btn('Use this key', { onClick: () => { const v = k.input.value.trim(); if (!keyOk(v)) return U.toast('That does not look like an API key.', 'warn'); root.App.setKey(v, 'typed'); k.input.value = ''; U.toast('Key loaded for this session.'); root.App.render(); } }));
    } else if (c.keyMode === 'vault') {
      const k = UI.field({ label: 'API key', type: 'password', placeholder: 'Paste your key (first time only)' });
      const pass = UI.field({ label: 'Passphrase', type: 'password', hint: 'Encrypts the key with AES-256 on this device. There is no reset if you forget it.' });
      U.put(keyBox, k, pass,
        UI.btn('Encrypt and keep', { onClick: async () => {
          const v = k.input.value.trim(), pw = pass.input.value;
          if (!keyOk(v)) return U.toast('Paste the key first.', 'warn');
          if (pw.length < 8) return U.toast('Use a passphrase of 8 or more characters.', 'warn');
          try { await Store.setMeta('keyvault', await Crypt.encryptText(v, pw)); root.App.setKey(v, 'vault'); k.input.value = ''; pass.input.value = ''; U.toast('Key encrypted and saved. Unlock it with your passphrase next time.'); root.App.render(); } catch (e) { U.toast(e.message, 'warn'); }
        } }),
        UI.btn('Unlock saved key', { kind: 'quiet', onClick: async () => {
          const env = await Store.getMeta('keyvault');
          if (!env) return U.toast('No saved key yet.', 'warn');
          try { root.App.setKey(await Crypt.decryptText(env, pass.input.value), 'vault'); pass.input.value = ''; U.toast('Unlocked.'); root.App.render(); } catch (e) { U.toast(e.message, 'warn'); }
        } }),
        UI.btn('Delete saved key', { kind: 'danger', onClick: async () => { await Store.delMeta('keyvault'); root.App.clearKey(); U.toast('Deleted.'); root.App.render(); } }));
    } else {
      const f = h('input', { type: 'file', class: 'hidden', accept: '.txt,.key,.env,.json,text/plain,application/json', 'aria-label': 'Key file' });
      f.addEventListener('change', async () => {
        const file = f.files && f.files[0]; f.value = '';
        if (!file) return;
        if (file.size > 8192) return U.toast('That file is too big to be a key file.', 'warn');
        const v = parseKeyText(await file.text());
        if (!keyOk(v)) return U.toast('Could not find a key in that file.', 'warn');
        root.App.setKey(v, 'file'); U.toast('Key loaded from file. It was not copied anywhere.'); root.App.render();
      });
      U.put(keyBox, f, UI.btn('Choose key file', { icon: 'file', onClick: () => f.click() }), h('div', { class: 'muted small' }, 'A text file containing just the key, or a line like NAME=key, or JSON with "apiKey". The file is read into memory and never stored. You pick it again next time.'));
    }

    return UI.page(UI.header('Coach settings', 'Your model, your key, your cost.', { back: '#/coach' }), UI.scroller(
      UI.card(provPills, model, base, customNote(Object.assign({}, cfg, { baseUrl: c.baseUrl }))),
      UI.card(h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'API key'), status), modeSeg, keyBox,
        root.App.hasKey() ? UI.btn('Forget key in memory', { kind: 'quiet', onClick: () => { root.App.clearKey(); U.toast('Cleared.'); root.App.render(); } }) : null),
      UI.btn('Test connection', { kind: 'quiet', onClick: async (e) => {
        if (!root.App.aiReady()) return U.toast('Add a key (and a model or endpoint) first.', 'warn');
        const b = e.currentTarget; b.disabled = true; U.toast('Testing...');
        try { const r = await LLM.ping(root.App.llmConfig()); U.toast('Connected. Reply: ' + r.slice(0, 40)); } catch (er) { U.toast(String(er.message || er).slice(0, 200), 'warn'); }
        b.disabled = false;
      } }),
      UI.card(h('div', { class: 'ct' }, 'What leaves your phone'),
        h('div', { class: 'muted' }, 'Only requests you trigger, sent straight from this device to ' + hostOf(cfg) + ' with your key: a summary of your numbers for the coach, or the text you type when you ask for a food estimate. Not your name, not your photos. The key is never written into backups, logs or the repository.'),
        h('div', { class: 'muted small' }, 'The coach cannot change anything by itself. It can suggest, and you tap Apply. Every change has an Undo.'))));
  };
})(self);
