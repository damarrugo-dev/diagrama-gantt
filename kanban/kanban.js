// Tablero Kanban: procesos (columnas) y carriles (filas). Vive en la misma página que el Gantt.
import { $, h, uid, toast, ask, confirmDlg, showMenu, downloadCsv } from '../js/util.js';
import { me, initials, hueOf, preguntarNombreSiFalta } from '../js/sesion.js';
import * as enlaces from '../js/enlaces.js';

const nowIso = () => new Date().toISOString();
const limpiarId = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const params = new URLSearchParams(location.search);
let BOARD_ID = limpiarId(params.get('tablero')) || (() => { try { return localStorage.getItem('kanban:ultimo-tablero'); } catch { return null; } })() || 'principal';

const COLORS = ['', '#e5484d', '#f76b15', '#f5b300', '#30a46c', '#2f6fed', '#8e4ec6', '#d6409f'];

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function durText(fromIso, toIso) {
  const ms = (toIso ? new Date(toIso) : new Date()) - new Date(fromIso);
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return days === 1 ? '1 día' : `${days} días`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours} h`;
  return 'menos de 1 h';
}
function safeUrl(url) {
  url = (url || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { return new URL(url).href; } catch { return null; }
}

// ---------- Almacenamiento ----------
const DEFAULT_BOARD = () => ({
  title: 'Mi tablero',
  columns: ['Por hacer', 'En proceso', 'En revisión', 'Terminado'].map(name => ({ id: uid(), name })),
  lanes: [{ id: uid(), name: 'General' }],
});

// La base sirve para cualquier tablero: el que está en pantalla y los de las tarjetas enlazadas al Gantt.
// En línea: Firebase Firestore (todos los que abren el enlace ven lo mismo, en tiempo real)
function createFirebaseBase(fs, db) {
  const boardRef = b => fs.doc(db, 'tableros', b);
  const cardsCol = b => fs.collection(db, 'tableros', b, 'tarjetas');
  return {
    mode: 'online',
    async listBoards() {
      const qs = await fs.getDocs(fs.collection(db, 'tableros'));
      return qs.docs.map(d => ({ id: d.id, title: d.data().title || d.id }));
    },
    subscribe(b, onBoard, onCards, onError) {
      const off1 = fs.onSnapshot(boardRef(b), snap => {
        if (!snap.exists()) { fs.setDoc(boardRef(b), DEFAULT_BOARD()).catch(onError); return; }
        onBoard(snap.data());
      }, onError);
      const off2 = fs.onSnapshot(cardsCol(b), qs => {
        const m = new Map();
        qs.forEach(d => m.set(d.id, { ...d.data(), id: d.id }));
        onCards(m);
      }, onError);
      return () => { off1(); off2(); };
    },
    async readBoard(b) { const s = await fs.getDoc(boardRef(b)); return s.exists() ? s.data() : null; },
    async readCards(b) { const qs = await fs.getDocs(cardsCol(b)); return qs.docs.map(d => ({ ...d.data(), id: d.id })); },
    async readCard(b, id) { const s = await fs.getDoc(fs.doc(cardsCol(b), id)); return s.exists() ? { ...s.data(), id } : null; },
    addBoard: (b, data) => fs.setDoc(boardRef(b), data),
    saveBoard: (b, patch) => fs.updateDoc(boardRef(b), patch),
    addCard: (b, { id, ...rest }) => fs.setDoc(fs.doc(cardsCol(b), id), JSON.parse(JSON.stringify(rest))),
    updateCard: (b, id, patch) => fs.updateDoc(fs.doc(cardsCol(b), id), patch),
    deleteCard: (b, id) => fs.deleteDoc(fs.doc(cardsCol(b), id)),
  };
}

// Modo de prueba: guarda en este navegador
function createLocalBase() {
  const KEY = b => 'kanban:datos:' + b;
  const load = b => { try { return JSON.parse(localStorage.getItem(KEY(b))); } catch { return null; } };
  const data = b => load(b) || { board: DEFAULT_BOARD(), cards: {} };
  let sub = null; // { b, onBoard, onCards }
  const emit = () => {
    if (!sub) return;
    const d = data(sub.b);
    sub.onBoard(d.board);
    sub.onCards(new Map(Object.entries(d.cards).map(([id, c]) => [id, { ...c, id }])));
  };
  const change = (b, fn) => {
    const d = data(b);
    fn(d);
    try { localStorage.setItem(KEY(b), JSON.stringify(d)); } catch {}
    if (sub?.b === b) emit();
  };
  window.addEventListener('storage', e => { if (sub && e.key === KEY(sub.b)) emit(); });
  return {
    mode: 'local',
    async listBoards() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('kanban:datos:')) out.push({ id: k.slice(13), title: load(k.slice(13))?.board?.title || k.slice(13) });
      }
      return out;
    },
    subscribe(b, onBoard, onCards) {
      sub = { b, onBoard, onCards };
      if (!load(b)) change(b, () => {});
      emit();
      return () => { if (sub?.b === b) sub = null; };
    },
    async readBoard(b) { return load(b)?.board || null; },
    async readCards(b) { return Object.entries(load(b)?.cards || {}).map(([id, c]) => ({ ...c, id })); },
    async readCard(b, id) { const c = load(b)?.cards?.[id]; return c ? { ...c, id } : null; },
    async addBoard(b, board) { change(b, d => { d.board = structuredClone(board); }); },
    async saveBoard(b, patch) { change(b, d => Object.assign(d.board, structuredClone(patch))); },
    async addCard(b, { id, ...rest }) { change(b, d => { d.cards[id] = structuredClone(rest); }); },
    async updateCard(b, id, patch) { change(b, d => { if (d.cards[id]) Object.assign(d.cards[id], structuredClone(patch)); }); },
    async deleteCard(b, id) { change(b, d => { delete d.cards[id]; }); },
  };
}

// ---------- Estado ----------
let base;          // Firebase o este navegador
let cerrarTablero = () => {};
// El tablero en pantalla
const store = {
  get mode() { return base.mode; },
  saveBoard: patch => base.saveBoard(BOARD_ID, patch),
  addCard: card => base.addCard(BOARD_ID, card),
  updateCard: (id, patch) => base.updateCard(BOARD_ID, id, patch),
  deleteCard: id => base.deleteCard(BOARD_ID, id),
};
let board = null;
let cards = new Map();
let dragging = false;
let openCardId = null;
const filters = { q: '', resp: '' };

const columns = () => board?.columns || [];
const lanes = () => board?.lanes || [];
const colName = id => columns().find(c => c.id === id)?.name || '(proceso eliminado)';
const laneName = id => lanes().find(l => l.id === id)?.name || '(carril eliminado)';

// Si una tarjeta quedó en un proceso/carril que ya no existe, se muestra en el primero
function placeOf(card) {
  const col = columns().some(c => c.id === card.columnId) ? card.columnId : columns()[0]?.id;
  const lane = lanes().some(l => l.id === card.laneId) ? card.laneId : lanes()[0]?.id;
  return { col, lane };
}
function cardsIn(colId, laneId) {
  return [...cards.values()]
    .filter(c => { const p = placeOf(c); return p.col === colId && p.lane === laneId; })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
function matchesFilters(c) {
  if (filters.resp && (c.responsible || '') !== filters.resp) return false;
  if (filters.q) {
    const text = [c.title, c.description, c.responsible, ...(c.notes || []).map(n => n.text)].join(' ').toLowerCase();
    if (!text.includes(filters.q)) return false;
  }
  return true;
}
const fail = err => { console.error(err); toast('No se pudo guardar: ' + (err?.message || err)); };

function updateCard(id, patch) {
  const card = cards.get(id);
  if (card) cards.set(id, { ...card, ...patch }); // se ve el cambio al instante
  render();
  const guardado = store.updateCard(id, patch).catch(fail);
  if (card) enlaces.alCambiarTarjeta(BOARD_ID, card, cards.get(id));
  return guardado;
}
function saveBoard(patch) {
  board = { ...board, ...patch };
  render();
  return store.saveBoard(patch).catch(fail);
}

// ---------- Acciones de tarjetas ----------
// Tarjeta nueva con todos sus campos, en cualquier tablero (tb = {columns, lanes})
function buildCard(tb, { id, title, columnId, laneId, order = 0, ...extra }) {
  const cols = tb?.columns || [], lns = tb?.lanes || [];
  if (!cols.some(c => c.id === columnId)) columnId = cols[0]?.id;
  if (!lns.some(l => l.id === laneId)) laneId = lns[0]?.id;
  const name = (list, x) => list.find(y => y.id === x)?.name || '';
  const now = nowIso();
  return {
    id: id || uid(),
    title: title || 'Sin título',
    description: '',
    responsible: '',
    color: '',
    columnId,
    laneId,
    order,
    enteredAt: now,
    createdAt: now,
    createdBy: me(),
    history: [{ columnId, laneId, columnName: name(cols, columnId), laneName: name(lns, laneId), enteredAt: now, leftAt: null, by: me() }],
    checklist: [],
    notes: [],
    links: [],
    ...extra,
  };
}
// Cambios para pasar una tarjeta a otro proceso/carril: queda registrada la fecha de entrada
function movePatch(tb, card, colId, laneId) {
  const name = (list, x) => (list || []).find(y => y.id === x)?.name || '';
  const now = nowIso();
  const history = [...(card.history || [])];
  const last = history[history.length - 1];
  if (last && !last.leftAt) history[history.length - 1] = { ...last, leftAt: now };
  history.push({ columnId: colId, laneId, columnName: name(tb?.columns, colId), laneName: name(tb?.lanes, laneId), enteredAt: now, leftAt: null, by: me() });
  return { columnId: colId, laneId, enteredAt: now, history };
}

async function newCard(colId, laneId) {
  const res = await enlaces.dialogoNuevaTarjeta(`${colName(colId)} · ${laneName(laneId)}`);
  if (!res) return;
  const data = { id: uid(), title: res.title, columnId: colId, laneId, order: nextOrder(colId, laneId) };
  if (res.enlace) await enlaces.enlazarTarjetaNueva(BOARD_ID, data, res.enlace);
  else await kanbanApi.crearTarjeta(BOARD_ID, data);
  if (cards.has(data.id)) openCard(data.id);
}

// Mueve una tarjeta; si cambia de proceso o de carril, queda registrada la fecha de entrada
function moveCard(id, colId, laneId, order) {
  const card = cards.get(id);
  if (!card) return;
  const p = placeOf(card);
  if (p.col === colId && p.lane === laneId) return updateCard(id, { order });
  return updateCard(id, { ...movePatch(board, card, colId, laneId), order });
}

async function removeCard(id) {
  const card = cards.get(id);
  if (!card) return;
  const hint = card.gantt ? 'Se borra para todas las personas y no se puede deshacer. La tarea del Gantt se conserva, sin enlace.' : 'Se borra para todas las personas y no se puede deshacer.';
  if (!(await confirmDlg(`¿Eliminar la tarjeta "${card.title}"?`, hint))) return;
  closeCard();
  cards.delete(id);
  render();
  store.deleteCard(id).catch(fail);
  enlaces.alEliminarTarjeta(BOARD_ID, card);
}

// ---------- Acciones de procesos (columnas) y carriles (filas) ----------
async function addColumn() {
  const name = await ask({ title: 'Nuevo proceso (columna)', hint: 'Ejemplo: Diseño, Producción, Entrega…', okText: 'Agregar' });
  if (name) saveBoard({ columns: [...columns(), { id: uid(), name }] });
}
async function addLane() {
  const name = await ask({ title: 'Nuevo carril (fila)', hint: 'Ejemplo: un equipo, un cliente o un tipo de trabajo.', okText: 'Agregar' });
  if (name) saveBoard({ lanes: [...lanes(), { id: uid(), name }] });
}
async function renameItem(kind, id) {
  const list = kind === 'columns' ? columns() : lanes();
  const item = list.find(x => x.id === id);
  const name = await ask({ title: kind === 'columns' ? 'Renombrar proceso' : 'Renombrar carril', value: item.name, okText: 'Guardar' });
  if (name) saveBoard({ [kind]: list.map(x => (x.id === id ? { ...x, name } : x)) });
}
function moveItem(kind, id, delta) {
  const list = [...(kind === 'columns' ? columns() : lanes())];
  const i = list.findIndex(x => x.id === id);
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveBoard({ [kind]: list });
}
async function deleteItem(kind, id) {
  const list = kind === 'columns' ? columns() : lanes();
  const isCol = kind === 'columns';
  if (list.length <= 1) return toast(isCol ? 'El tablero necesita al menos un proceso.' : 'El tablero necesita al menos un carril.');
  const inside = [...cards.values()].filter(c => (isCol ? placeOf(c).col : placeOf(c).lane) === id).length;
  if (inside) return toast(`Primero mueve o elimina las ${inside} tarjeta(s) que tiene.`);
  const item = list.find(x => x.id === id);
  if (!(await confirmDlg(`¿Eliminar ${isCol ? 'el proceso' : 'el carril'} "${item.name}"?`, 'Está vacío; las tarjetas no se ven afectadas.'))) return;
  saveBoard({ [kind]: list.filter(x => x.id !== id) });
}

// ---------- Dibujo del tablero ----------
function render() {
  if (!board) return;
  if (dragging) return; // se redibuja al soltar
  if (visible) document.title = (board.title || 'Tablero') + ' · Kanban';
  renderBoardSelect();
  renderRespFilter();

  const el = $('#board');
  const cols = columns();
  const lns = lanes();
  el.style.setProperty('--ncols', cols.length);
  el.textContent = '';

  el.append(h('div', { class: 'corner' }, h('span', {}, 'Carriles'), h('span', { class: 'muted' }, ' / Procesos')));
  cols.forEach((c, i) => {
    const count = [...cards.values()].filter(card => placeOf(card).col === c.id).length;
    el.append(h('div', { class: 'col-head' },
      h('span', { class: 'col-name', title: c.name, ondblclick: () => renameItem('columns', c.id) }, c.name),
      h('span', { class: 'count' }, count),
      h('button', {
        class: 'icon-btn', 'aria-label': `Opciones de ${c.name}`,
        onclick: e => { e.stopPropagation(); showMenu(e.currentTarget, [
          { label: '✎ Renombrar', action: () => renameItem('columns', c.id) },
          { label: '← Mover a la izquierda', disabled: i === 0, action: () => moveItem('columns', c.id, -1) },
          { label: '→ Mover a la derecha', disabled: i === cols.length - 1, action: () => moveItem('columns', c.id, 1) },
          { label: '🗑 Eliminar proceso', danger: true, action: () => deleteItem('columns', c.id) },
        ]); },
      }, '⋯')));
  });

  lns.forEach((lane, li) => {
    const count = [...cards.values()].filter(card => placeOf(card).lane === lane.id).length;
    el.append(h('div', { class: 'lane-head' },
      h('div', { class: 'lane-top' },
        h('span', { class: 'lane-name', ondblclick: () => renameItem('lanes', lane.id) }, lane.name),
        h('button', {
          class: 'icon-btn', 'aria-label': `Opciones de ${lane.name}`,
          onclick: e => { e.stopPropagation(); showMenu(e.currentTarget, [
            { label: '✎ Renombrar', action: () => renameItem('lanes', lane.id) },
            { label: '↑ Subir', disabled: li === 0, action: () => moveItem('lanes', lane.id, -1) },
            { label: '↓ Bajar', disabled: li === lns.length - 1, action: () => moveItem('lanes', lane.id, 1) },
            { label: '🗑 Eliminar carril', danger: true, action: () => deleteItem('lanes', lane.id) },
          ]); },
        }, '⋯')),
      h('span', { class: 'count' }, `${count} tarjeta${count === 1 ? '' : 's'}`)));
    cols.forEach(col => {
      const list = h('div', { class: 'cards', 'data-col': col.id, 'data-lane': lane.id },
        cardsIn(col.id, lane.id).filter(matchesFilters).map(cardEl));
      el.append(h('div', { class: 'cell' }, list,
        h('button', { class: 'add-card', onclick: () => newCard(col.id, lane.id) }, '+ Añadir tarjeta')));
    });
  });

  initDragAndDrop();
  if (openCardId) setTimeout(refreshCardDialog, 0);
}

function cardEl(c) {
  const done = (c.checklist || []).filter(i => i.done).length;
  const total = (c.checklist || []).length;
  return h('article', {
    class: 'card', 'data-id': c.id, tabindex: 0,
    style: c.color ? `--card-color:${c.color}` : '',
    onclick: () => openCard(c.id),
    onkeydown: e => { if (e.key === 'Enter') openCard(c.id); },
  },
    h('div', { class: 'card-title' }, c.title || 'Sin título'),
    c.description ? h('div', { class: 'card-desc' }, c.description) : null,
    h('div', { class: 'card-meta' },
      c.responsible
        ? h('span', { class: 'resp' }, h('span', { class: 'avatar sm', style: `--h:${hueOf(c.responsible)}` }, initials(c.responsible)), c.responsible)
        : h('span', { class: 'resp muted' }, 'Sin responsable'),
      h('span', { class: 'since', title: `Entró a esta etapa el ${fmtDateTime(c.enteredAt)}` }, `📅 ${fmtDate(c.enteredAt)} · ${durText(c.enteredAt)}`)),
    c.gantt ? enlaces.etiquetaTarea(c.gantt) : null,
    (total || c.notes?.length || c.links?.length) ? h('div', { class: 'badges' },
      total ? h('span', { class: done === total ? 'ok' : '' }, `☑ ${done}/${total}`) : null,
      c.notes?.length ? h('span', {}, `💬 ${c.notes.length}`) : null,
      c.links?.length ? h('span', {}, `🔗 ${c.links.length}`) : null) : null);
}

let sortables = [];
function initDragAndDrop() {
  sortables.forEach(s => s.destroy());
  sortables = [];
  if (!window.Sortable) return;
  document.querySelectorAll('.cards').forEach(list => {
    sortables.push(new Sortable(list, {
      group: 'tarjetas',
      animation: 150,
      delay: 180,
      delayOnTouchOnly: true,
      ghostClass: 'ghost',
      chosenClass: 'chosen',
      onStart: () => { dragging = true; },
      onEnd: evt => {
        dragging = false;
        const id = evt.item.dataset.id;
        const to = evt.to;
        if (evt.from === to && evt.oldIndex === evt.newIndex) return render();
        const ids = [...to.querySelectorAll('.card')].map(e => e.dataset.id);
        const idx = ids.indexOf(id);
        const prev = cards.get(ids[idx - 1]);
        const next = cards.get(ids[idx + 1]);
        let order = 0;
        if (prev && next) order = ((prev.order ?? 0) + (next.order ?? 0)) / 2;
        else if (prev) order = (prev.order ?? 0) + 1;
        else if (next) order = (next.order ?? 0) - 1;
        moveCard(id, to.dataset.col, to.dataset.lane, order);
        render();
      },
    }));
  });
}

function renderRespFilter() {
  const sel = $('#filterResp');
  const names = [...new Set([...cards.values()].map(c => c.responsible).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const current = filters.resp;
  sel.textContent = '';
  sel.append(h('option', { value: '' }, 'Todos los responsables'), ...names.map(n => h('option', { value: n }, n)));
  if (current && !names.includes(current)) sel.append(h('option', { value: current }, current));
  sel.value = current;
}

// ---------- Ventana de la tarjeta ----------
let dialogDirty = false;

function openCard(id) {
  openCardId = id;
  dialogDirty = false;
  buildCardDialog();
  const d = $('#cardDialog');
  if (!d.open) d.showModal();
}
function closeCard() {
  openCardId = null;
  const d = $('#cardDialog');
  if (d.open) d.close();
}
const isTyping = () => {
  const a = document.activeElement;
  return a && $('#cardDialog').contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'));
};
function refreshCardDialog() {
  if (!openCardId) return;
  if (!cards.has(openCardId)) { closeCard(); return; }
  if (isTyping()) { dialogDirty = true; return; } // no interrumpir a quien escribe
  buildCardDialog();
}

function buildCardDialog() {
  const c = cards.get(openCardId);
  if (!c) return closeCard();
  const body = $('#cardDialogBody');
  const scroll = $('#cardDialog').scrollTop;
  const set = patch => updateCard(c.id, patch);
  const respNames = [...new Set([...cards.values()].map(x => x.responsible).filter(Boolean))];
  const p = placeOf(c);

  const checklist = c.checklist || [];
  const notes = [...(c.notes || [])].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const links = c.links || [];
  const history = c.history || [];

  body.textContent = '';
  body.append(
    h('div', { class: 'dlg-head', style: c.color ? `--card-color:${c.color}` : '' },
      h('input', { class: 'dlg-title', value: c.title || '', maxlength: 150, 'aria-label': 'Título',
        onchange: e => set({ title: e.target.value.trim() || 'Sin título' }) }),
      h('button', { class: 'icon-btn close', 'aria-label': 'Cerrar', onclick: closeCard }, '✕')),

    h('div', { class: 'dlg-grid' },
      // Columna principal
      h('div', { class: 'dlg-main' },
        h('label', { class: 'field' }, h('span', {}, 'Descripción'),
          h('textarea', { rows: 4, placeholder: 'Describe la tarea…', value: c.description || '',
            onchange: e => set({ description: e.target.value }) })),

        h('section', {},
          h('h3', {}, `Lista de tareas ${checklist.length ? `(${checklist.filter(i => i.done).length}/${checklist.length})` : ''}`),
          h('ul', { class: 'checklist' }, checklist.map(item => h('li', {},
            h('label', {},
              h('input', { type: 'checkbox', checked: !!item.done,
                onchange: e => set({ checklist: (cards.get(c.id).checklist || []).map(i => i.id === item.id ? { ...i, done: e.target.checked } : i) }) }),
              h('span', { class: item.done ? 'done' : '' }, item.text)),
            h('button', { class: 'icon-btn sm', 'aria-label': 'Quitar', onclick: () => set({ checklist: (cards.get(c.id).checklist || []).filter(i => i.id !== item.id) }) }, '✕')))),
          h('form', { class: 'inline-add', onsubmit: e => {
            e.preventDefault();
            const inp = e.target.elements.task;
            const text = inp.value.trim();
            if (!text) return;
            inp.value = '';
            set({ checklist: [...(cards.get(c.id).checklist || []), { id: uid(), text, done: false }] });
          } },
            h('input', { name: 'task', placeholder: 'Nueva tarea…', autocomplete: 'off' }),
            h('button', { class: 'btn' }, 'Agregar'))),

        h('section', {},
          h('h3', {}, 'Notas y avances'),
          h('form', { class: 'note-add', onsubmit: e => {
            e.preventDefault();
            const ta = e.target.elements.note;
            const text = ta.value.trim();
            if (!text) return;
            ta.value = '';
            set({ notes: [...(cards.get(c.id).notes || []), { id: uid(), text, author: me(), at: nowIso() }] });
          } },
            h('textarea', { name: 'note', rows: 2, placeholder: 'Escribe un avance, comentario o información adicional…' }),
            h('button', { class: 'btn primary' }, 'Agregar nota')),
          h('ul', { class: 'notes' }, notes.map(n => h('li', {},
            h('div', { class: 'note-meta' },
              h('span', { class: 'avatar sm', style: `--h:${hueOf(n.author)}` }, initials(n.author)),
              h('strong', {}, n.author), h('span', { class: 'muted' }, fmtDateTime(n.at)),
              h('button', { class: 'icon-btn sm', 'aria-label': 'Borrar nota', onclick: async () => {
                if (await confirmDlg('¿Borrar esta nota?', '')) set({ notes: (cards.get(c.id).notes || []).filter(x => x.id !== n.id) });
              } }, '✕')),
            h('div', { class: 'note-text' }, n.text))))),

        h('section', {},
          h('h3', {}, 'Enlaces y documentos'),
          h('ul', { class: 'links' }, links.map(l => h('li', {},
            h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label || l.url),
            h('button', { class: 'icon-btn sm', 'aria-label': 'Quitar enlace', onclick: () => set({ links: (cards.get(c.id).links || []).filter(x => x.id !== l.id) }) }, '✕')))),
          h('form', { class: 'inline-add', onsubmit: e => {
            e.preventDefault();
            const url = safeUrl(e.target.elements.url.value);
            if (!url) return toast('Escribe una dirección web válida.');
            const label = e.target.elements.label.value.trim();
            set({ links: [...(cards.get(c.id).links || []), { id: uid(), url, label }] });
          } },
            h('input', { name: 'url', placeholder: 'Pega un enlace (Drive, documento…)', autocomplete: 'off' }),
            h('input', { name: 'label', placeholder: 'Nombre (opcional)', autocomplete: 'off' }),
            h('button', { class: 'btn' }, 'Agregar')))),

      // Columna lateral
      h('aside', { class: 'dlg-side' },
        h('label', { class: 'field' }, h('span', {}, 'Responsable'),
          h('input', { list: 'respList', value: c.responsible || '', placeholder: 'Nombre del responsable',
            onchange: e => set({ responsible: e.target.value.trim() }) }),
          h('datalist', { id: 'respList' }, respNames.map(n => h('option', { value: n })))),

        h('label', { class: 'field' }, h('span', {}, 'Proceso (columna)'),
          h('select', { onchange: e => { moveCard(c.id, e.target.value, p.lane, nextOrder(e.target.value, p.lane)); } },
            columns().map(col => h('option', { value: col.id, selected: col.id === p.col }, col.name)))),
        h('label', { class: 'field' }, h('span', {}, 'Carril (fila)'),
          h('select', { onchange: e => { moveCard(c.id, p.col, e.target.value, nextOrder(p.col, e.target.value)); } },
            lanes().map(l => h('option', { value: l.id, selected: l.id === p.lane }, l.name)))),

        h('div', { class: 'since-box' },
          h('span', { class: 'muted' }, 'En esta etapa desde'),
          h('strong', {}, fmtDateTime(c.enteredAt)),
          h('span', {}, durText(c.enteredAt))),

        h('section', { class: 'gantt-box' },
          h('h3', {}, 'Gantt'),
          c.gantt
            ? [enlaces.etiquetaTarea(c.gantt, true),
                h('div', { class: 'gantt-acciones' },
                  h('button', { class: 'btn', onclick: () => { closeCard(); enlaces.abrirTarea(c.gantt); } }, 'Abrir en el Gantt'),
                  h('button', { class: 'btn', onclick: async () => {
                    if (await confirmDlg('¿Quitar el enlace con el Gantt?', 'La tarjeta y la tarea se conservan; solo dejan de actualizarse entre sí.', 'Quitar enlace')) enlaces.desenlazar({ tablero: BOARD_ID, tarjeta: c.id, ...c.gantt });
                  } }, 'Desenlazar'))]
            : [h('p', { class: 'muted small' }, 'Esta tarjeta vive solo en el Kanban.'),
                h('button', { class: 'btn', onclick: () => enlaces.dialogoEnlazarTarjeta(BOARD_ID, c) }, 'Enlazar con una tarea del Gantt…')]),

        h('div', { class: 'field' }, h('span', {}, 'Color'),
          h('div', { class: 'colors' }, COLORS.map(col => h('button', {
            class: 'swatch' + ((c.color || '') === col ? ' on' : ''), style: col ? `background:${col}` : '',
            'aria-label': col ? `Color ${col}` : 'Sin color', title: col ? '' : 'Sin color',
            onclick: () => set({ color: col }),
          }, col ? '' : '∅')))),

        h('section', {},
          h('h3', {}, 'Historial de seguimiento'),
          h('ol', { class: 'history' }, [...history].reverse().map(e => h('li', {},
            h('div', {}, h('strong', {}, e.columnName), ' · ', e.laneName),
            h('div', { class: 'muted' }, `Entró: ${fmtDateTime(e.enteredAt)}`),
            h('div', { class: 'muted' }, e.leftAt ? `Salió: ${fmtDateTime(e.leftAt)} (${durText(e.enteredAt, e.leftAt)})` : `Sigue aquí (${durText(e.enteredAt)})`),
            e.by ? h('div', { class: 'muted' }, `Movida por ${e.by}`) : null)))),

        h('p', { class: 'muted small' }, `Creada por ${c.createdBy || '—'} el ${fmtDate(c.createdAt)}`),
        h('button', { class: 'btn danger', onclick: () => removeCard(c.id) }, 'Eliminar tarjeta'))),
  );
  $('#cardDialog').scrollTop = scroll;
}

function nextOrder(colId, laneId) {
  const list = cardsIn(colId, laneId);
  return list.length ? (list[list.length - 1].order ?? 0) + 1 : 0;
}

// ---------- Exportar a Excel (CSV) ----------
function exportCsv() {
  const rows = [['Tarjeta', 'Responsable', 'Proceso', 'Carril', 'Entró', 'Salió', 'Días en la etapa', 'Movida por', 'Proceso actual', 'Carril actual', 'Descripción']];
  for (const c of cards.values()) {
    const p = placeOf(c);
    for (const e of c.history || []) {
      const days = ((e.leftAt ? new Date(e.leftAt) : new Date()) - new Date(e.enteredAt)) / 86400000;
      rows.push([c.title, c.responsible, e.columnName, e.laneName, fmtDateTime(e.enteredAt), e.leftAt ? fmtDateTime(e.leftAt) : 'Sigue aquí',
        days.toFixed(1).replace('.', ','), e.by, colName(p.col), laneName(p.lane), c.description]);
    }
  }
  downloadCsv(rows, `seguimiento-${BOARD_ID}-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function share() {
  const url = new URL(location.href);
  url.searchParams.set('vista', 'kanban');
  url.searchParams.set('tablero', BOARD_ID);
  try { await navigator.clipboard.writeText(url.href); toast('Enlace copiado. Envíalo a quien quieras.'); }
  catch { await ask({ title: 'Copia este enlace', value: url.href, okText: 'Listo' }); }
  if (store.mode === 'local') toast('Ojo: en modo de prueba los demás no verán tus cambios.');
}

