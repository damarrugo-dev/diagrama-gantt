// Enlaces entre tarjetas del Kanban y tareas del Gantt.
//
// Enlazar es opcional: una tarjeta puede vivir solo en el Kanban y una tarea solo en el Gantt.
// Cuando están enlazadas se mantienen iguales:
//   - el nombre de la tarea = el título de la tarjeta
//   - el % completado de la tarea ↔ el proceso (columna) de la tarjeta:
//     primera columna = 0 %, última = 100 %, las del medio = avance intermedio
// La tarjeta guarda { gantt: { proyecto, tarea, ultimo: { nombre, pct } } } y la tarea { kanban: { tablero, tarjeta } }.
// "ultimo" son los valores de la última sincronización: así se sabe cuál de las dos cambió
// (por ejemplo, si alguien movió la tarjeta sin tener acceso al proyecto, se aplica al abrir el Gantt).
import { $, h, toast } from './util.js';

let G = null; // vista Gantt (ver ganttApi en app.js)
let K = null; // vista Kanban (ver kanbanApi en kanban/kanban.js)
let mostrarVista = () => {};
export function registrar(gantt, kanban, mostrar) { G = gantt; K = kanban; mostrarVista = mostrar; }

const nuevoId = () => crypto.randomUUID();

// ---------- Columna ↔ % completado ----------
export function colPara(pct, n) {
  if (n <= 1 || pct <= 0) return 0;
  if (pct >= 100) return n - 1;
  if (n === 2) return 0;
  return Math.min(n - 2, Math.max(1, Math.round(pct / 100 * (n - 1))));
}
export function pctPara(i, n) {
  if (i <= 0 || n <= 1) return 0;
  if (i >= n - 1) return 100;
  return Math.round(i / (n - 1) * 100);
}
const indiceColumna = (card, cols) => Math.max(0, cols.findIndex(c => c.id === card.columnId));

// Los cambios de enlaces se aplican de uno en uno para que no se crucen
let cola = Promise.resolve();
const enCola = fn => (cola = cola.then(fn).catch(err => { console.error(err); toast('No se pudo sincronizar el enlace: ' + (err?.message || err)); }));

// ---------- Sincronizar una tarjeta con su tarea ----------
async function sincronizar(b, c) {
  const card = await K.leerTarjeta(b, c);
  if (!card?.gantt) return;
  const { proyecto, tarea } = card.gantt;
  let datos = null;
  try { datos = await G.leerProyecto(proyecto); } catch (err) { console.warn('Sin acceso al proyecto del Gantt', err); }
  if (!datos) return; // sin acceso al proyecto: se sincroniza cuando lo abra alguien que sí tenga acceso
  const t = datos.p.tareas.find(x => x.id === tarea);
  if (!t || t.kanban?.tarjeta !== c) { await K.actualizarTarjeta(b, c, { gantt: null }); invalidar(); return; }
  const r = datos.calc.tareas.get(tarea);
  const cols = (await K.leerTablero(b))?.columns || [];
  const n = cols.length;
  const ci = indiceColumna(card, cols);
  const u = card.gantt.ultimo || { nombre: t.nombre, pct: t.porcentaje || 0 };
  const aTarea = {}, aTarjeta = {};

  let nombre = t.nombre || '';
  const titulo = card.title || '';
  if (titulo !== nombre) {
    if (titulo !== u.nombre) { aTarea.nombre = titulo; nombre = titulo; } // cambió la tarjeta
    else aTarjeta.title = nombre || 'Sin título';                       // cambió la tarea
  }
  let pct = t.porcentaje || 0;
  let colDestino = null;
  if (n && colPara(pct, n) !== ci) {
    if (!r?.resumen && pct === u.pct) { pct = pctPara(ci, n); aTarea.porcentaje = pct; } // se movió la tarjeta
    else colDestino = cols[colPara(pct, n)].id;                                          // cambió el avance
  }
  if (Object.keys(aTarea).length) {
    await G.modificarProyecto(proyecto, p => { const x = p.tareas.find(y => y.id === tarea); if (x) Object.assign(x, aTarea); });
  }
  const ultimo = { nombre: aTarjeta.title ?? nombre, pct };
  if (!card.gantt.ultimo || u.nombre !== ultimo.nombre || u.pct !== ultimo.pct) aTarjeta.gantt = { ...card.gantt, ultimo };
  if (colDestino) await K.moverTarjetaA(b, c, colDestino, aTarjeta);
  else if (Object.keys(aTarjeta).length) await K.actualizarTarjeta(b, c, aTarjeta);
  invalidar();
}

