/*
 * Photo trend (scrub or play through your check-ins, with the numbers of each day) and Compare (any two dates).
 * Photos are read from this device only; nothing here leaves it. The saving sheets live in screens-export.js.
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};

  const T = { angle: null, week: null, reveal: false, speed: 1 };                      // trend screen, kept while you move around
  const CMP = { angle: null, a: null, b: null, mode: 'slider', pos: 0.5, blend: 0.5, reveal: false };
  const SPEEDS = [1, 2, 0.5];
  let urls = [], gen = 0, timer = null;

  // One decimal everywhere on these screens, so columns line up: 82.0, -1.0, +0.7.
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const signed = (x) => { const v = Math.round(x * 10) / 10; return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(1); };
  const wk = (w) => 'Wk ' + w;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function revokeUrls() { for (const u of urls) URL.revokeObjectURL(u); urls = []; }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }

  // The angle with the most photos, unless you already picked one.
  function trendAngle(st) {
    if (T.angle) return T.angle;
    let best = 'Front', n = 0;
    for (const a of E.ANGLES) { const c = st.photos.filter((p) => p.angle === a).length; if (c > n) { best = a; n = c; } }
    return best;
  }
  async function loadUrls(items, into, myGen) {
    for (const c of items) {
      const m = await Store.getMedia(c.photo.id);
      if (myGen !== gen) return false;
      if (m) { const u = URL.createObjectURL(m.blob); urls.push(u); into[c.week] = u; }
    }
    return true;
  }
  // Pointer drag along an element's width; calls onMove with the pointer event.
  function dragX(el, onMove) {
    let down = false;
    el.addEventListener('pointerdown', (e) => { if (e.button > 0) return; down = true; try { el.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } onMove(e); });
    el.addEventListener('pointermove', (e) => { if (down) onMove(e); });
    const up = () => { down = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function anglePills(onPick) {
    const box = UI.pills({ items: E.ANGLES, values: new Set([T.angle]), multi: false, onChange: (v) => onPick(Array.from(v)[0]) });
    box.classList.add('hscroll');
    return box;
  }

  // The number a stat card shows for a check-in, in the person's units.
  const KEYS = {
    weight: { label: 'Weight', of: (c) => (c.snap ? c.snap.weightKg : null), show: (v, set) => f1(U.kgToUnit(v, set.bodyUnit)), unit: (set) => set.bodyUnit, diff: (d, set) => U.kgToUnit(d, set.bodyUnit) },
  };
  for (const [site, label] of E.MEAS_SITES) KEYS[site] = { label, of: (c) => (c.snap ? c.snap.meas[site] : null), show: (v, set) => f1(U.cmToUnit(v, set.lenUnit)), unit: (set) => set.lenUnit, diff: (d, set) => U.cmToUnit(d, set.lenUnit) };

  // Rows of the before/after table, shared by the compare screen and the saved image.
  function compareRows(st, ca, cb, set) {
    const rows = [];
    for (const key of ['weight'].concat(E.MEAS_SITES.map((s) => s[0]))) {
      const K = KEYS[key], a = K.of(ca), b = K.of(cb);
      if (a == null && b == null) continue;
      const both = a != null && b != null, d = both ? b - a : null, u = K.unit(set);
      rows.push({
        name: K.label, a: a == null ? '—' : K.show(a, set) + ' ' + u, b: b == null ? '—' : K.show(b, set) + ' ' + u,
        change: both ? signed(K.diff(d, set)) + ' ' + u : '—', tone: both ? E.changeTone(d, E.goalDir(st.plan, key)) : '',
      });
    }
    return rows;
  }
  const numbersText = (snap, set) => {
    if (!snap) return '';
    const p = [];
    if (snap.weightKg != null) p.push(KEYS.weight.show(snap.weightKg, set) + ' ' + set.bodyUnit);
    if (snap.meas.waist != null) p.push(KEYS.waist.show(snap.meas.waist, set) + ' ' + set.lenUnit);
    return p.join(' · ');
  };

  // ---------- Photo trend ----------
  Screens.photoTrend = function () {
    revokeUrls(); stopTimer();
    const myGen = ++gen;
    const st = Store.getState(), set = Store.getSettings();
    if (!T.angle) T.angle = trendAngle(st);
    const angle = T.angle;
    const curWeek = E.clamp(E.weekOf(st.plan.startDate, U.today()), 1, E.WEEKS);
    const cis = E.checkIns(st, angle, curWeek), have = cis.filter((c) => c.photo), n = cis.length;
    const pills = anglePills((a) => { T.angle = a; T.week = null; T.reveal = false; root.App.render(); });
    const back = { back: '#/photos' };

    if (!have.length) {
      return UI.page(UI.header('Photo trend', angle + ' · no photos yet', back), UI.scroller(pills,
        UI.card(h('div', { class: 'muted' }, 'You have no ' + angle + ' photos yet. Add one at a check-in and it shows up here.'), UI.btn('Open photo check-in', { href: '#/photos', kind: 'quiet' }))));
    }
    if (!have.find((c) => c.week === T.week)) T.week = have[have.length - 1].week;

    // stage
    const blurOn = !!set.blurPhotos;
    const img = h('img', { class: 'stage-img', alt: '' });
    const badge = h('span', { class: 'stage-badge' });
    const eye = h('span', { class: 'stage-eye' }, U.icon('eye', 30));
    const cap = h('span', { class: 'stage-cap' });
    const stage = h(blurOn ? 'button' : 'div', blurOn ? { type: 'button', class: 'stage', onclick: () => { T.reveal = !T.reveal; update(); } } : { class: 'stage' }, img, blurOn ? badge : null, blurOn ? eye : null, cap);

    // numbers under the photo
    const third = ['chest', 'shoulders', 'bicepL', 'hips'].find((k) => have.some((c) => KEYS[k].of(c) != null)) || 'chest';
    const keys = ['weight', 'waist', third];
    const cards = keys.map((k) => ({ k, lab: h('span', { class: 'tl' }, KEYS[k].label), val: h('b', null), unit: h('small', null), delta: h('div', { class: 'td' }) }));
    const statRow = h('div', { class: 'tstats' }, cards.map((c) => h('div', { class: 'tstat' }, c.lab, h('div', { class: 'tv' }, c.val, c.unit), c.delta)));
    const note = h('div', { class: 'muted small' }, 'Change since week ' + have[0].week + '. Green means toward your goal.');

    // scrubber
    const line = h('div', { class: 'scrub-line' }, h('div', { class: 'scrub-fill' }));
    const showLabel = (w) => n <= 10 || w === 1 || w === n || w % 5 === 0;
    const dotEls = cis.map((c) => h('span', { class: 'sdot' + (c.photo ? ' has' : '') + (showLabel(c.week) ? '' : ' nolab') }, h('i', { class: 'd' }), h('b', { class: 'w' }, String(c.week))));
    const scrub = h('div', { class: 'scrub', role: 'slider', tabindex: '0', 'aria-label': 'Check-in', 'aria-valuemin': '0', 'aria-valuemax': String(n - 1) }, line, ...dotEls);
    scrub.style.setProperty('--n', String(n)); if (n > 14) scrub.classList.add('dense');
    const idxOf = (w) => cis.findIndex((c) => c.week === w);
    const nearestHave = (i) => { let best = null; for (const c of have) { const j = idxOf(c.week); if (best == null || Math.abs(j - i) < Math.abs(idxOf(best.week) - i)) best = c; } return best; };
    dragX(scrub, (e) => {
      const r = scrub.getBoundingClientRect();
      const i = clamp(Math.floor(((e.clientX - r.left) / r.width) * n), 0, n - 1);
      const c = nearestHave(i); if (c && c.week !== T.week) { stop(); pick(c.week); }
    });
    scrub.addEventListener('keydown', (e) => {
      const k = e.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
      e.preventDefault(); stop();
      const cur = have.findIndex((c) => c.week === T.week);
      const to = k === 'Home' ? 0 : k === 'End' ? have.length - 1 : clamp(cur + (k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : 1), 0, have.length - 1);
      pick(have[to].week);
    });
    const playBtn = h('button', { type: 'button', class: 'playbtn', 'aria-label': 'Play through the check-ins', onclick: () => (timer ? stop() : play()) });
    const speedBtn = h('button', { type: 'button', class: 'chip line speedchip', onclick: () => { T.speed = SPEEDS[(SPEEDS.indexOf(T.speed) + 1) % SPEEDS.length]; if (timer) { stopTimer(); startTimer(); } update(); } });
    const player = UI.card(h('div', { class: 'playrow' }, playBtn, scrub), h('div', { class: 'target-top' }, h('div', { class: 'muted small' }, have.length > 1 ? 'Drag to scrub, or play through every check-in.' : 'Add this angle at another check-in to play through them.'), speedBtn));

    // thumbnails
    const thumbEls = cis.map((c) => {
      if (!c.photo) return h('a', { href: '#/photos', class: 'tthumb none', 'aria-label': 'Add week ' + c.week + ' ' + angle + ' photo', onclick: () => Screens._.gotoWeek(c.week) }, h('span', { class: 'tbox' }, U.icon('plus', 18)), h('span', { class: 'tw' }, wk(c.week)));
      const im = h('img', { alt: '' });
      return Object.assign(h('button', { type: 'button', class: 'tthumb', 'aria-label': 'Show week ' + c.week, onclick: () => { stop(); pick(c.week); } }, h('span', { class: 'tbox' + (blurOn ? ' blur' : '') }, im), h('span', { class: 'tw' }, wk(c.week))), { im });
    });
    const strip = h('div', { class: 'tstrip' }, thumbEls);
    const chartBox = h('div', null);
    const chartCard = UI.card(h('div', { class: 'ct' }, 'Waist at each check-in'), chartBox);

    const enough = have.length >= 2;
    const foot = h('div', { class: 'foot' },
      UI.btn('Download time-lapse', { icon: 'download', disabled: !enough, onClick: () => Screens._.videoSheet({ angle, items: have, index: Math.max(0, have.findIndex((c) => c.week === T.week)), numbersText, wkLabel: (c) => 'Week ' + c.week + ' · ' + U.shortDate(c.date) }) }),
      UI.btn('Compare two dates', { href: '#/photos/compare', kind: 'quiet' }),
      enough ? null : h('div', { class: 'muted small centered' }, 'Add this angle at two check-ins to download or compare.'));

    const urlByWeek = {};
    let loaded = false;

    function pick(w) { T.week = w; update(); }
    function syncPlay() {
      const on = !!timer;
      U.clear(playBtn); playBtn.appendChild(U.icon(on ? 'pause' : 'chev', 26)); playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play through the check-ins');
      speedBtn.textContent = 'Speed ' + T.speed + 'x';
      playBtn.disabled = have.length < 2; speedBtn.disabled = have.length < 2;
    }
    function stop() { stopTimer(); syncPlay(); }
    function startTimer() {
      timer = setInterval(() => {
        if (!stage.isConnected) return stopTimer();
        const i = have.findIndex((c) => c.week === T.week);
        if (i >= have.length - 1) return stop();
        pick(have[i + 1].week);
      }, 1300 / T.speed);
    }
    function play() {
      if (have.length < 2) return;
      if (T.week === have[have.length - 1].week) T.week = have[0].week;
      startTimer(); update();
    }
    function update() {
      const cur = cis.find((c) => c.week === T.week), ci = idxOf(T.week), url = urlByWeek[T.week];
      const hidden = blurOn && !T.reveal;
      if (url) { if (img.getAttribute('src') !== url) img.src = url; } else img.removeAttribute('src');
      img.alt = angle + ', week ' + cur.week;
      stage.classList.toggle('blur', hidden);
      badge.textContent = hidden ? 'Blurred · tap to reveal' : 'Tap to blur';
      eye.classList.toggle('hidden', !hidden);
      stage.setAttribute('aria-label', hidden ? 'Reveal photo' : 'Blur photo');
      cap.textContent = loaded && !url ? 'This photo is not on this device' : 'Week ' + cur.week + ' · ' + U.shortDate(cur.date);
      // scrubber
      scrub.setAttribute('aria-valuenow', String(ci)); scrub.setAttribute('aria-valuetext', 'Week ' + cur.week + ', ' + U.shortDate(cur.date));
      line.firstChild.style.width = (n > 1 ? (ci / (n - 1)) * 100 : 0) + '%';
      cis.forEach((c, i) => { dotEls[i].classList.toggle('cur', i === ci); dotEls[i].classList.toggle('past', i < ci); });
      thumbEls.forEach((t, i) => { if (!cis[i].photo) return; t.classList.toggle('cur', i === ci); const u = urlByWeek[cis[i].week]; if (u && t.im.getAttribute('src') !== u) t.im.src = u; });
      // numbers
      for (const c of cards) {
        const K = KEYS[c.k], v = K.of(cur), first = have.find((x) => K.of(x) != null);
        c.val.textContent = v == null ? '—' : K.show(v, set); c.unit.textContent = v == null ? '' : ' ' + K.unit(set);
        c.delta.className = 'td'; c.delta.textContent = '';
        if (v != null && first && first.week !== cur.week) {
          const d = v - K.of(first), tone = E.changeTone(d, E.goalDir(st.plan, c.k));
          c.delta.textContent = signed(K.diff(d, set)) + ' ' + K.unit(set); if (tone) c.delta.classList.add(tone);
        } else if (v != null) c.delta.textContent = 'Starting point';
        else c.delta.textContent = 'Not logged near this date';
      }
      // waist chart
      const pts = have.filter((c) => KEYS.waist.of(c) != null).map((c) => ({ x: c.week, y: U.cmToUnit(KEYS.waist.of(c), set.lenUnit) }));
      const here = pts.filter((p) => p.x === cur.week);
      U.clear(chartBox);
      chartBox.appendChild(pts.length ? U.lineChart({ label: 'Waist at each check-in', xs: [1, Math.max(2, n)], series: [{ pts, color: U.PAL.cool }, { pts, color: U.PAL.cool, dots: true, line: false }, { pts: here, color: U.PAL.acc, dots: true, line: false, r: 5.5 }], xLabel: (x) => wk(x), fmtY: (y) => U.num(y, 1) })
        : h('div', { class: 'muted' }, 'Log your waist near a check-in and it appears here.'));
      syncPlay();
    }

    update();
    loadUrls(have, urlByWeek, myGen).then((ok) => { if (ok) { loaded = true; update(); } });

    return UI.page(UI.header('Photo trend', angle + ' · ' + have.length + ' of ' + n + ' weekly check-ins', back), UI.scroller(pills, stage, statRow, note, player, strip, chartCard), foot);
  };

  // ---------- Compare two dates ----------
  Screens.photoCompare = function () {
    revokeUrls(); stopTimer();
    const myGen = ++gen;
    const st = Store.getState(), set = Store.getSettings();
    if (!T.angle) T.angle = trendAngle(st);
    const angle = T.angle, cis = E.checkIns(st, angle), have = cis.filter((c) => c.photo);
    const head = UI.header('Compare', angle + ' · pick any two check-ins', { back: '#/photos/trend' });
    if (have.length < 2) {
      return UI.page(head, UI.scroller(UI.card(h('div', { class: 'muted' }, 'Add ' + angle + ' photos at two check-ins to compare them.'), UI.btn('Open photo check-in', { href: '#/photos', kind: 'quiet' }))));
    }
    if (CMP.angle !== angle || !have.find((c) => c.week === CMP.a) || !have.find((c) => c.week === CMP.b)) { CMP.angle = angle; CMP.a = have[0].week; CMP.b = have[have.length - 1].week; CMP.reveal = false; }
    const byWeek = (w) => have.find((c) => c.week === w);
    const urlByWeek = {};
    const blurOn = !!set.blurPhotos;

    const selectFor = (which, label) => {
      const s = h('select', { class: 'inp', 'aria-label': label, onchange: () => { CMP[which] = Number(s.value); redraw(); } },
        ...have.map((c) => h('option', { value: String(c.week), selected: c.week === CMP[which] }, wk(c.week) + ' · ' + U.shortDate(c.date))));
      return h('label', { class: 'field flex' }, h('span', { class: 'lab' }, label), h('span', { class: 'selbox' }, s));
    };
    const modeSeg = UI.seg({ options: [{ value: 'side', label: 'Side by side' }, { value: 'slider', label: 'Slider' }, { value: 'overlay', label: 'Overlay' }], value: CMP.mode, onChange: (v) => { CMP.mode = v; redraw(); } });
    const stageBox = h('div', { class: 'cmpwrap' });
    const help = h('div', { class: 'muted small' });
    const tableBox = h('div', null);
    const badge = h('button', { type: 'button', class: 'stage-badge cmpbadge', onclick: () => { CMP.reveal = !CMP.reveal; redraw(); } });
    const foot = h('div', { class: 'foot' });
    let loaded = false;

    const pill = (t, side) => h('span', { class: 'cmplabel ' + side }, t);
    const photo = (w, cls) => { const im = h('img', { class: cls || '', alt: angle + ' week ' + w }); const u = urlByWeek[w]; if (u) im.src = u; return im; };

    function redraw() {
      const ca = byWeek(CMP.a), cb = byWeek(CMP.b), hidden = blurOn && !CMP.reveal;
      U.clear(stageBox);
      const la = 'Week ' + ca.week + ' · ' + U.shortDate(ca.date), lb = 'Week ' + cb.week + ' · ' + U.shortDate(cb.date);
      if (CMP.mode === 'side') {
        stageBox.appendChild(h('div', { class: 'cmp-side' + (hidden ? ' blur' : '') }, h('div', { class: 'cmp-cell' }, photo(ca.week), pill(wk(ca.week), 'l')), h('div', { class: 'cmp-cell' }, photo(cb.week), pill(wk(cb.week), 'l'))));
        help.textContent = 'Same pose, same light. Look at the same spots on both.';
      } else if (CMP.mode === 'slider') {
        const clip = h('div', { class: 'cmp-clip' }, photo(ca.week));
        const handle = h('div', { class: 'cmp-handle', role: 'slider', tabindex: '0', 'aria-label': 'Compare position', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'knob2' }, U.icon('swap', 20)));
        const box = h('div', { class: 'cmp-slider' + (hidden ? ' blur' : ''), 'data-testid': 'cmp-slider' }, photo(cb.week), clip, handle, pill(la, 'l'), pill(lb, 'r'));
        const set2 = (p) => { CMP.pos = clamp(p, 0, 1); clip.style.clipPath = 'inset(0 ' + (100 - CMP.pos * 100) + '% 0 0)'; handle.style.left = CMP.pos * 100 + '%'; handle.setAttribute('aria-valuenow', String(Math.round(CMP.pos * 100))); };
        dragX(box, (e) => { const r = box.getBoundingClientRect(); set2((e.clientX - r.left) / r.width); });
        handle.addEventListener('keydown', (e) => { const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0; if (!step) return; e.preventDefault(); set2(CMP.pos + step); });
        set2(CMP.pos);
        stageBox.appendChild(box);
        help.textContent = 'Drag the handle across. Overlay blends the two so you can line up your pose.';
      } else {
        const over = photo(cb.week, 'cmp-over');
        over.style.opacity = String(CMP.blend);
        const box = h('div', { class: 'cmp-slider' + (hidden ? ' blur' : '') }, photo(ca.week), over, pill(la, 'l'), pill(lb, 'r'));
        const range = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(CMP.blend * 100)), class: 'range', 'aria-label': 'Blend', oninput: () => { CMP.blend = Number(range.value) / 100; over.style.opacity = String(CMP.blend); } });
        stageBox.appendChild(box); stageBox.appendChild(h('div', { class: 'blendrow' }, h('span', { class: 'muted small' }, wk(ca.week)), range, h('span', { class: 'muted small' }, wk(cb.week))));
        help.textContent = 'Slide to fade from the first check-in to the second. Line up head and feet.';
      }
      if (blurOn) { badge.textContent = hidden ? 'Blurred · tap to reveal' : 'Tap to blur'; stageBox.appendChild(badge); }
      if (loaded && (!urlByWeek[ca.week] || !urlByWeek[cb.week])) help.textContent = 'One of these photos is not on this device (it was left out of the backup you restored).';

      const rows = compareRows(st, ca, cb, set);
      U.clear(tableBox);
      tableBox.appendChild(UI.card(
        h('div', { class: 'cmptable' },
          h('div', { class: 'cmprow head' }, h('span', null, 'Measure'), h('span', null, wk(ca.week)), h('span', null, wk(cb.week)), h('span', null, 'Change')),
          ...(rows.length ? rows.map((r) => h('div', { class: 'cmprow' }, h('b', null, r.name), h('span', null, r.a), h('b', null, r.b), h('b', { class: r.tone || 'muted' }, r.change))) : [h('div', { class: 'muted' }, 'Log a weight or measurement near these dates to see the change here.')]))));
      const different = ca.week !== cb.week;
      U.clear(foot);
      U.put(foot, UI.btn('Download image', { icon: 'download', disabled: !different, onClick: () => Screens._.imageSheet({ angle, a: ca, b: cb, rows, mode: CMP.mode, pos: CMP.pos, blend: CMP.blend }) }),
        different ? null : h('div', { class: 'muted small centered' }, 'Pick two different check-ins to download a comparison.'));
    }

    redraw();
    loadUrls(have, urlByWeek, myGen).then((ok) => { if (ok) { loaded = true; redraw(); } });

    return UI.page(head, UI.scroller(h('div', { class: 'row' }, selectFor('a', 'Before'), selectFor('b', 'After')), modeSeg, stageBox, help, tableBox,
      h('div', { class: 'muted small' }, 'Photos stay on this device.' + (blurOn ? ' Blur is on until you reveal them.' : ''))), foot);
  };

  // Leaving these screens frees the photo URLs and stops any playback.
  window.addEventListener('hashchange', () => { if (!/^#\/photos\/(trend|compare)$/.test(location.hash)) { stopTimer(); revokeUrls(); gen++; } });

  Screens._ = Object.assign(Screens._ || {}, { trendAngle, compareRows, numbersText });
})(self);