// ---------- Tableros (como los proyectos del Gantt: se eligen en la barra de arriba) ----------
let boardList = [];
async function loadBoardList() {
  try { boardList = await base.listBoards(); } catch (err) { console.error(err); }
  if (!boardList.some(b => b.id === BOARD_ID)) boardList.push({ id: BOARD_ID, title: board?.title || BOARD_ID });
  renderBoardSelect();
}
function renderBoardSelect() {
  const sel = $('#selTablero');
  const list = boardList.map(b => b.id === BOARD_ID && board ? { ...b, title: board.title || b.title } : b)
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
  sel.replaceChildren(
    ...list.map(b => h('option', { value: b.id, selected: b.id === BOARD_ID }, b.title || b.id)),
    h('option', { value: '__nuevo' }, '＋ Tablero nuevo…'),
    h('option', { value: '__renombrar' }, '✎ Renombrar este tablero…'));
  sel.value = BOARD_ID;
}
async function onBoardSelect(e) {
  const v = e.target.value;
  e.target.value = BOARD_ID;
  if (v === '__renombrar') {
    const name = await ask({ title: 'Renombrar tablero', value: board?.title || '', okText: 'Guardar' });
    if (name) saveBoard({ title: name });
  } else if (v === '__nuevo') {
    const name = await ask({ title: 'Tablero nuevo', hint: 'Empieza con los procesos Por hacer, En proceso, En revisión y Terminado.', okText: 'Crear' });
    if (!name) return;
    let id = limpiarId(name) || 'tablero';
    while (boardList.some(b => b.id === id)) id += '-2';
    await base.addBoard(id, { ...DEFAULT_BOARD(), title: name });
    boardList.push({ id, title: name });
    openBoard(id, { ...DEFAULT_BOARD(), title: name });
  } else if (v !== BOARD_ID) openBoard(v);
}