// ---------- Avisos de cada vista ----------
// La firma de un proyecto: lo que importa de cada tarea para los enlaces
export function firma(p) {
  const m = new Map();
  for (const t of p.tareas) m.set(t.id, { nombre: t.nombre || '', pct: t.porcentaje || 0, kanban: t.kanban || null });
  return m;
}
const mismoEnlace = (a, b) => a && b && a.tablero === b.tablero && a.tarjeta === b.tarjeta;

// El Gantt cambió (editar, eliminar, deshacer…): se lleva a las tarjetas enlazadas
export function alCambiarGantt(proyecto, antes, despues) {
  const tareas = [];
  for (const id of new Set([...antes.keys(), ...despues.keys()])) {
    const a = antes.get(id), d = despues.get(id);
    if (a?.kanban && !mismoEnlace(a.kanban, d?.kanban)) tareas.push(['quitado', id, a.kanban, d]);
    if (d?.kanban && !mismoEnlace(a?.kanban, d.kanban)) tareas.push(['agregado', id, d.kanban, d]);
    else if (d?.kanban && (a.nombre !== d.nombre || a.pct !== d.pct)) tareas.push(['cambio', id, d.kanban, d]);
  }
  if (!tareas.length) return;
  invalidar();
  enCola(async () => {
    for (const [tipo, id, { tablero, tarjeta }, d] of tareas) {
      const card = await K.leerTarjeta(tablero, tarjeta);
      if (!card) continue;
      if (tipo === 'quitado') {
        if (card.gantt?.tarea === id) await K.actualizarTarjeta(tablero, tarjeta, { gantt: null });
        if (!d) toast('Se eliminó una tarea enlazada: su tarjeta sigue en el Kanban, sin enlace.');
      } else if (tipo === 'agregado') {
        // Volvió el enlace (por ejemplo, al deshacer): la tarjeta se vuelve a enlazar si está libre
        if (!card.gantt) {
          const cols = (await K.leerTablero(tablero))?.columns || [];
          await K.actualizarTarjeta(tablero, tarjeta, { gantt: { proyecto, tarea: id, ultimo: { nombre: card.title || '', pct: pctPara(indiceColumna(card, cols), cols.length) } } });
        }
        if ((await K.leerTarjeta(tablero, tarjeta))?.gantt?.tarea === id) await sincronizar(tablero, tarjeta);
      } else {
        await sincronizar(tablero, tarjeta);
      }
    }
  });
}

// Al abrir un proyecto en el Gantt se revisan todas sus tareas enlazadas
// (por si alguien movió tarjetas desde el Kanban sin tener acceso al proyecto)
export function alAbrirProyecto(p) {
  const enlazadas = p.tareas.filter(t => t.kanban).map(t => ({ id: t.id, ...t.kanban }));
  if (!enlazadas.length) return;
  enCola(async () => {
    for (const { id, tablero, tarjeta } of enlazadas) {
      const card = await K.leerTarjeta(tablero, tarjeta).catch(() => undefined);
      if (card === undefined) continue; // no se pudo leer: se deja como está
      if (!card || card.gantt?.tarea !== id) {
        // La tarjeta ya no existe o se desenlazó desde el Kanban
        await G.modificarProyecto(p.id, q => { const x = q.tareas.find(y => y.id === id); if (x && mismoEnlace(x.kanban, { tablero, tarjeta })) x.kanban = null; });
        continue;
      }
      await sincronizar(tablero, tarjeta);
    }
  });
}

