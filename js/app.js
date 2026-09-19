/* App shell: hash router, tab bar, PIN lock, AI key holder, service worker, boot. */
(function (root) {
  'use strict';
  const E = root.Engine, U = root.U, Store = root.Store, Crypt = root.Crypt, LLM = root.LLM;
  const { h } = U;

  const TABS = [['#/today', 'Today', 'home'], ['#/lifts', 'Lifts', 'dumbbell'], ['#/fuel', 'Fuel', 'fork'], ['#/progress', 'Progress', 'chart'], ['#/coach', 'Coach', 'chat']];

  // ---------- the API key lives here, in memory only (unless the user chose the encrypted vault) ----------
  const keyState = { value: '', source: '' }; // source: 'typed' | 'file' | 'vault'
  function setKey(v, source) { keyState.value = String(v || '').trim(); keyState.source = keyState.value ? source : ''; }
  function clearKey() { keyState.value = ''; keyState.source = ''; }
  function hasKey() { return !!keyState.value; }
  function llmConfig() {
    const c = Store.getSettings().coach;
    const p = LLM.PROVIDERS[c.provider] || LLM.PROVIDERS.anthropic;
    return { provider: c.provider, model: c.model || p.defaultModel, baseUrl: c.baseUrl, apiKey: keyState.value };
  }
  // True when a request could be sent right now.
  function aiReady() {
    const cfg = llmConfig(), p = LLM.PROVIDERS[cfg.provider];
    if (!p) return false;
    if (p.needsKey && !cfg.apiKey) return false;
    if (cfg.provider === 'custom' && !cfg.baseUrl) return false;
    return !!cfg.model;
  }

  // ---------- routing ----------
  const screenEl = () => document.getElementById('screen');
  const tabsEl = () => document.getElementById('tabs');
  let lastHash = null;

  function routes() {
    const S = root.Screens, O = root.Onboard;
    return [
      [/^#\/welcome$/, () => O.welcome()],
      [/^#\/onboard\/1$/, () => O.about()], [/^#\/onboard\/2$/, () => O.goalStep()], [/^#\/onboard\/3$/, () => O.trainingStep()],
      [/^#\/onboard\/4$/, () => O.liftsStep()], [/^#\/onboard\/5$/, () => O.planStep()],
      [/^#\/today$/, () => S.today()],
      [/^#\/lifts$/, () => S.lifts()], [/^#\/lifts\/([a-z0-9_]+)$/, (m) => S.liftDetail(m[1])],
      [/^#\/fuel$/, () => S.fuel()],
      [/^#\/progress$/, () => S.progress()], [/^#\/photos$/, () => S.photos()], [/^#\/photos\/trend$/, () => S.photoTrend()], [/^#\/photos\/compare$/, () => S.photoCompare()],
      [/^#\/coach$/, () => S.coach()], [/^#\/coach\/setup$/, () => S.coachSetup()],
      [/^#\/profile$/, () => S.profile()], [/^#\/settings$/, () => S.settings()], [/^#\/settings\/plan$/, () => S.planSettings()],
    ];
  }

  function currentHash() {
    let hash = location.hash || '';
    const has = !!Store.getState().profile;
    if (!has) { if (!/^#\/(welcome|onboard\/[1-5])$/.test(hash)) hash = '#/welcome'; }
    else if (hash === '' || hash === '#/welcome' || hash.startsWith('#/onboard')) hash = '#/today';
    return hash;
  }

  function drawTabs(hash) {
    const bar = tabsEl();
    const show = !!Store.getState().profile && !/^#\/(welcome|onboard)/.test(hash);
    bar.classList.toggle('hidden', !show);
    U.clear(bar);
    if (!show) return;
    const base = hash.startsWith('#/photos') || hash.startsWith('#/settings') ? '#/progress' : '#/' + hash.split('/')[1];
    for (const [href, label, ic] of TABS) {
      const on = href === (hash.startsWith('#/settings') || hash.startsWith('#/profile') ? '#/today' : base);
      bar.appendChild(h('a', { href, class: on ? 'on' : '', 'aria-current': on ? 'page' : null }, U.icon(ic, 22), h('span', null, label)));
    }
  }

  function render() {
    const hash = currentHash();
    const host = screenEl();
    const prev = host.querySelector('.scroll, .chat');
    const keep = hash === lastHash && prev ? prev.scrollTop : 0;
    let node = null;
    for (const [re, fn] of routes()) {
      const m = re.exec(hash);
      if (m) { try { node = fn(m); } catch (e) { node = errorPage(e); } break; }
    }
    if (!node) { go('#/today'); return; }
    U.clear(host);
    host.appendChild(node);
    drawTabs(hash);
    lastHash = hash;
    const sc = host.querySelector('.scroll, .chat');
    if (sc && keep) sc.scrollTop = keep;
    if (node.afterMount) node.afterMount();
  }
  function errorPage(e) {
    return h('div', { class: 'page' }, root.UI.header('Something broke', 'Your data is safe on this device.'), root.UI.scroller(root.UI.card(h('div', { class: 'muted' }, String(e && e.message ? e.message : e)), root.UI.btn('Back to Today', { href: '#/today' }))));
  }
  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }
  window.addEventListener('hashchange', () => { if (!locked) render(); });

  // ---------- app lock (a screen gate, not encryption at rest; see SECURITY.md) ----------
  let locked = false, hiddenAt = 0, fails = 0, blockedUntil = 0;
  const lockEl = () => document.getElementById('lock');
  async function showLock() {
    const rec = await Store.getMeta('pin');
    if (!Store.getSettings().lockEnabled || !rec) return;
    locked = true;
    const box = U.clear(lockEl());
    box.classList.remove('hidden');
    const err = h('div', { class: 'err', role: 'alert' });
    const pin = h('input', { class: 'inp', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, 'aria-label': 'Passcode', placeholder: '••••' });
    const tryUnlock = async () => {
      if (Date.now() < blockedUntil) { err.textContent = 'Too many tries. Wait ' + Math.ceil((blockedUntil - Date.now()) / 1000) + ' s.'; return; }
      const ok = await Crypt.verifyPin(pin.value, rec);
      if (ok) { fails = 0; locked = false; box.classList.add('hidden'); U.clear(box); render(); return; }
      fails++; pin.value = '';
      if (fails >= 5) { blockedUntil = Date.now() + Math.min(300000, 15000 * Math.pow(2, fails - 5)); err.textContent = 'Too many tries. Wait a bit.'; } else err.textContent = 'That is not it.';
    };
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    box.appendChild(h('div', { class: 'lockbox' }, h('div', { class: 'app-icon' }, U.logoSvg(36)), h('div', { class: 'display h2' }, 'Orbit is locked'), pin, err, h('button', { class: 'btn primary block', type: 'button', onclick: tryUnlock }, 'Unlock')));
    setTimeout(() => pin.focus(), 50);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const s = Store.getSettings();
    if (s && s.lockEnabled && !locked && hiddenAt && Date.now() - hiddenAt > (s.lockMinutes || 2) * 60000) showLock();
  });

  // ---------- service worker (only on https or localhost; a no-op from file://) ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const okHost = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!okHost) return;
    let url = 'sw.js';
    try {
      if (root.trustedTypes && root.trustedTypes.createPolicy) {
        const p = root.trustedTypes.createPolicy('orbit-sw', { createScriptURL: (u) => { if (u !== 'sw.js') throw new TypeError('Blocked script URL'); return u; } });
        url = p.createScriptURL('sw.js');
      }
      navigator.serviceWorker.register(url).catch(() => { /* offline support is a bonus */ });
    } catch (e) { /* ignore */ }
  }

  async function boot() {
    let info = { volatile: false };
    try { info = await Store.init(); } catch (e) { info = { volatile: true }; }
    registerSW();
    root.Screens.volatile = info.volatile;
    await showLock();
    if (!locked) render();
    if (info.volatile) setTimeout(() => U.toast('Storage is blocked in this browser mode, so nothing will be kept after you close this tab.', 'warn'), 400);
  }

  root.App = { go, render, boot, showLock, setKey, clearKey, hasKey, llmConfig, aiReady, keyState };
  boot();
})(self);
