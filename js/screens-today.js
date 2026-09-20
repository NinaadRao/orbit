/* Today (workout + set logging + rest timer), Lifts (week-by-week targets) and a single lift's detail. */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h, s } = U;
  const Screens = root.Screens = root.Screens || {};

  const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'x';
  const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : '';
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  Screens._ = Object.assign(Screens._ || {}, { slug, cap, numOrNull });

  // ---------- rest timer (lives outside the page so re-rendering does not reset it) ----------
  let timer = null; // { end, total, label }
  let tickId = null;
  function startTimer(sec, label) {
    timer = { end: Date.now() + sec * 1000, total: sec, label: label || '' };
    if (!tickId) tickId = setInterval(tick, 500);
    tick();
  }
  function stopTimer() { timer = null; if (tickId) { clearInterval(tickId); tickId = null; } tick(); }
  function fmtClock(ms) { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function tick() {
    const els = document.querySelectorAll('.timer-t');
    if (timer) {
      const left = timer.end - Date.now();
      if (left <= 0 && !timer.done) { timer.done = true; try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
      if (left < -30000) { stopTimer(); if (root.App) root.App.render(); return; }
      for (const el of els) el.textContent = left > 0 ? fmtClock(left) : 'Go';
    }
  }
  function timerBar() {
    if (!timer) return null;
    return h('div', { class: 'timerbar', role: 'timer' }, U.icon('dumbbell', 20),
      h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Rest' + (timer.label ? ' · ' + timer.label : '')), h('div', { class: 'timer-t' }, fmtClock(timer.end - Date.now()))),
      h('button', { class: 'btn quiet small', type: 'button', onclick: () => { timer.end += 30000; timer.done = false; tick(); } }, '+30 s'),
      h('button', { class: 'btn quiet small', type: 'button', onclick: () => { stopTimer(); root.App.render(); } }, 'Skip'));
  }

  // ---------- set logging ----------
  // opts: { liftId, label, bw, defaultKg, defaultReps, date, restSec, existing }
  function setSheet(opts) {
    const set = Store.getSettings(), lu = set.liftUnit, ex = opts.existing;
    const wInp = UI.field({ label: 'Weight', unit: lu, type: 'number', value: ex ? (ex.kg == null ? '' : U.fmtWeight(ex.kg, lu, 1)) : opts.defaultKg != null ? U.fmtWeight(opts.defaultKg, lu, 1) : '', flex: 1 });
    const rInp = UI.field({ label: 'Reps', type: 'number', inputmode: 'numeric', value: ex ? ex.reps : opts.defaultReps || '', flex: 1 });
    let rpe = ex && ex.rpe ? String(ex.rpe) : '', warm = !!(ex && ex.warmup);
    const note = UI.field({ label: 'Note (optional)', value: ex && ex.note ? ex.note : '', maxlength: 200, hint: 'Form cue, pain, gym was full.' });
    const body = h('div', { class: 'stack' },
      UI.row(...(opts.bw ? [rInp] : [wInp, rInp])),
      set.logRpe ? UI.seg({ label: 'Effort (RPE, optional)', options: [{ value: '', label: 'Skip' }, '6', '7', '8', '9', '10'], value: rpe, onChange: (v) => { rpe = v; } }) : null,
      set.logWarmups ? UI.toggleRow('Warm-up set', 'Not counted toward your targets', warm, (v) => { warm = v; }) : null,
      set.logNotes ? note : null);
    const actions = [{ label: 'Cancel' }];
    if (ex) actions.push({ label: 'Delete', kind: 'danger', run: async () => { await Store.voidEvent(ex.seq); root.App.render(); } });
    actions.push({ label: 'Save', kind: 'primary', run: () => {
      const reps = Math.round(numOrNull(rInp.input.value) || 0);
      const w = opts.bw ? null : numOrNull(wInp.input.value);
      if (!(reps >= 1 && reps <= 100)) { U.toast('Reps must be between 1 and 100.', 'warn'); return false; }
      const tracked = !!Store.getState().plan.lifts[opts.liftId];
      const noWeight = opts.bw || (!tracked && w == null); // accessories can be logged by reps alone
      if (!noWeight && !(w >= 0 && w <= 2000)) { U.toast('Enter the weight you used.', 'warn'); return false; }
      const kg = noWeight ? null : E.clean(U.unitToKg(w, lu));
      if (kg != null && kg > 700) { U.toast('That weight looks too high. Check the unit.', 'warn'); return false; }
      const plan = Store.getState().plan, date = opts.date || U.today();
      const data = { date, week: E.weekOf(plan.startDate, date), lift: opts.liftId, kg, reps };
      if (opts.label && !plan.lifts[opts.liftId]) data.name = String(opts.label).slice(0, 60);
      if (rpe) data.rpe = Number(rpe);
      if (warm) data.warmup = true;
      const nt = note.input.value.trim();
      if (nt) data.note = nt.slice(0, 200);
      (async () => {
        if (ex) await Store.voidEvent(ex.seq);
        await Store.append('set_logged', data);
        if (!ex && !warm && set.restTimer) startTimer(opts.restSec || 90, opts.label);
        root.App.render();
      })();
    } });
    U.sheet((ex ? 'Edit set · ' : 'Log set · ') + (opts.label || 'Lift'), body, actions);
  }

  function setChips(sets, opts, lu) {
    const box = h('div', { class: 'setchips' });
    for (const x of sets) {
      box.appendChild(h('button', { type: 'button', class: 'setchip done', 'aria-label': 'Edit logged set', onclick: () => setSheet(Object.assign({}, opts, { existing: x })) },
        (x.warmup ? 'W ' : '') + (x.kg == null ? '' : U.fmtWeight(x.kg, lu, 1) + ' x ') + x.reps));
    }
    box.appendChild(h('button', { type: 'button', class: 'setchip add', onclick: () => setSheet(opts) }, '+ Log set'));
    return box;
  }

  // ---------- weigh-in ----------
  function weighCard(st, set) {
    const t = U.today();
    const todays = st.weights.filter((w) => w.date === t);
    const last = st.weights.length ? st.weights[st.weights.length - 1] : null;
    const inp = UI.field({ label: todays.length ? 'Weigh again' : 'Morning weight', unit: set.bodyUnit, type: 'number', flex: 1, placeholder: last ? U.fmtWeight(last.kg, set.bodyUnit) : '' });
    return UI.card(
      h('div', { class: 'ct' }, 'Weigh-in'),
      todays.length ? h('div', { class: 'muted' }, 'Logged today: ' + todays.map((w) => U.fmtWeight(w.kg, set.bodyUnit) + ' ' + set.bodyUnit).join(', ')) : h('div', { class: 'muted small' }, 'Same time, same conditions. Orbit uses a 7-day average so one bad morning does not matter.'),
      UI.row(inp, UI.btn('Log', { block: false, onClick: async () => {
        const v = numOrNull(inp.input.value);
        const kg = v == null ? null : U.unitToKg(v, set.bodyUnit);
        if (!(kg >= 30 && kg <= 300)) return U.toast('Enter a weight between 30 and 300 kg.', 'warn');
        await Store.append('weight_logged', { date: t, kg: E.clean(kg) });
        U.toast('Logged.'); root.App.render();
      } })));
  }

  function switchGoalSheet(goal, reason, src) {
    const st = Store.getState(), plan = st.plan, kg = st.weights.length ? st.weights[st.weights.length - 1].kg : st.profile.weightKg;
    const t = E.targetsFor(goal, { sex: st.profile.sex, kg, cm: st.profile.heightCm, age: st.profile.age, days: (st.profile.days || []).length || 5 });
    const base = Object.fromEntries(Object.entries(plan.measTargets).map(([k, m]) => [k, m.start]));
    U.sheet('Switch to ' + goal + '?', h('div', { class: 'stack' },
      h('div', { class: 'kv' }, h('span', null, 'Calories'), h('b', null, U.withCommas(plan.kcal) + ' to ' + U.withCommas(t.kcal))),
      h('div', { class: 'kv' }, h('span', null, 'Protein'), h('b', null, plan.protein + ' g to ' + t.protein + ' g')),
      h('div', { class: 'kv' }, h('span', null, 'Carbs / fat'), h('b', null, t.carbs + ' g / ' + t.fat + ' g')),
      h('div', { class: 'muted small' }, 'Measurement targets are recalculated from your starting numbers. Your logs are untouched.')), [
      { label: 'Not now' },
      { label: 'Switch', kind: 'primary', run: async () => {
        await Store.append('plan_revised', { reason: reason || 'Switched goal to ' + goal, changes: { goal, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, measTargets: E.measurementTargets(goal, base) } }, src || 'user');
        U.toast('Goal changed.'); root.App.render();
      } }]);
  }
  Screens.switchGoalSheet = switchGoalSheet;

  // ---------- Today ----------
  Screens.today = function () {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings();
    const t = U.today();
    const rawWeek = E.weekOf(plan.startDate, t);
    const week = E.clamp(rawWeek, 1, E.WEEKS);
    const deload = plan.deloadWeeks.includes(week);
    const ci = rawWeek <= E.WEEKS ? E.checkinStatus(st, set.checkinDay, t) : null;
    const pct = Math.min(100, Math.max(0, ((E.daysBetween(plan.startDate, t) + 1) / (E.WEEKS * 7)) * 100));
    const C = 2 * Math.PI * 34;
    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': 'Plan progress ' + Math.round(pct) + ' percent' },
      s('svg', { viewBox: '0 0 84 84' }, s('circle', { cx: 42, cy: 42, r: 34, fill: 'none', stroke: U.PAL.track, 'stroke-width': 8 }),
        s('circle', { cx: 42, cy: 42, r: 34, fill: 'none', stroke: U.PAL.acc, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': (C * pct / 100).toFixed(1) + ' ' + C.toFixed(1), transform: 'rotate(-90 42 42)' })),
      h('div', { class: 'mid' }, String(Math.round(pct)) + '%', h('small', null, 'of plan')));
    const cards = [];

    cards.push(UI.card(h('div', { class: 'todayhead' }, ring, h('div', { class: 'grow' },
      h('div', { class: 'display big2' }, 'Week ' + week + ' of ' + E.WEEKS),
      h('div', { class: 'muted' }, cap(plan.goal) + ' · ' + U.withCommas(plan.kcal) + ' kcal · ' + plan.protein + ' g protein'),
      h('div', { class: 'row' }, deload ? U.chip('Deload week: 2 easier sets', 'good') : null, ci ? U.chip(ci.status === 'done' ? 'Check-in done' : ci.status === 'due' ? 'Check-in today' : 'Check-in ' + U.DOW[set.checkinDay], ci.status === 'done' ? 'good' : 'acc') : null)))));

    if (rawWeek > E.WEEKS) cards.push(UI.cardX('good', h('div', { class: 'ct' }, 'You finished all 26 weeks'), h('div', { class: 'muted' }, 'Take your final photos and measurements, then compare against week 1 in Progress. Your logs stay here as long as you keep the app.'), UI.btn('See progress', { href: '#/progress' })));

    const cp = E.checkpoint(st, t);
    if (cp) cards.push(UI.cardX('acc', h('div', { class: 'ct' }, 'Checkpoint · week ' + cp.week), h('div', null, cp.text), UI.row(UI.btn('Review goal', { kind: 'primary', onClick: () => switchGoalSheet(cp.goal, cp.text, 'checkpoint') }))));

    // Monthly review: rules only, every number has a sentence behind it.
    const monthNo = Math.floor(week / 4);
    if (week >= 4 && (set.reviewSeen || 0) < monthNo) {
      const rev = E.reviewMonth(st, t);
      cards.push(UI.card(h('div', { class: 'ct' }, 'Monthly check-in'), h('div', null, rev.message),
        rev.perWeek != null ? h('div', { class: 'muted small' }, 'Weight trend: ' + (rev.perWeek >= 0 ? '+' : '') + U.fmtWeight(rev.perWeek, set.bodyUnit, 2) + ' ' + set.bodyUnit + ' per week' + (rev.waistDelta != null ? ' · waist ' + (rev.waistDelta >= 0 ? '+' : '') + U.fmtLen(rev.waistDelta, set.lenUnit, 1) + ' ' + set.lenUnit : '')) : null,
        UI.row(
          rev.proposal ? UI.btn('Apply ' + (rev.kcalDelta > 0 ? '+' : '') + rev.kcalDelta + ' kcal', { onClick: async () => { await Store.append('plan_revised', { reason: rev.message, changes: rev.proposal }, 'review'); await Store.saveSettings({ reviewSeen: monthNo }); root.App.render(); } }) : null,
          UI.btn(rev.proposal ? 'Keep as is' : 'Got it', { kind: 'quiet', onClick: async () => { await Store.saveSettings({ reviewSeen: monthNo }); root.App.render(); } }))));
    }

    // Gentle backup nudge: browsers can clear site data, and the file is the only safety net.
    if (set.reminder !== 'off') {
      const since = set.lastBackupAt ? E.daysBetween(set.lastBackupAt.slice(0, 10), t) : E.daysBetween(plan.startDate, t);
      if (since >= (set.reminder === 'monthly' ? 30 : 7)) cards.push(UI.cardX('good', h('div', { class: 'ct' }, 'Back up your data'), h('div', { class: 'muted' }, set.lastBackupAt ? 'Your last backup was ' + since + ' days ago.' : 'You have not made a backup yet.'), UI.btn('Back up now', { href: '#/settings' })));
    }
    if (ci && ci.missed.length) {
      const w = ci.missed[ci.missed.length - 1];
      cards.push(UI.cardX('coral', h('div', { class: 'ct' }, 'The check-in for ' + U.longDate(E.checkinDate(st.plan.startDate, w, set.checkinDay)) + ' is missing'), h('div', { class: 'muted' }, ci.missed.length > 1 ? ci.missed.length + ' weekly check-ins are not finished. Start with the latest.' : 'The weekly photo check-in is not finished. Add the photos you can now.'), UI.btn('Add those photos', { href: '#/photos', onClick: () => Screens._.gotoWeek(w) })));
    }
    if (ci && (ci.status === 'due' || ci.status === 'overdue')) {
      cards.push(UI.cardX(ci.status === 'overdue' ? 'coral' : 'acc', h('div', { class: 'ct' }, ci.status === 'overdue' ? 'Weekly check-in is overdue' : 'Weekly check-in today'),
        h('div', { class: 'muted' }, (ci.taken ? ci.taken + ' of ' + ci.of + ' angles saved. ' : '') + 'Five angles, same light, same spot. It takes two minutes and it is not optional. Change the day in Profile.'),
        UI.btn(ci.taken ? 'Finish the photos' : 'Take photos', { href: '#/photos', onClick: () => Screens._.gotoWeek(ci.week) })));
    }

    // Workout
    const wo = plan.workouts.find((w) => w.weekday === E.weekdayOf(t));
    const todaySets = st.sets.filter((x) => x.date === t);
    if (wo) {
      const list = h('div', null);
      let doneEx = 0;
      for (const ex of wo.ex) {
        const lift = ex.lift ? plan.lifts[ex.lift] : null;
        const id = lift ? lift.id : 'acc_' + slug(ex.n);
        const mine = todaySets.filter((x) => x.lift === id);
        let targetTxt, defaultKg = null, defaultReps = null, bw = false;
        if (lift) {
          const tg = E.liftTarget(lift, week, { deloadWeeks: plan.deloadWeeks });
          bw = !!lift.bw;
          targetTxt = tg.sets + ' x ' + tg.reps + (tg.kg == null ? ' reps' : ' @ ' + U.fmtLift(tg.kg, set.liftUnit));
          defaultKg = tg.kg; defaultReps = tg.reps;
          const lastMine = mine.filter((x) => !x.warmup).slice(-1)[0];
          if (lastMine) defaultKg = lastMine.kg;
          if (mine.filter((x) => !x.warmup).length >= tg.sets) doneEx++;
        } else {
          targetTxt = ex.sets + ' x ' + (ex.range || 'work sets');
          const lo = parseInt(ex.range, 10);
          if (lo > 0) defaultReps = lo;
          const lastMine = mine.slice(-1)[0];
          if (lastMine) defaultKg = lastMine.kg;
          if (mine.filter((x) => !x.warmup).length >= ex.sets) doneEx++;
        }
        const opts = { liftId: id, label: ex.n, bw, defaultKg, defaultReps, restSec: ex.rest || 90 };
        list.appendChild(h('div', { class: 'exrow' },
          h('div', { class: 'exname' }, h('span', null, ex.n), h('span', { class: 'extarget' }, targetTxt)),
          ex.flag ? h('div', { class: 'flag' }, ex.flag) : null,
          setChips(mine, opts, set.liftUnit)));
      }
      cards.push(UI.card(h('div', { class: 'todayhead' }, h('div', { class: 'grow' }, h('div', { class: 'ct' }, wo.name + ' day'), h('div', { class: 'muted small' }, doneEx + ' of ' + wo.ex.length + ' exercises done')), U.chip(set.restTimer ? 'Rest timer on' : 'Timer off', 'line')), list));
    } else {
      const nextIdx = [1, 2, 3, 4, 5, 6, 7].map((d) => plan.workouts.find((w) => w.weekday === (E.weekdayOf(t) + d) % 7)).find(Boolean);
      cards.push(UI.card(h('div', { class: 'ct' }, 'Rest day'), h('div', { class: 'muted' }, 'A light walk counts. ' + (nextIdx ? 'Next up: ' + nextIdx.name + ' on ' + U.DOW[nextIdx.weekday] + '.' : '')), UI.btn('See this week\'s lifts', { kind: 'quiet', href: '#/lifts' })));
    }

    // Food summary
    const tot = E.dayTotals(st, t);
    cards.push(UI.card(h('div', { class: 'target-top' }, h('div', { class: 'ct' }, 'Fuel today'), h('a', { class: 'chip line', href: '#/fuel' }, 'Log food')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'display big' }, U.withCommas(tot.kcal), h('span', { class: 'muted unitbig' }, ' / ' + U.withCommas(plan.kcal) + ' kcal'))), h('div', { class: 'muted' }, tot.n ? Math.round(tot.protein) + ' / ' + plan.protein + ' g protein' : 'Nothing logged')),
      U.bar(plan.kcal ? (tot.kcal / plan.kcal) * 100 : 0, tot.kcal > plan.kcal * 1.1 ? 'coral' : '', true)));

    cards.push(weighCard(st, set));
    const tb = timerBar();
    if (tb) cards.push(tb);
    const left = Screens.volatile ? h('div', { class: 'warnbox' }, 'Storage is blocked in this browser mode. Nothing here will be kept.') : null;
    return UI.page(UI.header('Today', U.longDate(t), { right: h('div', { class: 'hdr-actions' }, h('a', { class: 'iconbtn', href: '#/profile', 'aria-label': 'Profile' }, U.icon('user', 20)), h('a', { class: 'iconbtn', href: '#/settings', 'aria-label': 'Privacy, backup and settings' }, U.icon('shield', 20))) }), UI.scroller(left, ...cards));
  };

  // ---------- Lifts ----------
  let viewWeek = null;
  function statusChip(st) { return h('span', { class: 'status-' + st }, st); }
  Screens.lifts = function () {
    const state = Store.getState(), plan = state.plan, set = Store.getSettings(), t = U.today();
    const cur = E.clamp(E.weekOf(plan.startDate, t), 1, E.WEEKS);
    const w = viewWeek == null ? cur : viewWeek;
    const rows = Object.values(plan.lifts).map((l) => {
      const ls = E.liftStatus(state, l.id, w, t);
      const tg = ls.target;
      return h('a', { class: 'liftcard', href: '#/lifts/' + l.id },
        h('div', { class: 'grow' }, h('b', null, l.name), h('span', { class: 'muted small' }, tg.sets + ' x ' + tg.reps + (tg.kg == null ? ' reps' : ' @ ' + U.fmtLift(tg.kg, set.liftUnit)) + (tg.deload ? ' · deload' : ''))),
        h('div', { class: 'small' }, w <= cur ? statusChip(ls.status) : h('span', { class: 'muted' }, 'Ahead')),
        U.icon('chev', 18));
    });
    const nav = h('div', { class: 'daynav' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Previous week', disabled: w <= 1, onclick: () => { viewWeek = w - 1; root.App.render(); } }, U.icon('back', 20)),
      h('div', { class: 'grow', style: { textAlign: 'center' } }, h('div', { class: 'd' }, 'Week ' + w), h('div', { class: 'muted small' }, U.shortDate(E.weekRange(plan.startDate, w)[0]) + ' to ' + U.shortDate(E.weekRange(plan.startDate, w)[1]) + (w === cur ? ' · this week' : ''))),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Next week', disabled: w >= E.WEEKS, onclick: () => { viewWeek = w + 1; root.App.render(); } }, U.icon('chev', 20)));
    const hit = Object.values(plan.lifts).filter((l) => E.liftStatus(state, l.id, cur, t).status === 'Hit').length;
    return UI.page(UI.header('Lifts', 'Targets by week. Miss one, carry on.'), UI.scroller(
      nav,
      w !== cur ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { viewWeek = null; root.App.render(); } }, 'Jump to this week') : null,
      UI.card(...(rows.length ? rows : [UI.empty('No tracked lifts yet. Add one below.')])),
      h('div', { class: 'muted small' }, hit + ' of ' + rows.length + ' lifts hit this week' + (plan.deloadWeeks.includes(w) ? '. Week ' + w + ' is a deload: 2 sets at last block\'s weight.' : '.')),
      UI.btn('Add a lift', { kind: 'quiet', icon: 'plus', onClick: addLiftSheet })));
  };

  function addLiftSheet() {
    const st = Store.getState(), plan = st.plan, set = Store.getSettings(), prof = st.profile;
    const free = Object.keys(E.CATALOG).filter((id) => !plan.lifts[id]);
    if (!free.length) return U.toast('Every lift Orbit knows is already tracked.');
    const sel = h('select', { class: 'inp', 'aria-label': 'Lift' }, ...free.map((id) => h('option', { value: id }, E.CATALOG[id].name)));
    const w = UI.field({ label: 'Weight you can do for a solid set', unit: set.liftUnit, type: 'number', flex: 1 });
    const r = UI.field({ label: 'Reps', type: 'number', inputmode: 'numeric', flex: 1 });
    const body = h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Lift'), sel), UI.row(w, r), h('div', { class: 'muted small' }, 'Orbit builds the same block progression for it, starting from where the plan is this week. For pull-ups just enter reps.'));
    U.sheet('Add a lift', body, [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', run: () => {
      const id = sel.value, cat = E.CATALOG[id], reps = numOrNull(r.input.value), wt = numOrNull(w.input.value);
      if (cat.equip !== 'bw' && !(wt > 0)) { U.toast('Add a weight.', 'warn'); return false; }
      if (cat.equip === 'bw' && !(reps > 0)) { U.toast('Add your reps.', 'warn'); return false; }
      const t = prof.training || {};
      const built = E.buildLiftPlan([{ id, on: true, weight: wt, reps }], { dbStep: t.dbStep, machineStep: t.machineStep, sets: t.sets, repStyle: t.repStyle, lighter: false }, (prof.units && prof.units.lift) || set.liftUnit);
      const lift = built[id];
      if (!lift) { U.toast('Could not build that lift.', 'warn'); return false; }
      const wk = E.clamp(E.weekOf(plan.startDate, U.today()), 1, E.WEEKS);
      if (!lift.bw && wk > 1) {
        const now = E.liftTarget(lift, wk, { deloadWeeks: plan.deloadWeeks }).kg;
        if (now > 0) lift.adjust.push({ fromWeek: wk, factor: E.clean(lift.blockKg[0] / now) });
      }
      Store.append('plan_revised', { reason: 'Added ' + lift.name, changes: { addLifts: { [id]: lift } } }, 'user').then(() => { U.toast(lift.name + ' added.'); root.App.render(); });
    } }]);
  }

  // ---------- one lift ----------
  Screens.liftDetail = function (id) {
    const state = Store.getState(), plan = state.plan, set = Store.getSettings(), t = U.today();
    const lift = plan.lifts[id];
    if (!lift) return UI.page(UI.header('Lift', 'Not found', { back: '#/lifts' }), UI.scroller(UI.empty('That lift is not in your plan.')));
    const cur = E.clamp(E.weekOf(plan.startDate, t), 1, E.WEEKS);
    const tgs = [], top = [];
    for (let w = 1; w <= E.WEEKS; w++) {
      const ls = E.liftStatus(state, id, w, t);
      tgs.push({ x: w, y: ls.target.kg == null ? ls.target.reps : U.kgToUnit(ls.target.kg, set.liftUnit) });
      top.push({ x: w, y: ls.logged ? (lift.bw ? ls.topReps : ls.topKg == null ? null : U.kgToUnit(ls.topKg, set.liftUnit)) : null });
    }
    const chart = U.lineChart({ label: lift.name + ' target and logged top set by week', xs: tgs.map((p) => p.x), series: [{ pts: tgs, color: U.PAL.acc, dash: '5 4', width: 2 }, { pts: top, color: U.PAL.cool, dots: true, line: false }], xLabel: (x) => 'Wk ' + x, fmtY: (y) => U.num(y, 0) });
    const rows = [];
    for (let w = 1; w <= E.WEEKS; w++) {
      const ls = E.liftStatus(state, id, w, t), tg = ls.target;
      const cls = w === cur ? ' cur' : '';
      rows.push(h('div', { class: 'kv' + cls },
        h('span', null, 'Wk ' + w + (tg.deload ? ' (deload)' : '') + (w === cur ? ' · now' : '')),
        h('b', null, tg.sets + ' x ' + tg.reps + (tg.kg == null ? '' : ' @ ' + U.fmtLift(tg.kg, set.liftUnit)) + (w <= cur ? '  ' : ''), w <= cur ? statusChip(ls.status) : null)));
    }
    const mine = state.sets.filter((x) => x.lift === id).slice(-12).reverse();
    const hist = mine.length ? mine.map((x) => h('button', { type: 'button', class: 'listrow', onclick: () => setSheet({ liftId: id, label: lift.name, bw: !!lift.bw, existing: x }) },
      h('div', { class: 'grow' }, h('b', null, (x.kg == null ? '' : U.fmtWeight(x.kg, set.liftUnit, 1) + ' ' + set.liftUnit + ' x ') + x.reps + (x.rpe ? ' @ RPE ' + x.rpe : '') + (x.warmup ? ' (warm-up)' : '')), h('span', { class: 'muted small' }, U.shortDate(x.date) + (x.note ? ' · ' + x.note : ''))), U.icon('chev', 16))) : [UI.empty('No sets logged yet.')];
    const adjust = () => {
      const pct = UI.field({ label: 'Change all weights by', unit: '%', type: 'number', value: '', hint: 'Between -10 and 10, e.g. -5 if it has been too heavy.' });
      const from = UI.field({ label: 'From week', type: 'number', inputmode: 'numeric', value: cur });
      U.sheet('Adjust ' + lift.name, h('div', { class: 'stack' }, UI.row(pct, from)), [{ label: 'Cancel' }, { label: 'Apply', kind: 'primary', run: () => {
        const v = E.validateLiftChange(plan, { lift: id, percent: numOrNull(pct.input.value), fromWeek: numOrNull(from.input.value) });
        if (!v.ok) { U.toast(v.errors[0], 'warn'); return false; }
        Store.append('plan_revised', { reason: 'Adjusted ' + lift.name + ' by ' + pct.input.value + '%', changes: { liftAdjust: v.value } }, 'user').then(() => { U.toast('Updated.'); root.App.render(); });
      } }]);
    };
    return UI.page(UI.header(lift.name, cap(lift.muscle) + (lift.bw ? ' · bodyweight' : ' · steps of ' + lift.step + ' ' + lift.unit), { back: '#/lifts' }), UI.scroller(
      UI.card(h('div', { class: 'ct' }, 'Target vs what you lifted'), chart, h('div', { class: 'muted small' }, 'Dashed: target. Dots: your top set each week.')),
      UI.card(h('div', { class: 'ct' }, 'Recent sets'), h('div', { class: 'list' }, ...hist)),
      lift.bw ? null : UI.btn('Adjust weights', { kind: 'quiet', onClick: adjust }),
      UI.card(h('div', { class: 'ct' }, 'All 26 weeks'), ...rows)));
  };

  root.Screens.setSheet = setSheet;
  root.Screens.startTimer = startTimer;
})(self);