// La tarjeta cambió (título, proceso o enlace)
export function alCambiarTarjeta(b, antes, despues) {
  const quitado = antes?.gantt && (!despues?.gantt || antes.gantt.tarea !== despues.gantt.tarea);
  const cambio = despues?.gantt && (antes.title !== despues.title || antes.columnId !== despues.columnId);
  if (!quitado && !cambio) return;
  invalidar();
  enCola(async () => {
    if (quitado) await quitarEnlaceDeTarea(antes.gantt, b, antes.id);
    if (cambio) await sincronizar(b, despues.id);
  });
}
export function alEliminarTarjeta(b, card) {
  if (!card?.gantt) return;
  invalidar();
  enCola(() => quitarEnlaceDeTarea(card.gantt, b, card.id));
}
async function quitarEnlaceDeTarea({ proyecto, tarea }, b, c) {
  try {
    await G.modificarProyecto(proyecto, p => {
      const t = p.tareas.find(x => x.id === tarea);
      if (t && mismoEnlace(t.kanban, { tablero: b, tarjeta: c })) t.kanban = null;
    });
  } catch (err) { console.warn('No se pudo quitar el enlace en el Gantt', err); }
}

// ---------- Crear y quitar enlaces ----------
// Desde el Kanban: tarjeta nueva enlazada a una tarea nueva o existente
export function enlazarTarjetaNueva(b, card, enlace) {
  return enCola(async () => {
    const tablero = await K.leerTablero(b);
    const cols = tablero?.columns || [];
    if (enlace.modo === 'nueva') {
      const tarea = nuevoId();
      const pct = pctPara(indiceColumna(card, cols), cols.length);
      card.gantt = { proyecto: enlace.proyecto, tarea, ultimo: { nombre: card.title, pct } };
      await K.crearTarjeta(b, card);
      await G.modificarProyecto(enlace.proyecto, p => insertarTarea(p, { id: tarea, nombre: card.title, porcentaje: pct, kanban: { tablero: b, tarjeta: card.id } }, enlace.epica));
    } else {
      // Tarea existente: su avance decide la columna de la tarjeta nueva
      const datos = await G.leerProyecto(enlace.proyecto);
      const t = datos.p.tareas.find(x => x.id === enlace.tarea);
      const pct = t.porcentaje || 0;
      if (cols.length) card.columnId = cols[colPara(pct, cols.length)].id;
      card.gantt = { proyecto: enlace.proyecto, tarea: t.id, ultimo: { nombre: t.nombre || '', pct } };
      await K.crearTarjeta(b, card);
      await G.modificarProyecto(enlace.proyecto, p => { p.tareas.find(x => x.id === t.id).kanban = { tablero: b, tarjeta: card.id }; });
      await sincronizar(b, card.id);
    }
    invalidar();
  });
}

// Desde la ventana de una tarjeta que ya existe
export function enlazarTarjeta(b, c, enlace) {
  return enCola(async () => {
    const card = await K.leerTarjeta(b, c);
    const cols = (await K.leerTablero(b))?.columns || [];
    const pctTarjeta = pctPara(indiceColumna(card, cols), cols.length);
    if (enlace.modo === 'nueva') {
      const tarea = nuevoId();
      await G.modificarProyecto(enlace.proyecto, p => insertarTarea(p, { id: tarea, nombre: card.title, porcentaje: pctTarjeta, kanban: { tablero: b, tarjeta: c } }, enlace.epica));
      await K.actualizarTarjeta(b, c, { gantt: { proyecto: enlace.proyecto, tarea, ultimo: { nombre: card.title, pct: pctTarjeta } } });
    } else {
      // Manda la tarjeta: la tarea toma su nombre y su avance
      const datos = await G.leerProyecto(enlace.proyecto);
      const t = datos.p.tareas.find(x => x.id === enlace.tarea);
      await G.modificarProyecto(enlace.proyecto, p => { p.tareas.find(x => x.id === t.id).kanban = { tablero: b, tarjeta: c }; });
      await K.actualizarTarjeta(b, c, { gantt: { proyecto: enlace.proyecto, tarea: t.id, ultimo: { nombre: t.nombre || '', pct: t.porcentaje || 0 } } });
      await sincronizar(b, c);
    }
    invalidar();
  });
}

