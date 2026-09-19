/*
 * Profile: the basics you entered plus your plan, and the one thing you can change here, the weekly photo check-in day.
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
        h('div', { class: 'grow' }, h('div', { class: 'display big2' }, name || 'You'), h('div', { class: 'muted' }, cap(plan.goal) + ' · week ' + week + ' of ' + E.WEEKS)))),
      UI.card(h('div', { class: 'ct' }, 'Basics'),
        kv('Sex', cap(pr.sex)), kv('Age', pr.age ? pr.age + ' years' : null), kv('Height', height),
        kv('Weight now', latest ? U.fmtWeight(latest.kg, bu) + ' ' + bu + ' (' + U.shortDate(latest.date) + ')' : null),
        kv('Started at', pr.weightKg ? U.fmtWeight(pr.weightKg, bu) + ' ' + bu : null),
        kv('Body fat', pr.bodyFatPct ? pr.bodyFatPct + '%' : null), kv('Eating', pr.diet)),
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
