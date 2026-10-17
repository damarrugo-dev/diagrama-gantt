// Utilidades compartidas por el Gantt, el Kanban y los enlaces entre ellos.
export const $ = (s, el = document) => el.querySelector(s);
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Crea un elemento: h('div', {class: 'x', onclick: fn}, 'texto', otroElemento)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// Ventana de pregunta reutilizable
export function ask({ title, hint = '', value = '', input = true, okText = 'Aceptar', danger = false }) {
  return new Promise(resolve => {
    const d = $('#askDialog');
    $('#askTitle').textContent = title;
    $('#askHint').textContent = hint;
    $('#askHint').hidden = !hint;
    const inp = $('#askInput');
    inp.hidden = !input;
    inp.required = input;
    inp.value = value;
    const ok = $('#askOk');
    ok.textContent = okText;
    ok.classList.toggle('danger', danger);
    d.returnValue = '';
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return resolve(null);
      resolve(input ? inp.value.trim() || null : true);
    }, { once: true });
    d.showModal();
    if (input) { inp.focus(); inp.select(); } else ok.focus();
  });
}
export const confirmDlg = (title, hint, okText = 'Eliminar') => ask({ title, hint, input: false, okText, danger: true });

// Menú emergente pequeño (⋯)
export function showMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map(it => h('button', {
      type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', disabled: it.disabled,
      onclick: () => { closeMenu(); it.action(); },
    }, it.label)));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
export function closeMenu() { document.querySelectorAll('.menu').forEach(m => m.remove()); }

// Archivo CSV que Excel abre con tildes y columnas bien separadas
export function downloadCsv(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}