// Desde el Gantt: la tarea se enlaza con una tarjeta nueva o existente
export function enlazarTarea(proyecto, tareaId, enlace) {
  return enCola(async () => {
    const datos = await G.leerProyecto(proyecto);
    const t = datos.p.tareas.find(x => x.id === tareaId);
    const b = enlace.tablero;
    const cols = (await K.leerTablero(b))?.columns || [];
    if (enlace.modo === 'nueva') {
      const pct = t.porcentaje || 0;
      const id = await K.crearTarjeta(b, {
        title: t.nombre || 'Sin título', columnId: cols.length ? cols[colPara(pct, cols.length)].id : undefined, laneId: enlace.carril,
        gantt: { proyecto, tarea: t.id, ultimo: { nombre: t.nombre || '', pct } },
      });
      await G.modificarProyecto(proyecto, p => { p.tareas.find(x => x.id === t.id).kanban = { tablero: b, tarjeta: id }; });
    } else {
      // Manda la tarea: la tarjeta toma su nombre y pasa a la columna de su avance
      const card = await K.leerTarjeta(b, enlace.tarjeta);
      await G.modificarProyecto(proyecto, p => { p.tareas.find(x => x.id === t.id).kanban = { tablero: b, tarjeta: card.id }; });
      await K.actualizarTarjeta(b, card.id, { gantt: { proyecto, tarea: t.id, ultimo: { nombre: card.title || '', pct: pctPara(indiceColumna(card, cols), cols.length) } } });
      await sincronizar(b, card.id);
    }
    invalidar();
  });
}

// Quita el enlace en los dos lados; la tarjeta y la tarea se conservan
export function desenlazar({ tablero, tarjeta, proyecto, tarea }) {
  return enCola(async () => {
    const card = await K.leerTarjeta(tablero, tarjeta).catch(() => null);
    if (card?.gantt?.tarea === tarea) await K.actualizarTarjeta(tablero, tarjeta, { gantt: null });
    await quitarEnlaceDeTarea({ proyecto, tarea }, tablero, tarjeta);
    invalidar();
    toast('Enlace quitado. La tarjeta y la tarea se conservan.');
  });
}

// Inserta una tarea al final de una épica (o del proyecto)
function insertarTarea(p, datos, epica) {
  const t = { nivel: 1, duracion: 1, modo: 'auto', restriccion: 'ASAP', porcentaje: 0, ...datos };
  let pos = p.tareas.length;
  const i = epica ? p.tareas.findIndex(x => x.id === epica) : -1;
  if (i >= 0) {
    t.nivel = (p.tareas[i].nivel || 1) + 1;
    pos = i + 1;
    while (pos < p.tareas.length && (p.tareas[pos].nivel || 1) > (p.tareas[i].nivel || 1)) pos++;
  }
  p.tareas.splice(pos, 0, t);
}

