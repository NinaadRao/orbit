'use strict';
// Gemini 3 refuses a follow-up request unless each function call goes back with the thought signature it came with.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.self = globalThis;
require('../js/llm.js');
const LLM = globalThis.LLM;

const sse = (...objs) => new Response(objs.map((o) => 'data: ' + JSON.stringify(o) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const cfg = { provider: 'google', model: 'gemini-3.6-flash', apiKey: 'k' };
const ask = [{ role: 'user', content: [{ type: 'text', text: 'Should I change my calories?' }] }];

test('a thought signature on a function call is kept and sent back with the tool result', async () => {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? sse({ candidates: [{ content: { parts: [{ text: 'Let me look. ' }, { functionCall: { name: 'propose_macro_change', args: { kcal: 2700 } }, thoughtSignature: 'SIG-ABC' }] } }] }, { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] })
      : sse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Done.' }] } }] });
  };
  try {
    const r1 = await LLM.chat(cfg, { system: 's', messages: ask, tools: [{ name: 'propose_macro_change', description: 'd', schema: { type: 'object', properties: {} } }], maxTokens: 100 }, {});
    assert.equal(r1.toolCalls.length, 1);
    assert.equal(r1.toolCalls[0].sig, 'SIG-ABC');
    const history = ask.concat([
      { role: 'assistant', content: [{ type: 'text', text: r1.text }, { type: 'tool_use', id: r1.toolCalls[0].id, name: r1.toolCalls[0].name, input: r1.toolCalls[0].input, sig: r1.toolCalls[0].sig }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: r1.toolCalls[0].id, content: 'ok' }] },
    ]);
    const r2 = await LLM.chat(cfg, { system: 's', messages: history, maxTokens: 100 }, {});
    assert.equal(r2.text, 'Done.');
    const call = bodies[1].contents[1].parts.find((p) => p.functionCall);
    assert.equal(call.thoughtSignature, 'SIG-ABC');
  } finally { globalThis.fetch = realFetch; }
});

test('a signature that arrives on an earlier part of the same reply goes to the first call', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => sse({ candidates: [{ content: { parts: [{ text: '', thoughtSignature: 'EARLY' }] } }] }, { candidates: [{ content: { parts: [{ functionCall: { name: 'a', args: {} } }, { functionCall: { name: 'b', args: {} } }] } }] });
  try {
    const r = await LLM.chat(cfg, { system: 's', messages: ask, maxTokens: 100 }, {});
    assert.deepEqual(r.toolCalls.map((c) => c.sig), ['EARLY', undefined]);
  } finally { globalThis.fetch = realFetch; }
});

test('a call with no saved signature gets the skip value on Gemini 3, and nothing on older models', () => {
  const msgs = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'a', input: {} }, { type: 'tool_use', id: 'y', name: 'b', input: {} }] }];
  const g3 = LLM.toGemini(msgs, 'gemini-3.6-flash')[0].parts;
  assert.equal(g3[0].thoughtSignature, 'skip_thought_signature_validator');
  assert.equal(g3[1].thoughtSignature, undefined, 'only the first call in a turn needs one');
  const old = LLM.toGemini(msgs, 'gemini-2.0-flash')[0].parts;
  assert.ok(old.every((p) => p.thoughtSignature === undefined));
  assert.equal(LLM.toGemini(msgs, 'gemini-2.5-flash')[0].parts[0].thoughtSignature, undefined);
  assert.equal(LLM.toGemini(msgs, 'gemini-3-pro-preview')[0].parts[0].thoughtSignature, 'skip_thought_signature_validator');
});

// A rejected key should be recognised so the app can ask for a new one, without mistaking rate limits or outages for it.
test('isAuthFailure spots expired, wrong and revoked keys but not rate limits or outages', () => {
  const A = LLM.isAuthFailure;
  assert.equal(A(401, ''), true);
  assert.equal(A(400, '{"error":{"message":"API key expired. Please renew the API key.","status":"INVALID_ARGUMENT"}}'), true, 'Google reports an expired key as a 400');
  assert.equal(A(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}'), true);
  assert.equal(A(403, '{"error":{"status":"PERMISSION_DENIED","message":"Your API key was reported as leaked."}}'), true);
  assert.equal(A(400, '{"error":{"code":"invalid_api_key","message":"Incorrect API key provided"}}'), true);
  assert.equal(A(403, 'Forbidden'), true);
  assert.equal(A(429, 'Rate limit reached'), false);
  assert.equal(A(500, 'Internal error'), false);
  assert.equal(A(400, 'Your prompt is too long'), false);
});

test('chat tells the app when the provider rejects the key, then still throws', async () => {
  const realFetch = globalThis.fetch, realHook = LLM.onAuthError;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key', type: 'authentication_error' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  const seen = [];
  LLM.onAuthError = (e, c) => seen.push([e.auth, c.provider]);
  try {
    await assert.rejects(() => LLM.chat({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-bad' }, { system: 's', messages: ask, maxTokens: 50 }, {}), (e) => e.auth === true);
    assert.deepEqual(seen, [[true, 'anthropic']]);
  } finally { globalThis.fetch = realFetch; LLM.onAuthError = realHook; }
});
