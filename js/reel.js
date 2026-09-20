/*
 * The reel: your workout clips and photos, and optionally your weekly check-in photos, stitched into one MP4.
 * It is drawn on a canvas and recorded on this device in real time. Nothing is uploaded, the video has no sound,
 * and Regoal does not keep it: it exists only until you save or share it, or close the sheet.
 * The originals are opened one at a time (two while the next one is prepared) and let go as soon as their part is done,
 * so a long reel does not hold many videos in memory at once.
 */
(function (root) {
  'use strict';
  const M = root.MediaOut, X = M._;
  const DIP = 250;            // milliseconds to fade to the background and back between items
  const TITLE_MS = 2000;
  const MAX_ITEMS = 30;
  const MAX_SECONDS = 180;
  const SHAPES = { story: { W: 1080, H: 1920 }, square: { W: 1080, H: 1080 }, wide: { W: 1280, H: 720 } };

  // items: [{ type: 'photo'|'video'|'progress', blob (File or Blob), dur (seconds, video), label, sub }]
  // opt: { shape, photoSec, clipSec, title, subtitle }
  function segments(items, opt) {
    const segs = [];
    if (opt.title) segs.push({ type: 'title', ms: TITLE_MS, title: opt.title, subtitle: opt.subtitle || '' });
    for (const it of items) {
      if (it.type === 'video') {
        const d = it.dur > 0 ? it.dur : opt.clipSec, len = Math.max(0.5, Math.min(opt.clipSec, d));
        segs.push({ type: 'video', ms: Math.round(len * 1000), start: Math.max(0, (d - len) / 2), item: it });
      } else segs.push({ type: 'photo', ms: Math.round(opt.photoSec * 1000), item: it });
    }
    return segs;
  }
  const secondsOf = (items, opt) => segments(items, opt).reduce((t, s) => t + s.ms, 0) / 1000;
  const sizeMB = (sec) => Math.max(1, Math.round(sec * X.VIDEO_BPS / 8 / 1e6));

  function fit(ctx, text, px, maxW, font) {
    let s = px;
    ctx.font = font(s);
    while (s > 24 && ctx.measureText(text).width > maxW) { s -= 4; ctx.font = font(s); }
    return s;
  }
  function drawTitle(ctx, g, seg) {
    ctx.fillStyle = X.C.chalk; ctx.fillRect(0, 0, g.W, g.H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cy = g.H / 2, base = Math.round(g.W * 0.13);
    ctx.fillStyle = X.C.ink;
    const px = fit(ctx, seg.title, base, g.W * 0.84, (s) => '800 ' + s + 'px ' + X.DISPLAY);
    ctx.font = '800 ' + px + 'px ' + X.DISPLAY; ctx.fillText(seg.title, g.W / 2, cy);
    ctx.fillStyle = X.C.acc; ctx.fillRect(g.W / 2 - g.W * 0.06, cy + px * 0.7, g.W * 0.12, Math.max(4, g.W * 0.006));
    if (seg.subtitle) { ctx.fillStyle = X.C.ink2; ctx.font = '500 ' + Math.round(g.W * 0.04) + 'px ' + X.FONT; ctx.fillText(seg.subtitle, g.W / 2, cy + px * 0.7 + g.W * 0.08); }
  }
  // One frame of an item. src is an image or a playing video; alpha 0..1 is the dip to the background.
  function drawFrame(ctx, g, seg, src, alpha, opt) {
    if (seg.type === 'title') { ctx.save(); drawTitle(ctx, g, seg); if (alpha < 1) { ctx.globalAlpha = 1 - alpha; ctx.fillStyle = X.C.chalk; ctx.fillRect(0, 0, g.W, g.H); } ctx.restore(); return; }
    ctx.fillStyle = X.C.chalk; ctx.fillRect(0, 0, g.W, g.H);
    if (!src) return;
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    X.cover(ctx, src, 0, 0, g.W, g.H);
    const it = seg.item;
    if (opt.labels && it && it.label) {
      const px = Math.round(g.W * 0.038), m = Math.round(g.W * 0.045);
      const safe = g.H > g.W ? Math.round(g.H * 0.11) : 0; // keeps text clear of the buttons on a Story
      const gh = g.H * 0.22, grad = ctx.createLinearGradient(0, g.H - gh - safe, 0, g.H);
      grad.addColorStop(0, 'rgba(9,13,11,0)'); grad.addColorStop(1, 'rgba(9,13,11,0.85)');
      ctx.fillStyle = grad; ctx.fillRect(0, g.H - gh - safe, g.W, gh + safe);
      let y = g.H - safe - m - px * 1.9;
      X.pill(ctx, it.label, m, y, px, 'left');
      if (it.sub) X.pill(ctx, it.sub, m, y - px * 2.3, px * 0.9, 'left');
    }
    ctx.restore();
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // o: { items, shape, photoSec, clipSec, labels, title, subtitle, signal, onProgress(0..1, text) }
  async function render(o) {
    const mime = M.pickVideoMime();
    if (!mime) throw new Error('This browser cannot save video as MP4. Open Regoal in Safari or Chrome.');
    const segs = segments(o.items, o);
    if (!o.items.length) throw new Error('Pick something for the reel first.');
    const total = segs.reduce((t, s) => t + s.ms, 0);
    if (total > MAX_SECONDS * 1000) throw new Error('That reel would be over ' + MAX_SECONDS / 60 + ' minutes. Take a few items out or shorten the clips.');
    const say = (p, t) => { if (o.onProgress) o.onProgress(p, t); };
    const aborted = () => o.signal && o.signal.aborted;
    const cancel = () => new DOMException('Cancelled', 'AbortError');
    await X.fontsReady();
    const g = SHAPES[o.shape] || SHAPES.story;
    const cv = X.canvasOf(g.W, g.H), ctx = cv.getContext('2d');
    ctx.fillStyle = X.C.chalk; ctx.fillRect(0, 0, g.W, g.H);

    // Preparing one item: a decoded photo, or a paused video ready at its start point.
    const prep = async (seg) => {
      if (seg.type === 'title') return { src: null };
      const f = seg.item.blob;
      if (seg.type === 'photo') { const im = await X.decode(f); return { src: im, done: () => X.release(im) }; }
      const { v, done } = root.Library.openVideo(f);
      try { await root.Library.ready(v); await root.Library.seekTo(v, seg.start); } catch (e) { done(); throw e; }
      if (!v.videoWidth) { done(); throw new Error('unreadable'); }
      return { src: v, video: v, done };
    };
    const preps = new Array(segs.length).fill(null);
    const ensure = (i) => { if (i < segs.length && !preps[i]) { preps[i] = prep(segs[i]).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e })); } };
    const release = async (i) => { if (preps[i]) { const p = await preps[i]; if (p.ok && p.r.done) p.r.done(); preps[i] = null; } };

    let wake = null;
    try { if (navigator.wakeLock && navigator.wakeLock.request) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }

    const stream = cv.captureStream(30), track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: X.VIDEO_BPS });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = (e) => rej((e && e.error) || new Error('Recording failed.')); });
    const stopTracks = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* already stopped */ } };
    const frame = () => { if (track && track.requestFrame) track.requestFrame(); };

    let skipped = 0, elapsed = 0, started = false, shown = 0;
    try {
      ensure(0);
      for (let i = 0; i < segs.length; i++) {
        if (aborted()) throw cancel();
        const seg = segs[i];
        const p = await preps[i];
        if (!p.ok) { skipped++; await release(i); ensure(i + 1); continue; }
        ensure(i + 1);
        if (!started) { rec.start(250); started = true; }
        shown++;
        const v = p.r.video;
        if (v) { try { const pl = v.play(); if (pl && pl.catch) pl.catch(() => { /* a frozen frame is used instead */ }); } catch (e) { /* frozen frame */ } }
        const dip = Math.min(DIP, seg.ms * 0.2), t0 = performance.now();
        await new Promise((res) => {
          const tick = () => {
            if (aborted()) return res();
            const t = performance.now() - t0;
            if (t >= seg.ms) return res();
            const alpha = Math.min(1, t / dip, (seg.ms - t) / dip);
            drawFrame(ctx, g, seg, p.r.src, alpha, o);
            frame();
            say(Math.min(1, (elapsed + t) / total), 'Recording ' + Math.min(segs.length, i + 1) + ' of ' + segs.length);
            setTimeout(tick, 33);
          };
          tick();
        });
        elapsed += seg.ms;
        await release(i);
      }
      if (aborted()) throw cancel();
      if (!shown) throw new Error('None of those could be read by this browser. If they are iPhone photos, use Most Compatible in Camera settings, or pick videos.');
      // A last still so the final item does not end mid-fade.
      ctx.fillStyle = X.C.chalk; ctx.fillRect(0, 0, g.W, g.H);
      frame(); await wait(120);
      rec.stop(); await stopped; stopTracks();
      const blob = new Blob(chunks, { type: 'video/mp4' });
      if (!blob.size) throw new Error('The browser produced an empty video. Try a different shape.');
      return { blob, mime: 'video/mp4', ext: 'mp4', seconds: total / 1000, skipped };
    } catch (e) {
      try { if (started && rec.state !== 'inactive') rec.stop(); } catch (er) { /* not recording */ }
      stopTracks();
      throw e;
    } finally {
      for (let i = 0; i < preps.length; i++) { try { await release(i); } catch (e) { /* nothing left to release */ } }
      if (wake && wake.release) { try { await wake.release(); } catch (e) { /* already released */ } }
    }
  }

  root.Reel = { render, segments, secondsOf, sizeMB, SHAPES, MAX_ITEMS, MAX_SECONDS, TITLE_MS };
})(self);