// ---------- Información para mostrar (con memoria) ----------
const memProyectos = new Map(); // proyecto → Promise<{p, calc} | null>
const memTarjetas = new Map();  // "tablero/tarjeta" → Promise<{card, tablero} | null>
let refrescoPendiente = false;
export function invalidar() {
  memProyectos.clear();
  memTarjetas.clear();
  if (refrescoPendiente) return;
  refrescoPendiente = true;
  setTimeout(() => { refrescoPendiente = false; G?.redibujar(); K?.redibujar(); }, 50);
}
function proyectoEnMemoria(id) {
  if (!memProyectos.has(id)) memProyectos.set(id, G.leerProyecto(id).catch(() => null));
  return memProyectos.get(id);
}
function tarjetaEnMemoria(b, c) {
  const k = b + '/' + c;
  if (!memTarjetas.has(k)) memTarjetas.set(k, Promise.all([K.leerTarjeta(b, c), K.leerTablero(b)]).then(([card, tablero]) => card ? { card, tablero } : null).catch(() => null));
  return memTarjetas.get(k);
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtFecha = iso => iso ? `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1]}` : '';

// Etiqueta "▤ Proyecto · Id 5 · 12 oct → 20 oct" para la tarjeta del Kanban
export function etiquetaTarea(gantt, conBotones = false) {
  const el = h('div', { class: 'gantt-chip', title: 'Enlazada con una tarea del Gantt' }, h('span', { class: 'gantt-icono' }, '▤'), h('span', {}, 'Gantt…'));
  proyectoEnMemoria(gantt.proyecto).then(datos => {
    const t = datos?.p.tareas.find(x => x.id === gantt.tarea);
    const r = t && datos.calc.tareas.get(t.id);
    el.replaceChildren(h('span', { class: 'gantt-icono' }, '▤'),
      !datos ? h('span', {}, 'Gantt (proyecto sin acceso)')
        : !t ? h('span', {}, 'Gantt (tarea eliminada)')
          : h('span', {}, `${datos.p.nombre} · Id ${r.fila + 1} · ${r.hito ? fmtFecha(r.comienzo) : `${fmtFecha(r.comienzo)} → ${fmtFecha(r.fin)}`}`));
    if (conBotones && t) el.title = `${t.nombre}\n${t.porcentaje || 0} % completado`;
  });
  return el;
}

// Etiqueta "▥ En proceso" para la columna Kanban del Gantt (síncrona: usa lo que ya está en memoria)
const etiquetasTarjeta = new Map();
export function textoTarjeta(kanban) {
  const k = kanban.tablero + '/' + kanban.tarjeta;
  if (!memTarjetas.has(k)) {
    tarjetaEnMemoria(kanban.tablero, kanban.tarjeta).then(info => {
      const col = info?.tablero?.columns?.find(c => c.id === info.card.columnId) || info?.tablero?.columns?.[0];
      const nuevo = info ? { texto: col?.name || 'Kanban', titulo: `${info.tablero?.title || kanban.tablero} · ${col?.name || ''}\n${info.card.title}` } : { texto: 'sin tarjeta', titulo: 'La tarjeta ya no existe' };
      const viejo = etiquetasTarjeta.get(k);
      etiquetasTarjeta.set(k, nuevo);
      if (!viejo || viejo.texto !== nuevo.texto) G?.redibujar();
    });
  }
  return etiquetasTarjeta.get(k) || { texto: '…', titulo: 'Kanban' };
}

// ---------- Ir de una vista a la otra ----------
export async function abrirTarea({ proyecto, tarea }) {
  mostrarVista('gantt');
  await G.abrirTarea(proyecto, tarea);
}
export async function abrirTarjeta({ tablero, tarjeta }) {
  mostrarVista('kanban');
  await K.abrirTarjeta(tablero, tarjeta);
}

// ---------- Ventanas para elegir ----------
function ventana(titulo, contenido, textoOk = 'Aceptar') {
  return new Promise(resolve => {
    const d = $('#enlaceDialog');
    const form = h('form', { method: 'dialog' }, h('h2', {}, titulo), contenido,
      h('div', { class: 'ask-actions' },
        h('button', { value: 'cancel', formnovalidate: true, class: 'btn' }, 'Cancelar'),
        h('button', { value: 'ok', class: 'btn primary' }, textoOk)));
    d.replaceChildren(form);
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
    form.querySelector('input:not([type=radio]), select')?.focus();
  });
}
const campo = (etiqueta, control, extra = {}) => h('label', { class: 'field', ...extra }, h('span', {}, etiqueta), control);
const opcion = (nombre, valor, texto, marcado) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: nombre, value: valor, checked: marcado }), texto);