// Abre un tablero: deja de escuchar el anterior y escucha el nuevo en tiempo real
function openBoard(id, initial = null) {
  cerrarTablero();
  closeCard();
  BOARD_ID = id;
  try { localStorage.setItem('kanban:ultimo-tablero', id); } catch {}
  board = null;
  cards = new Map();
  $('#board').replaceChildren(h('p', { class: 'loading' }, 'Cargando tablero…'));
  if (visible) setUrl();
  return new Promise(resolve => {
    const ready = { board: false, cards: false };
    const done = () => { if (ready.board && ready.cards) resolve(); };
    cerrarTablero = base.subscribe(id,
      b => { board = { ...DEFAULT_BOARD(), ...(initial || {}), ...b }; render(); ready.board = true; done(); },
      m => { cards = m; render(); ready.cards = true; done(); enlaces.invalidar(); },
      err => {
        console.error(err);
        resolve();
        const denied = err?.code === 'permission-denied';
        showBanner(denied
          ? 'Tu cuenta no tiene permiso para ver este tablero.'
          : 'Problema de conexión con la base de datos: ' + (err?.message || err), 'error');
      });
  });
}
function setUrl() {
  const url = new URL(location.href);
  url.searchParams.set('tablero', BOARD_ID);
  history.replaceState(null, '', url);
}

