/*
 * The workout library: photos and videos you keep where you took them.
 *
 * Orbit never stores the original. What it keeps for each item is a small preview picture (around 15 KB), the date, a tag,
 * a note and the file's name and size. To see or use the original again it asks the browser for the file:
 *   - Chrome and Edge on a computer can remember a real link to the file (a file handle), so nothing is asked twice;
 *   - Safari on iPhone cannot keep a link into Photos, so you pick the item again, and Orbit uses it in memory and lets go.
 * Either way there is no second copy of your photos or videos in Orbit's storage.
 */
(function (root) {
  'use strict';
  const { h } = root.U;

  const IMG_EXT = /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i, VID_EXT = /\.(mp4|mov|m4v|webm|3gp|mkv)$/i;
  const MAX_FILES = 40;
  const THUMB_SIDE = 320;

  const kindOf = (f) => (/^image\//.test(f.type) ? 'photo' : /^video\//.test(f.type) ? 'video' : IMG_EXT.test(f.name || '') ? 'photo' : VID_EXT.test(f.name || '') ? 'video' : null);
  const pad = (n) => String(n).padStart(2, '0');
  function localDate(ms) {
    const d = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // The day a file was made, from its modified time; a date in the future (a wrong phone clock) becomes today.
  function dateOf(file) {
    const d = localDate(file.lastModified);
    return d > root.U.today() ? root.U.today() : d;
  }
  const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); };

  // ---------- reading a file ----------
  function withTimeout(p, ms, msg) {
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(msg || 'Timed out.')), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
  }
  function once(el, ev) { return new Promise((res, rej) => { const ok = () => { off(); res(); }; const bad = () => { off(); rej(new Error('This browser cannot read that video.')); }; const off = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }; el.addEventListener(ev, ok); el.addEventListener('error', bad); }); }

  // A hidden <video> for a file. done() releases everything, so nothing is left behind.
  function openVideo(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.className = 'offscreen'; v.setAttribute('aria-hidden', 'true');
    document.body.appendChild(v);
    v.src = url;
    const done = () => { try { v.pause(); } catch (e) { /* not playing */ } v.removeAttribute('src'); try { v.load(); } catch (e) { /* ignore */ } v.remove(); URL.revokeObjectURL(url); };
    return { v, done };
  }
  async function ready(v) {
    if (v.readyState >= 1) return;
    await withTimeout(once(v, 'loadedmetadata'), 12000, 'That video took too long to open.');
  }
  // Some recorders leave the length out of the file. Jumping far ahead makes the browser work it out.
  async function knownDuration(v) {
    if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
    try { v.currentTime = 1e6; await withTimeout(once(v, 'timeupdate'), 4000); v.currentTime = 0; await withTimeout(once(v, 'seeked'), 4000); } catch (e) { /* leave it */ }
    return Number.isFinite(v.duration) ? v.duration : 0;
  }
  async function seekTo(v, t) {
    if (Math.abs(v.currentTime - t) < 0.03 && v.readyState >= 2) return;
    const p = once(v, 'seeked');
    v.currentTime = Math.max(0, t);
    await withTimeout(p, 8000, 'That video would not seek.');
    if (v.readyState < 2) { try { await v.play(); v.pause(); } catch (e) { /* some browsers need the play to show a frame */ } }
  }
  const canvasOf = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
  const toJpeg = (cv, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not make a preview.'))), 'image/jpeg', q));
  function drawScaled(src, w, hh, max) {
    const k = Math.min(1, max / Math.max(w, hh));
    const cv = canvasOf(w * k, hh * k);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }
  async function decodeImage(file) {
    try { const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() }; } catch (e) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This browser cannot read that image. On iPhone, choose Most Compatible in Camera settings, or export it as JPEG.')); img.src = url; });
        return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => {} };
      } finally { URL.revokeObjectURL(url); }
    }
  }

  // What Orbit keeps: kind, name, size, date, dimensions, length and a small preview (null when the browser cannot decode it).
  async function readInfo(file) {
    const kind = kindOf(file);
    if (!kind) throw new Error('That is not a photo or a video.');
    const base = { kind, name: String(file.name || '').slice(0, 80), size: file.size, mtime: file.lastModified || 0, date: dateOf(file), w: 0, h: 0, dur: 0, thumb: null };
    if (kind === 'photo') {
      if (file.size > 200 * 1024 * 1024) throw new Error('That photo is too large.');
      const im = await decodeImage(file);
      try { base.w = im.w; base.h = im.h; base.thumb = await toJpeg(drawScaled(im.src, im.w, im.h, THUMB_SIDE), 0.72); } finally { im.done(); }
      return base;
    }
    const { v, done } = openVideo(file);
    try {
      await ready(v);
      base.dur = await knownDuration(v);
      base.w = v.videoWidth; base.h = v.videoHeight;
      if (base.w && base.h) {
        try { await seekTo(v, Math.min(1, base.dur * 0.1)); base.thumb = await toJpeg(drawScaled(v, base.w, base.h, THUMB_SIDE), 0.72); } catch (e) { base.thumb = null; }
      }
    } catch (e) { /* metadata only: the item still works, it just shows a placeholder */ } finally { done(); }
    return base;
  }

  // Still frames for a form review, in memory only. n evenly spaced frames from a video, or the one photo. Returns [{blob, t}].
  async function frames(file, n, max) {
    const kind = kindOf(file);
    if (kind === 'photo') {
      const im = await decodeImage(file);
      try { return [{ blob: await toJpeg(drawScaled(im.src, im.w, im.h, max), 0.78), t: 0 }]; } finally { im.done(); }
    }
    if (kind !== 'video') throw new Error('That is not a photo or a video.');
    const { v, done } = openVideo(file);
    try {
      await ready(v);
      const dur = await knownDuration(v);
      if (!dur || !v.videoWidth) throw new Error('This browser cannot read frames from that video.');
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = Math.min(dur - 0.05, Math.max(0, ((i + 0.5) / n) * dur));
        await seekTo(v, t);
        out.push({ blob: await toJpeg(drawScaled(v, v.videoWidth, v.videoHeight, max), 0.75), t });
      }
      return out;
    } finally { done(); }
  }
  async function toB64(blob) { return root.U.b64(await blob.arrayBuffer()); }

  // ---------- links to files (Chrome and Edge on a computer) ----------
  const cache = new Map();
  const canLink = () => typeof root.showOpenFilePicker === 'function' && root.isSecureContext && !Library.noLinks;
  async function saveHandle(id, handle) {
    if (!handle) return false;
    cache.set(id, handle);
    try { await root.Store.setMeta('clip_h_' + id, handle); return true; } catch (e) { return false; }
  }
  // ids whose saved link has already been looked up, so a tap can decide without waiting on the database
  const looked = new Set();
  async function getHandle(id) {
    if (cache.has(id)) return cache.get(id);
    try { const hd = await root.Store.getMeta('clip_h_' + id); if (hd && hd.kind === 'file') { cache.set(id, hd); return hd; } } catch (e) { /* none */ }
    finally { looked.add(id); }
    return null;
  }
  async function dropHandle(id) { cache.delete(id); looked.delete(id); try { await root.Store.delMeta('clip_h_' + id); } catch (e) { /* none */ } }
  // The original through a saved link, or null when there is no link, permission was refused, or the file moved.
  async function fromLink(clip) {
    const hd = await getHandle(clip.id);
    if (!hd || typeof hd.getFile !== 'function') return null;
    try {
      let p = hd.queryPermission ? await hd.queryPermission({ mode: 'read' }) : 'granted';
      if (p !== 'granted' && hd.requestPermission) p = await hd.requestPermission({ mode: 'read' });
      if (p !== 'granted') return null;
      return await hd.getFile();
    } catch (e) { return null; }
  }

  // ---------- picking files ----------
  // Resolves { files, handles } (handles is null without file links), or null when cancelled.
  async function pick(opts) {
    const o = opts || {};
    if (canLink()) {
      try {
        const kinds = o.kind === 'video' ? { 'video/*': ['.mp4', '.mov', '.m4v', '.webm'] } : o.kind === 'photo' ? { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] } : { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'], 'video/*': ['.mp4', '.mov', '.m4v', '.webm'] };
        const hs = await root.showOpenFilePicker({ multiple: !!o.multiple, types: [{ description: o.kind === 'video' ? 'Videos' : o.kind === 'photo' ? 'Photos' : 'Photos and videos', accept: kinds }] });
        const files = [];
        for (const hd of hs) files.push(await hd.getFile());
        return { files, handles: hs };
      } catch (e) { if (e && e.name === 'AbortError') return null; /* any other failure: use the plain picker below */ }
    }
    return new Promise((resolve) => {
      const accept = o.kind === 'video' ? 'video/*' : o.kind === 'photo' ? 'image/*' : 'image/*,video/*';
      // Kept "on the page" but out of sight: some iPhone versions ignore a click on an input that is display:none.
      const input = h('input', { type: 'file', accept, multiple: !!o.multiple, class: 'offscreen', 'aria-label': o.label || 'Choose photos or videos' });
      input.addEventListener('change', () => { const files = Array.from(input.files || []); input.remove(); resolve(files.length ? { files, handles: null } : null); });
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });
      document.body.appendChild(input);
      input.click();
    });
  }
  // The original of a library item: through its link when there is one, otherwise the person picks it again.
  // A browser only opens its file picker while it still counts the tap as a tap, and waiting on the database first
  // can use that up (Safari on iPhone is strict about it). So when there is no link to try, the picker opens at once.
  async function original(clip) {
    const again = () => pick({ multiple: false, kind: clip.kind, label: 'Choose the original ' + clip.kind }).then((r) => (r ? { file: r.files[0], how: 'picked', handle: r.handles ? r.handles[0] : null } : null));
    if (!canLink() || (looked.has(clip.id) && !cache.has(clip.id))) return again();
    const f = await fromLink(clip);
    if (f) return { file: f, how: 'link' };
    return again();
  }
  // Look up the saved link for an item ahead of time (when its sheet opens), so the tap on "Watch the original" can act straight away.
  function warm(clip) { return canLink() && clip ? getHandle(clip.id).catch(() => null) : Promise.resolve(null); }

  // Match files the person picked again to library items by name and size. Returns Map(clip id -> File).
  function match(files, clips) {
    const key = (n, sz) => n + '|' + sz, byKey = new Map();
    for (const f of files) byKey.set(key(String(f.name || '').slice(0, 80), f.size), f);
    const out = new Map();
    for (const c of clips) { const f = byKey.get(key(c.name, c.size)); if (f) out.set(c.id, f); }
    return out;
  }

  const Library = { match, MAX_FILES, THUMB_SIDE, kindOf, dateOf, fmtDur, readInfo, frames, toB64, canLink, saveHandle, getHandle, dropHandle, fromLink, pick, original, warm, openVideo, ready, knownDuration, seekTo, noLinks: false };
  root.Library = Library;
})(self);