// Partes para elegir proyecto → épica o tarea del Gantt
async function selectorGantt({ conNinguno, inicial = conNinguno ? 'no' : 'nueva', alElegirTarea }) {
  const proyectos = await G.listarProyectos();
  const modo = h('div', { class: 'radios' },
    conNinguno ? opcion('modoGantt', 'no', 'Solo en el Kanban', inicial === 'no') : null,
    opcion('modoGantt', 'nueva', 'Crear también la tarea en el Gantt', inicial === 'nueva'),
    opcion('modoGantt', 'existente', 'Enlazar con una tarea que ya existe', inicial === 'existente'));
  const selProyecto = h('select', { required: true }, proyectos.map(p => h('option', { value: p.id }, p.nombre)));
  const selEpica = h('select', {});
  const selTarea = h('select', {});
  const fProyecto = campo('Proyecto del Gantt', selProyecto);
  const fEpica = campo('Dentro de la épica', selEpica);
  const fTarea = campo('Tarea', selTarea);
  const valorModo = () => modo.querySelector('input:checked')?.value || 'no';
  const llenar = async () => {
    const datos = await G.leerProyecto(selProyecto.value).catch(() => null);
    const tareas = datos?.p.tareas || [];
    const R = id => datos.calc.tareas.get(id);
    selEpica.replaceChildren(h('option', { value: '' }, 'Sin épica (al final del proyecto)'),
      ...tareas.filter(t => R(t.id).resumen).map(t => h('option', { value: t.id }, `${'— '.repeat(R(t.id).nivel - 1)}${t.nombre || '(sin nombre)'}`)));
    const libres = tareas.filter(t => !R(t.id).resumen && !t.kanban);
    selTarea.replaceChildren(...(libres.length
      ? libres.map(t => h('option', { value: t.id }, `${R(t.id).fila + 1} · ${t.nombre || '(sin nombre)'}`))
      : [h('option', { value: '' }, 'No hay tareas libres en este proyecto')]));
    if (valorModo() === 'existente') alElegirTarea?.(tareas.find(t => t.id === selTarea.value));
  };
  const actualizar = () => {
    const m = valorModo();
    if (m === 'existente') selTarea.dispatchEvent(new Event('change'));
    fProyecto.hidden = m === 'no';
    fEpica.hidden = m !== 'nueva';
    fTarea.hidden = m !== 'existente';
    selTarea.required = m === 'existente';
  };
  modo.addEventListener('change', actualizar);
  selProyecto.addEventListener('change', llenar);
  selTarea.addEventListener('change', async () => {
    const datos = await G.leerProyecto(selProyecto.value).catch(() => null);
    alElegirTarea?.(datos?.p.tareas.find(t => t.id === selTarea.value));
  });
  if (!proyectos.length) modo.querySelectorAll('input:not([value=no])').forEach(i => (i.disabled = true));
  await llenar();
  actualizar();
  return {
    partes: [h('div', { class: 'field' }, h('span', {}, 'Gantt'), modo), fProyecto, fEpica, fTarea],
    valor: () => {
      const m = valorModo();
      if (m === 'no' || !selProyecto.value) return null;
      if (m === 'existente' && !selTarea.value) return null;
      return m === 'nueva' ? { modo: 'nueva', proyecto: selProyecto.value, epica: selEpica.value || null } : { modo: 'existente', proyecto: selProyecto.value, tarea: selTarea.value };
    },
  };
}

