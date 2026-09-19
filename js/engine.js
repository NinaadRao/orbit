/*
 * Orbit plan engine. Pure functions only: no DOM, no storage, no network.
 * Works as a classic <script> in the browser (window.Engine) and under Node (module.exports).
 */
(function (root) {
  'use strict';

  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;
  const WEEKS = 26;
  const PHOTO_WEEKS = [1, 5, 9, 13, 17, 21, 26];
  const DELOAD_WEEKS = [7, 14, 21];
  const ANGLES = ['Front', 'Side', 'Back', 'Front flexed', 'Back flexed'];
  // Reps per week for the "heavy" group. Medium is +2, high-rep is +4.
  const HEAVY_WAVE = [8, 9, 10, 6, 7, 8, 8, 9, 10, 6, 7, 8, 9, 8, 10, 6, 7, 8, 9, 10, 8, 6, 7, 8, 9, 10];
  const REP_OFFSET = { heavy: 0, medium: 2, high: 4 };
  const REP_STYLE_SHIFT = { heavy: -2, mixed: 0, pump: 2 };

  // ---------- small helpers ----------
  const clean = (n) => Math.round(n * 1000) / 1000;
  const roundTo = (x, step) => clean(Math.round(x / step) * step);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lbToKg = (lb) => lb * KG_PER_LB;
  const kgToLb = (kg) => kg / KG_PER_LB;
  const inToCm = (i) => i * CM_PER_IN;
  const cmToIn = (c) => c / CM_PER_IN;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); }
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function weekOf(startDate, dateStr) { return Math.floor(daysBetween(startDate, dateStr) / 7) + 1; }
  function weekRange(startDate, week) { const s = addDays(startDate, (week - 1) * 7); return [s, addDays(s, 6)]; }
  function weekdayOf(dateStr) { return parseISO(dateStr).getDay(); }

  // ---------- nutrition ----------
  function bmr(sex, kg, cm, age) {
    const base = 10 * kg + 6.25 * cm - 5 * age;
    if (sex === 'male') return base + 5;
    if (sex === 'female') return base - 161;
    return base - 78; // midpoint for "other"
  }
  function maintenance(sex, kg, cm, age, days) {
    return roundTo(bmr(sex, kg, cm, age) * (1.4 + 0.05 * days), 50);
  }
  const GOAL_KCAL_DELTA = { build: 200, recomp: 0, cut: -300 };
  function targetsFor(goal, p) {
    const m = maintenance(p.sex, p.kg, p.cm, p.age, p.days);
    const kcal = m + (GOAL_KCAL_DELTA[goal] || 0);
    const protein = roundTo(2.4 * p.kg, 5);
    const fat = roundTo(1.3 * p.kg, 5);
    const carbs = Math.max(0, roundTo((kcal - 4 * protein - 9 * fat) / 4, 5));
    return { maintenance: m, kcal, protein, carbs, fat };
  }
  // Suggestion only; the user always picks.
  function recommendGoal(waistCm, heightCm, bodyFatPct) {
    const ratio = clean(waistCm / heightCm);
    let goal = ratio >= 0.5 ? 'cut' : ratio >= 0.45 ? 'recomp' : 'build';
    if (bodyFatPct) {
      if (bodyFatPct >= 25) goal = 'cut';
      else if (bodyFatPct >= 20 && goal === 'build') goal = 'recomp';
    }
    return { goal, ratio: Math.round(ratio * 100) / 100 };
  }

  // ---------- measurement targets (offsets in inches, stored as cm) ----------
  const MEAS_OFFSETS_IN = {
    recomp: { shoulders: 1.25, chest: 1.25, bicep: 0.6, forearm: 0.3, waist: -1.0, hips: -0.4 },
    build: { shoulders: 1.5, chest: 1.5, bicep: 0.75, forearm: 0.4, waist: 0.5, hips: 0.5 },
    cut: { shoulders: 0.5, chest: 0.5, bicep: 0.2, forearm: 0.1, waist: -2.0, hips: -1.0 },
  };
  const MEAS_SITES = [
    ['waist', 'Waist'], ['chest', 'Chest'], ['shoulders', 'Shoulders'], ['hips', 'Hips'],
    ['bicepL', 'Bicep L'], ['bicepR', 'Bicep R'], ['forearmL', 'Forearm L'], ['forearmR', 'Forearm R'],
  ];
  function siteKey(site) { return site.replace(/[LR]$/, ''); }
  function measurementTargets(goal, meas) {
    const out = {};
    const off = MEAS_OFFSETS_IN[goal] || MEAS_OFFSETS_IN.recomp;
    for (const [site] of MEAS_SITES) {
      if (meas && typeof meas[site] === 'number' && meas[site] > 0) {
        out[site] = { start: meas[site], target: clean(meas[site] + inToCm(off[siteKey(site)] || 0)) };
      }
    }
    return out;
  }

  // ---------- lift catalog and progression ----------
  const CATALOG = {
    flat_db_press: { name: 'Flat DB press', muscle: 'chest', equip: 'db', cls: 'heavy', gain: 0.40, def: [50, 8] },
    incline_db_press: { name: 'Incline DB press', muscle: 'chest', equip: 'db', cls: 'heavy', gain: 0.40, def: [45, 8] },
    shoulder_press: { name: 'Seated DB shoulder press', short: 'Shoulder press', muscle: 'shoulders', equip: 'db', cls: 'medium', gain: 0.25, def: [35, 10] },
    lat_pulldown: { name: 'Lat pulldown', muscle: 'back', equip: 'machine', cls: 'medium', gain: 0.27, def: [130, 10] },
    db_row: { name: 'DB row', muscle: 'back', equip: 'db', cls: 'medium', gain: 0.40, def: [50, 10] },
    curl: { name: 'Strict DB curl', muscle: 'arms', equip: 'db', cls: 'medium', gain: 0.33, def: [30, 10] },
    leg_press: { name: 'Leg press', muscle: 'legs', equip: 'machine', cls: 'heavy', gain: 0.25, def: [270, 8] },
    leg_curl: { name: 'Leg curl', muscle: 'legs', equip: 'machine', cls: 'high', gain: 0.21, def: [150, 12] },
    leg_ext: { name: 'Leg extension', muscle: 'legs', equip: 'machine', cls: 'high', gain: 0.21, def: [150, 12] },
    bulgarian: { name: 'Bulgarian split squat', muscle: 'legs', equip: 'db', cls: 'medium', gain: 0.40, def: [40, 10] },
    pullups: { name: 'Pull-ups', muscle: 'back', equip: 'bw', cls: 'medium', gain: 0, def: [null, 4] },
    barbell_squat: { name: 'Barbell squat', muscle: 'legs', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [95, 8] },
    barbell_bench: { name: 'Barbell bench press', muscle: 'chest', equip: 'barbell', cls: 'heavy', gain: 0.30, def: [95, 8] },
  };
  const DEFAULT_LIFT_ORDER = ['flat_db_press', 'incline_db_press', 'shoulder_press', 'lat_pulldown', 'db_row', 'curl', 'leg_press', 'leg_curl', 'leg_ext', 'bulgarian', 'pullups', 'barbell_squat'];

  function blockOfWeek(w) { return w <= 3 ? 0 : w <= 9 ? 1 : w <= 15 ? 2 : w <= 21 ? 3 : 4; }

  // Five block weights, strictly increasing by at least one step.
  function blockWeights(start, gain, step) {
    const out = [start];
    for (let b = 1; b <= 4; b++) {
      let w = roundTo(start * (1 + (gain * b) / 4), step);
      if (w <= out[b - 1]) w = clean(out[b - 1] + step);
      out.push(w);
    }
    return out;
  }
  // Working weight for week 1 from a set the user did (Epley, aiming at week-1 reps).
  function e1rm(w, r) { return r <= 1 ? w : w * (1 + r / 30); }
  function startWeight(w, reps, cls, step, opts) {
    const o = opts || {};
    const shift = REP_STYLE_SHIFT[o.repStyle || 'mixed'] || 0;
    const targetReps = Math.max(4, HEAVY_WAVE[0] + REP_OFFSET[cls] + shift);
    let start = e1rm(w, reps || targetReps) / (1 + targetReps / 30);
    if (o.lighter) start *= 0.9;
    return Math.max(step, roundTo(start, step));
  }

  const DEFAULT_STEPS = { lb: { db: 2.5, machine: 5, barbell: 5 }, kg: { db: 1, machine: 2.5, barbell: 2.5 } };

  // Build the tracked-lift plan. Weights are stored in kg; progression runs in the user's unit.
  function buildLiftPlan(inputLifts, prefs, unit) {
    const u = unit === 'kg' ? 'kg' : 'lb';
    const factor = u === 'lb' ? KG_PER_LB : 1;
    const steps = Object.assign({}, DEFAULT_STEPS[u]);
    if (prefs && prefs.dbStep) steps.db = prefs.dbStep;
    if (prefs && prefs.machineStep) steps.machine = prefs.machineStep;
    const sets = prefs && prefs.sets ? prefs.sets : 3;
    const repStyle = (prefs && prefs.repStyle) || 'mixed';
    const out = {};
    for (const l of inputLifts || []) {
      if (!l || !l.on) continue;
      const cat = CATALOG[l.id] || {};
      const id = l.id;
      const equip = l.equip || cat.equip || 'machine';
      const cls = l.cls || cat.cls || 'medium';
      const gain = l.gain != null ? l.gain : cat.gain != null ? cat.gain : 0.25;
      const step = steps[equip] || steps.machine;
      const item = {
        id, name: l.name || cat.name || id, short: cat.short || l.name || cat.name || id,
        muscle: l.muscle || cat.muscle || 'other', equip, cls, gain, sets, repStyle, unit: u, adjust: [],
      };
      if (equip === 'bw') {
        item.bw = true;
        item.startReps = Math.max(1, Math.round(l.reps || 4));
      } else {
        if (!(l.weight > 0)) continue;
        const start = startWeight(l.weight, l.reps, cls, step, { repStyle, lighter: prefs && prefs.lighter });
        item.step = step;
        item.blockUnits = blockWeights(start, gain, step);
        item.blockKg = item.blockUnits.map((x) => Math.round(x * factor * 1e5) / 1e5);
      }
      out[id] = item;
    }
    return out;
  }

  // Prescription for one lift in one week.
  function liftTarget(lift, week, opts) {
    const o = opts || {};
    const deloadWeeks = o.deloadWeeks || DELOAD_WEEKS;
    const w = clamp(week, 1, WEEKS);
    const b = blockOfWeek(w);
    const deload = deloadWeeks.includes(w);
    const baseSets = lift.sets || 3;
    const sets = deload ? Math.max(1, baseSets - 1) : baseSets;
    const shift = REP_STYLE_SHIFT[lift.repStyle || 'mixed'] || 0;
    let reps = HEAVY_WAVE[w - 1] + (REP_OFFSET[lift.cls] || 0) + shift;
    reps = Math.max(4, reps);
    if (lift.bw) {
      return { id: lift.id, name: lift.name, week: w, sets, reps: lift.startReps + b, kg: null, deload, block: b };
    }
    let kg = lift.blockKg[deload ? Math.max(0, b - 1) : b];
    for (const a of lift.adjust || []) {
      if (w >= a.fromWeek) {
        const stepKg = lift.step * (lift.unit === 'lb' ? KG_PER_LB : 1);
        kg = Math.round(Math.round((kg * a.factor) / stepKg) * stepKg * 1e5) / 1e5;
      }
    }
    return { id: lift.id, name: lift.name, week: w, sets, reps, kg, deload, block: b };
  }

  // ---------- workout templates ----------
  // Each exercise: n name, lift = tracked id (optional), sets, range (rep range for accessories), rest secs, m muscle, s stress tags
  const E = (n, sets, range, rest, m, extra) => Object.assign({ n, sets, range, rest, m }, extra || {});
  const T = (lift, sets, rest, m) => ({ lift, n: CATALOG[lift].name, sets, range: '', rest, m });

  const TEMPLATES = {
    chest5: [
      { name: 'Push', focus: ['chest', 'shoulders', 'arms'], ex: [
        T('incline_db_press', 4, 150, 'chest'), E('Flat DB or machine press', 3, '8-12', 120, 'chest'), E('Cable fly', 3, '12-15', 90, 'chest'),
        T('shoulder_press', 3, 120, 'shoulders'), E('Lateral raise', 4, '12-20', 75, 'shoulders'), E('Overhead triceps extension', 3, '10-15', 90, 'arms'), E('Rope pushdown', 2, '12-15', 60, 'arms')] },
      { name: 'Pull', focus: ['back', 'arms'], ex: [
        T('lat_pulldown', 4, 120, 'back'), T('db_row', 3, 120, 'back'), E('Single-arm cable pulldown', 3, '10-12', 90, 'back'), E('Face pull or rear-delt fly', 3, '15-20', 60, 'shoulders'),
        T('curl', 3, 90, 'arms'), E('Hammer curl', 3, '10-12', 60, 'arms')] },
      { name: 'Legs', focus: ['legs'], ex: [
        T('leg_press', 4, 180, 'legs'), E('Romanian deadlift', 3, '8-10', 150, 'legs'), T('leg_ext', 3, 90, 'legs'), T('leg_curl', 3, 90, 'legs'),
        E('Calf raise', 4, '10-15', 60, 'legs'), E('Cable lateral raise', 3, '15-20', 60, 'shoulders')] },
      { name: 'Upper', focus: ['chest', 'back', 'shoulders', 'arms'], ex: [
        T('pullups', 3, 120, 'back'), T('flat_db_press', 3, 150, 'chest'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Incline machine press or pec deck', 3, '12-15', 90, 'chest'),
        E('Cable lateral raise', 4, '15-20', 60, 'shoulders'), E('EZ-bar curl', 3, '10-12', 90, 'arms'), E('Triceps pushdown', 3, '10-12', 60, 'arms')] },
      { name: 'Lower', focus: ['legs', 'core'], ex: [
        E('Hack squat or leg press', 3, '8-12', 150, 'legs'), T('bulgarian', 3, 120, 'legs'), E('Lying leg curl', 3, '10-12', 90, 'legs'), E('Calf raise', 3, '12-15', 60, 'legs'),
        E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] },
    ],
    ul4: [
      { name: 'Upper A', focus: ['chest', 'back', 'shoulders', 'arms'], ex: [
        T('flat_db_press', 4, 150, 'chest'), T('lat_pulldown', 3, 120, 'back'), T('shoulder_press', 3, 120, 'shoulders'), T('db_row', 3, 120, 'back'), E('Cable fly', 3, '12-15', 90, 'chest'), T('curl', 3, 90, 'arms'), E('Triceps pushdown', 3, '10-12', 60, 'arms')] },
      { name: 'Lower A', focus: ['legs', 'core'], ex: [
        T('leg_press', 4, 180, 'legs'), E('Romanian deadlift', 3, '8-10', 150, 'legs'), T('leg_curl', 3, 90, 'legs'), E('Calf raise', 4, '10-15', 60, 'legs'), E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] },
      { name: 'Upper B', focus: ['chest', 'back', 'shoulders', 'arms'], ex: [
        T('incline_db_press', 4, 150, 'chest'), T('pullups', 3, 120, 'back'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Lateral raise', 4, '12-20', 60, 'shoulders'), E('Hammer curl', 3, '10-12', 60, 'arms'), E('Overhead triceps extension', 3, '10-15', 60, 'arms')] },
      { name: 'Lower B', focus: ['legs'], ex: [
        E('Hack squat or leg press', 3, '8-12', 150, 'legs'), T('bulgarian', 3, 120, 'legs'), T('leg_ext', 3, 90, 'legs'), E('Lying leg curl', 3, '10-12', 90, 'legs'), E('Calf raise', 3, '12-15', 60, 'legs')] },
    ],
    ppl6: null, // filled below from chest5 halves
    fb3: [
      { name: 'Full body A', focus: ['chest', 'back', 'legs'], ex: [
        T('flat_db_press', 3, 150, 'chest'), T('lat_pulldown', 3, 120, 'back'), T('leg_press', 3, 150, 'legs'), T('shoulder_press', 3, 120, 'shoulders'), T('curl', 2, 90, 'arms'), E('Triceps pushdown', 2, '10-12', 60, 'arms')] },
      { name: 'Full body B', focus: ['chest', 'back', 'legs'], ex: [
        T('incline_db_press', 3, 150, 'chest'), T('db_row', 3, 120, 'back'), T('bulgarian', 3, 120, 'legs'), T('leg_curl', 3, 90, 'legs'), E('Lateral raise', 3, '12-20', 60, 'shoulders'), E('Calf raise', 3, '12-15', 60, 'legs')] },
      { name: 'Full body C', focus: ['chest', 'back', 'legs'], ex: [
        T('pullups', 3, 120, 'back'), E('Flat DB or machine press', 3, '8-12', 120, 'chest'), T('leg_ext', 3, 90, 'legs'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Hammer curl', 2, '10-12', 60, 'arms'), E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] },
    ],
  };
  TEMPLATES.ppl6 = [
    TEMPLATES.chest5[0], TEMPLATES.chest5[1], TEMPLATES.chest5[2],
    Object.assign({}, TEMPLATES.chest5[0], { name: 'Push B', ex: [
      T('flat_db_press', 4, 150, 'chest'), E('Incline machine press or pec deck', 3, '10-12', 90, 'chest'), E('Seated DB shoulder press', 3, '8-12', 120, 'shoulders'), E('Lateral raise', 4, '15-20', 60, 'shoulders'), E('Triceps pushdown', 3, '10-12', 60, 'arms'), E('Overhead triceps extension', 3, '10-15', 60, 'arms')] }),
    Object.assign({}, TEMPLATES.chest5[1], { name: 'Pull B', ex: [
      T('pullups', 3, 120, 'back'), E('Seated cable row', 3, '10-12', 90, 'back'), E('Chest-supported row', 3, '8-12', 120, 'back'), E('Face pull or rear-delt fly', 3, '15-20', 60, 'shoulders'), E('Incline DB curl', 3, '10-12', 90, 'arms'), E('EZ-bar curl', 3, '10-12', 60, 'arms')] }),
    Object.assign({}, TEMPLATES.chest5[4], { name: 'Legs B', ex: [
      E('Hack squat or leg press', 3, '8-12', 150, 'legs'), T('bulgarian', 3, 120, 'legs'), E('Lying leg curl', 3, '10-12', 90, 'legs'), E('Calf raise', 4, '12-15', 60, 'legs'), E('Hanging leg raise or cable crunch', 3, '10-15', 60, 'core')] }),
  ];

  const FOREARM = {
    Pull: [E('Reverse EZ-bar curl', 3, '10-12', 75, 'forearms'), E('Wrist curl (palms up)', 3, '12-20', 60, 'forearms')],
    Upper: [E('Wrist curl (palms up)', 3, '12-20', 60, 'forearms'), E('Reverse wrist extension (palms down)', 3, '15-20', 60, 'forearms')],
    Lower: [E("Farmer's carry, heavy dumbbells", 3, '30-40 sec', 90, 'forearms'), E('Dead hang from a bar', 2, 'near failure', 60, 'forearms')],
  };
  const INJURY_KEYWORDS = {
    Shoulder: ['press', 'raise', 'fly', 'dip'],
    Elbow: ['curl', 'extension', 'pushdown', 'press'],
    Wrist: ['curl', 'press', 'carry', 'wrist'],
    'Lower back': ['deadlift', 'squat', 'row'],
    Knee: ['squat', 'leg press', 'extension', 'lunge'],
  };

  function pickTemplate(days, split) {
    const n = days.length;
    if (n >= 6) return 'ppl6';
    if (n === 5) return 'chest5';
    if (n === 4) return 'ul4';
    if (split === 'ppl' && n === 3) return 'chest5';
    return 'fb3';
  }
  function ordered(days) { const order = [1, 2, 3, 4, 5, 6, 0]; return days.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)); }

  function buildWorkouts(answers, trackedLifts) {
    const t = answers.training || {};
    const days = ordered(answers.days && answers.days.length ? answers.days : [1, 2, 3, 4, 5]);
    const key = pickTemplate(days, t.split);
    const tpl = TEMPLATES[key];
    const focus = t.focus || [];
    const injuries = (t.injuries || []).filter((x) => x !== 'Nothing');
    const workouts = [];
    for (let i = 0; i < days.length; i++) {
      const src = tpl[i % tpl.length];
      const ex = src.ex.map((e) => {
        const o = Object.assign({}, e);
        if (o.lift && !trackedLifts[o.lift]) { o.lift = null; o.range = o.range || (CATALOG[e.lift].cls === 'heavy' ? '6-10' : CATALOG[e.lift].cls === 'high' ? '12-15' : '8-12'); }
        const lower = o.n.toLowerCase();
        const flags = [];
        for (const inj of injuries) if ((INJURY_KEYWORDS[inj] || []).some((k) => lower.includes(k))) flags.push(inj);
        if (flags.length) o.flag = 'Work around your ' + flags.join(' and ').toLowerCase() + ': lighter, pain-free range.';
        return o;
      });
      if (focus.includes('forearms') && FOREARM[src.name.replace(/ [AB]$/, '')]) for (const f of FOREARM[src.name.replace(/ [AB]$/, '')]) ex.push(Object.assign({ forearm: true }, f));
      if (focus.includes('shoulders') && src.focus.includes('shoulders') && !ex.some((e) => /lateral/i.test(e.n))) ex.push(E('Lateral raise', 3, '12-20', 60, 'shoulders'));
      if (focus.includes('core') && !ex.some((e) => e.m === 'core')) ex.push(E('Cable crunch', 3, '10-15', 60, 'core'));
      workouts.push({ name: src.name, weekday: days[i], focus: src.focus, ex });
    }
    // Any tracked lift the template did not place goes on the best-matching day.
    const placed = new Set();
    workouts.forEach((w) => w.ex.forEach((e) => e.lift && placed.add(e.lift)));
    for (const id of Object.keys(trackedLifts)) {
      if (placed.has(id)) continue;
      const lf = trackedLifts[id];
      let day = workouts.find((w) => w.focus.includes(lf.muscle)) || workouts[workouts.length - 1];
      day.ex.unshift({ lift: id, n: lf.name, sets: lf.sets || 3, range: '', rest: 150, m: lf.muscle });
    }
    return { template: key, workouts };
  }

  // ---------- plan assembly ----------
  function buildPlan(a) {
    const days = a.days && a.days.length ? a.days : [1, 2, 3, 4, 5];
    const goal = a.goal || recommendGoal(a.measurements && a.measurements.waist ? a.measurements.waist : a.heightCm * 0.45, a.heightCm, a.bodyFatPct).goal;
    const targets = targetsFor(goal, { sex: a.sex, kg: a.weightKg, cm: a.heightCm, age: a.age, days: days.length });
    const t = a.training || {};
    const lifts = buildLiftPlan(a.lifts, {
      dbStep: t.dbStep, machineStep: t.machineStep, sets: t.sets, repStyle: t.repStyle, lighter: a.startLighter,
    }, a.units && a.units.lift);
    const wk = buildWorkouts(a, lifts);
    return {
      v: 1, startDate: a.startDate, weeks: WEEKS, goal,
      kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat, maintenance: targets.maintenance,
      measTargets: measurementTargets(goal, a.measurements),
      baseline: { weightKg: a.weightKg, waistCm: a.measurements && a.measurements.waist ? a.measurements.waist : null },
      deloadWeeks: t.deload === 'planned' || t.deload == null ? DELOAD_WEEKS.slice() : [],
      lifts, template: wk.template, workouts: wk.workouts, history: [],
    };
  }

  function weeklyTargets(plan, week) {
    return Object.values(plan.lifts).map((l) => liftTarget(l, week, { deloadWeeks: plan.deloadWeeks }));
  }

  // ---------- bounds used to validate any change (user, checkpoint or coach) ----------
  const LIMITS = { maxKcalStep: 300, minKcal: 1500, maxKcal: 5000, minProteinPerKg: 1.4, maxProteinPerKg: 3.0, maxLiftPct: 10 };
  function validateMacroChange(plan, weightKg, ch) {
    const errs = [];
    const kcal = ch.kcal != null ? Number(ch.kcal) : plan.kcal;
    const protein = ch.protein != null ? Number(ch.protein) : plan.protein;
    if (!Number.isFinite(kcal) || !Number.isFinite(protein)) errs.push('Numbers only.');
    else {
      if (Math.abs(kcal - plan.kcal) > LIMITS.maxKcalStep) errs.push('Calories can change by at most ' + LIMITS.maxKcalStep + ' per step.');
      if (kcal < LIMITS.minKcal || kcal > LIMITS.maxKcal) errs.push('Calories must stay between ' + LIMITS.minKcal + ' and ' + LIMITS.maxKcal + '.');
      const pk = protein / weightKg;
      if (pk < LIMITS.minProteinPerKg || pk > LIMITS.maxProteinPerKg) errs.push('Protein must be ' + LIMITS.minProteinPerKg + ' to ' + LIMITS.maxProteinPerKg + ' g per kg.');
    }
    if (errs.length) return { ok: false, errors: errs };
    const fat = ch.fat != null ? Number(ch.fat) : plan.fat;
    const carbs = ch.carbs != null ? Number(ch.carbs) : Math.max(0, roundTo((kcal - 4 * protein - 9 * fat) / 4, 5));
    return { ok: true, value: { kcal: roundTo(kcal, 5), protein: roundTo(protein, 1), carbs, fat } };
  }
  function validateLiftChange(plan, ch) {
    const l = plan.lifts[ch.lift];
    if (!l) return { ok: false, errors: ['Unknown lift.'] };
    const pct = Number(ch.percent);
    if (!Number.isFinite(pct) || Math.abs(pct) > LIMITS.maxLiftPct || pct === 0) return { ok: false, errors: ['Lift changes are limited to 10 percent at a time.'] };
    const from = clamp(Math.round(Number(ch.fromWeek) || 1), 1, WEEKS);
    return { ok: true, value: { lift: ch.lift, fromWeek: from, factor: clean(1 + pct / 100) } };
  }

  // ---------- state projection from the event log ----------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function project(events) {
    const voided = new Set();
    for (const e of events) if (e.type === 'event_voided') voided.add(e.data.target);
    const s = { profile: null, plan: null, weights: [], meas: [], foods: [], sets: [], photos: [], revisions: [] };
    for (const e of events) {
      if (voided.has(e.seq) || e.type === 'event_voided') continue;
      const d = e.data || {};
      switch (e.type) {
        case 'profile_created': s.profile = clone(d.profile); s.plan = clone(d.plan); break;
        case 'plan_revised': if (s.plan) applyRevision(s.plan, d, e); s.revisions.push({ seq: e.seq, ts: e.ts, src: e.src, reason: d.reason, changes: d.changes }); break;
        case 'weight_logged': s.weights.push({ seq: e.seq, date: d.date, kg: d.kg }); break;
        case 'measurement_logged': s.meas.push({ seq: e.seq, date: d.date, site: d.site, cm: d.cm }); break;
        case 'food_logged': s.foods.push(Object.assign({ seq: e.seq }, d)); break;
        case 'set_logged': s.sets.push(Object.assign({ seq: e.seq }, d)); break;
        case 'photo_added': s.photos.push({ seq: e.seq, date: d.date, week: d.week, angle: d.angle, id: d.id }); break;
        default: break;
      }
    }
    s.weights.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    return s;
  }
  function applyRevision(plan, d, e) {
    const c = d.changes || {};
    const before = {};
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'goal']) if (c[k] != null) { before[k] = plan[k]; plan[k] = c[k]; }
    if (c.liftAdjust && plan.lifts[c.liftAdjust.lift]) plan.lifts[c.liftAdjust.lift].adjust.push({ fromWeek: c.liftAdjust.fromWeek, factor: c.liftAdjust.factor });
    if (c.measTargets) plan.measTargets = c.measTargets;
    // A lift added after onboarding goes on the day that trains that muscle.
    if (c.addLifts && typeof c.addLifts === 'object') {
      for (const id of Object.keys(c.addLifts)) {
        const l = c.addLifts[id];
        if (!/^[a-z0-9_]{1,40}$/.test(id) || plan.lifts[id] || !l || !l.blockKg && !l.bw) continue;
        plan.lifts[id] = l;
        const day = plan.workouts.find((w) => w.focus.includes(l.muscle)) || plan.workouts[plan.workouts.length - 1];
        if (day) day.ex.unshift({ lift: id, n: l.name, sets: l.sets || 3, range: '', rest: 150, m: l.muscle });
      }
    }
    plan.history.push({ seq: e.seq, ts: e.ts, src: e.src || 'user', reason: d.reason || '', before, changes: c });
  }

  // ---------- derived numbers ----------
  function avgWeightSeries(weights, window) {
    const w = window || 7;
    return weights.map((p, i) => {
      const sl = weights.slice(Math.max(0, i - w + 1), i + 1);
      return { date: p.date, kg: sl.reduce((t, x) => t + x.kg, 0) / sl.length };
    });
  }
  function latestMeas(meas, site) {
    let best = null;
    for (const m of meas) if (m.site === site && (!best || m.date >= best.date)) best = m;
    return best;
  }
  function setsForWeek(state, week) {
    const [a, b] = weekRange(state.plan.startDate, week);
    return state.sets.filter((x) => x.date >= a && x.date <= b && !x.warmup);
  }
  // Hit / Partial / Behind / Todo for one lift in one week.
  function liftStatus(state, liftId, week, today) {
    const lift = state.plan.lifts[liftId];
    const tg = liftTarget(lift, week, { deloadWeeks: state.plan.deloadWeeks });
    const sets = setsForWeek(state, week).filter((x) => x.lift === liftId);
    const tol = tg.kg ? tg.kg * 0.02 : 0;
    const good = sets.filter((x) => x.reps >= tg.reps && (tg.kg == null || x.kg >= tg.kg - tol));
    const [, end] = weekRange(state.plan.startDate, week);
    const over = today > end;
    let status = 'Todo';
    if (good.length >= tg.sets) status = 'Hit';
    else if (sets.length) status = over ? 'Behind' : 'Partial';
    else if (over) status = 'Behind';
    const top = sets.reduce((m, x) => (x.kg != null && x.kg > m ? x.kg : m), 0);
    const topReps = sets.reduce((m, x) => (x.reps > m ? x.reps : m), 0);
    return { status, target: tg, logged: sets.length, good: good.length, topKg: top || null, topReps };
  }

  // Rules-based monthly review (every 4 weeks). Never a black box: each branch is one sentence.
  function reviewMonth(state, today) {
    const plan = state.plan;
    const week = clamp(weekOf(plan.startDate, today), 1, WEEKS);
    const since = addDays(today, -28);
    const ws = avgWeightSeries(state.weights, 7);
    const inWin = ws.filter((p) => p.date >= since);
    let perWeek = null;
    if (inWin.length >= 2) perWeek = ((inWin[inWin.length - 1].kg - inWin[0].kg) / Math.max(1, daysBetween(inWin[0].date, inWin[inWin.length - 1].date))) * 7;
    const waistNow = latestMeas(state.meas, 'waist');
    const waistThen = state.meas.filter((m) => m.site === 'waist' && m.date <= since).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || { cm: plan.baseline.waistCm };
    const waistDelta = waistNow && waistThen && waistThen.cm ? waistNow.cm - waistThen.cm : null;
    // Lift trend: share of tracked-lift weeks hit in the last 4 completed weeks, and stall length.
    const ids = Object.keys(plan.lifts);
    let hitNow = 0, hitPrev = 0, cnt = 0;
    for (let w = Math.max(1, week - 4); w < week; w++) {
      for (const id of ids) {
        const st = liftStatus(state, id, w, today);
        if (st.logged || st.status === 'Behind') { cnt++; if (st.status === 'Hit') { if (w >= week - 2) hitNow++; else hitPrev++; } }
      }
    }
    const liftsRising = cnt ? hitNow >= hitPrev : null;
    const stalled = cnt >= 6 && hitNow + hitPrev === 0;
    const g = plan.goal;
    const out = { week, perWeek, waistDelta, action: 'hold', kcalDelta: 0, message: '', flags: [] };
    if (perWeek == null && waistDelta == null) { out.message = 'Not enough logs yet. Weigh in most mornings and measure your waist every week or two.'; return out; }
    const wk = perWeek == null ? 0 : perWeek;
    if (g === 'recomp') {
      if (wk < -0.5 || (liftsRising === false && wk < -0.2)) { out.action = 'add'; out.kcalDelta = 175; out.message = 'Weight is dropping faster than a recomp should, or lifts are slipping. Add about 175 kcal.'; }
      else if (stalled && Math.abs(wk) < 0.2) { out.action = 'add'; out.kcalDelta = 125; out.message = 'Lifts have stalled with flat weight. Add about 125 kcal and check your sleep.'; out.flags.push('sleep'); }
      else if ((waistDelta == null || waistDelta >= -0.1) && wk >= 0.5 * 0.25) { out.action = 'cut'; out.kcalDelta = -175; out.message = 'Waist is not shrinking and weight is creeping up. Trim about 175 kcal.'; }
      else if (waistDelta != null && waistDelta <= -0.6 && waistDelta >= -1.4 && wk > -0.3 && wk < 0.4) { out.message = 'Waist is down and weight is flat to slightly up. That is the recomp working. Hold calories.'; }
      else out.message = 'Signals are mixed. Hold calories and check again next month.';
    } else if (g === 'build') {
      if (wk > 0.5) { out.action = 'cut'; out.kcalDelta = -150; out.message = 'Gaining faster than about 0.5 kg a week. Trim about 150 kcal to keep it lean.'; }
      else if (wk < 0.1) { out.action = 'add'; out.kcalDelta = 150; out.message = 'Weight is flat while building. Add about 150 kcal.'; }
      else out.message = 'Gaining at a steady pace. Hold calories.';
    } else {
      if (wk > -0.15) { out.action = 'cut'; out.kcalDelta = -150; out.message = 'Weight loss has slowed below about 0.15 kg a week. Trim about 150 kcal or add steps.'; }
      else if (wk < -0.8) { out.action = 'add'; out.kcalDelta = 150; out.message = 'Losing faster than 0.8 kg a week. Add about 150 kcal to protect muscle.'; }
      else out.message = 'Fat loss is on pace. Hold calories.';
    }
    if (out.kcalDelta) {
      const v = validateMacroChange(plan, state.profile ? state.profile.weightKg : plan.baseline.weightKg, { kcal: plan.kcal + out.kcalDelta });
      out.proposal = v.ok ? v.value : null;
    }
    return out;
  }

  // Goal checkpoints at fixed weeks.
  function checkpoint(state, today) {
    const plan = state.plan;
    const week = weekOf(plan.startDate, today);
    const waistNow = latestMeas(state.meas, 'waist');
    const base = plan.baseline.waistCm;
    if (!waistNow || !base) return null;
    const dIn = cmToIn(waistNow.cm - base);
    if (plan.goal === 'recomp' && week >= 12 && dIn <= -0.5) return { week: 12, text: 'Checkpoint: waist is down ' + Math.abs(dIn).toFixed(1) + ' in. You can move to a lean bulk (+200 kcal).', goal: 'build' };
    if (plan.goal === 'build' && week >= 20 && dIn >= 2) return { week: 20, text: 'Checkpoint: waist is up ' + dIn.toFixed(1) + ' in. Consider a 4 to 6 week mini-cut (-300 kcal).', goal: 'cut' };
    if (plan.goal === 'cut' && week >= 10) return { week: 10, text: 'Checkpoint at week 10: consider switching to recomp at maintenance.', goal: 'recomp' };
    return null;
  }

  // ---------- backup / import validation ----------
  const EVENT_TYPES = ['profile_created', 'plan_revised', 'weight_logged', 'measurement_logged', 'food_logged', 'set_logged', 'photo_added', 'event_voided'];
  const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  function hasBadKeys(o, depth) {
    if (o === null || typeof o !== 'object') return false;
    if (depth > 40) return true;
    if (Array.isArray(o)) return o.some((x) => hasBadKeys(x, depth + 1));
    for (const k of Object.keys(o)) { if (BAD_KEYS.includes(k)) return true; if (hasBadKeys(o[k], depth + 1)) return true; }
    return false;
  }
  function validateEvents(events, max) {
    if (!Array.isArray(events)) return 'Events must be a list.';
    if (events.length > (max || 200000)) return 'Too many events.';
    for (const e of events) {
      if (!e || typeof e !== 'object') return 'Bad event.';
      if (!EVENT_TYPES.includes(e.type)) return 'Unknown event type.';
      if (typeof e.ts !== 'string' || e.ts.length > 40) return 'Bad timestamp.';
      if (e.data == null || typeof e.data !== 'object') return 'Bad event data.';
    }
    if (hasBadKeys(events, 0)) return 'Unsafe keys found.';
    return null;
  }

  // ---------- food logging ----------
  const MEALS = ['Breakfast', 'Pre-workout', 'Post-workout', 'Lunch', 'Snack', 'Dinner'];
  const FOOD_MAX_KCAL = 3000;
  function macroKcal(p, c, f) { return 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0); }
  function num0(x, max) { const n = Number(x); return Number.isFinite(n) ? clamp(Math.round(n), 0, max) : 0; }
  function cleanStr(x, n) { return String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

  // Turns anything a person typed or a model returned into a safe food entry, or explains why not.
  // Never trusts the input: every field is clamped and every string is length-limited.
  function normalizeFood(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['That is not a food entry.'] };
    if (hasBadKeys(raw, 0)) return { ok: false, errors: ['Unsafe keys were found.'] };
    const warnings = [];
    const items = [];
    if (Array.isArray(raw.items)) {
      for (const it of raw.items.slice(0, 25)) {
        if (!it || typeof it !== 'object') continue;
        const name = cleanStr(it.name, 60);
        if (!name) continue;
        items.push({ name, qty: cleanStr(it.qty, 40), kcal: num0(it.kcal, FOOD_MAX_KCAL), protein: num0(it.protein, 400), carbs: num0(it.carbs, 800), fat: num0(it.fat, 400) });
      }
    }
    let kcal = num0(raw.kcal, FOOD_MAX_KCAL), protein = num0(raw.protein, 400), carbs = num0(raw.carbs, 800), fat = num0(raw.fat, 400);
    const sum = (k) => items.reduce((t, x) => t + x[k], 0);
    if (items.length) {
      // The line items are the evidence, so totals follow them.
      const sk = sum('kcal'), sp = sum('protein'), sc = sum('carbs'), sf = sum('fat');
      if (!kcal || Math.abs(sk - kcal) > Math.max(30, 0.05 * kcal)) { if (kcal) warnings.push('The total did not match the ingredients, so it was recalculated from them.'); kcal = sk; protein = sp; carbs = sc; fat = sf; }
    }
    const name = cleanStr(raw.name, 80) || (items.length ? items.map((x) => x.name).slice(0, 3).join(', ') : '');
    if (!name) return { ok: false, errors: ['Give the food a name.'] };
    if (kcal > FOOD_MAX_KCAL || Number(raw.kcal) > FOOD_MAX_KCAL) return { ok: false, errors: ['That is over ' + FOOD_MAX_KCAL + ' kcal for one entry. Split it up.'] };
    if (!kcal && (protein || carbs || fat)) kcal = Math.round(macroKcal(protein, carbs, fat));
    if (!kcal) return { ok: false, errors: ['Add the calories, or the macros so they can be worked out.'] };
    const mk = macroKcal(protein, carbs, fat);
    if (mk > 0 && Math.abs(mk - kcal) > Math.max(60, 0.25 * kcal)) warnings.push('Calories (' + kcal + ') and macros (about ' + Math.round(mk) + ' kcal) do not add up. Worth a second look.');
    const conf = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';
    const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions.slice(0, 8).map((x) => cleanStr(x, 160)).filter(Boolean) : [];
    return { ok: true, value: { name, kcal, protein, carbs, fat, items, assumptions, confidence: conf }, warnings };
  }
  // Models sometimes wrap JSON in prose or code fences. Pull out the first object, nothing more.
  function parseJsonLoose(text) {
    const t = String(text || '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The reply did not contain any data.');
    return JSON.parse(t.slice(a, b + 1));
  }
  function dayTotals(state, date) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, n: 0 };
    for (const f of state.foods) if (f.date === date) { t.kcal += f.kcal || 0; t.protein += f.protein || 0; t.carbs += f.carbs || 0; t.fat += f.fat || 0; t.n++; }
    return t;
  }

  const Engine = {
    MEALS, macroKcal, normalizeFood, parseJsonLoose, dayTotals,
    KG_PER_LB, CM_PER_IN, WEEKS, PHOTO_WEEKS, DELOAD_WEEKS, ANGLES, HEAVY_WAVE, CATALOG, DEFAULT_LIFT_ORDER, MEAS_SITES, LIMITS, TEMPLATES, DEFAULT_STEPS,
    clean, roundTo, clamp, lbToKg, kgToLb, inToCm, cmToIn, isoDate, parseISO, addDays, daysBetween, weekOf, weekRange, weekdayOf,
    bmr, maintenance, targetsFor, recommendGoal, measurementTargets, blockOfWeek, blockWeights, e1rm, startWeight, buildLiftPlan, liftTarget,
    buildWorkouts, buildPlan, weeklyTargets, validateMacroChange, validateLiftChange, project, avgWeightSeries, latestMeas, setsForWeek,
    liftStatus, reviewMonth, checkpoint, validateEvents, hasBadKeys, EVENT_TYPES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);