// ---------- Inicio ----------
let visible = false;
function wireUi() {
  $('#addColumn').onclick = addColumn;
  $('#addLane').onclick = addLane;
  $('#shareBtn').onclick = share;
  $('#exportBtn').onclick = exportCsv;
  $('#selTablero').onchange = onBoardSelect;
  $('#search').oninput = e => { filters.q = e.target.value.trim().toLowerCase(); render(); };
  $('#filterResp').onchange = e => { filters.resp = e.target.value; render(); };
  const d = $('#cardDialog');
  d.addEventListener('close', () => { openCardId = null; });
  d.addEventListener('click', e => { if (e.target === d) closeCard(); }); // clic fuera
  d.addEventListener('focusout', () => setTimeout(() => { if (dialogDirty && openCardId && !isTyping()) { dialogDirty = false; buildCardDialog(); } }, 0));
  // Refresca los "hace X días" cada minuto
  setInterval(() => { if (!openCardId && visible) render(); }, 60000);
}

function showBanner(html, kind = 'warn') {
  const b = $('#banner');
  b.className = 'banner ' + kind;
  b.innerHTML = html;
  b.hidden = false;
}

export async function iniciarKanban(ses) {
  wireUi();
  if (ses.modo === 'firebase') {
    base = createFirebaseBase(ses.fs, ses.db);
  } else {
    base = createLocalBase();
    showBanner('<strong>Modo de prueba:</strong> los cambios solo se guardan en este navegador. Cuando se conecte la base de datos, todos los que tengan el enlace verán y moverán las mismas tarjetas.');
  }
  const abierto = openBoard(BOARD_ID);
  loadBoardList();
  await abierto;
  preguntarNombreSiFalta();
}