// Tarjeta nueva: título y si se enlaza con el Gantt
export async function dialogoNuevaTarjeta(lugar) {
  const titulo = h('input', { required: true, maxlength: 150, placeholder: 'Título de la tarjeta', autocomplete: 'off' });
  let tocado = false;
  titulo.addEventListener('input', () => (tocado = !!titulo.value));
  const sel = await selectorGantt({ conNinguno: true, alElegirTarea: t => { if (t && !tocado) titulo.value = t.nombre || ''; } });
  const ok = await ventana('Nueva tarjeta', [h('p', { class: 'hint' }, lugar), campo('Título', titulo), ...sel.partes], 'Crear');
  if (!ok || !titulo.value.trim()) return null;
  return { title: titulo.value.trim(), enlace: sel.valor() };
}

// Enlazar una tarjeta que ya existe
export async function dialogoEnlazarTarjeta(b, card) {
  const sel = await selectorGantt({ conNinguno: false });
  const ok = await ventana('Enlazar con el Gantt', [
    h('p', { class: 'hint' }, 'Si eliges una tarea que ya existe, la tarea toma el nombre y el avance de esta tarjeta.'), ...sel.partes], 'Enlazar');
  const enlace = ok && sel.valor();
  if (enlace) await enlazarTarjeta(b, card.id, enlace);
}

// Enlazar una tarea del Gantt con el Kanban
export async function dialogoEnlazarTarea(proyecto, tarea) {
  const tableros = await K.listarTableros();
  const modo = h('div', { class: 'radios' },
    opcion('modoKanban', 'nueva', 'Crear una tarjeta nueva', true),
    opcion('modoKanban', 'existente', 'Enlazar con una tarjeta que ya existe', false));
  const selTablero = h('select', { required: true }, tableros.map(t => h('option', { value: t.id, selected: t.id === K.tableroActual() }, t.title)));
  const selCarril = h('select', {});
  const selTarjeta = h('select', {});
  const fCarril = campo('Carril', selCarril);
  const fTarjeta = campo('Tarjeta', selTarjeta);
  const valorModo = () => modo.querySelector('input:checked').value;
  const llenar = async () => {
    const [tablero, tarjetas] = await Promise.all([K.leerTablero(selTablero.value), K.listarTarjetas(selTablero.value)]);
    selCarril.replaceChildren(...(tablero?.lanes || []).map(l => h('option', { value: l.id }, l.name)));
    const col = id => tablero?.columns?.find(c => c.id === id)?.name || '';
    const libres = tarjetas.filter(c => !c.gantt).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
    selTarjeta.replaceChildren(...(libres.length
      ? libres.map(c => h('option', { value: c.id }, `${c.title || 'Sin título'} (${col(c.columnId)})`))
      : [h('option', { value: '' }, 'No hay tarjetas libres en este tablero')]));
  };
  const actualizar = () => {
    fCarril.hidden = valorModo() !== 'nueva';
    fTarjeta.hidden = valorModo() !== 'existente';
    selTarjeta.required = valorModo() === 'existente';
  };
  modo.addEventListener('change', actualizar);
  selTablero.addEventListener('change', llenar);
  await llenar();
  actualizar();
  const ok = await ventana('Enlazar con el Kanban', [
    h('p', { class: 'hint' }, 'La tarjeta toma el nombre de la tarea y queda en la columna que corresponde a su % completado.'),
    h('div', { class: 'field' }, h('span', {}, 'Tarjeta'), modo), campo('Tablero', selTablero), fCarril, fTarjeta], 'Enlazar');
  if (!ok) return;
  if (valorModo() === 'existente' && !selTarjeta.value) return;
  await enlazarTarea(proyecto, tarea, valorModo() === 'nueva'
    ? { modo: 'nueva', tablero: selTablero.value, carril: selCarril.value }
    : { modo: 'existente', tablero: selTablero.value, tarjeta: selTarjeta.value });
}
