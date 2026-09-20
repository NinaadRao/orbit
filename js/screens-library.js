/*
 * Library: workout photos and videos you keep where you took them (see js/library.js).
 * Orbit stores a small preview, the date, a tag and a note. The original stays in Photos or Files; nothing is copied.
 * From here you can view the original, ask your coach about form (frames only, with a confirmation first), or make a reel.
 */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, UI = root.UI, Store = root.Store, Library = root.Library;
  const { h } = U;
  const Screens = root.Screens = root.Screens || {};

  let urls = [];
  let filter = 'All';
  const revoke = () => { for (const u of urls) URL.revokeObjectURL(u); urls = []; };
  const fmtBytes = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : b < 1073741824 ? U.num(b / 1048576, 1) + ' MB' : U.num(b / 1073741824, 2) + ' GB');
  const liftName = (st, id) => (id && st.plan.lifts[id] ? st.plan.lifts[id].name : '');
  const rand = () => Math.random().toString(36).slice(2, 6);
  const dateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq);

  async function fillThumb(img, holder, c) {
    const m = c.thumb ? await Store.getMedia(c.thumb) : null;
    if (!m) { img.remove(); holder.insertBefore(h('div', { class: 'ph' }, U.icon(c.kind === 'video' ? 'film' : 'camera', 26)), holder.firstChild); return; }
    const url = URL.createObjectURL(m.blob); urls.push(url); img.src = url;
  }

  // Saving a change to an entry is a new event that replaces the old one, like the rest of Orbit.
  async function updateClip(c, patch) {
    const r = E.cleanClip(Object.assign({}, c, patch));
    if (!r.ok) throw new Error(r.errors[0]);
    await Store.voidEvent(c.seq);
    return Store.append('clip_added', r.value);
  }
  async function removeClip(c) {
    await Store.voidEvent(c.seq);
    if (c.thumb) await Store.delMedia(c.thumb);
    await Library.dropHandle(c.id);
  }

  // ---------- adding ----------
  async function addFlow(defaults) {
    const d = defaults || {};
    const picked = await Library.pick({ multiple: true });
    if (!picked) return;
    const pairs = [];
    picked.files.forEach((f, i) => { if (Library.kindOf(f)) pairs.push({ file: f, handle: picked.handles ? picked.handles[i] : null }); });
    if (!pairs.length) return U.toast('Pick photos or videos.', 'warn');
    const over = pairs.length > Library.MAX_FILES;
    const batch = pairs.slice(0, Library.MAX_FILES);
    const st = Store.getState();
    let tag = d.tag || 'Workout', lift = d.lift || null;
    const note = UI.field({ label: 'Note for these (optional)', maxlength: 200, placeholder: 'Top set, 3 reps' });
    const liftItems = ['None'].concat(Object.values(st.plan.lifts).map((l) => l.name));
    const liftBox = UI.pills({ label: 'Exercise (optional)', items: liftItems, values: new Set([lift ? liftName(st, lift) : 'None']), multi: false, onChange: (v) => {
      const n = Array.from(v)[0]; lift = n === 'None' ? null : Object.keys(st.plan.lifts).find((k) => st.plan.lifts[k].name === n) || null;
    } });
    liftBox.classList.add('hscroll');
    const body = h('div', { class: 'stack' });
    const form = () => {
      U.clear(body);
      U.put(body,
        h('div', { class: 'muted small' }, 'Nothing is copied. Orbit keeps a small preview, the date and your note. The original stays in ' + (Library.canLink() ? 'its folder on this computer.' : 'Photos or Files.')),
        UI.pills({ label: 'What is it?', items: E.CLIP_TAGS, values: new Set([tag]), multi: false, onChange: (v) => { tag = Array.from(v)[0]; } }),
        liftBox, note,
        over ? h('div', { class: 'warnbox' }, 'Only the first ' + Library.MAX_FILES + ' will be added. Add the rest in another batch.') : null);
    };
    form();
    let closeSheet = null, cancelled = false;
    closeSheet = U.sheet('Add ' + batch.length + (batch.length === 1 ? ' item' : ' items'), body, [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', keep: true, run: () => { go(); } }], { onClose: () => { cancelled = true; } });

    async function go() {
      const fill = h('div', { class: 'bar-fill' }), bar = h('div', { class: 'bar tall', role: 'progressbar', 'aria-label': 'Progress' }, fill), status = h('div', { class: 'muted small centered', role: 'status' }, 'Reading...');
      U.clear(body); U.put(body, h('div', { class: 'ct' }, 'Adding'), bar, status);
      let added = 0, skipped = 0, failed = 0, previews = 0;
      for (let i = 0; i < batch.length && !cancelled; i++) {
        status.textContent = 'Reading ' + (i + 1) + ' of ' + batch.length; fill.style.width = Math.round((i / batch.length) * 100) + '%';
        try {
          const info = await Library.readInfo(batch[i].file);
          if (Store.getState().clips.some((c) => c.name === info.name && c.size === info.size)) { skipped++; continue; }
          const id = 'c_' + Date.now().toString(36) + rand();
          let thumb = null;
          if (info.thumb) { thumb = 't_' + id; await Store.putMedia(thumb, info.thumb, { kind: 'thumb' }); previews++; }
          const linked = batch[i].handle ? await Library.saveHandle(id, batch[i].handle) : false;
          const r = E.cleanClip({ id, kind: info.kind, date: info.date, tag, lift, note: note.input.value, name: info.name, size: info.size, mtime: info.mtime, w: info.w, h: info.h, dur: info.dur, thumb, linked });
          if (!r.ok) throw new Error(r.errors[0]);
          await Store.append('clip_added', r.value);
          added++;
        } catch (e) { failed++; }
      }
      closeSheet();
      const parts = [];
      if (added) parts.push('Added ' + added + '. The originals were not copied.');
      if (skipped) parts.push(skipped + ' already in the library.');
      if (failed) parts.push(failed + ' could not be read.');
      U.toast(parts.join(' ') || 'Nothing was added.', failed && !added ? 'warn' : undefined);
      root.App.render();
    }
  }

  // ---------- viewing the original ----------
  async function viewOriginal(c) {
    let got;
    try { got = await Library.original(c); } catch (e) { return U.toast(String(e && e.message ? e.message : e), 'warn'); }
    if (!got) return;
    if (got.how === 'picked' && got.handle) await Library.saveHandle(c.id, got.handle);
    const url = URL.createObjectURL(got.file);
    const set = Store.getSettings();
    const media = c.kind === 'video' ? h('video', { src: url, controls: true, playsinline: true, class: 'resmedia', 'aria-label': 'Original video' }) : h('img', { src: url, alt: 'Original photo', class: 'resmedia' });
    const warn = h('div', { class: 'warnbox hidden', role: 'note' }, 'This does not look like the item you saved (its length is different). It is shown anyway.');
    const noplay = h('div', { class: 'warnbox hidden', role: 'alert' }, 'This browser cannot show this file (some phone formats, such as HEIC photos or HEVC videos, only open on Apple devices or in Safari). The original is fine where it is. Open it from Photos or Files instead.');
    media.addEventListener('error', () => { noplay.classList.remove('hidden'); warn.classList.add('hidden'); });
    if (c.kind === 'video' && c.dur) media.addEventListener('loadedmetadata', () => { if (Number.isFinite(media.duration) && Math.abs(media.duration - c.dur) > 1.5) warn.classList.remove('hidden'); });
    let hidden = !!set.blurPhotos;
    const holder = h('div', { class: 'resbox' + (hidden ? ' blur' : '') }, media);
    const peek = set.blurPhotos ? h('button', { type: 'button', class: 'chip line peekbtn', onclick: () => { hidden = !hidden; holder.classList.toggle('blur', hidden); peek.textContent = hidden ? 'Show' : 'Blur'; } }, 'Show') : null;
    U.sheet(c.kind === 'video' ? 'Original video' : 'Original photo', h('div', { class: 'stack' }, holder, peek, noplay, warn,
      h('div', { class: 'muted small' }, got.how === 'link' ? 'Opened from the file on this computer.' : 'You picked it again. Orbit is using it now and is not keeping a copy.')), [{ label: 'Close', kind: 'primary' }], { onClose: () => URL.revokeObjectURL(url) });
  }

  // ---------- coach form check ----------
  const FORM_SYSTEM = 'You are a careful strength coach looking at still frames taken from a video of one set of a lift. The frames are in time order and evenly spaced, so you can judge positions but not speed, tempo or bar path between frames. Say briefly what you can see. Then give at most four observations about form (setup, depth or range of motion, joint and spine alignment, balance), each with one short cue to try next set. If the frames do not show a lift, the angle hides what matters, or the picture is too dark or small, say that plainly and say how to film it better (side view, whole body, hip height). Never guess weights, reps or how it felt. Do not describe the person beyond what form needs. This is coaching, not medical advice: if there is pain, suggest seeing a professional. Keep it under 220 words in plain sentences, no headings.';

  async function formCheck(c) {
    if (!root.App.aiReady()) {
      U.sheet('Coach form check', h('div', { class: 'stack' }, h('div', { class: 'muted' }, 'This uses your own AI key with the provider you chose. Add your key, or set up the coach first.'),
        UI.btn('Add your key', { onClick: () => { setTimeout(() => Screens.keySheet(() => formCheck(c)), 0); } }), UI.btn('Coach settings', { kind: 'quiet', href: '#/coach/setup' })), [{ label: 'Close' }]);
      return;
    }
    let got;
    try { got = await Library.original(c); } catch (e) { return U.toast(String(e && e.message ? e.message : e), 'warn'); }
    if (!got) return;
    U.toast('Reading frames...');
    let fr;
    try { fr = await Library.frames(got.file, c.kind === 'video' ? 6 : 1, 896); } catch (e) { return U.toast(String(e && e.message ? e.message : e), 'warn'); }
    const cfg = root.App.llmConfig();
    let host = '';
    try { host = new URL(root.LLM.endpointOf(cfg)).host; } catch (e) { host = 'your provider'; }
    const st = Store.getState();
    const urlsF = fr.map((f) => URL.createObjectURL(f.blob));
    const ex = UI.field({ label: 'Exercise', value: liftName(st, c.lift), maxlength: 60, placeholder: 'Back squat' });
    const q = UI.field({ label: 'Anything to check? (optional)', maxlength: 200, placeholder: 'Is my depth OK?' });
    const body = h('div', { class: 'stack' });
    const ctl = new AbortController();
    let text = '', closeSheet = null;
    const confirm = () => {
      U.clear(body);
      U.put(body,
        h('div', { class: 'framestrip' + (Store.getSettings().blurPhotos ? ' blur' : '') }, ...urlsF.map((u, i) => h('img', { src: u, alt: 'Frame ' + (i + 1) }))),
        h('div', { class: 'warnbox privacy', role: 'note' }, U.icon('shield', 20), h('div', null, h('b', null, 'These ' + fr.length + (fr.length === 1 ? ' picture goes' : ' pictures go') + ' to ' + host), ' with your key so the coach can look at your form. Orbit does not save them. They can show your face and your surroundings. Cancel if you would rather not.')),
        ex, q, UI.btn('Send ' + fr.length + (fr.length === 1 ? ' picture' : ' pictures'), { icon: 'send', onClick: send }), h('div', { class: 'linkrow' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => closeSheet() }, 'Cancel')));
    };
    async function send() {
      const exercise = ex.input.value.trim().slice(0, 60) || 'an exercise', ask = q.input.value.trim().slice(0, 200);
      const out = h('div', { class: 'coachout', role: 'status' }, 'Looking...');
      U.clear(body);
      U.put(body, h('div', { class: 'ct' }, 'Form check'), out, UI.btn('Stop', { kind: 'quiet', onClick: () => ctl.abort() }));
      try {
        const content = [{ type: 'text', text: 'Exercise: ' + exercise + '.' + (ask ? ' My question: ' + ask : '') + '\nThe ' + fr.length + (fr.length === 1 ? ' image is' : ' images are') + ' from one set, in time order.' }];
        for (const f of fr) content.push({ type: 'image', mime: 'image/jpeg', b64: await Library.toB64(f.blob) });
        const r = await root.LLM.chat(cfg, { system: FORM_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 700, signal: ctl.signal }, { onText: (t) => { text = t; out.textContent = t; } });
        text = (r.text || text || '').trim();
        if (!text) throw new Error('The coach sent back nothing. Try again.');
        result(exercise);
      } catch (e) {
        if (e && e.name === 'AbortError') { text ? result(exercise) : confirm(); return; }
        confirm(); U.toast(String(e && e.message ? e.message : e).slice(0, 240), 'warn');
      }
    }
    function result(exercise) {
      U.clear(body);
      U.put(body, h('div', { class: 'ct' }, 'Form check'), h('div', { class: 'coachout' }, text), h('div', { class: 'muted small' }, 'An AI reading of a few still pictures. It cannot see speed or feel, and it can be wrong. Use it as a prompt to look, not a verdict.'),
        UI.btn('Save with this ' + c.kind, { onClick: async () => { try { await updateClip(c, { review: (exercise + ': ' + text).slice(0, 2500) }); U.toast('Saved with the ' + c.kind + '.'); closeSheet(); root.App.render(); } catch (e) { U.toast(String(e.message || e), 'warn'); } } }),
        h('div', { class: 'linkrow' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => closeSheet() }, 'Close')));
    }
    closeSheet = U.sheet('Coach form check', body, [], { onClose: () => { ctl.abort(); urlsF.forEach((u) => URL.revokeObjectURL(u)); } });
    confirm();
  }

  // ---------- one item ----------
  function openClip(c) {
    Library.warm(c);
    const st = Store.getState(), set = Store.getSettings();
    let tag = c.tag, lift = c.lift;
    const note = UI.field({ label: 'Note', value: c.note, maxlength: 200 });
    const liftItems = ['None'].concat(Object.values(st.plan.lifts).map((l) => l.name));
    const liftBox = UI.pills({ label: 'Exercise', items: liftItems, values: new Set([lift ? liftName(st, lift) || 'None' : 'None']), multi: false, onChange: (v) => {
      const n = Array.from(v)[0]; lift = n === 'None' ? null : Object.keys(st.plan.lifts).find((k) => st.plan.lifts[k].name === n) || null;
    } });
    liftBox.classList.add('hscroll');
    const img = h('img', { alt: c.tag + ' ' + c.kind });
    const prev = h('div', { class: 'libprev thumb' + (set.blurPhotos ? ' blur' : '') }, img);
    fillThumb(img, prev, c);
    const meta = [U.longDate(c.date), c.kind === 'video' && c.dur ? Library.fmtDur(c.dur) : null, c.w && c.h ? c.w + ' x ' + c.h : null, c.size ? 'original ' + fmtBytes(c.size) : null].filter(Boolean).join(' · ');
    const body = h('div', { class: 'stack' },
      prev,
      h('div', { class: 'muted small' }, meta),
      h('div', { class: 'muted small' }, c.name ? c.name + ' stays where it is. Orbit keeps only the preview above.' : 'The original stays where it is. Orbit keeps only the preview above.'),
      UI.btn(c.kind === 'video' ? 'Watch the original' : 'View the original', { icon: 'eye', onClick: () => viewOriginal(c) }),
      UI.btn('Ask the coach about form', { kind: 'quiet', icon: 'chat', onClick: () => formCheck(c) }),
      c.review ? h('div', { class: 'stack' }, h('div', { class: 'lab' }, 'Coach form check'), h('div', { class: 'coachout' }, c.review)) : null,
      UI.pills({ label: 'What is it?', items: E.CLIP_TAGS, values: new Set([tag]), multi: false, onChange: (v) => { tag = Array.from(v)[0]; } }),
      liftBox, note);
    U.sheet('Library item', body, [
      { label: 'Remove', kind: 'danger', keep: true, run: (close) => { U.confirmSheet('Remove from Orbit?', 'This removes the preview, date and note from Orbit. The photo or video itself is not touched, wherever it is.', 'Remove', async () => { await removeClip(c); close(); root.App.render(); }, true); } },
      { label: 'Save', kind: 'primary', run: () => { updateClip(c, { tag, lift, note: note.input.value }).then(() => root.App.render()).catch((e) => U.toast(String(e.message || e), 'warn')); } },
    ]);
  }

  // ---------- the screen ----------
  Screens.library = function () {
    revoke();
    const st = Store.getState(), set = Store.getSettings();
    const clips = st.clips.slice().sort(dateDesc);
    const shown = filter === 'All' ? clips : clips.filter((c) => c.tag === filter);
    const usedNote = h('div', { class: 'muted small' }, clips.length ? clips.length + (clips.length === 1 ? ' item' : ' items') + ' in Orbit. The originals stay in ' + (Library.canLink() ? 'their folders on this computer.' : 'Photos or Files.') : 'Nothing here yet.');
    Store.allMedia().then((all) => { const b = all.filter((m) => m.kind === 'thumb').reduce((t, m) => t + (m.size || 0), 0); if (clips.length) usedNote.textContent = clips.length + (clips.length === 1 ? ' item' : ' items') + ' · ' + fmtBytes(b) + ' of previews in Orbit. The originals stay in ' + (Library.canLink() ? 'their folders on this computer.' : 'Photos or Files.'); }).catch(() => {});
    const grid = h('div', { class: 'photogrid libgrid' });
    for (const c of shown) {
      const img = h('img', { alt: '' });
      const tile = h('button', { type: 'button', class: 'thumb libtile' + (set.blurPhotos ? ' blur' : ''), 'aria-label': 'Open ' + c.tag + ' ' + c.kind + ' from ' + U.longDate(c.date), onclick: () => openClip(c) },
        img, c.kind === 'video' ? h('span', { class: 'dur' }, Library.fmtDur(c.dur)) : null, h('div', { class: 'lbl' }, U.shortDate(c.date) + ' · ' + c.tag));
      grid.appendChild(tile);
      fillThumb(img, tile, c);
    }
    const intro = UI.card(h('div', { class: 'ct' }, 'Your workout photos and videos'),
      h('div', { class: 'muted' }, 'Add gym photos and clips, and sets you want checked for form. Orbit does not copy them: it keeps a small preview, the date and your note, and the original stays where you took it, so your phone storage does not fill up twice.'),
      UI.btn('Add photos or videos', { icon: 'plus', onClick: () => addFlow() }),
      h('div', { class: 'row' }, UI.btn('Make a reel', { kind: 'quiet', icon: 'film', onClick: () => Screens.reelSheet && Screens.reelSheet() })),
      usedNote,
      Library.canLink() ? null : h('div', { class: 'muted small' }, 'On iPhone a web app cannot keep a link into Photos, so to watch an original again you pick it again. That is the price of not copying it.'));
    return UI.page(UI.header('Library', 'Kept where you took them.', { back: '#/progress' }), UI.scroller(intro,
      clips.length ? UI.pills({ label: 'Show', items: ['All'].concat(E.CLIP_TAGS), values: new Set([filter]), multi: false, onChange: (v) => { filter = Array.from(v)[0]; root.App.render(); } }) : null,
      clips.length ? (shown.length ? grid : UI.empty('Nothing with that tag yet.')) : null));
  };
  Screens._ = Object.assign(Screens._ || {}, { libraryAdd: addFlow });
})(self);
