/* Shared UI building blocks (forms, cards, headers). Screens live in js/screens-*.js */
(function (root) {
  'use strict';
  const { h, icon } = root.U;

  function header(title, sub, opts) {
    const o = opts || {};
    return h('header', { class: 'head' },
      o.back ? h('a', { class: 'iconbtn', href: o.back, 'aria-label': 'Back' }, icon('back', 20)) : null,
      h('div', { class: 'head-main' }, h('h1', { class: 'display' }, title), sub ? h('div', { class: 'sub' }, sub) : null),
      o.right || null);
  }
  function card(...kids) { return h('section', { class: 'card' }, ...kids); }
  function cardX(cls, ...kids) { return h('section', { class: 'card ' + cls }, ...kids); }
  function btn(label, opts) {
    const o = opts || {};
    const tag = o.href ? 'a' : 'button';
    const p = { class: 'btn ' + (o.kind || 'primary') + (o.block === false ? '' : ' block'), onclick: o.onClick };
    if (o.href) p.href = o.href; else p.type = o.type || 'button';
    if (o.disabled) p.disabled = true;
    return h(tag, p, o.icon ? icon(o.icon, 20) : null, h('span', null, label));
  }
  // Text/number input with label, unit and hint. The returned element exposes .input for reading.
  function field(o) {
    const input = h('input', {
      class: 'inp', type: o.type || 'text', inputmode: o.inputmode || (o.type === 'number' ? 'decimal' : null), value: o.value == null ? '' : String(o.value),
      placeholder: o.placeholder || '', min: o.min, max: o.max, step: o.step, autocomplete: o.autocomplete || 'off', maxlength: o.maxlength, id: o.id,
      'aria-label': o.label,
      oninput: () => { if (o.onInput) o.onInput(input.value); },
    });
    const wrap = h('label', { class: 'field' + (o.flex ? ' flex' : ''), style: o.flex ? { flex: String(o.flex) } : null },
      h('span', { class: 'lab' }, o.label, o.req ? h('span', { class: 'req' }, ' *') : null),
      h('span', { class: 'inpwrap' }, input, o.unit ? h('span', { class: 'unit' }, o.unit) : null),
      o.hint ? h('span', { class: 'hint' }, o.hint) : null);
    wrap.input = input;
    return wrap;
  }
  function seg(o) {
    let value = o.value;
    const box = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': o.label || '' });
    const draw = () => {
      box.textContent = '';
      for (const opt of o.options) {
        const v = typeof opt === 'string' ? opt : opt.value;
        const t = typeof opt === 'string' ? opt : opt.label;
        box.appendChild(h('button', { type: 'button', class: 'seg-b' + (v === value ? ' on' : ''), role: 'radio', 'aria-checked': v === value ? 'true' : 'false', onclick: () => { value = v; draw(); if (o.onChange) o.onChange(v); } }, t));
      }
    };
    draw();
    const wrap = h('div', { class: 'segwrap', style: o.flex ? { flex: String(o.flex) } : null }, o.label ? h('div', { class: 'lab' }, o.label) : null, box);
    wrap.get = () => value;
    return wrap;
  }
  // Pill multi/single select. `values` is a Set (mutated).
  function pills(o) {
    const box = h('div', { class: 'pills' });
    const draw = () => {
      box.textContent = '';
      for (const it of o.items) {
        const on = o.values.has(it);
        box.appendChild(h('button', { type: 'button', class: 'pill' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => {
          if (o.multi === false) { o.values.clear(); o.values.add(it); }
          else if (on) o.values.delete(it);
          else {
            if (o.exclusive && o.exclusive.includes(it)) for (const x of Array.from(o.values)) if (x !== it) o.values.delete(x);
            else if (o.exclusive) for (const x of o.exclusive) o.values.delete(x);
            if (o.max && o.values.size >= o.max) { const first = o.values.values().next().value; o.values.delete(first); }
            o.values.add(it);
          }
          draw(); if (o.onChange) o.onChange(o.values);
        } }, it));
      }
    };
    draw();
    return h('div', { class: 'pillwrap' }, o.label ? h('div', { class: 'lab' }, o.label) : null, box, o.hint ? h('div', { class: 'hint' }, o.hint) : null);
  }
  function toggleRow(title, sub, on, onChange) {
    const sw = h('button', { type: 'button', class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': title,
      onclick: () => { on = !on; sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); onChange(on); } }, h('span', { class: 'knob' }));
    return h('div', { class: 'trow' }, h('div', { class: 'grow' }, h('div', { class: 'tt' }, title), sub ? h('div', { class: 'ts' }, sub) : null), sw);
  }
  function stepBar(n, total) {
    const b = h('div', { class: 'steps', 'aria-label': 'Step ' + n + ' of ' + total });
    for (let i = 0; i < total; i++) b.appendChild(h('span', { class: i < n ? 'on' : '' }));
    return b;
  }
  function page(...kids) { return h('div', { class: 'page' }, ...kids); }
  function scroller(...kids) { return h('div', { class: 'scroll' }, ...kids); }
  function row(...kids) { return h('div', { class: 'row' }, ...kids); }
  function empty(text) { return h('div', { class: 'empty' }, text); }

  root.UI = { header, card, cardX, btn, field, seg, pills, toggleRow, stepBar, page, scroller, row, empty };
})(self);