// La vista Kanban se muestra u oculta (el Gantt vive en la misma página)
export function mostrarKanban(si) {
  visible = si;
  if (si) { setUrl(); render(); if (board) document.title = (board.title || 'Tablero') + ' · Kanban'; }
}

// ---------- Lo que necesitan los enlaces con el Gantt ----------
export const kanbanApi = {
  tableroActual: () => BOARD_ID,
  redibujar: () => { if (visible && !dragging) render(); },
  async listarTableros() {
    await loadBoardList();
    return boardList.map(b => b.id === BOARD_ID && board ? { ...b, title: board.title } : b).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
  },
  async leerTablero(b) { return b === BOARD_ID && board ? board : base.readBoard(b); },
  async listarTarjetas(b) { return b === BOARD_ID && board ? [...cards.values()] : base.readCards(b); },
  async leerTarjeta(b, c) { return b === BOARD_ID && board ? (cards.get(c) || null) : base.readCard(b, c); },
  async actualizarTarjeta(b, c, patch) {
    if (b === BOARD_ID) {
      const card = cards.get(c);
      if (card) { cards.set(c, { ...card, ...patch }); render(); }
    }
    await base.updateCard(b, c, patch);
  },
  async moverTarjetaA(b, c, colId, extra = {}) {
    const [tb, card] = await Promise.all([this.leerTablero(b), this.leerTarjeta(b, c)]);
    if (!card) return;
    const all = await this.listarTarjetas(b);
    const same = all.filter(x => x.columnId === colId && x.laneId === card.laneId && x.id !== c);
    const order = same.length ? Math.max(...same.map(x => x.order ?? 0)) + 1 : 0;
    await this.actualizarTarjeta(b, c, { ...extra, ...movePatch(tb, card, colId, card.laneId), order });
  },
  async crearTarjeta(b, data) {
    const tb = await this.leerTablero(b);
    const all = await this.listarTarjetas(b);
    const same = all.filter(x => x.columnId === data.columnId && x.laneId === data.laneId);
    const card = buildCard(tb, { order: same.length ? Math.max(...same.map(x => x.order ?? 0)) + 1 : 0, ...data });
    if (b === BOARD_ID) { cards.set(card.id, card); render(); }
    await base.addCard(b, card).catch(fail);
    return card.id;
  },
  async abrirTarjeta(b, c) {
    if (b !== BOARD_ID) await openBoard(b);
    if (cards.has(c)) openCard(c);
    else toast('La tarjeta ya no existe.');
  },
};
