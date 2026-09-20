/* Welcome + five-step onboarding. Everything stays in memory until "Start week 1". */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;

  function freshDraft() {
    const lifts = {};
    for (const id of E.DEFAULT_LIFT_ORDER) lifts[id] = { on: id !== 'barbell_squat', weight: '', reps: '' };
    return {
      name: '', sex: 'male', age: '', ft: '', inch: '', cm: '', weight: '', bf: '',
      units: { body: 'kg', length: 'in', lift: 'lb' },
      meas: { waist: '', chest: '', shoulders: '', hips: '', bicepL: '', bicepR: '', forearmL: '', forearmR: '' },
      goal: null, days: [1, 2, 3, 4, 5], sessionMin: '90', timeOfDay: 'AM', diet: 'Vegetarian', creatine: 'Yes', currentKcal: '', currentProtein: '',
      training: { experience: '1-3 yrs', split: 'Orbit picks', equipment: new Set(['Dumbbells', 'Machines', 'Cables', 'Bodyweight']), dbStep: null, machineStep: null, focus: new Set(['Chest']), injuries: new Set(['Nothing']), repStyle: 'mixed', sets: '3', rest: '90 s', deload: 'planned', logRpe: true, restTimer: true, warmups: false, notes: true },
      lifts, extra: [], custom: [], startLighter: false, dietPrefs: E.defaultDietPrefs(),
    };
  }
  let D = freshDraft();

  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

  function heightCm() {
    if (D.units.length === 'in') { const ft = num(D.ft), inch = num(D.inch) || 0; return ft == null ? null : E.clamp(ft * 30.48 + inch * 2.54, 0, 400); }
    return num(D.cm);
  }
  function weightKg() { const w = num(D.weight); return w == null ? null : U.unitToKg(w, D.units.body); }
  function measCm() {
    const out = {};
    for (const [k] of E.MEAS_SITES) { const v = num(D.meas[k]); if (v != null && v > 0) out[k] = E.clean(U.unitToCm(v, D.units.length)); }
    return out;
  }
  function stepsFor(unit) { return unit === 'kg' ? { db: [1, 2], mach: [2.5, 5] } : { db: [2.5, 5], mach: [5, 10] }; }

  function buildAnswers() {
    const t = D.training;
    const lu = D.units.lift;
    const st = stepsFor(lu);
    const lifts = [];
    for (const id of E.DEFAULT_LIFT_ORDER.concat(D.extra)) {
      const l = D.lifts[id];
      if (!l || !l.on) continue;
      const cat = E.CATALOG[id];
      if (cat.equip === 'bw') { if (num(l.reps)) lifts.push({ id, on: true, reps: num(l.reps) }); continue; }
      const w = num(l.weight);
      if (w > 0) lifts.push({ id, on: true, weight: w, reps: num(l.reps) || null });
    }
    for (const c of D.custom) {
      const w = num(c.weight);
      if (c.on !== false && c.name.trim() && (c.equip === 'bw' ? num(c.reps) : w > 0)) lifts.push({ id: E.newLiftId({ lifts: Object.fromEntries(lifts.map((x) => [x.id, 1])) }, c.name), on: true, name: c.name.trim().slice(0, 40), muscle: c.muscle, equip: c.equip, weight: w, reps: num(c.reps) || null, cls: c.cls || 'medium', gain: c.gain != null ? c.gain : 0.25 });
    }
    const splitMap = { 'Orbit picks': 'auto', 'Push / Pull / Legs': 'ppl', 'Upper / Lower': 'ul', 'Body-part days': 'bodypart', 'Full body': 'fullbody' };
    return {
      name: D.name.trim().slice(0, 40), sex: D.sex, age: num(D.age), heightCm: heightCm(), weightKg: E.clean(weightKg() || 0), bodyFatPct: num(D.bf),
      units: Object.assign({}, D.units), measurements: measCm(), goal: D.goal, days: D.days.slice(), sessionMin: Number(D.sessionMin), timeOfDay: D.timeOfDay, diet: D.diet,
      creatine: D.creatine === 'Yes', currentKcal: num(D.currentKcal), currentProtein: num(D.currentProtein),
      training: {
        experience: t.experience, split: splitMap[t.split] || 'auto', equipment: Array.from(t.equipment), dbStep: t.dbStep || st.db[0], machineStep: t.machineStep || st.mach[0],
        focus: Array.from(t.focus).map((x) => x.toLowerCase()), injuries: Array.from(t.injuries), repStyle: t.repStyle, sets: Number(t.sets) || 3, rest: t.rest,
        deload: t.deload, logRpe: t.logRpe, restTimer: t.restTimer, warmups: t.warmups, notes: t.notes,
      },
      lifts, startLighter: D.startLighter, startDate: U.today(),
    };
  }
  function validateAbout() {
    const age = num(D.age), hc = heightCm(), wk = weightKg(), waist = num(D.meas.waist);
    if (!(age >= 14 && age <= 90)) return 'Enter an age between 14 and 90.';
    if (!(hc >= 120 && hc <= 230)) return 'Enter your height.';
    if (!(wk >= 35 && wk <= 250)) return 'Enter your body weight.';
    if (!(waist > 0)) return 'Waist is the one measurement Orbit needs. Tape at the navel, relaxed.';
    const wc = U.unitToCm(waist, D.units.length);
    if (wc < 40 || wc > 200) return 'That waist looks off. Check the unit.';
    return null;
  }
  function validateLifts() {
    for (const id of E.DEFAULT_LIFT_ORDER.concat(D.extra)) {
      const l = D.lifts[id];
      if (l.on && E.CATALOG[id].equip !== 'bw' && !num(l.weight) && (l.reps !== '')) return 'Add a weight for ' + E.CATALOG[id].name + ' or untick it.';
    }
    return null;
  }

  async function finish(answers) {
    const plan = E.buildPlan(answers);
    const prev = Store.getState().profile;
    if (prev) throw new Error('A profile already exists on this device.');
    const start = answers.startDate;
    await Store.append('profile_created', { profile: answers, plan });
    const dp = E.cleanDietPrefs(D.dietPrefs);
    if (dp.ok) await Store.append('diet_prefs_set', { prefs: dp.value }, 'user');
    await Store.append('weight_logged', { date: start, kg: answers.weightKg });
    for (const [site, cm] of Object.entries(answers.measurements || {})) await Store.append('measurement_logged', { date: start, site, cm });
    const t = answers.training || {};
    await Store.saveSettings({ bodyUnit: answers.units.body, lenUnit: answers.units.length, liftUnit: answers.units.lift, logRpe: t.logRpe !== false, restTimer: t.restTimer !== false, logWarmups: !!t.warmups, logNotes: t.notes !== false, onboardedAt: new Date().toISOString() });
    Store.requestPersist();
    D = freshDraft();
    root.App.go('#/today');
  }

  // ---------- Welcome ----------
  function welcome() {
    const importInput = h('input', { type: 'file', class: 'hidden', accept: '.orbitbackup,.json,application/json,application/octet-stream', onchange: () => { if (importInput.files[0]) root.Screens.importFile(importInput.files[0]); } });
    const feature = (ic, t, sub) => h('div', { class: 'feat' }, U.icon(ic, 24), h('div', null, h('b', null, t), h('div', { class: 'muted' }, sub)));
    return h('div', { class: 'page welcome' },
      U.brandMark(),
      h('div', { class: 'display hero' }, U.TAGLINE[0], h('br'), U.TAGLINE[1]),
      h('p', { class: 'muted lead' }, 'Orbit is what you do every day: circle back, log it, go again. Bulk, cut or recomp, it keeps the receipts.'),
      h('div', { class: 'feats' },
        feature('lock', 'Lives on this phone.', 'No account, no cloud, no server. There is nothing to sign up for.'),
        feature('key', 'Bring your own brain.', 'Plug in your own AI coach key, or skip the AI entirely.'),
        feature('file', 'One-file exit.', 'Back up everything to a single file, take it anywhere.')),
      h('div', { class: 'grow' }),
      UI.btn('Start (about 4 minutes)', { href: '#/onboard/1', kind: 'primary' }),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => importInput.click() }, 'I already have a backup or profile file'), importInput);
  }

  // ---------- Step 1: About ----------
  function about() {
    const u = D.units;
    const measBox = h('div', { class: 'grid2' });
    const mk = (k, label, req) => UI.field({ label, value: D.meas[k], unit: u.length, type: 'number', req, onInput: (v) => { D.meas[k] = v; } });
    U.put(measBox, mk('waist', 'Waist', true), mk('chest', 'Chest'), mk('shoulders', 'Shoulders'), mk('hips', 'Hips'), mk('bicepL', 'Bicep L'), mk('bicepR', 'Bicep R'), mk('forearmL', 'Forearm L'), mk('forearmR', 'Forearm R'));
    const heightRow = u.length === 'in'
      ? [UI.field({ label: 'Height', value: D.ft, unit: 'ft', type: 'number', flex: 1, req: true, onInput: (v) => { D.ft = v; } }), UI.field({ label: ' ', value: D.inch, unit: 'in', type: 'number', flex: 1, onInput: (v) => { D.inch = v; } })]
      : [UI.field({ label: 'Height', value: D.cm, unit: 'cm', type: 'number', flex: 2, req: true, onInput: (v) => { D.cm = v; } })];
    return UI.page(
      UI.header('About you', 'The honest part. The scale already knows.', { back: '#/welcome' }), UI.stepBar(1, 5),
      UI.scroller(
        UI.row(UI.field({ label: 'Name (optional)', value: D.name, flex: 1, maxlength: 40, onInput: (v) => { D.name = v; }, hint: 'Stays on this device, never sent to a coach.' })),
        UI.seg({ label: 'Sex (for calorie maths)', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }], value: D.sex, onChange: (v) => { D.sex = v; } }),
        UI.row(UI.field({ label: 'Age', value: D.age, unit: 'yrs', type: 'number', flex: 1, req: true, onInput: (v) => { D.age = v; } }), UI.field({ label: 'Weight', value: D.weight, unit: u.body, type: 'number', flex: 1, req: true, onInput: (v) => { D.weight = v; } })),
        UI.row(...heightRow),
        UI.row(
          UI.seg({ label: 'Body weight', options: ['kg', 'lb'], value: u.body, flex: 1, onChange: (v) => { u.body = v; D.weight = ''; root.App.render(); } }),
          UI.seg({ label: 'Measurements', options: ['cm', 'in'], value: u.length, flex: 1, onChange: (v) => { u.length = v; for (const k of Object.keys(D.meas)) D.meas[k] = ''; D.ft = ''; D.inch = ''; D.cm = ''; root.App.render(); } }),
          UI.seg({ label: 'Lifts', options: ['lb', 'kg'], value: u.lift, flex: 1, onChange: (v) => { u.lift = v; D.training.dbStep = null; D.training.machineStep = null; root.App.render(); } })),
        h('div', { class: 'display h2' }, 'Measurements ', h('span', { class: 'muted small body' }, 'tape at the navel, relaxed')),
        measBox,
        UI.field({ label: 'Body fat (optional)', value: D.bf, unit: '%', type: 'number', hint: 'Scale or photo estimates are fine. Vibes are not.', onInput: (v) => { D.bf = v; } })),
      h('div', { class: 'foot' }, UI.btn('Next: your goal', { onClick: () => { const e = validateAbout(); if (e) return U.toast(e, 'warn'); root.App.go('#/onboard/2'); } })));
  }

  // ---------- Step 2: Goal and schedule ----------
  function goalStep() {
    const waist = num(D.meas.waist), hc = heightCm();
    const rec = waist && hc ? E.recommendGoal(U.unitToCm(waist, D.units.length), hc, num(D.bf)) : { goal: 'recomp', ratio: null };
    if (!D.goal) D.goal = rec.goal;
    const goalCard = (id, t, sub) => {
      const on = D.goal === id;
      return h('button', { type: 'button', class: 'goalcard' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => { D.goal = id; root.App.render(); } },
        h('div', { class: 'gc-top' }, h('span', { class: 'display' }, t), rec.goal === id ? U.chip('Suggested for you', 'good') : null), h('div', { class: 'muted' }, sub));
    };
    const order = [1, 2, 3, 4, 5, 6, 0], names = { 0: 'S', 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S' }, full = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
    const days = h('div', { class: 'days' });
    for (const d of order) days.appendChild(h('button', { type: 'button', class: 'day' + (D.days.includes(d) ? ' on' : ''), 'aria-pressed': D.days.includes(d) ? 'true' : 'false', 'aria-label': full[d], onclick: () => { D.days = D.days.includes(d) ? D.days.filter((x) => x !== d) : D.days.concat(d); root.App.render(); } }, names[d]));
    return UI.page(
      UI.header('Your goal', 'What are we doing here?', { back: '#/onboard/1' }), UI.stepBar(2, 5),
      UI.scroller(
        goalCard('build', 'Build', 'Eat above maintenance, lift, get bigger. Your waist may file a small complaint.'),
        goalCard('recomp', 'Recomp', 'Lose fat and add muscle together. Slow, sneaky, works.'),
        goalCard('cut', 'Cut', 'Less of you, more of your abs. A deficit, lots of protein, patience.'),
        rec.ratio ? h('div', { class: 'muted small' }, 'Suggestion uses your waist-to-height ratio (' + rec.ratio + '). You always get the final say.') : null,
        h('div', { class: 'display h2' }, 'Training days'), days,
        h('div', { class: 'muted small' }, D.days.length + ' days a week'),
        UI.row(
          UI.seg({ label: 'Session length (min)', options: ['45', '60', '90'], value: D.sessionMin, flex: 1, onChange: (v) => { D.sessionMin = v; } }),
          UI.seg({ label: 'Time of day', options: ['AM', 'Noon', 'PM'], value: D.timeOfDay, flex: 1, onChange: (v) => { D.timeOfDay = v; } })),
        UI.row(
          h('label', { class: 'field flex', style: { flex: '1' } }, h('span', { class: 'lab' }, 'Diet style'), (() => {
            const s = h('select', { class: 'inp', 'aria-label': 'Diet style', onchange: () => { D.diet = s.value; } });
            for (const o of ['Vegetarian', 'Vegan', 'Eggetarian', 'Pescatarian', 'Everything']) s.appendChild(h('option', { value: o, selected: o === D.diet }, o));
            return s;
          })()),
          UI.seg({ label: 'Creatine', options: ['Yes', 'No'], value: D.creatine, flex: 1, onChange: (v) => { D.creatine = v; } })),
        UI.row(UI.field({ label: 'Calories now (optional)', value: D.currentKcal, unit: 'kcal', type: 'number', flex: 1, onInput: (v) => { D.currentKcal = v; } }), UI.field({ label: 'Protein now (optional)', value: D.currentProtein, unit: 'g', type: 'number', flex: 1, onInput: (v) => { D.currentProtein = v; } }))),
      h('div', { class: 'foot' }, UI.btn('Next: your training', { onClick: () => { if (D.days.length < 2 || D.days.length > 6) return U.toast('Pick between 2 and 6 training days.', 'warn'); root.App.go('#/onboard/3'); } })));
  }

  // ---------- Step 3: Training background ----------
  function trainingStep() {
    const t = D.training, lu = D.units.lift, st = stepsFor(lu);
    const dbSel = t.dbStep || st.db[0], mSel = t.machineStep || st.mach[0];
    return UI.page(
      UI.header('Your training', 'So the plan fits how you actually lift.', { back: '#/onboard/2' }), UI.stepBar(3, 5),
      UI.scroller(
        UI.seg({ label: 'Lifting experience', options: ['Under 1 yr', '1-3 yrs', '3+ yrs'], value: t.experience, onChange: (v) => { t.experience = v; } }),
        UI.pills({ label: 'Split', items: ['Orbit picks', 'Push / Pull / Legs', 'Upper / Lower', 'Body-part days', 'Full body'], values: new Set([t.split]), multi: false, onChange: (v) => { t.split = Array.from(v)[0]; } }),
        UI.pills({ label: 'Equipment you can use', items: ['Dumbbells', 'Machines', 'Cables', 'Barbell', 'Bodyweight', 'Bands'], values: t.equipment }),
        UI.row(
          UI.seg({ label: 'Dumbbell jump', options: st.db.map((x) => ({ value: x, label: x + ' ' + lu })), value: dbSel, flex: 1, onChange: (v) => { t.dbStep = v; } }),
          UI.seg({ label: 'Machine jump', options: st.mach.map((x) => ({ value: x, label: x + ' ' + lu })), value: mSel, flex: 1, onChange: (v) => { t.machineStep = v; } })),
        UI.pills({ label: 'Muscles to prioritise', items: ['Chest', 'Shoulders', 'Back', 'Arms', 'Forearms', 'Legs', 'Core'], values: t.focus, max: 3, hint: 'Pick up to 3. They get extra weekly work.' }),
        UI.pills({ label: 'Anything to work around?', items: ['Nothing', 'Shoulder', 'Elbow', 'Wrist', 'Lower back', 'Knee'], values: t.injuries, exclusive: ['Nothing'], hint: 'Orbit flags lifts that lean on it.' }),
        UI.seg({ label: 'Rep style', options: [{ value: 'heavy', label: 'Heavy 6-8' }, { value: 'mixed', label: 'Mixed 8-12' }, { value: 'pump', label: 'Pump 12-15' }], value: t.repStyle, onChange: (v) => { t.repStyle = v; } }),
        UI.row(UI.field({ label: 'Sets per lift', value: t.sets, type: 'number', flex: 1, min: 2, max: 6, onInput: (v) => { t.sets = v; } }), UI.seg({ label: 'Rest between sets', options: ['60 s', '90 s', '2 min'], value: t.rest, flex: 2, onChange: (v) => { t.rest = v; } })),
        UI.seg({ label: 'Easier deload weeks (planned: 7, 14, 21)', options: [{ value: 'planned', label: 'Planned' }, { value: 'feel', label: 'When I feel beat' }, { value: 'never', label: 'Never' }], value: t.deload, onChange: (v) => { t.deload = v; } }),
        UI.card(
          UI.toggleRow('Effort per set', 'Log how hard it felt (RPE 1-10)', t.logRpe, (v) => { t.logRpe = v; }),
          UI.toggleRow('Rest timer', 'Counts down between sets', t.restTimer, (v) => { t.restTimer = v; }),
          UI.toggleRow('Warm-up sets', 'Log them, kept out of your volume', t.warmups, (v) => { t.warmups = v; }),
          UI.toggleRow('Notes on a lift', 'Pain, form cue, gym was full', t.notes, (v) => { t.notes = v; }))),
      h('div', { class: 'foot' }, UI.btn('Next: what you lift', { onClick: () => root.App.go('#/onboard/4') })));
  }

  // ---------- Step 4: Lifts ----------
  function liftsStep() {
    const lu = D.units.lift;
    const rows = h('div', { class: 'liftrows' });
    const rowFor = (name, l, cat, isCustom) => {
      const bw = (isCustom ? l.equip : cat.equip) === 'bw';
      const cb = h('button', { type: 'button', class: 'check' + (l.on !== false ? ' on' : ''), role: 'checkbox', 'aria-checked': l.on !== false ? 'true' : 'false', 'aria-label': 'Track ' + name, onclick: () => { l.on = !(l.on !== false); root.App.render(); } }, l.on !== false ? U.icon('check', 16) : null);
      const wInp = bw ? h('div', { class: 'inp static' }, 'BW') : h('input', { class: 'inp', type: 'number', inputmode: 'decimal', value: l.weight, placeholder: cat && cat.def ? String(cat.def[0]) : '', 'aria-label': name + ' weight', oninput: (e) => { l.weight = e.target.value; } });
      const rInp = h('input', { class: 'inp', type: 'number', inputmode: 'numeric', value: l.reps, placeholder: cat && cat.def ? String(cat.def[1]) : '', 'aria-label': name + ' reps', oninput: (e) => { l.reps = e.target.value; } });
      return h('div', { class: 'liftrow' + (l.on !== false ? '' : ' off') }, cb, h('div', { class: 'ln' }, name), h('div', { class: 'wbox' }, wInp, bw ? null : h('span', { class: 'unit' }, lu)), h('div', { class: 'rbox' }, rInp));
    };
    for (const id of E.DEFAULT_LIFT_ORDER.concat(D.extra)) rows.appendChild(rowFor(E.CATALOG[id].name, D.lifts[id], E.CATALOG[id], false));
    D.custom.forEach((c) => rows.appendChild(rowFor(c.name || 'Your lift', c, null, true)));
    const addBtn = h('button', { type: 'button', class: 'dashed', onclick: () => addLift() }, U.icon('plus', 18), 'Add another lift');
    function addLift() {
      const taken = new Set(E.DEFAULT_LIFT_ORDER.concat(D.extra));
      const form = root.Screens._.liftForm({ taken, unit: lu });
      U.sheet('Add another lift', form.body, [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', run: () => {
        const c = form.read();
        if (c.error) { U.toast(c.error, 'warn'); return false; }
        if (c.custom) D.custom.push({ name: c.custom.name, muscle: c.custom.muscle, equip: c.custom.equip, cls: c.custom.cls, gain: c.custom.gain, weight: c.weight == null ? '' : String(c.weight), reps: c.reps == null ? '' : String(c.reps), on: true });
        else { D.extra.push(c.catalogId); D.lifts[c.catalogId] = { on: true, weight: c.weight == null ? '' : String(c.weight), reps: c.reps == null ? '' : String(c.reps) }; }
        root.App.render();
      } }]);
    }
    return UI.page(
      UI.header('What you lift', 'Tick your lifts, add a clean set.', { back: '#/onboard/3' }), UI.stepBar(4, 5),
      UI.scroller(
        UI.card(h('div', { class: 'liftrow hdr' }, h('span', null), h('div', { class: 'ln' }, 'Lift'), h('div', { class: 'wbox' }, 'Weight'), h('div', { class: 'rbox' }, 'Reps')), rows),
        addBtn,
        h('div', { class: 'muted small' }, 'Weight and reps let Orbit estimate your max and start week 1 at a sensible load. Leave a weight empty to skip a lift. For pull-ups, just enter reps.'),
        UI.seg({ label: 'Starting point', options: [{ value: 'solid', label: 'These are solid' }, { value: 'light', label: 'Start me lighter' }], value: D.startLighter ? 'light' : 'solid', onChange: (v) => { D.startLighter = v === 'light'; } })),
      h('div', { class: 'foot' }, UI.btn('Next: see my plan', { onClick: () => { const e = validateLifts(); if (e) return U.toast(e, 'warn'); root.App.go('#/onboard/5'); } })));
  }

  // ---------- Step 5: Plan preview ----------
  function planStep() {
    const a = buildAnswers();
    let plan;
    try { plan = E.buildPlan(a); } catch (e) { return UI.page(UI.header('Plan', 'Something is missing', { back: '#/onboard/4' }), UI.scroller(UI.empty('Go back and check your answers: ' + e.message))); }
    const lu = a.units.lift, lenU = a.units.length;
    const segs = h('div', { class: 'timeline' });
    for (let w = 1; w <= 26; w++) segs.appendChild(h('span', { class: w <= 12 ? 'a' : 'b' }));
    const total = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
    const macroBar = h('div', { class: 'macrobar' }, ...[[plan.protein * 4, 'coral'], [plan.carbs * 4, 'acc'], [plan.fat * 9, 'cool']].map(([kc, c]) => { const s = h('span', { class: c }); s.style.width = (kc / total * 100) + '%'; return s; }));
    const targets = ['waist', 'shoulders', 'chest', 'bicepL'].filter((k) => plan.measTargets[k]).map((k) => h('div', { class: 'kv' }, h('span', null, k === 'bicepL' ? 'Biceps' : k[0].toUpperCase() + k.slice(1)), h('b', null, U.fmtLen(plan.measTargets[k].start, lenU) + ' to ' + U.fmtLen(plan.measTargets[k].target, lenU) + ' ' + lenU)));
    const w1 = E.weeklyTargets(plan, 1).slice(0, 4).map((t) => h('div', { class: 'kv' }, h('span', null, t.name), h('b', null, t.kg == null ? t.sets + ' x ' + t.reps + ' reps' : U.fmtLift(t.kg, lu) + ' x ' + t.sets + 'x' + t.reps)));
    const sched = plan.workouts.map((w) => h('div', { class: 'kv' }, h('span', null, U.DOW[w.weekday]), h('b', null, w.name)));
    return UI.page(
      UI.header('Your 26 weeks', 'Built from what you told me.', { back: '#/onboard/4' }), UI.stepBar(5, 5),
      UI.scroller(
        UI.card(h('div', { class: 'target-top' }, h('div', null, h('div', { class: 'muted small' }, 'Daily target · ' + plan.goal[0].toUpperCase() + plan.goal.slice(1)), h('div', { class: 'display big' }, U.withCommas(plan.kcal), h('span', { class: 'muted unitbig' }, ' kcal'))), U.chip('Maintenance about ' + U.withCommas(plan.maintenance), 'line')), macroBar,
          h('div', { class: 'macro-legend' }, h('span', null, h('b', null, plan.protein + ' g'), ' protein'), h('span', null, h('b', null, plan.carbs + ' g'), ' carbs'), h('span', null, h('b', null, plan.fat + ' g'), ' fat'))),
        root.Screens.dietOnboardCard(D.dietPrefs, plan, a.diet),
        UI.card(h('div', { class: 'ct' }, 'Timeline · 26 weeks'), segs, h('div', { class: 'tl-legend' }, h('span', null, 'Wk 1'), h('span', null, 'Checkpoint wk 12'), h('span', null, 'Wk 26')), h('div', { class: 'muted small' }, 'Progress photos are a weekly check-in on the day you choose in Profile. It starts on Friday.')),
        targets.length ? UI.card(h('div', { class: 'ct' }, 'Six-month targets'), ...targets) : null,
        UI.card(h('div', { class: 'ct' }, 'Your week'), ...sched),
        w1.length ? UI.card(h('div', { class: 'ct' }, 'Week 1 lifts'), ...w1) : UI.card(h('div', { class: 'muted' }, 'No lifts tracked yet. You can still log workouts; add lifts later from Lifts.')),
        h('div', { class: 'muted small' }, 'Every number here is a starting point. You can change targets any time, and the coach can suggest changes but never apply them without your tap.')),
      h('div', { class: 'foot' }, UI.btn('Start week 1', { onClick: async () => { try { await finish(a); } catch (e) { U.toast(e.message, 'warn'); } } })));
  }

  root.Onboard = { welcome, about, goalStep, trainingStep, liftsStep, planStep, finish, reset: () => { D = freshDraft(); } };
})(self);
