/*
 * "Make a reel": choose library items (and optionally your weekly check-in photos), tell Regoal where the originals are,
 * and it stitches them into one MP4 on this device (js/reel.js). Nothing is uploaded and the video is not kept in Regoal.
 * Regoal does not hold the originals, so on iPhone you pick them again in one go and Regoal matches them by name and size.
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, Library = root.Library, Reel = root.Reel;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0));

  // o: { preselect: [clip ids] } (optional)
  Screens.reelSheet = function (o) {
    const st = Store.getState(), set = Store.getSettings();
    const clips = st.clips.slice().sort(byDate);
    const counts = {};
    for (const p of st.photos) counts[p.angle] = (counts[p.angle] || 0) + 1;
    const angles = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (!clips.length && !angles.length) { U.toast('Add photos or videos to the library first.', 'warn'); return; }
    const opt = { shape: 'story', photoSec: 1.5, clipSec: 4, labels: true, titleOn: true, title: 'My training', progress: !clips.length, angle: angles[0] || null };
    const sel = new Set(o && o.preselect ? o.preselect : clips.slice(-Reel.MAX_ITEMS).map((c) => c.id));
    const files = new Map();   // clip id -> File, only for this sheet
    const urls = [];
    const liftName = (id) => (id && st.plan.lifts[id] ? st.plan.lifts[id].name : '');
    const supported = !!root.MediaOut.pickVideoMime();
    const box = h('div', { class: 'stack' });
    let ctl = null, closeSheet = null;
    closeSheet = U.sheet('Make a reel', box, [], { onClose: () => { if (ctl) ctl.abort(); files.clear(); urls.forEach((u) => URL.revokeObjectURL(u)); } });

    const progressPhotos = () => (opt.progress && opt.angle ? st.photos.filter((p) => p.angle === opt.angle) : []);
    const chosenClips = () => clips.filter((c) => sel.has(c.id));
    const count = () => chosenClips().length + progressPhotos().length;
    const asItems = (blobs) => {
      const items = chosenClips().filter((c) => files.has(c.id)).map((c) => ({ date: c.date, seq: c.seq, type: c.kind, blob: files.get(c.id), dur: c.dur, label: U.shortDate(c.date) + ' · ' + c.tag, sub: liftName(c.lift) }));
      for (const p of progressPhotos()) if (blobs.has(p.id)) items.push({ date: p.date, seq: p.seq, type: 'photo', blob: blobs.get(p.id), label: U.shortDate(p.date) + ' · Check-in', sub: '' });
      return items.sort(byDate);
    };
    const seconds = () => {
      const items = chosenClips().map((c) => ({ type: c.kind, dur: c.dur })).concat(progressPhotos().map(() => ({ type: 'photo' })));
      return Reel.secondsOf(items, { photoSec: opt.photoSec, clipSec: opt.clipSec, title: opt.titleOn ? opt.title || 'x' : '' });
    };

    // ---------- step 1: choose ----------
    function choose() {
      U.clear(box);
      const grid = h('div', { class: 'photogrid libgrid reelpick' });
      const tiles = new Map();
      const sum = h('div', { class: 'muted small centered', role: 'status' });
      const go = UI.btn('Continue', { icon: 'film', onClick: () => next() });
      const refresh = () => {
        for (const [id, t] of tiles) { const on = sel.has(id); t.setAttribute('aria-pressed', on ? 'true' : 'false'); t.classList.toggle('sel', on); }
        const n = count(), sec = seconds();
        sum.textContent = n ? n + (n === 1 ? ' item' : ' items') + ' · about ' + Math.round(sec) + ' seconds · about ' + Reel.sizeMB(sec) + ' MB' : 'Nothing chosen yet.';
        const over = n > Reel.MAX_ITEMS || sec > Reel.MAX_SECONDS;
        go.disabled = !supported || !n || over;
        warn.classList.toggle('hidden', !over);
      };
      const warn = h('div', { class: 'warnbox hidden', role: 'alert' }, 'That is too long for one reel (at most ' + Reel.MAX_ITEMS + ' items and ' + Reel.MAX_SECONDS / 60 + ' minutes). Take some out or shorten the clips.');
      for (const c of clips) {
        const img = h('img', { alt: '' });
        const tick = h('span', { class: 'tick', 'aria-hidden': 'true' }, U.icon('check', 14));
        const t = h('button', { type: 'button', class: 'thumb libtile' + (set.blurPhotos ? ' blur' : ''), 'aria-pressed': 'false', 'aria-label': c.tag + ' ' + c.kind + ' from ' + U.longDate(c.date),
          onclick: () => { if (sel.has(c.id)) sel.delete(c.id); else sel.add(c.id); refresh(); } },
        img, tick, c.kind === 'video' ? h('span', { class: 'dur' }, Library.fmtDur(c.dur)) : null, h('div', { class: 'lbl' }, U.shortDate(c.date) + ' · ' + c.tag));
        tiles.set(c.id, t); grid.appendChild(t);
        (async () => {
          const m = c.thumb ? await Store.getMedia(c.thumb) : null;
          if (!m) { img.remove(); t.insertBefore(h('div', { class: 'ph' }, U.icon(c.kind === 'video' ? 'film' : 'camera', 24)), t.firstChild); return; }
          const u = URL.createObjectURL(m.blob); urls.push(u); img.src = u;
        })();
      }
      const angleSeg = UI.seg({ label: 'Check-in angle', options: angles, value: opt.angle, onChange: (v) => { opt.angle = v; refresh(); } });
      angleSeg.classList.toggle('hidden', !opt.progress || angles.length < 2);
      const nTitle = h('div', { class: opt.titleOn ? '' : 'hidden' });
      const title = UI.field({ label: 'Title', value: opt.title, maxlength: 40, placeholder: 'My training' });
      title.input.addEventListener('input', () => { opt.title = title.input.value.trim(); refresh(); });
      nTitle.appendChild(title);
      U.put(box,
        h('div', { class: 'muted small' }, 'Pick the clips and photos that go in, in date order. Regoal does not hold the originals, so the next step asks where they are.'),
        clips.length ? h('div', { class: 'linkrow' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => { clips.slice(-Reel.MAX_ITEMS).forEach((c) => sel.add(c.id)); refresh(); } }, 'Select all'), h('button', { type: 'button', class: 'linkbtn', onclick: () => { sel.clear(); refresh(); } }, 'Clear')) : null,
        clips.length ? grid : h('div', { class: 'muted small' }, 'Your library is empty, so this reel will be your weekly check-in photos.'),
        angles.length ? UI.toggleRow('Weekly check-in photos', 'Your ' + (opt.angle || '').toLowerCase() + ' photos, in date order. They are already in Regoal.', opt.progress, (v) => { opt.progress = v; angleSeg.classList.toggle('hidden', !v || angles.length < 2); refresh(); }) : null,
        angleSeg,
        UI.seg({ label: 'Shape', options: [{ value: 'story', label: 'Story 9:16' }, { value: 'square', label: 'Square' }, { value: 'wide', label: 'Wide 16:9' }], value: opt.shape, onChange: (v) => { opt.shape = v; } }),
        UI.seg({ label: 'Time per photo', options: [{ value: 1, label: '1 s' }, { value: 1.5, label: '1.5 s' }, { value: 2.5, label: '2.5 s' }], value: opt.photoSec, onChange: (v) => { opt.photoSec = v; refresh(); } }),
        UI.seg({ label: 'Longest part of a video', options: [{ value: 2, label: '2 s' }, { value: 4, label: '4 s' }, { value: 8, label: '8 s' }], value: opt.clipSec, onChange: (v) => { opt.clipSec = v; refresh(); } }),
        UI.toggleRow('Date and tag', 'Shown on each item', opt.labels, (v) => { opt.labels = v; }),
        UI.toggleRow('Title card', 'A short opening frame', opt.titleOn, (v) => { opt.titleOn = v; nTitle.classList.toggle('hidden', !v); refresh(); }),
        nTitle,
        Screens._.privacyNote(),
        h('div', { class: 'muted small' }, 'Longer clips are trimmed to their middle part. The reel has no sound.'),
        supported ? null : h('div', { class: 'warnbox', role: 'alert' }, 'This browser cannot save video as MP4. Open Regoal in Safari or Chrome.'),
        warn, go, sum, Screens._.closeLink(closeSheet));
      refresh();
    }

    // ---------- step 2: where are the originals ----------
    async function next() {
      if (!chosenClips().length) return create();
      U.clear(box); U.put(box, h('div', { class: 'ct' }, 'Finding the originals'), h('div', { class: 'muted small', role: 'status' }, 'Checking...'));
      for (const c of chosenClips()) {
        if (files.has(c.id)) continue;
        try { const f = await Library.fromLink(c); if (f && f.size === c.size) files.set(c.id, f); } catch (e) { /* asked below */ }
      }
      originals();
    }
    function originals() {
      const need = chosenClips(), missing = need.filter((c) => !files.has(c.id));
      U.clear(box);
      const list = h('div', { class: 'stack' }, ...need.map((c) => h('div', { class: 'trow' }, h('div', { class: 'grow' }, h('div', { class: 'tt' }, U.shortDate(c.date) + ' · ' + c.tag + ' ' + c.kind), h('div', { class: 'ts' }, c.name || '')), files.has(c.id) ? U.chip('Found', 'line') : U.chip('Needed', 'line'))));
      const choosePick = async () => {
        let got;
        try { got = await Library.pick({ multiple: true, label: 'Choose the originals' }); } catch (e) { return U.toast(String(e && e.message ? e.message : e), 'warn'); }
        if (!got) return;
        const m = Library.match(got.files, missing);
        let n = 0;
        for (const [id, f] of m) { files.set(id, f); n++; if (got.handles) { const i = got.files.indexOf(f); if (i >= 0) await Library.saveHandle(id, got.handles[i]); } }
        if (!n) U.toast('None of those matched the items you chose. Pick the same photos and videos again.', 'warn');
        originals();
      };
      const usable = need.length - missing.length + progressPhotos().length;
      U.put(box,
        h('div', { class: 'ct' }, missing.length ? 'Where are the originals?' : 'Ready'),
        h('div', { class: 'muted small' }, missing.length
          ? (Library.canLink() ? 'Regoal could not open ' + missing.length + ' of them without you.' : 'Regoal does not keep your originals. Choose the same ' + (missing.length === 1 ? 'file' : 'files') + ' again, all at once, and Regoal matches them by name and size. They are used in memory and let go.')
          : 'All the originals were found. Nothing has been copied.'),
        list,
        missing.length ? UI.btn('Choose ' + (missing.length === 1 ? 'the file' : 'the files'), { icon: 'plus', onClick: choosePick }) : UI.btn('Create the reel', { icon: 'film', onClick: create }),
        missing.length && usable > 0 ? UI.btn('Leave out the missing ones', { kind: 'quiet', onClick: () => { for (const c of missing) sel.delete(c.id); if (count()) create(); else choose(); } }) : null,
        h('div', { class: 'linkrow' }, h('button', { type: 'button', class: 'linkbtn', onclick: choose }, 'Change the choice'), h('button', { type: 'button', class: 'linkbtn', onclick: () => closeSheet() }, 'Cancel')));
    }

    // ---------- step 3: record ----------
    async function create() {
      ctl = new AbortController();
      const my = ctl;
      const fill = h('div', { class: 'bar-fill' }), bar = h('div', { class: 'bar tall', role: 'progressbar', 'aria-label': 'Progress' }, fill);
      const status = h('div', { class: 'muted small centered', role: 'status' }, 'Preparing...');
      U.clear(box);
      U.put(box, h('div', { class: 'ct' }, 'Creating your reel'), bar, status, h('div', { class: 'muted small centered' }, 'Keep Regoal open on this screen until it finishes. It records in real time.'), UI.btn('Cancel', { kind: 'quiet', onClick: () => my.abort() }));
      try {
        const blobs = new Map();
        for (const p of progressPhotos()) { const m = await Store.getMedia(p.id); if (m) blobs.set(p.id, m.blob); }
        const items = asItems(blobs);
        if (!items.length) throw new Error('Nothing is left to put in the reel.');
        const first = items[0].date, last = items[items.length - 1].date;
        const out = await Reel.render({ items, shape: opt.shape, photoSec: opt.photoSec, clipSec: opt.clipSec, labels: opt.labels, title: opt.titleOn ? opt.title : '', subtitle: first === last ? U.longDate(first) : U.shortDate(first) + ' to ' + U.shortDate(last),
          signal: my.signal, onProgress: (p, t) => { fill.style.width = Math.round(p * 100) + '%'; status.textContent = t; } });
        if (my.signal.aborted) return;
        Screens._.resultView(box, { kind: 'video', blob: out.blob, ext: out.ext, name: 'regoal-reel-' + U.today() + '.' + out.ext, track: (u) => urls.push(u), close: closeSheet, again: choose });
        if (out.skipped) U.toast(out.skipped + (out.skipped === 1 ? ' item' : ' items') + ' could not be read and ' + (out.skipped === 1 ? 'was' : 'were') + ' left out.', 'warn');
      } catch (e) {
        if (my.signal.aborted || (e && e.name === 'AbortError')) { choose(); return; }
        choose(); U.toast(String(e && e.message ? e.message : e).slice(0, 240), 'warn');
      }
    }
    choose();
  };
})(self);
