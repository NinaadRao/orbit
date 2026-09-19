/*
 * Fuel: the calorie and macro log.
 * Four ways in: find a food, describe it to the AI, type raw ingredients, or enter the numbers by hand.
 * The AI paths only ever fill in a confirmation card. Nothing is stored until the person taps "Looks right".
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, Foods = root.Foods;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

  let viewDate = null;

  function guessMeal() {
    const hr = new Date().getHours();
    return hr < 10 ? 'Breakfast' : hr < 12 ? 'Snack' : hr < 15 ? 'Lunch' : hr < 18 ? 'Snack' : 'Dinner';
  }
  function macroLine(f) { return 'P ' + U.num(f.protein || 0, 0) + ' · C ' + U.num(f.carbs || 0, 0) + ' · F ' + U.num(f.fat || 0, 0); }

  // ---------- writing an entry ----------
  // n is a normalized food (Engine.normalizeFood value). extra carries source and AI evidence.
  async function saveFood(date, meal, n, extra) {
    const data = Object.assign({ date, meal: E.MEALS.includes(meal) ? meal : 'Snack', name: n.name, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat }, extra || {});
    return Store.append('food_logged', data);
  }

  // ---------- Fuel screen ----------
  Screens.fuel = function () {
    const st = Store.getState(), plan = st.plan, t = U.today();
    const date = viewDate && viewDate <= t ? viewDate : t;
    const tot = E.dayTotals(st, date);
    const nav = h('div', { class: 'daynav' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous day', onclick: () => { viewDate = E.addDays(date, -1); root.App.render(); } }, U.icon('back', 20)),
      h('div', { class: 'grow', style: { textAlign: 'center' } }, h('div', { class: 'd' }, date === t ? 'Today' : U.longDate(date)), h('div', { class: 'muted small' }, U.longDate(date))),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next day', disabled: date >= t, onclick: () => { viewDate = E.addDays(date, 1); root.App.render(); } }, U.icon('chev', 20)));
    const remaining = plan.kcal - tot.kcal;
    const macroBar = (label, val, target, kind) => h('div', { class: 'stack' }, h('div', { class: 'kv' }, h('span', null, label), h('b', null, Math.round(val) + ' / ' + target + ' g')), U.bar(target ? (val / target) * 100 : 0, kind));
    const summary = UI.card(
      h('div', { class: 'target-top' }, h('div', null, h('div', { class: 'display big' }, U.withCommas(tot.kcal), h('span', { class: 'muted unitbig' }, ' / ' + U.withCommas(plan.kcal) + ' kcal')), h('div', { class: 'muted small' }, remaining >= 0 ? U.withCommas(remaining) + ' left' : U.withCommas(-remaining) + ' over')), U.chip(E.dayTotals(st, date).n + ' logged', 'line')),
      U.bar(plan.kcal ? (tot.kcal / plan.kcal) * 100 : 0, tot.kcal > plan.kcal * 1.1 ? 'coral' : '', true),
      macroBar('Protein', tot.protein, plan.protein, 'coral'), macroBar('Carbs', tot.carbs, plan.carbs, ''), macroBar('Fat', tot.fat, plan.fat, 'cool'));

    const day = st.foods.filter((f) => f.date === date);
    const sections = [];
    for (const meal of E.MEALS) {
      const items = day.filter((f) => (E.MEALS.includes(f.meal) ? f.meal : 'Snack') === meal);
      if (!items.length) continue;
      const sub = items.reduce((tt, f) => tt + (f.kcal || 0), 0);
      sections.push(UI.card(
        h('div', { class: 'mealhead' }, h('div', { class: 'ct' }, meal), h('span', { class: 'muted small' }, U.withCommas(sub) + ' kcal')),
        ...items.map((f) => h('button', { type: 'button', class: 'listrow foodrow', 'aria-label': 'Edit ' + f.name, onclick: () => editSheet(f) },
          h('div', { class: 'fn' }, h('b', null, f.name), h('span', { class: 'muted small' }, macroLine(f) + (f.serving ? ' · ' + f.serving : ''))),
          f.ai ? U.chip(f.ai.edited ? 'AI, edited' : 'AI est.', 'acc') : null,
          h('div', { class: 'kc' }, String(f.kcal))))));
    }
    const hint = !root.App.aiReady() ? h('div', { class: 'muted small' }, 'Tip: add your own AI key in Coach settings and you can just describe a meal or list raw ingredients. You will always see the numbers before anything is saved.') : null;
    return UI.page(UI.header('Fuel', 'Log what you ate. Approximate is fine, consistent is better.'),
      UI.scroller(nav, summary, UI.btn('Add food', { icon: 'plus', onClick: () => openAdd(date) }),
        ...(sections.length ? sections : [UI.empty(date === t ? 'Nothing logged yet today.' : 'Nothing logged this day.')]), hint));
  };

  // ---------- edit an existing entry ----------
  function editSheet(f) {
    const name = UI.field({ label: 'Name', value: f.name, maxlength: 80 });
    const kc = UI.field({ label: 'Calories', unit: 'kcal', type: 'number', value: f.kcal, flex: 1 });
    const p = UI.field({ label: 'Protein', unit: 'g', type: 'number', value: f.protein, flex: 1 });
    const c = UI.field({ label: 'Carbs', unit: 'g', type: 'number', value: f.carbs, flex: 1 });
    const fa = UI.field({ label: 'Fat', unit: 'g', type: 'number', value: f.fat, flex: 1 });
    let meal = E.MEALS.includes(f.meal) ? f.meal : 'Snack';
    const body = h('div', { class: 'stack' }, name, UI.row(kc), UI.row(p, c, fa), UI.pills({ label: 'Meal', items: E.MEALS, values: new Set([meal]), multi: false, onChange: (v) => { meal = Array.from(v)[0]; } }),
      f.ai && f.ai.assumptions && f.ai.assumptions.length ? h('ul', { class: 'assume' }, ...f.ai.assumptions.map((a) => h('li', null, a))) : null);
    U.sheet('Edit food', body, [{ label: 'Delete', kind: 'danger', run: async () => { await Store.voidEvent(f.seq); root.App.render(); } }, { label: 'Save', kind: 'primary', run: () => {
      const n = E.normalizeFood({ name: name.input.value, kcal: numOrNull(kc.input.value), protein: numOrNull(p.input.value), carbs: numOrNull(c.input.value), fat: numOrNull(fa.input.value) });
      if (!n.ok) { U.toast(n.errors[0], 'warn'); return false; }
      const extra = {};
      if (f.serving) extra.serving = f.serving;
      if (f.source) extra.source = f.source;
      if (f.ai) extra.ai = Object.assign({}, f.ai, { edited: true });
      (async () => { await Store.voidEvent(f.seq); await saveFood(f.date, meal, n.value, extra); root.App.render(); })();
    } }]);
  }

  // ---------- add food ----------
  function openAdd(date, prefill) {
    const pre = prefill || {};
    let tab = pre.tab || 'find', meal = pre.meal || guessMeal(), pick = null, close = null;
    let aiText = pre.text || '', servings = '1', mFields = { name: pre.name || '', kcal: '', protein: '', carbs: '', fat: '' };
    let est = null, busy = null, err = '';
    const body = h('div', { class: 'stack' });
    const finish = (msg) => { if (close) close(); U.toast(msg || 'Logged.'); root.App.render(); };

    const mealPills = () => UI.pills({ label: 'Meal', items: E.MEALS, values: new Set([meal]), multi: false, onChange: (v) => { meal = Array.from(v)[0]; } });
    const tabBar = () => {
      const bar = h('div', { class: 'tabs2', role: 'tablist' });
      for (const [id, label] of [['find', 'Find'], ['ai', 'Describe'], ['ingr', 'Ingredients'], ['manual', 'Manual']]) {
        bar.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', class: tab === id ? 'on' : '', onclick: () => { if (busy) return; tab = id; est = null; pick = null; err = ''; draw(); } }, label));
      }
      return bar;
    };

    // ----- Find -----
    function drawFind() {
      const foods = Store.getState().foods;
      const results = h('div', { class: 'results' });
      const q = UI.field({ label: 'Search foods you eat or common ones', value: pre.text || '', placeholder: 'paneer, dal, whey...', maxlength: 60 });
      const showResults = () => {
        U.clear(results);
        const text = q.input.value.trim();
        let list;
        if (!text) list = Foods.recents(foods, 6).concat(Foods.CATALOG.slice(0, 8));
        else list = Foods.searchRecents(foods, text, 4).concat(Foods.search(text, 8));
        const seen = new Set();
        list = list.filter((f) => { const k = f.name.toLowerCase() + f.serving; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
        for (const f of list) results.appendChild(h('button', { type: 'button', class: 'result', onclick: () => { pick = f; draw(); } },
          h('div', null, h('b', null, f.name), h('small', null, f.serving + ' · ' + macroLine(f) + (f.recent ? ' · from your log' : ''))), h('b', null, String(Math.round(f.kcal)))));
        if (text && !list.length) results.appendChild(h('div', { class: 'empty' }, 'Not in the list. Tell Orbit what is in it, or type the numbers.'));
        results.classList.toggle('hidden', !list.length && !text);
        notListed.classList.toggle('hidden', !text);
      };
      const notListed = h('div', { class: 'stack' },
        h('div', { class: 'muted small' }, 'Not listed? Type the raw ingredients (like "200 g paneer, 1 tbsp oil, 2 rotis") and get an estimate, or enter the macros yourself.'),
        h('div', { class: 'row' }, UI.btn('Type ingredients', { kind: 'quiet', onClick: () => { aiText = q.input.value.trim(); tab = 'ingr'; draw(); } }), UI.btn('Enter macros', { kind: 'quiet', onClick: () => { mFields.name = q.input.value.trim().slice(0, 80); tab = 'manual'; draw(); } })));
      q.input.addEventListener('input', showResults);
      U.put(body, q, results, notListed);
      showResults();
    }
    function drawPick() {
      const f = pick;
      const sv = UI.field({ label: 'Servings of ' + f.serving, type: 'number', value: '1', flex: 1 });
      const live = h('div', { class: 'kv' });
      const upd = () => { const n = Math.max(0, numOrNull(sv.input.value) || 0); U.clear(live); U.put(live, h('span', null, U.num(n * f.kcal, 0) + ' kcal'), h('b', null, macroLine({ protein: n * f.protein, carbs: n * f.carbs, fat: n * f.fat }))); };
      sv.input.addEventListener('input', upd); upd();
      U.put(body, h('div', { class: 'ct' }, f.name), h('div', { class: 'muted small' }, 'Values are typical and approximate. If yours is different, use Manual.'), sv, live,
        h('div', { class: 'row' }, UI.btn('Back', { kind: 'quiet', onClick: () => { pick = null; draw(); } }), UI.btn('Log it', { onClick: async () => {
          const n = numOrNull(sv.input.value);
          if (!(n > 0 && n <= 20)) return U.toast('Servings must be between 0 and 20.', 'warn');
          const r = E.normalizeFood({ name: f.name, kcal: f.kcal * n, protein: f.protein * n, carbs: f.carbs * n, fat: f.fat * n });
          if (!r.ok) return U.toast(r.errors[0], 'warn');
          await saveFood(date, meal, r.value, { serving: n === 1 ? f.serving : U.num(n, 2) + ' x ' + f.serving, source: f.recent ? 'recent' : 'catalog' });
          finish();
        } })));
    }

    // ----- AI (describe) and raw ingredients -----
    function drawAI(mode) {
      if (!root.App.aiReady()) {
        const cfg = root.App.llmConfig();
        U.put(body, UI.card(h('div', { class: 'ct' }, 'Bring your own AI'), h('div', { class: 'muted' }, 'This uses your own key with the provider you choose. The key stays on this device and the text you type goes only to that provider. No key? Manual entry works fine.'),
          UI.btn('Add a key for this session', { onClick: () => root.Screens.keySheet(() => draw()) }),
          UI.btn('Coach settings', { kind: 'quiet', href: '#/coach/setup', onClick: () => { if (close) close(); } }),
          UI.btn('Enter macros myself', { kind: 'quiet', onClick: () => { tab = 'manual'; draw(); } })));
        void cfg;
        return;
      }
      const cfg = root.App.llmConfig();
      let host = '';
      try { host = new URL(root.LLM.endpointOf(cfg)).host; } catch (e) { host = 'your provider'; }
      const ta = h('textarea', { class: 'inp', maxlength: 1200, 'aria-label': mode === 'ingr' ? 'Raw ingredients' : 'What you ate', placeholder: mode === 'ingr' ? '200 g paneer\n1 tbsp oil\n1 onion, 2 tomatoes\nspices' : 'Two rotis with rajma and a bowl of curd', value: aiText, oninput: () => { aiText = ta.value; } });
      const sv = UI.field({ label: 'Makes how many equal servings?', type: 'number', inputmode: 'numeric', value: servings, hint: 'Cooked a pot for 4? Enter 4 and log one share.', onInput: (v) => { servings = v; } });
      const note = h('div', { class: 'muted small' }, 'Sends only this text to ' + host + ' with your key. Nothing is saved until you check the numbers.');
      const errBox = err ? h('div', { class: 'warnbox', role: 'alert' }, err) : null;
      const ctl = new AbortController();
      const go = h('button', { type: 'button', class: 'btn primary block' }, 'Estimate nutrition');
      go.addEventListener('click', async () => {
        if (busy) { ctl.abort(); return; }
        if (!aiText.trim()) { U.toast('Type what you had first.', 'warn'); return; }
        busy = ctl; err = ''; go.textContent = 'Stop';
        go.insertBefore(h('span', { class: 'spin' }), go.firstChild);
        const sN = mode === 'ingr' ? Math.max(1, Math.min(20, Math.round(numOrNull(servings) || 1))) : 1;
        try {
          const r = await root.FoodAI.estimate(cfg, { mode: mode === 'ingr' ? 'ingredients' : 'describe', text: aiText, servings: sN, signal: ctl.signal });
          busy = null;
          if (!document.body.contains(body)) return;
          est = { r, mode, sN, input: aiText.trim().slice(0, 300) };
        } catch (e) {
          busy = null;
          if (!document.body.contains(body)) return;
          err = e && e.name === 'AbortError' ? 'Stopped.' : String(e && e.message ? e.message : e).slice(0, 300);
        }
        draw();
      });
      U.put(body, ta, mode === 'ingr' ? sv : null, note, errBox, go, err ? UI.btn('Enter macros myself', { kind: 'quiet', onClick: () => { mFields.name = aiText.split('\n')[0].slice(0, 80); tab = 'manual'; err = ''; draw(); } }) : null);
    }

    // The confirmation card. Everything is editable and nothing is stored before "Looks right".
    function drawConfirm() {
      const v = est.r.value;
      const name = UI.field({ label: 'Name', value: v.name, maxlength: 80 });
      const kc = UI.field({ label: 'Calories', unit: 'kcal', type: 'number', value: v.kcal, flex: 1 });
      const p = UI.field({ label: 'Protein', unit: 'g', type: 'number', value: v.protein, flex: 1 });
      const c = UI.field({ label: 'Carbs', unit: 'g', type: 'number', value: v.carbs, flex: 1 });
      const fa = UI.field({ label: 'Fat', unit: 'g', type: 'number', value: v.fat, flex: 1 });
      const live = h('div', { class: 'muted small' });
      let ack = false;
      const warn = h('div', { class: 'warnbox hidden', role: 'alert' });
      const okBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Looks right, log it');
      const cur = () => ({ name: name.input.value, kcal: numOrNull(kc.input.value), protein: numOrNull(p.input.value), carbs: numOrNull(c.input.value), fat: numOrNull(fa.input.value) });
      const refresh = () => { const x = cur(); live.textContent = 'Macros add up to about ' + Math.round(E.macroKcal(x.protein, x.carbs, x.fat)) + ' kcal.'; ack = false; warn.classList.add('hidden'); okBtn.textContent = 'Looks right, log it'; };
      for (const f of [kc, p, c, fa, name]) f.input.addEventListener('input', refresh);
      refresh();
      okBtn.addEventListener('click', async () => {
        const x = cur();
        const n = E.normalizeFood(x);
        if (!n.ok) return U.toast(n.errors[0], 'warn');
        if (n.warnings.length && !ack) { ack = true; warn.textContent = n.warnings[0]; warn.classList.remove('hidden'); okBtn.textContent = 'Log anyway'; return; }
        const edited = ['kcal', 'protein', 'carbs', 'fat'].some((k) => n.value[k] !== v[k]) || n.value.name !== v.name;
        await saveFood(date, meal, n.value, { source: est.mode === 'ingr' ? 'ingredients' : 'ai', ai: { items: v.items, assumptions: v.assumptions, confidence: v.confidence, edited, input: est.input } });
        finish('Logged. Estimates can be edited any time from Fuel.');
      });
      const items = v.items.length ? h('div', null, h('div', { class: 'lab' }, 'How it was worked out'), ...v.items.map((it) => h('div', { class: 'itemrow' }, h('span', null, it.name), h('b', null, it.kcal + ' kcal'), h('small', null, (it.qty ? it.qty + ' · ' : '') + macroLine(it))))) : null;
      U.put(body, 
        h('div', { class: 'est' },
          h('div', { class: 'est-top' }, h('div', { class: 'ct' }, 'Check these numbers'), U.chip(v.confidence + ' confidence', v.confidence === 'high' ? 'good' : v.confidence === 'low' ? 'coral' : 'cool')),
          h('div', { class: 'muted small' }, 'This is an AI estimate from what you typed' + (est.sN > 1 ? ' (one of ' + est.sN + ' servings)' : '') + '. Fix anything that looks off, then confirm.'),
          name, UI.row(kc), UI.row(p, c, fa), live,
          items,
          v.assumptions.length ? h('ul', { class: 'assume' }, ...v.assumptions.map((a) => h('li', null, a))) : null,
          est.r.warnings.length ? h('div', { class: 'warnbox' }, est.r.warnings[0]) : null,
          warn, okBtn,
          h('div', { class: 'row' }, UI.btn('Estimate again', { kind: 'quiet', onClick: () => { est = null; draw(); } }), UI.btn('Cancel', { kind: 'quiet', onClick: () => close && close() }))));
    }

    // ----- Manual -----
    function drawManual() {
      const name = UI.field({ label: 'What was it?', value: mFields.name, maxlength: 80, placeholder: 'Homemade dal, 1 bowl', onInput: (v) => { mFields.name = v; } });
      const kc = UI.field({ label: 'Calories', unit: 'kcal', type: 'number', value: mFields.kcal, flex: 1, onInput: (v) => { mFields.kcal = v; upd(); } });
      const p = UI.field({ label: 'Protein', unit: 'g', type: 'number', value: mFields.protein, flex: 1, onInput: (v) => { mFields.protein = v; upd(); } });
      const c = UI.field({ label: 'Carbs', unit: 'g', type: 'number', value: mFields.carbs, flex: 1, onInput: (v) => { mFields.carbs = v; upd(); } });
      const fa = UI.field({ label: 'Fat', unit: 'g', type: 'number', value: mFields.fat, flex: 1, onInput: (v) => { mFields.fat = v; upd(); } });
      const live = h('div', { class: 'muted small' });
      const warn = h('div', { class: 'warnbox hidden', role: 'alert' });
      let ack = false;
      const okBtn = h('button', { type: 'button', class: 'btn primary block' }, 'Log it');
      function upd() { const k = E.macroKcal(numOrNull(mFields.protein), numOrNull(mFields.carbs), numOrNull(mFields.fat)); live.textContent = k ? 'Macros add up to about ' + Math.round(k) + ' kcal. Leave calories empty to use that.' : 'Leave calories empty to work them out from the macros.'; ack = false; warn.classList.add('hidden'); okBtn.textContent = 'Log it'; }
      upd();
      okBtn.addEventListener('click', async () => {
        const n = E.normalizeFood({ name: mFields.name, kcal: numOrNull(mFields.kcal), protein: numOrNull(mFields.protein), carbs: numOrNull(mFields.carbs), fat: numOrNull(mFields.fat) });
        if (!n.ok) return U.toast(n.errors[0], 'warn');
        if (n.warnings.length && !ack) { ack = true; warn.textContent = n.warnings[0]; warn.classList.remove('hidden'); okBtn.textContent = 'Log anyway'; return; }
        await saveFood(date, meal, n.value, { source: 'manual' });
        finish();
      });
      U.put(body, name, UI.row(kc), UI.row(p, c, fa), live, warn, okBtn);
    }

    function draw() {
      U.clear(body);
      U.put(body, tabBar());
      if (!(tab === 'find' && pick)) U.put(body, mealPills());
      if (est) drawConfirm();
      else if (tab === 'find') { if (pick) drawPick(); else drawFind(); }
      else if (tab === 'ai' || tab === 'ingr') drawAI(tab);
      else drawManual();
    }
    draw();
    close = U.sheet('Add food · ' + (date === U.today() ? 'today' : U.shortDate(date)), body, [{ label: 'Close', kind: 'quiet' }]);
  }

  Screens.openAddFood = openAdd;
})(self);
