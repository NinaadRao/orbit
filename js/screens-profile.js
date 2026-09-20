/*
 * Profile: the basics you entered (name, sex, age, height, body fat, diet, all editable) plus your plan and the weekly photo check-in day.
 * Everything shown comes from data already on this device. Nothing here is sent anywhere.
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const feetInches = (cm) => { const t = Math.round(cm / 2.54); return Math.floor(t / 12) + ' ft ' + (t % 12) + ' in'; };
  const kv = (k, v) => (v == null || v === '' ? null : h('div', { class: 'kv' }, h('span', null, k), h('b', null, v)));

  // Change the basics after onboarding. Only what you actually changed is saved, as one profile_edited event (so Undo works
  // and it rides along in backups). It does not touch your calorie targets: those live in Plan settings.
  function editSheet() {
    const st = Store.getState(), pr = st.profile, set = Store.getSettings(), inches = set.lenUnit === 'in';
    const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
    const tin = pr.heightCm ? Math.round(pr.heightCm / 2.54) : 0;
    const init = { name: pr.name || '', age: pr.age ? String(pr.age) : '', ft: tin ? String(Math.floor(tin / 12)) : '', inch: tin ? String(tin % 12) : '', cm: pr.heightCm ? String(Math.round(pr.heightCm)) : '', bf: pr.bodyFatPct ? String(pr.bodyFatPct) : '' };
    let sex = ['male', 'female', 'other'].includes(pr.sex) ? pr.sex : 'male';
    const name = UI.field({ label: 'Name (optional)', value: init.name, maxlength: 40, hint: 'Stays on this device, never sent to a coach.' });
    const age = UI.field({ label: 'Age', value: init.age, unit: 'yrs', type: 'number', flex: 1 });
    const bf = UI.field({ label: 'Body fat (optional)', value: init.bf, unit: '%', type: 'number', flex: 1 });
    const ft = UI.field({ label: 'Height', value: init.ft, unit: 'ft', type: 'number', flex: 1 }), inch = UI.field({ label: ' ', value: init.inch, unit: 'in', type: 'number', flex: 1 });
    const cm = UI.field({ label: 'Height', value: init.cm, unit: 'cm', type: 'number', flex: 1 });
    const sexSeg = UI.seg({ label: 'Sex (for calorie maths)', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }], value: sex, onChange: (v) => { sex = v; } });
    const dietSel = h('select', { class: 'inp', 'aria-label': 'Diet style' });
    for (const o of E.PROFILE_DIETS) dietSel.appendChild(h('option', { value: o, selected: o === pr.diet }, o));
    const body = h('div', { class: 'stack' }, name, sexSeg, UI.row(age, bf), UI.row(...(inches ? [ft, inch] : [cm])),
      h('label', { class: 'field' }, h('span', { class: 'lab' }, 'Diet style'), dietSel),
      h('div', { class: 'muted small' }, 'Weight comes from your weigh-ins. Your calorie and protein targets stay as they are; change them in Plan settings.'));
    U.sheet('Edit profile', body, [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: () => {
      const f = {};
      if (name.input.value.trim() !== init.name.trim()) f.name = name.input.value;
      if (sex !== pr.sex) f.sex = sex;
      if (age.input.value.trim() !== init.age) f.age = numOrNull(age.input.value);
      if (bf.input.value.trim() !== init.bf) f.bodyFatPct = bf.input.value.trim() === '' ? null : numOrNull(bf.input.value);
      if (dietSel.value !== pr.diet) f.diet = dietSel.value;
      if (inches ? (ft.input.value.trim() !== init.ft || inch.input.value.trim() !== init.inch) : cm.input.value.trim() !== init.cm) {
        const v = inches ? (numOrNull(ft.input.value) == null ? null : numOrNull(ft.input.value) * 30.48 + (numOrNull(inch.input.value) || 0) * 2.54) : numOrNull(cm.input.value);
        f.heightCm = v;
      }
      if (!Object.keys(f).length) { U.toast('Nothing changed.'); return false; }
      const chk = E.cleanProfileEdit(f);
      if (!chk.ok) { U.toast(chk.errors[0], 'warn'); return false; }
      Store.append('profile_edited', { fields: chk.value }, 'user').then(() => { U.toast('Profile updated.'); root.App.render(); });
    } }]);
  }
  Screens.editProfileSheet = editSheet;

  Screens.profile = function () {
    const st = Store.getState(), pr = st.profile, plan = st.plan, set = Store.getSettings(), t = U.today();
    const week = E.clamp(E.weekOf(plan.startDate, t), 1, E.WEEKS);
    const latest = st.weights.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).pop();
    const bu = set.bodyUnit, lu = set.lenUnit;
    const name = (pr.name || '').trim();
    const initials = name ? name.split(/\s+/).slice(0, 2).map((x) => x[0].toUpperCase()).join('') : '';
    const height = pr.heightCm ? (lu === 'in' ? feetInches(pr.heightCm) : U.fmtLen(pr.heightCm, 'cm', 0) + ' cm') : null;
    const days = (pr.days || plan.days || []).slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((d) => U.DOW[d]).join(', ');
    const dayItems = ORDER.map((d) => U.DOW[d]);

    const dayPills = UI.pills({
      label: 'Weekly photo check-in day', items: dayItems, values: new Set([U.DOW[set.checkinDay]]), multi: false,
      onChange: (v) => {
        const d = U.DOW.indexOf(Array.from(v)[0]);
        if (d >= 0) Store.saveSettings({ checkinDay: d }).then(() => { U.toast('Check-in day set to ' + U.DOW[d] + '.'); root.App.render(); });
      },
    });

    return UI.page(UI.header('Profile', 'Only on this device.', { back: '#/today' }), UI.scroller(
      UI.card(h('div', { class: 'profhead' },
        h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials || U.icon('user', 26)),
        h('div', { class: 'grow' }, h('div', { class: 'display big2' }, name || 'You'), h('div', { class: 'muted' }, cap(plan.goal) + ' · week ' + week + ' of ' + E.WEEKS)),
        UI.btn(name ? 'Edit' : 'Add name', { kind: 'quiet', block: false, onClick: editSheet }))),
      UI.card(h('div', { class: 'ct' }, 'Basics'),
        kv('Sex', cap(pr.sex)), kv('Age', pr.age ? pr.age + ' years' : null), kv('Height', height),
        kv('Weight now', latest ? U.fmtWeight(latest.kg, bu) + ' ' + bu + ' (' + U.shortDate(latest.date) + ')' : null),
        kv('Started at', pr.weightKg ? U.fmtWeight(pr.weightKg, bu) + ' ' + bu : null),
        kv('Body fat', pr.bodyFatPct ? pr.bodyFatPct + '%' : null), kv('Eating', pr.diet),
        UI.btn('Edit profile', { kind: 'quiet', onClick: editSheet })),
      UI.card(h('div', { class: 'ct' }, 'Your plan'),
        kv('Goal', cap(plan.goal)), kv('Started', U.longDate(plan.startDate)),
        kv('Calories', U.withCommas(plan.kcal) + ' kcal'), kv('Protein', plan.protein + ' g'), kv('Carbs', plan.carbs + ' g'), kv('Fat', plan.fat + ' g'),
        kv('Training days', days), kv('Sessions', (plan.workouts || []).map((w) => w.name).join(' · ')),
        kv('Session length', pr.sessionMin ? pr.sessionMin + ' min' + (pr.timeOfDay ? ', ' + String(pr.timeOfDay).toLowerCase() : '') : null),
        UI.btn('Plan settings', { href: '#/settings/plan', kind: 'quiet' })),
      UI.card(h('div', { class: 'ct' }, 'Weekly check-in'), dayPills,
        h('div', { class: 'muted small' }, 'Progress photos are due once a week, on this day. Today reminds you until all five angles are saved, and flags any week you missed.')),
      UI.card(h('div', { class: 'ct' }, 'Privacy, backup and units'), h('div', { class: 'muted small' }, 'Units, app lock, backups and restore live here.'), UI.btn('Open settings', { href: '#/settings', kind: 'quiet' }))));
  };
})(self);
