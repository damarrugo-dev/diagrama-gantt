import { programar, parsePredecesoras, textoPredecesoras, ancestros, RESTRICCIONES, NOMBRE_VINCULO, TIPOS_VINCULO } from './programador.js';
import { parseISO, addDaysISO, toISO } from './calendario.js';
import { AlmacenLocal, AlmacenFirebase, nuevoId, proyectoVacio } from './almacen.js';
import { showMenu, confirmDlg } from './util.js';
import * as enlaces from './enlaces.js';

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const DAY = 86400000;
const FILA = 28;          // alto de cada fila (tabla y gráfico)
const ENCABEZADO = 48;    // alto del encabezado (dos niveles)

// Crea un elemento: h('div', {class: 'x', onclick: fn}, 'texto', otroElemento)
function h(tag, attrs = {}, ...children) {
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
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtCorta = iso => new Date(parseISO(iso)).toLocaleDateString('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtFechaLarga = iso => new Date(parseISO(iso)).toLocaleDateString('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtDur = (d, hito) => (hito ? '0 días' : `${+d.toFixed(2)} día${d === 1 ? '' : 's'}`);
const fmtHoras = hrs => `${+hrs.toFixed(1)} h`;
// "5", "5d", "2 sem", "16h" → días laborables
function parseDuracion(texto) {
  const m = String(texto).trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(d|días?|dias?|s|sem|semanas?|h|hrs?|horas?|m|mes|meses)?\??$/);
  if (!m) return null;
  const n = +m[1], u = (m[2] || 'd')[0];
  if (u === 's') return Math.round(n * 5);
  if (u === 'h') return Math.ceil(n / (estado.proyecto.horasDia || 8));
  if (u === 'm') return Math.round(n * 20);
  return Math.round(n);
}
function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = h('a', { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Estado ----------
const prefs = (() => { try { return JSON.parse(localStorage.getItem('gantt:prefs')) || {}; } catch { return {}; } })();
const guardarPrefs = () => localStorage.setItem('gantt:prefs', JSON.stringify(prefs));

const estado = {
  almacen: null,
  proyecto: null,
  calc: null,
  sel: new Set(),
  ancla: null,
  plegadas: new Set(),
  zoom: prefs.zoom || 'semanas',
  verCritica: prefs.verCritica ?? true,
  verLineaBase: prefs.verLineaBase ?? true,
  nivelEsquema: '',
  filtro: '',
  deshacer: [],
  rehacer: [],
};

const ESCALAS = {
  dias: { dw: 26 },
  semanas: { dw: 9 },
  meses: { dw: 2.6 },
  trimestres: { dw: 1 },
};

// ---------- Guardado ----------
let temporizador = null;
let guardando = Promise.resolve();
let guardandoAhora = 0;
function guardarPronto() {
  ponerEstado('Cambios sin guardar…');
  clearTimeout(temporizador);
  temporizador = setTimeout(guardarYa, 700);
}
function guardarYa() {
  clearTimeout(temporizador);
  temporizador = null;
  const copia = structuredClone(estado.proyecto);
  guardandoAhora++;
  guardando = guardando.then(async () => {
    ponerEstado('Guardando…');
    try {
      await estado.almacen.guardar(copia);
      ponerEstado(estado.almacen.modo === 'local' ? 'Guardado en este navegador' : 'Guardado');
    } catch (e) {
      ponerEstado('No se pudo guardar: ' + e.message, true);
    } finally { guardandoAhora--; }
  });
  return guardando;
}
window.addEventListener('beforeunload', e => {
  if (temporizador && $('#estadoGuardado').textContent.startsWith('Cambios')) { guardarYa(); e.preventDefault(); }
});
function ponerEstado(texto, error = false) {
  const el = $('#estadoGuardado');
  el.textContent = texto;
  el.classList.toggle('error', error);
}
let avisoTimer;
function aviso(texto, error = false) {
  const el = $('#pie .aviso') || $('#pie').appendChild(h('span', { class: 'aviso' }));
  el.textContent = texto;
  el.classList.toggle('error', error);
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.textContent = ''), 6000);
}

// ---------- Cambios con deshacer ----------
const instantanea = () => JSON.stringify(estado.proyecto);
// sinEnlaces: el cambio viene del Kanban, así que no se le devuelve
function cambiar(fn, { sinEnlaces = false } = {}) {
  const antes = instantanea();
  const firmaAntes = enlaces.firma(estado.proyecto);
  const r = fn(estado.proyecto);
  if (instantanea() === antes) { render(); return r; }
  estado.deshacer.push(antes);
  if (estado.deshacer.length > 100) estado.deshacer.shift();
  estado.rehacer = [];
  recalcular();
  render();
  guardarPronto();
  if (!sinEnlaces) enlaces.alCambiarGantt(estado.proyecto.id, firmaAntes, enlaces.firma(estado.proyecto));
  return r;
}
function deshacer() {
  if (!estado.deshacer.length) return aviso('No hay nada que deshacer.');
  const firmaAntes = enlaces.firma(estado.proyecto);
  estado.rehacer.push(instantanea());
  estado.proyecto = JSON.parse(estado.deshacer.pop());
  recalcular(); render(); guardarPronto();
  enlaces.alCambiarGantt(estado.proyecto.id, firmaAntes, enlaces.firma(estado.proyecto));
}
function rehacer() {
  if (!estado.rehacer.length) return aviso('No hay nada que rehacer.');
  const firmaAntes = enlaces.firma(estado.proyecto);
  estado.deshacer.push(instantanea());
  estado.proyecto = JSON.parse(estado.rehacer.pop());
  recalcular(); render(); guardarPronto();
  enlaces.alCambiarGantt(estado.proyecto.id, firmaAntes, enlaces.firma(estado.proyecto));
}

function recalcular() {
  estado.calc = programar(estado.proyecto);
  for (const id of [...estado.sel]) if (!estado.calc.tareas.has(id)) estado.sel.delete(id);
}
const R = id => estado.calc.tareas.get(id);
const T = id => estado.proyecto.tareas.find(t => t.id === id);
const numeroFila = id => (R(id) ? R(id).fila + 1 : null);

// Tareas visibles (respeta resúmenes plegados, nivel de esquema y filtro)
function filasVisibles() {
  const out = [];
  const filtro = estado.filtro.trim().toLowerCase();
  const nivelMax = +estado.nivelEsquema || 99;
  for (const t of estado.proyecto.tareas) {
    const r = R(t.id);
    if (r.nivel > nivelMax) continue;
    if (ancestros(estado.calc.info, t.id).some(a => estado.plegadas.has(a))) continue;
    if (filtro && !t.nombre.toLowerCase().includes(filtro)) continue;
    out.push(t);
  }
  return out;
}
// Una tarea más todas sus subtareas (índices en el arreglo)
function bloque(id) {
  const tareas = estado.proyecto.tareas;
  const i = tareas.findIndex(t => t.id === id);
  let j = i + 1;
  while (j < tareas.length && tareas[j].nivel > tareas[i].nivel) j++;
  return [i, j];
}
function seleccionOrdenada() {
  return estado.proyecto.tareas.filter(t => estado.sel.has(t.id)).map(t => t.id);
}

// ---------- Acciones ----------
function nuevaTareaObj(extra = {}) {
  return { id: nuevoId(), nombre: '', nivel: 1, duracion: 1, modo: 'auto', restriccion: 'ASAP', porcentaje: 0, ...extra };
}
function insertar(extra) {
  const id = cambiar(p => {
    const [primera] = seleccionOrdenada();
    const t = nuevaTareaObj(extra);
    if (primera) {
      const i = p.tareas.findIndex(x => x.id === primera);
      t.nivel = p.tareas[i].nivel;
      p.tareas.splice(i, 0, t);
    } else {
      t.nivel = p.tareas.length ? p.tareas[p.tareas.length - 1].nivel : 1;
      p.tareas.push(t);
    }
    return t.id;
  });
  estado.sel = new Set([id]);
  render();
  enfocar(id, 'nombre');
}
// Una épica nueva siempre queda en el nivel principal: no tiene que estar dentro de otra épica.
// Si hay tareas seleccionadas, pasan a ser sus tareas (como en Project). Si estaban dentro de
// otra épica, la nueva se pone justo después de esa épica. Para anidarla, usa sangría o "Mover a épica".
function insertarResumen() {
  const ids = seleccionOrdenada();
  let nueva;
  cambiar(p => {
    nueva = nuevaTareaObj({ nombre: 'Nueva épica', nivel: 1 });
    if (!ids.length) { p.tareas.push(nueva); return; }
    const i = p.tareas.findIndex(x => x.id === ids[0]);
    if (p.tareas[i].nivel === 1) {
      // Tareas del nivel principal: la épica se inserta encima y las agrupa
      const [, fin] = bloque(ids[ids.length - 1]);
      for (let k = i; k < fin; k++) p.tareas[k].nivel++;
      p.tareas.splice(i, 0, nueva);
      return;
    }
    // Dentro de otra épica: la nueva va después de la épica principal que las contiene
    let raiz = i;
    while (p.tareas[raiz].nivel > 1) raiz--;
    let pos = raiz + 1;
    while (pos < p.tareas.length && p.tareas[pos].nivel > 1) pos++;
    p.tareas.splice(pos, 0, nueva);
    moverAEpica(p, ids, nueva.id);
  });
  estado.sel = new Set([nueva.id]);
  render();
  enfocar(nueva.id, 'nombre');
}
function cambiarNivel(delta) {
  const ids = seleccionOrdenada();
  if (!ids.length) return aviso('Selecciona una o varias tareas.');
  cambiar(p => {
    const hechos = new Set();
    for (const id of ids) {
      if (hechos.has(id)) continue;
      const [i, j] = bloque(id);
      const t = p.tareas[i];
      if (delta > 0 && (i === 0 || p.tareas[i - 1].nivel < t.nivel)) continue;
      if (delta < 0 && t.nivel <= 1) continue;
      for (let k = i; k < j; k++) { p.tareas[k].nivel += delta; hechos.add(p.tareas[k].id); }
    }
  });
}
// Pasa tareas (con sus subtareas) al final de otra épica; destino null = sin épica
function moverAEpica(p, ids, destino) {
  const bloques = [];
  for (const id of ids) {
    if (bloques.some(b => b.some(t => t.id === id))) continue;
    const [i, j] = bloque(id);
    bloques.push(p.tareas.slice(i, j));
  }
  const mover = new Set(bloques.flat().map(t => t.id));
  if (destino && mover.has(destino)) return false;
  p.tareas = p.tareas.filter(t => !mover.has(t.id));
  const nivelDestino = destino ? p.tareas.find(t => t.id === destino).nivel + 1 : 1;
  let pos = p.tareas.length;
  if (destino) {
    const i = p.tareas.findIndex(t => t.id === destino);
    pos = i + 1;
    while (pos < p.tareas.length && p.tareas[pos].nivel > p.tareas[i].nivel) pos++;
  }
  const nuevas = bloques.flatMap(b => { const delta = nivelDestino - b[0].nivel; return b.map(t => ({ ...t, nivel: t.nivel + delta })); });
  p.tareas.splice(pos, 0, ...nuevas);
  return true;
}
const epicasDisponibles = excluir => estado.proyecto.tareas.filter(t => R(t.id).resumen && !excluir.has(t.id));
const nombreEpica = t => `${'— '.repeat(R(t.id).nivel - 1)}${t.nombre || '(sin nombre)'}`;

function dialogoMoverAEpica() {
  const ids = seleccionOrdenada();
  if (!ids.length) return aviso('Selecciona las tareas que quieres mover (clic en su Id).');
  const excluir = new Set();
  for (const id of ids) { const [i, j] = bloque(id); estado.proyecto.tareas.slice(i, j).forEach(t => excluir.add(t.id)); }
  const sel = h('select', {}, h('option', { value: '' }, 'Sin épica (nivel principal)'),
    epicasDisponibles(excluir).map(t => h('option', { value: t.id }, nombreEpica(t))));
  const dlg = abrirDialogo('Mover a épica', [h('p', {}, `${ids.length === 1 ? 'La tarea seleccionada pasa' : `Las ${ids.length} tareas seleccionadas pasan`} al final de la épica que elijas. Sus vínculos se conservan.`), campo('Épica de destino', sel)], [
    h('button', { type: 'button', class: 'primario', onclick: () => {
      dlg.close();
      cambiar(p => moverAEpica(p, ids, sel.value || null));
      if (sel.value) { estado.plegadas.delete(sel.value); render(); }
    } }, 'Mover'),
    h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
  ]);
}

function mover(dir) {
  const [id] = seleccionOrdenada();
  if (!id) return aviso('Selecciona una tarea.');
  cambiar(p => {
    const [i, j] = bloque(id);
    const nivel = p.tareas[i].nivel;
    if (dir < 0) {
      let k = i - 1;
      while (k >= 0 && p.tareas[k].nivel > nivel) k--;
      if (k < 0 || p.tareas[k].nivel < nivel) return;
      p.tareas.splice(k, 0, ...p.tareas.splice(i, j - i));
    } else {
      if (j >= p.tareas.length || p.tareas[j].nivel < nivel) return;
      const [, j2] = bloque(p.tareas[j].id);
      const sig = p.tareas.splice(j, j2 - j);
      p.tareas.splice(i, 0, ...sig);
    }
  });
}
function eliminar() {
  const ids = seleccionOrdenada();
  if (!ids.length) return aviso('Selecciona las tareas que quieres eliminar.');
  cambiar(p => {
    const borrar = new Set();
    for (const id of ids) { const [i, j] = bloque(id); for (let k = i; k < j; k++) borrar.add(p.tareas[k].id); }
    p.tareas = p.tareas.filter(t => !borrar.has(t.id));
    p.dependencias = p.dependencias.filter(d => !borrar.has(d.pred) && !borrar.has(d.succ));
    p.asignaciones = p.asignaciones.filter(a => !borrar.has(a.tarea));
  });
  estado.sel.clear();
  render();
}
function vincular() {
  const ids = seleccionOrdenada();
  if (ids.length < 2) return aviso('Selecciona dos o más tareas (Ctrl+clic en el Id) para vincularlas.');
  cambiar(p => {
    for (let k = 1; k < ids.length; k++) agregarVinculo(p, ids[k - 1], ids[k], 'FS', 0);
  });
}
function agregarVinculo(p, pred, succ, tipo = 'FS', retraso = 0) {
  if (pred === succ) return false;
  const info = estado.calc.info;
  if (ancestros(info, succ).includes(pred) || ancestros(info, pred).includes(succ)) {
    aviso('No se puede vincular una tarea con su propia épica.', true);
    return false;
  }
  if (p.dependencias.some(d => d.pred === pred && d.succ === succ)) return false;
  if (creaCiclo(p, pred, succ)) {
    aviso(`No se vinculó: la tarea ${numeroFila(pred)} ya depende de la tarea ${numeroFila(succ)} y quedaría en círculo.`, true);
    return false;
  }
  p.dependencias.push({ id: nuevoId(), pred, succ, tipo, retraso });
  return true;
}
// ¿Vincular pred → succ haría un círculo? (succ ya lleva, directa o indirectamente, a pred)
function creaCiclo(p, pred, succ) {
  const info = estado.calc.info;
  const conHijos = id => {
    const out = [id];
    for (let i = 0; i < out.length; i++) out.push(...(info.get(out[i])?.hijos || []));
    return out;
  };
  const visto = new Set();
  const pila = conHijos(succ);
  while (pila.length) {
    const n = pila.pop();
    if (visto.has(n)) continue;
    visto.add(n);
    if (n === pred || conHijos(pred).includes(n)) return true;
    const fuentes = [n, ...ancestros(info, n)];
    for (const d of p.dependencias) if (fuentes.includes(d.pred)) pila.push(...conHijos(d.succ));
  }
  return false;
}

function desvincular() {
  const ids = new Set(seleccionOrdenada());
  if (!ids.size) return aviso('Selecciona tareas para desvincular.');
  cambiar(p => {
    p.dependencias = p.dependencias.filter(d => ids.size === 1
      ? !(ids.has(d.pred) || ids.has(d.succ))
      : !(ids.has(d.pred) && ids.has(d.succ)));
  });
}
function establecerLineaBase() {
  const sel = seleccionOrdenada();
  dialogoConfirmar(
    'Establecer línea base',
    'Guarda las fechas y duraciones actuales para compararlos después (barras grises bajo cada tarea).',
    [['Todo el proyecto', () => guardarLB(null)], sel.length ? ['Solo tareas seleccionadas', () => guardarLB(new Set(sel))] : null,
      ['Borrar línea base', () => cambiar(p => p.tareas.forEach(t => { t.lbComienzo = t.lbFin = t.lbDuracion = null; }))]].filter(Boolean),
  );
  function guardarLB(solo) {
    cambiar(p => {
      for (const t of p.tareas) {
        if (solo && !solo.has(t.id)) continue;
        const r = R(t.id);
        Object.assign(t, { lbComienzo: r.comienzo, lbFin: r.fin, lbDuracion: r.e - r.s });
      }
    });
    aviso('Línea base guardada.');
  }
}
function exportarCSV() {
  const p = estado.proyecto;
  const filas = [['Id', 'EDT', 'Nombre', 'Nivel', 'Duración (días)', 'Comienzo', 'Fin', 'Predecesoras', 'Recursos', '% completado', 'Trabajo (h)', 'Margen total (días)', 'Crítica', 'Comienzo previsto', 'Fin previsto']];
  for (const t of p.tareas) {
    const r = R(t.id);
    filas.push([r.fila + 1, r.edt, t.nombre, r.nivel, r.e - r.s, r.comienzo, r.fin, predecesorasDe(t.id), recursosDe(t.id), t.porcentaje || 0,
      +r.trabajo.toFixed(2), r.holgura, r.critica ? 'Sí' : 'No', t.lbComienzo || '', t.lbFin || '']);
  }
  const csv = filas.map(f => f.map(v => /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(';')).join('\r\n');
  descargar(`${p.nombre}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

const predecesorasDe = id => textoPredecesoras(estado.proyecto.dependencias.filter(d => d.succ === id), numeroFila);
function recursosDe(id) {
  const recs = new Map(estado.proyecto.recursos.map(r => [r.id, r]));
  return estado.proyecto.asignaciones.filter(a => a.tarea === id && recs.has(a.recurso))
    .map(a => recs.get(a.recurso).nombre + ((a.unidades ?? 1) !== 1 ? `[${Math.round((a.unidades ?? 1) * 100)}%]` : ''))
    .join('; ');
}

// ---------- Edición de celdas ----------
function confirmarCelda(id, col, valor) {
  const t = T(id), r = R(id);
  if (!t) return;
  const p = estado.proyecto;
  switch (col) {
    case 'nombre':
      cambiar(() => { t.nombre = valor.trim(); });
      break;
    case 'duracion': {
      const d = parseDuracion(valor);
      if (d == null) { aviso('Duración no válida. Ejemplos: 5, 3d, 2sem, 16h.', true); return render(); }
      cambiar(() => { t.duracion = d; });
      break;
    }
    case 'comienzo':
      if (!valor) return render();
      cambiar(() => {
        if (t.modo === 'manual') t.comienzoManual = valor;
        else { t.restriccion = 'SNET'; t.fechaRestriccion = valor; }
      });
      if (t.modo !== 'manual') aviso('Se aplicó la restricción "No comenzar antes del" ' + fmtFechaLarga(valor) + '.');
      break;
    case 'fin': {
      if (!valor) return render();
      if (r.hito) return confirmarCelda(id, 'comienzo', valor);
      const d = estado.calc.cal.indice(valor) - r.s + 1;
      cambiar(() => { t.duracion = Math.max(1, d); });
      break;
    }
    case 'pred': {
      const lista = parsePredecesoras(nombresAIds(valor));
      if (!lista) { aviso('Escribe el Id de la tarea predecesora (el número de la columna Id), por ejemplo 3 o 3;5. También puedes elegirla de la lista.', true); return render(); }
      cambiar(() => {
        p.dependencias = p.dependencias.filter(d => d.succ !== id);
        for (const x of lista) {
          const pred = p.tareas[x.fila - 1];
          if (!pred) { aviso(`No existe la tarea ${x.fila}.`, true); continue; }
          agregarVinculo(p, pred.id, id, x.tipo, x.retraso);
        }
      });
      break;
    }
    case 'recursos':
      cambiar(() => asignarDesdeTexto(id, valor));
      break;
    case 'pct': {
      const n = Math.max(0, Math.min(100, Math.round(+String(valor).replace('%', '') || 0)));
      cambiar(() => { t.porcentaje = n; });
      break;
    }
    case 'modo':
      cambiar(() => {
        t.modo = valor;
        if (valor === 'manual') t.comienzoManual = r.comienzo;
      });
      break;
  }
}
// Permite escribir el nombre de la tarea en lugar de su Id: "Etapa 1;3" → "6;3"
function nombresAIds(texto) {
  return String(texto || '').split(/[;,]/).map(parte => {
    const x = parte.trim();
    if (!x || /^\d/.test(x)) return x;
    const i = estado.proyecto.tareas.findIndex(t => t.nombre.trim().toLowerCase() === x.toLowerCase());
    return i >= 0 ? String(i + 1) : x;
  }).filter(Boolean).join(';');
}

// Lista desplegable para elegir la tarea predecesora (como en Project)
function selectorPredecesoras(input, id) {
  let lista = null;
  const cerrar = () => { lista?.remove(); lista = null; };
  const mostrar = e => {
    cerrar();
    const partes = input.value.split(';');
    // Al entrar en la celda se muestran todas; al escribir, se filtra por lo último escrito
    const busca = e.type === 'input' ? partes[partes.length - 1].trim().toLowerCase() : '';
    if (e.type !== 'input' && partes[partes.length - 1].trim()) partes.push('');
    const yaEstan = new Set(estado.proyecto.dependencias.filter(d => d.succ === id).map(d => d.pred));
    const info = estado.calc.info;
    const opciones = estado.proyecto.tareas.filter(t => t.id !== id && !yaEstan.has(t.id)
      && !ancestros(info, id).includes(t.id) && !ancestros(info, t.id).includes(id)
      && !creaCiclo(estado.proyecto, t.id, id)
      && (!busca || String(numeroFila(t.id)).startsWith(busca) || t.nombre.toLowerCase().includes(busca)));
    if (!opciones.length) return;
    const caja = input.getBoundingClientRect();
    lista = h('div', { class: 'lista-pred', style: `left:${caja.left}px;top:${caja.bottom + 2}px` },
      opciones.slice(0, 60).map(t => h('div', {
        class: 'opcion' + (R(t.id).resumen ? ' resumen' : ''),
        onmousedown: e => {
          e.preventDefault();
          partes[partes.length - 1] = String(numeroFila(t.id));
          const valor = partes.map(x => x.trim()).filter(Boolean).join(';');
          cerrar();
          input.value = input.defaultValue = valor;
          confirmarCelda(id, 'pred', valor);
        },
      }, h('b', {}, numeroFila(t.id)), ' ', t.nombre || '(sin nombre)')));
    document.body.append(lista);
  };
  input.addEventListener('focus', mostrar);
  input.addEventListener('input', mostrar);
  input.addEventListener('blur', cerrar);
  return input;
}

function asignarDesdeTexto(tareaId, texto) {
  const p = estado.proyecto;
  p.asignaciones = p.asignaciones.filter(a => a.tarea !== tareaId);
  for (const parte of texto.split(/[;,]/)) {
    const m = parte.trim().match(/^(.+?)\s*(?:\[\s*(\d+(?:[.,]\d+)?)\s*%?\s*\])?$/);
    if (!m) continue;
    const nombre = m[1].trim();
    let rec = p.recursos.find(r => r.nombre.toLowerCase() === nombre.toLowerCase());
    if (!rec) {
      rec = { id: nuevoId(), nombre, iniciales: nombre.split(/\s+/).map(x => x[0]).join('').slice(0, 3).toUpperCase(), tipo: 'trabajo', maxUnidades: 1 };
      p.recursos.push(rec);
    }
    const unidades = m[2] ? +m[2].replace(',', '.') / 100 : 1;
    p.asignaciones.push({ id: nuevoId(), tarea: tareaId, recurso: rec.id, unidades });
  }
}

let pendienteFoco = null;
function enfocar(id, col) { pendienteFoco = { id, col }; aplicarFoco(); }
function aplicarFoco() {
  if (!pendienteFoco) return;
  const el = document.querySelector(`[data-celda="${pendienteFoco.id}:${pendienteFoco.col}"]`);
  if (el) { el.focus(); el.select?.(); }
  pendienteFoco = null;
}

// ---------- Tabla ----------
const COLUMNAS = [
  { k: 'ind', t: '', w: 30 },
  { k: 'id', t: 'Id', w: 38 },
  { k: 'modo', t: 'Modo', w: 54 },
  { k: 'nombre', t: 'Nombre de tarea', w: 250 },
  { k: 'duracion', t: 'Duración', w: 78 },
  { k: 'comienzo', t: 'Comienzo', w: 122 },
  { k: 'fin', t: 'Fin', w: 122 },
  { k: 'pred', t: 'Predecesoras', w: 104 },
  { k: 'recursos', t: 'Nombres de los recursos', w: 170 },
  { k: 'pct', t: '% compl.', w: 64 },
  { k: 'kanban', t: 'Kanban', w: 104 },
  { k: 'trabajo', t: 'Trabajo', w: 72 },
  { k: 'holgura', t: 'Margen total', w: 84 },
];
// Ancho de cada columna: el que dejó la persona arrastrando el borde del encabezado (se guarda en este navegador)
const anchoColumna = c => prefs.anchos?.[c.k] || c.w;
const aplicarAnchos = () => $('#panelTabla').style.setProperty('--columnas', COLUMNAS.map(c => anchoColumna(c) + 'px').join(' '));

function redimensionarColumna(e, c) {
  e.preventDefault(); e.stopPropagation();
  const x0 = e.clientX, w0 = anchoColumna(c);
  document.body.classList.add('redimensionando');
  const mover = ev => { (prefs.anchos ||= {})[c.k] = Math.max(28, Math.min(800, Math.round(w0 + ev.clientX - x0))); aplicarAnchos(); };
  const fin = () => {
    window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', fin);
    document.body.classList.remove('redimensionando'); guardarPrefs();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', fin);
}
function anchoOriginal(c) {
  if (prefs.anchos) delete prefs.anchos[c.k];
  guardarPrefs(); aplicarAnchos();
}

function renderTabla(visibles) {
  const panel = $('#panelTabla');
  const scroll = panel.scrollTop, scrollX = panel.scrollLeft;
  aplicarAnchos();
  const cab = h('div', { class: 'fila cabecera', style: `height:${ENCABEZADO}px` },
    COLUMNAS.map(c => h('div', { class: 'celda c-' + c.k }, c.t,
      h('span', { class: 'redim', title: 'Arrastra para cambiar el ancho (doble clic: ancho original)',
        onpointerdown: e => redimensionarColumna(e, c), ondblclick: () => anchoOriginal(c) }))));
  const cuerpo = h('div', { class: 'cuerpo' });
  for (const t of visibles) cuerpo.append(filaTabla(t));
  // Fila vacía para escribir una tarea nueva, como en Project
  cuerpo.append(h('div', { class: 'fila nueva' },
    h('div', { class: 'celda c-ind' }), h('div', { class: 'celda c-id' }), h('div', { class: 'celda c-modo' }),
    h('div', { class: 'celda c-nombre' }, h('input', {
      placeholder: 'Escribe una tarea nueva…', 'data-celda': 'nueva:nombre',
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
      onchange: e => {
        const nombre = e.target.value.trim();
        if (!nombre) return;
        const ultima = estado.proyecto.tareas[estado.proyecto.tareas.length - 1];
        const id = cambiar(p => { const t = nuevaTareaObj({ nombre, nivel: ultima ? ultima.nivel : 1 }); p.tareas.push(t); return t.id; });
        estado.sel = new Set([id]);
        render();
        enfocar('nueva', 'nombre');
      },
    }))));
  panel.replaceChildren(cab, cuerpo);
  panel.scrollTop = scroll; panel.scrollLeft = scrollX;
}

function filaTabla(t) {
  const r = R(t.id);
  const sel = estado.sel.has(t.id);
  const clase = ['fila', sel && 'sel', r.resumen && 'resumen', estado.verCritica && r.critica && !r.resumen && 'critica'].filter(Boolean).join(' ');
  const fila = h('div', { class: clase, 'data-id': t.id });
  const seleccionar = e => seleccionarFila(t.id, e);

  const entrada = (col, valor, attrs = {}) => h('input', {
    value: valor ?? '', 'data-celda': `${t.id}:${col}`, ...attrs,
    onfocus: e => { if (!estado.sel.has(t.id) || estado.sel.size > 1) { estado.sel = new Set([t.id]); marcarSeleccion(); } },
    onkeydown: e => teclaCelda(e, t.id, col),
    onchange: e => confirmarCelda(t.id, col, e.target.value),
  });

  // Indicadores (como la columna "i" de Project)
  const ind = [];
  if (t.notas) ind.push(h('span', { title: t.notas }, '📝'));
  if (t.restriccion && t.restriccion !== 'ASAP') ind.push(h('span', { title: `${RESTRICCIONES[t.restriccion]} ${t.fechaRestriccion ? fmtFechaLarga(t.fechaRestriccion) : ''}` }, r.conflicto ? '⚠' : '📌'));
  if (r.tardeLimite) ind.push(h('span', { title: 'Termina después de su fecha límite' }, '⏰'));
  if (r.sobreasignada) ind.push(h('span', { class: 'rojo', title: 'Recurso sobreasignado' }, '👤'));
  if (t.porcentaje >= 100 && !r.resumen) ind.push(h('span', { title: 'Completada' }, '✔'));

  const sangria = (r.nivel - 1) * 16;
  const plegada = estado.plegadas.has(t.id);
  fila.append(
    h('div', { class: 'celda c-ind' }, ind),
    h('div', { class: 'celda c-id', onclick: seleccionar, ondblclick: () => dialogoTarea(t.id), title: 'Clic: seleccionar · Ctrl/Shift+clic: varias · Doble clic: información' }, r.fila + 1),
    h('div', { class: 'celda c-modo' }, h('select', {
      'data-celda': `${t.id}:modo`, title: t.modo === 'manual' ? 'Programada manualmente' : 'Programada automáticamente',
      onchange: e => confirmarCelda(t.id, 'modo', e.target.value),
    }, h('option', { value: 'auto', selected: t.modo !== 'manual' }, '⚙'), h('option', { value: 'manual', selected: t.modo === 'manual' }, '✎'))),
    h('div', { class: 'celda c-nombre', style: `padding-left:${sangria + 4}px` },
      r.resumen ? h('button', { class: 'plegar', title: plegada ? 'Expandir' : 'Contraer', onclick: () => alternarPlegado(t.id) }, plegada ? '▸' : '▾') : h('span', { class: 'plegar' }),
      entrada('nombre', t.nombre, { placeholder: '(sin nombre)' }),
      r.resumen ? h('span', { class: 'insignia', title: 'Épica: agrupa tareas' }, plegada ? `ÉPICA · ${contarTareas(t.id)}` : 'ÉPICA') : null),
    h('div', { class: 'celda c-duracion' }, entrada('duracion', fmtDur(r.e - r.s, r.hito), { readOnly: r.resumen })),
    h('div', { class: 'celda c-comienzo' }, entrada('comienzo', r.comienzo, { type: 'date', readOnly: r.resumen })),
    h('div', { class: 'celda c-fin' }, entrada('fin', r.fin, { type: 'date', readOnly: r.resumen })),
    h('div', { class: 'celda c-pred' }, selectorPredecesoras(entrada('pred', predecesorasDe(t.id), { placeholder: r.resumen ? '' : 'Elegir…', autocomplete: 'off' }), t.id)),
    h('div', { class: 'celda c-recursos' }, r.resumen ? '' : entrada('recursos', recursosDe(t.id), { list: 'listaRecursos' })),
    h('div', { class: 'celda c-pct' }, entrada('pct', (t.porcentaje || 0) + '%', { readOnly: r.resumen })),
    h('div', { class: 'celda c-kanban' }, celdaKanban(t, r)),
    h('div', { class: 'celda c-trabajo num' }, fmtHoras(r.trabajo)),
    h('div', { class: 'celda c-holgura num' }, fmtDur(Math.max(0, r.holgura))),
  );
  return fila;
}

// Celda "Kanban": la tarjeta enlazada (o el botón para enlazar)
function celdaKanban(t, r) {
  if (t.kanban) {
    const info = enlaces.textoTarjeta(t.kanban);
    return h('button', { type: 'button', class: 'chip-kanban', title: info.titulo + '\nClic: opciones', onclick: e => menuKanban(t, e.currentTarget) }, h('span', {}, '▥'), info.texto);
  }
  if (r.resumen) return '';
  return h('button', { type: 'button', class: 'enlazar-kanban', title: 'Enlazar con una tarjeta del Kanban', onclick: () => enlaces.dialogoEnlazarTarea(estado.proyecto.id, t.id) }, '＋');
}
function menuKanban(t, ancla) {
  const enlace = { ...t.kanban, proyecto: estado.proyecto.id, tarea: t.id };
  showMenu(ancla, [
    { label: '▥ Abrir la tarjeta en el Kanban', action: () => enlaces.abrirTarjeta(enlace) },
    { label: '⛓ Desenlazar', danger: true, action: async () => {
      if (await confirmDlg('¿Quitar el enlace con el Kanban?', 'La tarea y la tarjeta se conservan; solo dejan de actualizarse entre sí.', 'Quitar enlace')) enlaces.desenlazar(enlace);
    } },
  ]);
}

function teclaCelda(e, id, col) {
  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (col === 'comienzo' || col === 'fin') { if (e.key !== 'Enter') return; }
    e.preventDefault();
    const vis = filasVisibles();
    const i = vis.findIndex(t => t.id === id);
    const sig = e.key === 'ArrowUp' ? vis[i - 1] : vis[i + 1];
    e.target.blur();
    if (sig) { estado.sel = new Set([sig.id]); marcarSeleccion(); enfocar(sig.id, col); }
    else if (e.key !== 'ArrowUp') enfocar('nueva', 'nombre');
  } else if (e.key === 'Escape') {
    e.target.value = e.target.defaultValue;
    e.target.blur();
  }
}

// Cantidad de tareas (sin contar épicas) dentro de una épica
function contarTareas(id) {
  const info = estado.calc.info;
  let n = 0;
  const pila = [...info.get(id).hijos];
  while (pila.length) { const x = pila.pop(); const i = info.get(x); i.resumen ? pila.push(...i.hijos) : n++; }
  return `${n} tarea${n === 1 ? '' : 's'}`;
}

function plegarTodo(plegar) {
  estado.plegadas = new Set(plegar ? estado.proyecto.tareas.filter(t => R(t.id).resumen).map(t => t.id) : []);
  localStorage.setItem('gantt:plegadas:' + estado.proyecto.id, JSON.stringify([...estado.plegadas]));
  render();
}

function alternarPlegado(id) {
  estado.plegadas.has(id) ? estado.plegadas.delete(id) : estado.plegadas.add(id);
  localStorage.setItem('gantt:plegadas:' + estado.proyecto.id, JSON.stringify([...estado.plegadas]));
  render();
}

function seleccionarFila(id, e) {
  const vis = filasVisibles().map(t => t.id);
  if (e?.shiftKey && estado.ancla) {
    const a = vis.indexOf(estado.ancla), b = vis.indexOf(id);
    estado.sel = new Set(vis.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else if (e?.ctrlKey || e?.metaKey) {
    estado.sel.has(id) ? estado.sel.delete(id) : estado.sel.add(id);
    estado.ancla = id;
  } else {
    estado.sel = new Set([id]);
    estado.ancla = id;
  }
  marcarSeleccion();
}
function marcarSeleccion() {
  document.querySelectorAll('[data-id]').forEach(el => el.classList.toggle('sel', estado.sel.has(el.dataset.id)));
}

// ---------- Gráfico ----------
function rangoFechas() {
  const c = estado.calc;
  let ini = c.comienzo, fin = c.fin;
  for (const t of estado.proyecto.tareas) {
    if (t.lbComienzo && t.lbComienzo < ini) ini = t.lbComienzo;
    if (t.lbFin && t.lbFin > fin) fin = t.lbFin;
  }
  const d0 = new Date(parseISO(addDaysISO(ini, -7)));
  const t0 = toISO(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - (estado.zoom === 'trimestres' ? 3 : 0), 1));
  const anchoMin = ($('#panelGrafico').clientWidth || 800) / ESCALAS[estado.zoom].dw;
  const dias = Math.max((parseISO(fin) - parseISO(t0)) / DAY + 60, anchoMin + 7);
  return { t0, dias: Math.ceil(dias) };
}

function renderGrafico(visibles) {
  const panel = $('#panelGrafico');
  const scroll = panel.scrollTop, scrollX = panel.scrollLeft;
  const { cal } = estado.calc;
  const dw = ESCALAS[estado.zoom].dw;
  const { t0, dias } = rangoFechas();
  const ancho = Math.ceil(dias * dw);
  const alto = (visibles.length + 1) * FILA;
  const X = iso => ((parseISO(iso) - parseISO(t0)) / DAY) * dw;
  const xIni = i => X(cal.fecha(i));
  const xFin = i => X(cal.fecha(i - 1)) + dw;
  estado.geo = { t0, dw, X };

  // --- Escala de tiempo (dos niveles) ---
  const cab = s('svg', { width: ancho, height: ENCABEZADO, class: 'escala' });
  const nivel = (y, cortes) => {
    for (const [a, b, texto] of cortes) {
      const x1 = X(a), x2 = X(b);
      cab.append(s('line', { x1, x2: x1, y1: y, y2: y + 24, class: 'div' }));
      const cabe = Math.floor((x2 - x1 - 4) / 6.5);
      if (cabe >= 1) cab.append(s('text', { x: (x1 + x2) / 2, y: y + 16, 'text-anchor': 'middle' }, texto.length <= cabe ? texto : texto.slice(0, cabe)));
    }
    cab.append(s('line', { x1: 0, x2: ancho, y1: y + 24, y2: y + 24, class: 'div' }));
  };
  const fin = addDaysISO(t0, dias);
  const cortes = paso => {
    const out = [];
    let a = t0;
    while (a < fin) { const [b, txt] = paso(a); out.push([a, b, txt]); a = b; }
    return out;
  };
  const mes = (a, conAnio) => {
    const d = new Date(parseISO(a));
    const b = toISO(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return [b, conAnio ? `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}` : MESES[d.getUTCMonth()]];
  };
  const trimestre = a => {
    const d = new Date(parseISO(a));
    const q = Math.floor(d.getUTCMonth() / 3);
    return [toISO(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1)), `T${q + 1} ${d.getUTCFullYear()}`];
  };
  const anio = a => {
    const y = new Date(parseISO(a)).getUTCFullYear();
    return [toISO(Date.UTC(y + 1, 0, 1)), String(y)];
  };
  if (estado.zoom === 'dias') {
    nivel(0, cortes(a => mes(a, true)));
    nivel(24, cortes(a => [addDaysISO(a, 1), `${'DLMXJVS'[new Date(parseISO(a)).getUTCDay()]}${+a.slice(8)}`]));
  } else if (estado.zoom === 'semanas') {
    nivel(0, cortes(a => mes(a, true)));
    nivel(24, cortes(a => { const wd = (new Date(parseISO(a)).getUTCDay() + 6) % 7; return [addDaysISO(a, 7 - wd), String(+a.slice(8))]; }));
  } else if (estado.zoom === 'meses') {
    nivel(0, cortes(trimestre));
    nivel(24, cortes(a => mes(a, false)));
  } else {
    nivel(0, cortes(anio));
    nivel(24, cortes(a => { const [b, txt] = trimestre(a); return [b, txt.split(' ')[0]]; }));
  }

  // --- Cuerpo ---
  const svg = s('svg', { width: ancho, height: alto, class: 'lienzo' });
  const defs = s('defs', {},
    s('marker', { id: 'flecha', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L8,4 L0,8 z', class: 'punta' })),
    s('marker', { id: 'flechaCritica', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L8,4 L0,8 z', class: 'punta critica' })),
    s('pattern', { id: 'rayado', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 6, height: 6, class: 'rayado-fondo' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'rayado-linea' })),
  );
  svg.append(defs);

  // Días no laborables sombreados
  if (dw >= 6) {
    const g = s('g', { class: 'nolaborable' });
    for (let k = 0; k < dias; k++) {
      const d = addDaysISO(t0, k);
      if (!cal.esLaborable(d)) g.append(s('rect', { x: k * dw, y: 0, width: dw, height: alto }));
    }
    svg.append(g);
  }
  // Filas seleccionadas
  const gSel = s('g', { class: 'selfondo' });
  visibles.forEach((t, i) => gSel.append(s('rect', { x: 0, y: i * FILA, width: ancho, height: FILA, 'data-id': t.id, class: estado.sel.has(t.id) ? 'sel' : '' })));
  svg.append(gSel);
  // Líneas de las filas
  const gLin = s('g', { class: 'rejilla' });
  for (let i = 1; i <= visibles.length; i++) gLin.append(s('line', { x1: 0, x2: ancho, y1: i * FILA, y2: i * FILA }));
  svg.append(gLin);

  // Comienzo del proyecto y hoy
  const xp = xIni(0);
  svg.append(s('line', { x1: xp, x2: xp, y1: 0, y2: alto, class: 'inicio-proyecto' }, s('title', {}, 'Comienzo del proyecto')));
  const hoy = hoyISO();
  const xh = X(hoy) + dw / 2;
  if (xh >= 0 && xh <= ancho) {
    svg.append(s('line', { x1: xh, x2: xh, y1: 0, y2: alto, class: 'hoy' }, s('title', {}, 'Hoy: ' + fmtFechaLarga(hoy))));
    cab.append(s('line', { x1: xh, x2: xh, y1: 24, y2: ENCABEZADO, class: 'hoy' }));
  }

  // Posiciones de cada barra
  const pos = new Map();
  visibles.forEach((t, i) => {
    const r = R(t.id);
    const y = i * FILA;
    if (r.hito) { const x = r.s > 0 ? xFin(r.s) : xIni(0); pos.set(t.id, { x1: x, x2: x, y, ym: y + FILA / 2 }); }
    else pos.set(t.id, { x1: xIni(r.s), x2: xFin(r.e), y, ym: y + FILA / 2 });
  });

  // Vínculos
  const gVin = s('g', { class: 'vinculos' });
  // Si una tarea está dentro de una épica contraída, la flecha llega a la barra de la épica
  const visible = id => [id, ...ancestros(estado.calc.info, id)].find(x => pos.has(x));
  const dibujados = new Set();
  for (const d0 of estado.proyecto.dependencias) {
    const d = { ...d0, pred: visible(d0.pred), succ: visible(d0.succ) };
    if (!d.pred || !d.succ || d.pred === d.succ) continue;
    const clave = `${d.pred}>${d.succ}>${d.tipo}`;
    if (dibujados.has(clave)) continue;
    dibujados.add(clave);
    const a = pos.get(d.pred), b = pos.get(d.succ);
    const desdeFin = d.tipo === 'FS' || d.tipo === 'FF';
    const haciaIni = d.tipo === 'FS' || d.tipo === 'SS';
    const ax = desdeFin ? a.x2 : a.x1, bx = haciaIni ? b.x1 : b.x2;
    const dirA = desdeFin ? 1 : -1, dirB = haciaIni ? 1 : -1;
    const px = ax + dirA * 8, qx = bx - dirB * 8;
    const ay = a.ym;
    let dpath;
    const directo = dirB === 1 ? px <= bx - 2 : px >= bx + 2;
    if (directo) dpath = `M${ax},${ay} H${px} V${b.ym} H${bx}`;
    else {
      const ymedio = b.y > a.y ? b.y : b.y + FILA;
      dpath = `M${ax},${ay} H${px} V${ymedio} H${qx} V${b.ym} H${bx}`;
    }
    const critica = estado.verCritica && R(d.pred).critica && R(d.succ).critica;
    gVin.append(s('path', { d: dpath, class: critica ? 'critica' : '', 'marker-end': `url(#${critica ? 'flechaCritica' : 'flecha'})` },
      s('title', {}, `${numeroFila(d.pred)} → ${numeroFila(d.succ)} (${NOMBRE_VINCULO[d.tipo]}${d.retraso ? (d.retraso > 0 ? '+' : '') + d.retraso + 'd' : ''})`)));
  }
  svg.append(gVin);

  // Barras
  const gBar = s('g', { class: 'barras' });
  visibles.forEach(t => {
    const r = R(t.id), { x1, x2, y } = pos.get(t.id);
    const g = s('g', { class: 'tarea', 'data-id': t.id });
    const titulo = s('title', {}, `${t.nombre || '(sin nombre)'}\nComienzo: ${fmtFechaLarga(r.comienzo)}\nFin: ${fmtFechaLarga(r.fin)}\nDuración: ${fmtDur(r.e - r.s, r.hito)}\n% completado: ${t.porcentaje || 0}%\nMargen total: ${fmtDur(Math.max(0, r.holgura))}`);
    // Línea base
    if (estado.verLineaBase && t.lbComienzo && t.lbFin) {
      const bx1 = X(t.lbComienzo), bx2 = t.lbDuracion === 0 ? bx1 : X(t.lbFin) + dw;
      if (t.lbDuracion === 0) g.append(s('path', { d: `M${bx1 + dw},${y + FILA - 9} l4,4 l-4,4 l-4,-4 z`, class: 'lb' }));
      else g.append(s('rect', { x: bx1, y: y + FILA - 8, width: Math.max(2, bx2 - bx1), height: 4, class: 'lb' }));
    }
    const critica = estado.verCritica && r.critica;
    if (r.resumen) {
      const yy = y + 8;
      const xpct = x1 + (x2 - x1) * (t.porcentaje || 0) / 100;
      if (estado.plegadas.has(t.id)) {
        // Épica contraída: una sola barra gruesa con su avance
        g.append(s('rect', { x: x1, y: y + 6, width: Math.max(2, x2 - x1), height: FILA - 12, rx: 3, class: 'epica' + (critica ? ' critica' : '') }, titulo));
        if (t.porcentaje) g.append(s('rect', { x: x1, y: y + FILA / 2 - 2, width: xpct - x1, height: 4, class: 'progreso', 'pointer-events': 'none' }));
      } else {
        g.append(s('path', { d: `M${x1},${yy} H${x2} V${yy + 10} l-5,-5 H${x1 + 5} l-5,5 Z`, class: 'resumen' + (critica ? ' critica' : '') }, titulo));
        if (t.porcentaje) g.append(s('rect', { x: x1, y: yy + 2, width: xpct - x1, height: 2, class: 'progreso-resumen' }));
      }
      g.append(s('text', { x: x2 + 8, y: y + FILA / 2 + 4, class: 'etiqueta etiqueta-epica' }, `${t.nombre} · ${fmtCorta(r.comienzo)} – ${fmtCorta(r.fin)}`));
    } else if (r.hito) {
      const yy = y + FILA / 2;
      g.append(s('path', { d: `M${x1},${yy - 7} l7,7 l-7,7 l-7,-7 z`, class: 'hito' + (critica ? ' critica' : ''), 'data-parte': 'mover' }, titulo));
      g.append(s('text', { x: x1 + 11, y: yy + 4, class: 'etiqueta' }, fmtCorta(r.comienzo)));
    } else {
      const yy = y + 6, alto = FILA - 14;
      const cls = ['barra', critica && 'critica', t.modo === 'manual' && 'manual', (t.porcentaje || 0) >= 100 && 'completa'].filter(Boolean).join(' ');
      g.append(s('rect', { x: x1, y: yy, width: Math.max(2, x2 - x1), height: alto, rx: 2, class: cls, 'data-parte': 'mover', style: t.color ? `fill:${t.color}` : null }, titulo));
      if (t.porcentaje) g.append(s('rect', { x: x1, y: yy + alto / 2 - 2, width: (x2 - x1) * t.porcentaje / 100, height: 4, class: 'progreso', 'pointer-events': 'none' }));
      g.append(s('rect', { x: x2 - 4, y: yy, width: 6, height: alto, class: 'asa', 'data-parte': 'fin' }, s('title', {}, 'Arrastra para cambiar la duración')));
      g.append(s('circle', { cx: x2 + 7, cy: yy + alto / 2, r: 4, class: 'conector', 'data-parte': 'vincular' }, s('title', {}, 'Arrastra hasta otra tarea para vincularlas')));
      const recs = recursosDe(t.id);
      if (recs) g.append(s('text', { x: x2 + 14, y: yy + alto / 2 + 4, class: 'etiqueta' }, recs));
    }
    if (t.fechaLimite) {
      const xl = X(t.fechaLimite) + dw;
      g.append(s('path', { d: `M${xl - 5},${y + 2} h10 l-5,7 z`, class: 'limite' + (r.tardeLimite ? ' tarde' : '') }, s('title', {}, 'Fecha límite: ' + fmtFechaLarga(t.fechaLimite))));
    }
    gBar.append(g);
  });
  svg.append(gBar);

  panel.replaceChildren(h('div', { class: 'cab-grafico', style: `width:${ancho}px;height:${ENCABEZADO}px` }, cab), svg);
  panel.scrollTop = scroll; panel.scrollLeft = scrollX;
  activarArrastre(svg, visibles, pos);
}

// Arrastrar barras: mover (aplica "No comenzar antes del"), cambiar duración, o vincular con otra tarea
function activarArrastre(svg, visibles, pos) {
  const { dw } = estado.geo;
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const g = e.target.closest('.tarea');
    const fondo = e.target.closest('.selfondo rect');
    if (fondo) { seleccionarFila(fondo.dataset.id, e); return; }
    if (!g) return;
    const id = g.dataset.id;
    seleccionarFila(id, e);
    const parte = e.target.dataset.parte;
    if (!parte || R(id).resumen) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    drag = { id, parte, x0: e.clientX, g, linea: null };
    if (parte === 'vincular') {
      const p = pos.get(id);
      drag.linea = s('line', { x1: p.x2 + 7, y1: p.ym, x2: p.x2 + 7, y2: p.ym, class: 'vinculo-temporal' });
      svg.append(drag.linea);
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (drag.parte === 'mover') drag.g.setAttribute('transform', `translate(${Math.round(dx / dw) * dw},0)`);
    else if (drag.parte === 'fin') {
      const barra = drag.g.querySelector('.barra');
      if (!drag.ancho0) drag.ancho0 = +barra.getAttribute('width');
      barra.setAttribute('width', Math.max(dw, drag.ancho0 + Math.round(dx / dw) * dw));
    } else if (drag.parte === 'vincular') {
      const caja = svg.getBoundingClientRect();
      drag.linea.setAttribute('x2', e.clientX - caja.left);
      drag.linea.setAttribute('y2', e.clientY - caja.top);
    }
  });
  const soltar = e => {
    if (!drag) return;
    const d = drag; drag = null;
    const dias = Math.round((e.clientX - d.x0) / dw);
    const r = R(d.id);
    if (d.parte === 'mover' && dias) {
      const nueva = estado.calc.cal.fecha(estado.calc.cal.indice(addDaysISO(r.comienzo, dias)));
      confirmarCelda(d.id, 'comienzo', nueva);
    } else if (d.parte === 'fin' && dias) {
      confirmarCelda(d.id, 'fin', addDaysISO(r.fin, dias));
    } else if (d.parte === 'vincular') {
      d.linea.remove();
      const caja = svg.getBoundingClientRect();
      const fila = Math.floor((e.clientY - caja.top) / FILA);
      const destino = visibles[fila];
      if (destino && destino.id !== d.id) cambiar(p => agregarVinculo(p, d.id, destino.id, 'FS', 0));
    } else {
      d.g.removeAttribute('transform');
      render();
    }
  };
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', () => { drag = null; render(); });
  svg.addEventListener('dblclick', e => {
    const g = e.target.closest('.tarea') || e.target.closest('.selfondo rect');
    if (g) dialogoTarea(g.dataset.id);
  });
}

function desplazarA(iso) {
  const { X } = estado.geo;
  const panel = $('#panelGrafico');
  panel.scrollLeft = Math.max(0, X(iso) - 60);
}

// ---------- Pie de página ----------
function renderPie() {
  const c = estado.calc, p = estado.proyecto;
  const totalTrabajo = p.tareas.filter(t => R(t.id).nivel === 1).reduce((a, t) => a + R(t.id).trabajo, 0);
  const aviso = $('#pie .aviso');
  $('#pie').replaceChildren(...[
    h('span', {}, `Comienzo: ${fmtFechaLarga(c.comienzo)}`),
    h('span', {}, `Fin: ${fmtFechaLarga(c.fin)}`),
    h('span', {}, `Duración: ${fmtDur(c.finIdx)}`),
    h('span', {}, `Trabajo: ${fmtHoras(totalTrabajo)}`),
    c.errores.length ? h('span', { class: 'error' }, c.errores.join(' ')) : null,
    c.sobreasignados.size ? h('span', { class: 'error' }, `Recursos sobreasignados: ${[...c.sobreasignados].map(id => p.recursos.find(r => r.id === id)?.nombre).join(', ')}`) : null,
    estado.almacen.modo === 'local' ? h('span', { class: 'nota' }, 'Modo de prueba: los datos se guardan solo en este navegador') : null,
    aviso || h('span', { class: 'aviso' }),
  ].filter(Boolean));
}

// ---------- Render general ----------
function render() {
  if (!estado.proyecto) return;
  const visibles = filasVisibles();
  renderTabla(visibles);
  renderGrafico(visibles);
  renderPie();
  let dl = $('#listaRecursos');
  if (!dl) document.body.append(dl = h('datalist', { id: 'listaRecursos' }));
  dl.replaceChildren(...estado.proyecto.recursos.map(r => h('option', { value: r.nombre })));
  aplicarFoco();
}

// ---------- Diálogos ----------
function abrirDialogo(titulo, contenido, botones) {
  const dlg = $('#dialogo');
  dlg.replaceChildren(h('form', { method: 'dialog', class: 'dlg' },
    h('h2', {}, titulo),
    h('div', { class: 'dlg-cuerpo' }, contenido),
    h('div', { class: 'dlg-botones' }, botones)));
  dlg.showModal();
  return dlg;
}
function dialogoConfirmar(titulo, texto, opciones) {
  const dlg = abrirDialogo(titulo, h('p', {}, texto), [
    ...opciones.map(([txt, fn], i) => h('button', { type: 'button', class: i === 0 ? 'primario' : '', onclick: () => { dlg.close(); fn(); } }, txt)),
    h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
  ]);
}
const campo = (etiqueta, control) => h('label', { class: 'campo' }, h('span', {}, etiqueta), control);

function dialogoTarea(id) {
  const t = T(id), r = R(id);
  if (!t) return;
  const p = estado.proyecto;
  const preds = p.dependencias.filter(d => d.succ === id).map(d => ({ ...d }));
  const asigs = p.asignaciones.filter(a => a.tarea === id).map(a => ({ ...a }));
  const f = {
    nombre: h('input', { value: t.nombre }),
    duracion: h('input', { value: fmtDur(r.e - r.s, r.hito), disabled: r.resumen }),
    pct: h('input', { type: 'number', min: 0, max: 100, value: t.porcentaje || 0, disabled: r.resumen }),
    modo: h('select', {}, h('option', { value: 'auto', selected: t.modo !== 'manual' }, 'Programada automáticamente'), h('option', { value: 'manual', selected: t.modo === 'manual' }, 'Programada manualmente')),
    comienzoManual: h('input', { type: 'date', value: t.comienzoManual || r.comienzo }),
    restriccion: h('select', {}, Object.entries(RESTRICCIONES).map(([k, v]) => h('option', { value: k, selected: (t.restriccion || 'ASAP') === k }, v))),
    fechaRestriccion: h('input', { type: 'date', value: t.fechaRestriccion || '' }),
    fechaLimite: h('input', { type: 'date', value: t.fechaLimite || '' }),
    color: h('input', { type: 'color', value: t.color || '#4f7fe0' }),
    usarColor: h('input', { type: 'checkbox', checked: !!t.color }),
    notas: h('textarea', { rows: 5 }, t.notas || ''),
  };
  const epicaActual = R(id).padre || '';
  {
    const [i, j] = bloque(id);
    const excluir = new Set(p.tareas.slice(i, j).map(x => x.id));
    f.epica = h('select', {}, h('option', { value: '' }, 'Sin épica (nivel principal)'),
      epicasDisponibles(excluir).map(x => h('option', { value: x.id, selected: x.id === epicaActual }, nombreEpica(x))));
  }
  const tablaPred = h('div');
  const pintarPred = () => tablaPred.replaceChildren(h('table', { class: 'mini' },
    h('tr', {}, h('th', {}, 'Id'), h('th', {}, 'Nombre'), h('th', {}, 'Tipo'), h('th', {}, 'Pos. (días)'), h('th', {})),
    preds.map((d, i) => h('tr', {},
      h('td', {}, numeroFila(d.pred)),
      h('td', {}, T(d.pred)?.nombre || ''),
      h('td', {}, h('select', { onchange: e => (d.tipo = e.target.value) }, TIPOS_VINCULO.map(k => h('option', { value: k, selected: d.tipo === k }, { FS: 'Fin a comienzo (FC)', SS: 'Comienzo a comienzo (CC)', FF: 'Fin a fin (FF)', SF: 'Comienzo a fin (CF)' }[k])))),
      h('td', {}, h('input', { type: 'number', value: d.retraso || 0, style: 'width:70px', onchange: e => (d.retraso = Math.round(+e.target.value || 0)) })),
      h('td', {}, h('button', { type: 'button', onclick: () => { preds.splice(i, 1); pintarPred(); } }, '✕')))),
    h('tr', {}, h('td', { colspan: 5 }, h('select', {
      onchange: e => { if (e.target.value) { preds.push({ id: nuevoId(), pred: e.target.value, succ: id, tipo: 'FS', retraso: 0 }); pintarPred(); } },
    }, h('option', { value: '' }, '＋ Agregar predecesora…'),
      p.tareas.filter(x => x.id !== id && !preds.some(d => d.pred === x.id)).map(x => h('option', { value: x.id }, `${numeroFila(x.id)} · ${x.nombre}`)))))));
  pintarPred();

  const tablaAsig = h('div');
  const pintarAsig = () => tablaAsig.replaceChildren(h('table', { class: 'mini' },
    h('tr', {}, h('th', {}, 'Recurso'), h('th', {}, 'Unidades (%)'), h('th', {})),
    asigs.map((a, i) => h('tr', {},
      h('td', {}, p.recursos.find(x => x.id === a.recurso)?.nombre || ''),
      h('td', {}, h('input', { type: 'number', value: Math.round((a.unidades ?? 1) * 100), style: 'width:80px', onchange: e => (a.unidades = Math.max(0, +e.target.value || 0) / 100) })),
      h('td', {}, h('button', { type: 'button', onclick: () => { asigs.splice(i, 1); pintarAsig(); } }, '✕')))),
    h('tr', {}, h('td', { colspan: 3 }, h('select', {
      onchange: e => { if (e.target.value) { asigs.push({ id: nuevoId(), tarea: id, recurso: e.target.value, unidades: 1 }); pintarAsig(); } },
    }, h('option', { value: '' }, p.recursos.length ? '＋ Asignar recurso…' : 'Crea recursos en "Recursos"'),
      p.recursos.filter(x => !asigs.some(a => a.recurso === x.id)).map(x => h('option', { value: x.id }, x.nombre)))))));
  pintarAsig();

  const pestañas = {
    General: h('div', { class: 'rejilla2' },
      campo('Nombre', f.nombre), campo('Duración', f.duracion), campo('% completado', f.pct), campo('Modo', f.modo),
      campo('Comienzo manual', f.comienzoManual),
      campo('Épica', f.epica),
      h('div', { class: 'campo' }, h('span', {}, 'Fechas calculadas'), h('div', {}, `${fmtFechaLarga(r.comienzo)} → ${fmtFechaLarga(r.fin)}`)),
      campo('Color de la barra', h('div', {}, f.usarColor, ' ', f.color))),
    Predecesoras: tablaPred,
    Recursos: tablaAsig,
    Avanzado: h('div', { class: 'rejilla2' },
      campo('Tipo de restricción', f.restriccion), campo('Fecha de restricción', f.fechaRestriccion),
      campo('Fecha límite', f.fechaLimite),
      h('div', { class: 'campo' }, h('span', {}, 'EDT'), h('div', {}, r.edt)),
      h('div', { class: 'campo' }, h('span', {}, 'Margen total'), h('div', {}, fmtDur(Math.max(0, r.holgura)) + (r.critica ? ' · en la ruta crítica' : '')))),
    Notas: f.notas,
    Kanban: h('div', { class: 'pestana-kanban' },
      t.kanban
        ? [h('p', {}, 'Esta tarea está enlazada con una tarjeta del Kanban. El nombre y el % completado se mantienen iguales en los dos lados.'),
            h('p', {}, h('button', { type: 'button', class: 'chip-kanban grande', onclick: () => { dlg.close(); enlaces.abrirTarjeta({ ...t.kanban, proyecto: p.id, tarea: id }); } }, '▥ ', enlaces.textoTarjeta(t.kanban).titulo.split('\n')[0], ' · Abrir en el Kanban')),
            h('button', { type: 'button', class: 'peligro', onclick: async () => {
              dlg.close();
              if (await confirmDlg('¿Quitar el enlace con el Kanban?', 'La tarea y la tarjeta se conservan; solo dejan de actualizarse entre sí.', 'Quitar enlace')) enlaces.desenlazar({ ...t.kanban, proyecto: p.id, tarea: id });
            } }, 'Desenlazar…')]
        : r.resumen
          ? h('p', {}, 'Las épicas no se enlazan con tarjetas: enlaza sus tareas.')
          : [h('p', {}, 'Esta tarea vive solo en el Gantt. Puedes crearle una tarjeta en el Kanban o enlazarla con una que ya exista.'),
              h('button', { type: 'button', class: 'primario', onclick: () => { dlg.close(); enlaces.dialogoEnlazarTarea(p.id, id); } }, 'Enlazar con el Kanban…')]),
  };
  const cuerpo = h('div', { class: 'pestanas-cuerpo' });
  const barra = h('div', { class: 'pestanas' });
  const mostrar = nombre => {
    barra.querySelectorAll('button').forEach(b => b.classList.toggle('activa', b.textContent === nombre));
    cuerpo.replaceChildren(pestañas[nombre]);
  };
  for (const nombre of Object.keys(pestañas)) barra.append(h('button', { type: 'button', onclick: () => mostrar(nombre) }, nombre));
  mostrar('General');

  const dlg = abrirDialogo('Información de la tarea', [barra, cuerpo], [
    h('button', { type: 'button', class: 'primario', onclick: () => {
      const d = parseDuracion(f.duracion.value);
      cambiar(() => {
        t.nombre = f.nombre.value.trim();
        if (!r.resumen && d != null) t.duracion = d;
        if (!r.resumen) t.porcentaje = Math.max(0, Math.min(100, Math.round(+f.pct.value || 0)));
        t.modo = f.modo.value;
        t.comienzoManual = t.modo === 'manual' ? (f.comienzoManual.value || r.comienzo) : null;
        t.restriccion = f.restriccion.value;
        t.fechaRestriccion = t.restriccion === 'ASAP' ? null : (f.fechaRestriccion.value || r.comienzo);
        t.fechaLimite = f.fechaLimite.value || null;
        t.color = f.usarColor.checked ? f.color.value : null;
        t.notas = f.notas.value.trim() || null;
        if (f.epica.value !== epicaActual) moverAEpica(p, [id], f.epica.value || null);
        p.dependencias = p.dependencias.filter(x => x.succ !== id);
        for (const x of preds) agregarVinculo(p, x.pred, id, x.tipo, x.retraso);
        p.asignaciones = p.asignaciones.filter(a => a.tarea !== id).concat(asigs);
      });
      dlg.close();
    } }, 'Aceptar'),
    h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
  ]);
  f.nombre.focus();
}

function dialogoRecursos() {
  const p = estado.proyecto;
  const lista = p.recursos.map(r => ({ ...r }));
  const contenedor = h('div');
  const pintar = () => contenedor.replaceChildren(h('table', { class: 'mini hoja' },
    h('tr', {}, ['Nombre', 'Iniciales', 'Capacidad máx. (%)', 'Grupo', 'Correo', ''].map(x => h('th', {}, x))),
    lista.map((r, i) => h('tr', { class: estado.calc.sobreasignados.has(r.id) ? 'sobre' : '', title: estado.calc.sobreasignados.has(r.id) ? 'Sobreasignado: tiene más trabajo del que su capacidad permite en algún día' : '' },
      h('td', {}, h('input', { value: r.nombre, onchange: e => (r.nombre = e.target.value.trim()) })),
      h('td', {}, h('input', { value: r.iniciales || '', style: 'width:50px', onchange: e => (r.iniciales = e.target.value) })),
      h('td', {}, h('input', { type: 'number', value: Math.round((r.maxUnidades ?? 1) * 100), style: 'width:70px', onchange: e => (r.maxUnidades = Math.max(0, +e.target.value || 0) / 100) })),
      h('td', {}, h('input', { value: r.grupo || '', style: 'width:90px', onchange: e => (r.grupo = e.target.value) })),
      h('td', {}, h('input', { type: 'email', value: r.correo || '', onchange: e => (r.correo = e.target.value) })),
      h('td', {}, h('button', { type: 'button', title: 'Eliminar recurso', onclick: () => { lista.splice(i, 1); pintar(); } }, '✕')))),
  ), h('button', { type: 'button', onclick: () => { lista.push({ id: nuevoId(), nombre: 'Recurso ' + (lista.length + 1), tipo: 'trabajo', maxUnidades: 1 }); pintar(); } }, '＋ Agregar recurso'));
  pintar();
  const dlg = abrirDialogo('Hoja de recursos', contenedor, [
    h('button', { type: 'button', class: 'primario', onclick: () => {
      cambiar(() => {
        p.recursos = lista.filter(r => r.nombre);
        const ids = new Set(p.recursos.map(r => r.id));
        p.asignaciones = p.asignaciones.filter(a => ids.has(a.recurso));
      });
      dlg.close();
    } }, 'Aceptar'),
    h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
  ]);
  dlg.classList.add('ancho');
}

function dialogoProyecto() {
  const p = estado.proyecto;
  const nombre = h('input', { value: p.nombre });
  const inicio = h('input', { type: 'date', value: p.inicio });
  const horas = h('input', { type: 'number', min: 1, max: 24, step: 'any', value: p.horasDia || 8 });
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((n, i) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: i, checked: p.diasLaborables.includes(i) }), n));
  const exc = p.excepciones.map(x => ({ ...x }));
  const tablaExc = h('div');
  const pintar = () => tablaExc.replaceChildren(h('table', { class: 'mini' },
    h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Nombre'), h('th', {}, '¿Laborable?'), h('th', {})),
    exc.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map((x, i) => h('tr', {},
      h('td', {}, h('input', { type: 'date', value: x.fecha || '', onchange: e => (x.fecha = e.target.value) })),
      h('td', {}, h('input', { value: x.nombre || '', onchange: e => (x.nombre = e.target.value) })),
      h('td', {}, h('input', { type: 'checkbox', checked: !!x.laborable, onchange: e => (x.laborable = e.target.checked) })),
      h('td', {}, h('button', { type: 'button', onclick: () => { exc.splice(i, 1); pintar(); } }, '✕'))))),
    h('button', { type: 'button', onclick: () => { exc.push({ id: nuevoId(), fecha: hoyISO(), nombre: 'Festivo', laborable: false }); pintar(); } }, '＋ Agregar festivo / excepción'));
  pintar();
  const dlg = abrirDialogo('Información del proyecto', [
    h('div', { class: 'rejilla2' }, campo('Nombre', nombre), campo('Fecha de comienzo', inicio), campo('Horas por día', horas)),
    h('h3', {}, 'Calendario: días laborables'), h('div', { class: 'dias' }, dias),
    h('h3', {}, 'Días festivos y excepciones'), tablaExc,
  ], [
    !p.propietario || p.propietario === correoActual ? h('button', { type: 'button', class: 'peligro', onclick: () => {
      dialogoConfirmar('Eliminar proyecto', `¿Eliminar "${p.nombre}" con todas sus tareas? No se puede deshacer.`, [['Eliminar', async () => {
        try { await estado.almacen.eliminar(p.id); } catch (e) { return aviso('No se pudo eliminar: ' + e.message, true); }
        estado.proyecto = null;
        await iniciarProyectos();
      }]]);
    } }, 'Eliminar proyecto') : null,
    h('span', { class: 'espacio' }),
    h('button', { type: 'button', class: 'primario', onclick: () => {
      cambiar(() => {
        p.nombre = nombre.value.trim() || p.nombre;
        p.inicio = inicio.value || p.inicio;
        p.horasDia = +horas.value || 8;
        p.diasLaborables = dias.map(l => l.firstChild).filter(c => c.checked).map(c => +c.value);
        p.excepciones = exc.filter(x => x.fecha);
      });
      pintarSelector();
      dlg.close();
    } }, 'Aceptar'),
    h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
  ]);
}

function dialogoNuevoProyecto() {
  const nombre = h('input', { value: '', placeholder: 'Nombre del proyecto', required: true });
  const inicio = h('input', { type: 'date', value: hoyISO() });
  const ejemplo = h('input', { type: 'checkbox' });
  const dlg = abrirDialogo('Proyecto nuevo', h('div', { class: 'rejilla2' },
    campo('Nombre', nombre), campo('Fecha de comienzo', inicio), h('label', { class: 'chk' }, ejemplo, ' Con tareas de ejemplo')), [
    h('button', { type: 'button', class: 'primario', onclick: async () => {
      const p = ejemplo.checked ? proyectoEjemplo(inicio.value) : proyectoVacio('', inicio.value || hoyISO());
      p.nombre = nombre.value.trim() || 'Proyecto nuevo';
      dlg.close();
      await estado.almacen.crear(p);
      await abrirProyecto(p.id);
    } }, 'Crear'),
    h('button', { type: 'button', onclick: () => { dlg.close(); pintarSelector(); } }, 'Cancelar'),
  ]);
  nombre.focus();
}

// ---------- Proyecto de ejemplo ----------
function proyectoEjemplo(inicio) {
  const p = proyectoVacio('Lanzamiento de producto (ejemplo)', inicio);
  const T_ = (nombre, nivel, duracion = 1, extra = {}) => { const t = nuevaTareaObj({ nombre, nivel, duracion, ...extra }); p.tareas.push(t); return t.id; };
  const fs = (a, b, tipo = 'FS', retraso = 0) => p.dependencias.push({ id: nuevoId(), pred: a, succ: b, tipo, retraso });
  const R_ = (nombre, max = 1) => { const r = { id: nuevoId(), nombre, iniciales: nombre.slice(0, 2).toUpperCase(), tipo: 'trabajo', maxUnidades: max }; p.recursos.push(r); return r.id; };
  const asg = (t, r, u = 1) => p.asignaciones.push({ id: nuevoId(), tarea: t, recurso: r, unidades: u });

  const ana = R_('Ana'), luis = R_('Luis'), eq = R_('Equipo de diseño', 2);
  T_('Investigación de mercado', 1);
  const a1 = T_('Mercados de destino', 2, 5, { porcentaje: 100 });
  const a2 = T_('Clientes potenciales', 2, 4, { porcentaje: 60 });
  const a3 = T_('Investigación de competidores', 2, 6);
  T_('Concepto del producto', 1);
  const b1 = T_('Etapa 1', 2, 4);
  const b2 = T_('Etapa 2', 2, 5);
  const b3 = T_('Etapa 3', 2, 3);
  const hito = T_('Concepto aprobado', 2, 0);
  T_('Presupuesto', 1);
  const c1 = T_('Trabajar con patrocinadores', 2, 8);
  const c2 = T_('Trabajar con contratistas', 2, 6);
  const fin = T_('Lanzamiento', 1, 0, { fechaLimite: addDaysISO(inicio, 70) });
  fs(a1, a2); fs(a1, a3, 'SS', 2); fs(a2, b1); fs(a3, b1); fs(b1, b2); fs(b2, b3); fs(b3, hito);
  fs(hito, c1); fs(c1, c2, 'SS', 3); fs(c2, fin);
  asg(a1, ana); asg(a2, ana); asg(a3, luis); asg(b1, eq); asg(b2, eq); asg(b3, eq, 0.5); asg(b3, luis); asg(c1, ana); asg(c2, ana, 0.5);
  return p;
}

// ---------- Proyectos ----------
async function pintarSelector() {
  const sel = $('#selProyecto');
  const lista = await estado.almacen.listar();
  sel.replaceChildren(...[
    ...lista.map(x => h('option', { value: x.id, selected: estado.proyecto?.id === x.id },
      x.id === estado.proyecto?.id ? estado.proyecto.nombre : x.nombre)),
    h('option', { value: '__nuevo' }, '＋ Proyecto nuevo…'),
    estado.almacen.modo === 'firebase' ? h('option', { value: '__migrar' }, '⇪ Traer proyectos del Gantt anterior…') : null,
  ].filter(Boolean));
}
let dejarDeEscuchar = () => {};
async function abrirProyecto(id) {
  if (estado.proyecto && temporizador) await guardarYa();
  const p = await estado.almacen.cargar(id);
  if (!p) return;
  dejarDeEscuchar();
  dejarDeEscuchar = estado.almacen.escuchar(id, (remoto, quien) => recibirCambios(id, remoto, quien));
  for (const k of ['excepciones', 'tareas', 'dependencias', 'recursos', 'asignaciones']) p[k] ||= [];
  estado.proyecto = p;
  estado.deshacer = []; estado.rehacer = []; estado.sel.clear();
  try { estado.plegadas = new Set(JSON.parse(localStorage.getItem('gantt:plegadas:' + id)) || []); } catch { estado.plegadas = new Set(); }
  prefs.ultimo = id; guardarPrefs();
  const url = new URL(location.href); url.searchParams.set('proyecto', id); history.replaceState(null, '', url);
  if (visible) document.title = `${p.nombre} · Diagrama de Gantt`;
  recalcular();
  await pintarSelector();
  render();
  ponerEstado(estado.almacen.modo === 'local' ? 'Modo de prueba' : 'Guardado');
  requestAnimationFrame(() => desplazarA(addDaysISO(estado.calc.comienzo, -3)));
  enlaces.alAbrirProyecto(p);
}
// Otra persona guardó cambios en el proyecto abierto: se muestran sin recargar.
// Si aquí hay cambios sin guardar o una ventana abierta, se espera a que terminen.
let remotoPendiente = null;
function recibirCambios(id, remoto, quien) {
  remotoPendiente = { id, remoto, quien };
  aplicarRemoto();
}
function aplicarRemoto() {
  if (!remotoPendiente) return;
  const foco = document.activeElement;
  // Se espera si hay cambios sin guardar, una ventana abierta o una celda a medio escribir
  if (temporizador || guardandoAhora || document.querySelector('#dialogo[open]') || (foco?.closest?.('#panelTabla') && foco.dataset.sucio)) {
    clearTimeout(aplicarRemoto.t); aplicarRemoto.t = setTimeout(aplicarRemoto, 800); return;
  }
  const { id, remoto, quien } = remotoPendiente;
  remotoPendiente = null;
  if (estado.proyecto?.id !== id) return;
  for (const k of ['excepciones', 'tareas', 'dependencias', 'recursos', 'asignaciones']) remoto[k] ||= [];
  estado.proyecto = remoto;
  // Lo que se podía deshacer ya no aplica sobre la versión nueva
  estado.deshacer = []; estado.rehacer = [];
  for (const x of [...estado.sel]) if (!remoto.tareas.some(t => t.id === x)) estado.sel.delete(x);
  recalcular();
  pintarSelector();
  if (visible) {
    render();
    const celda = foco?.dataset?.celda;
    if (celda) document.querySelector(`[data-celda="${celda}"]`)?.focus();
  }
  aviso(`Actualizado con los cambios de ${quien || 'otra persona'}.`);
}

async function iniciarProyectos() {
  let lista = await estado.almacen.listar();
  if (!lista.length) {
    const p = estado.almacen.modo === 'local' ? proyectoEjemplo(hoyISO()) : proyectoVacio('Mi primer proyecto', hoyISO());
    await estado.almacen.crear(p);
    lista = await estado.almacen.listar();
  }
  const pedido = new URLSearchParams(location.search).get('proyecto');
  const id = [pedido, prefs.ultimo].find(x => x && lista.some(l => l.id === x)) || lista[0].id;
  await abrirProyecto(id);
}

// ---------- Barra de herramientas y teclado ----------
const ACCIONES = {
  deshacer, rehacer,
  nuevaTarea: () => insertar({ nombre: 'Nueva tarea' }),
  nuevoHito: () => insertar({ nombre: 'Nuevo hito', duracion: 0 }),
  nuevoResumen: insertarResumen,
  contraerTodo: () => plegarTodo(true),
  expandirTodo: () => plegarTodo(false),
  sangria: () => cambiarNivel(1),
  anularSangria: () => cambiarNivel(-1),
  subir: () => mover(-1),
  bajar: () => mover(1),
  moverEpica: dialogoMoverAEpica,
  vincular, desvincular, eliminar,
  informacion: () => { const [id] = seleccionOrdenada(); id ? dialogoTarea(id) : aviso('Selecciona una tarea.'); },
  irHoy: () => desplazarA(addDaysISO(hoyISO(), -7)),
  irTarea: () => { const [id] = seleccionOrdenada(); if (id) desplazarA(addDaysISO(R(id).comienzo, -3)); },
  infoProyecto: dialogoProyecto,
  recursos: dialogoRecursos,
  lineaBase: establecerLineaBase,
  exportar: exportarCSV,
  imprimir: () => window.print(),
};

function conectarInterfaz() {
  $('#panelTabla').addEventListener('input', e => { e.target.dataset.sucio = '1'; });
  $('#cinta').addEventListener('click', e => {
    const b = e.target.closest('button[data-acc]');
    if (b && estado.proyecto) ACCIONES[b.dataset.acc]();
  });
  $('#selZoom').value = estado.zoom;
  $('#selZoom').addEventListener('change', e => {
    const centro = $('#panelGrafico').scrollLeft / estado.geo.dw;
    estado.zoom = prefs.zoom = e.target.value; guardarPrefs();
    render();
    $('#panelGrafico').scrollLeft = centro * estado.geo.dw;
  });
  $('#chkCritica').checked = estado.verCritica;
  $('#chkCritica').addEventListener('change', e => { estado.verCritica = prefs.verCritica = e.target.checked; guardarPrefs(); render(); });
  $('#chkLineaBase').checked = estado.verLineaBase;
  $('#chkLineaBase').addEventListener('change', e => { estado.verLineaBase = prefs.verLineaBase = e.target.checked; guardarPrefs(); render(); });
  $('#txtFiltro').addEventListener('input', e => { estado.filtro = e.target.value; render(); });
  $('#selProyecto').addEventListener('change', e => {
    if (e.target.value === '__migrar') {
      e.target.value = estado.proyecto?.id || '';
      import('./migrar.js').then(m => m.dialogoMigrar(estado.almacen, id => abrirProyecto(id)));
    } else if (e.target.value === '__nuevo') dialogoNuevoProyecto();
    else abrirProyecto(e.target.value);
  });

  // Desplazamiento vertical sincronizado entre la tabla y el gráfico
  const pt = $('#panelTabla'), pg = $('#panelGrafico');
  let sinc = false;
  const enlazar = (a, b) => a.addEventListener('scroll', () => {
    if (sinc) { sinc = false; return; }
    if (b.scrollTop !== a.scrollTop) { sinc = true; b.scrollTop = a.scrollTop; }
  });
  enlazar(pt, pg); enlazar(pg, pt);

  // Divisor entre tabla y gráfico
  const vista = $('#vista');
  const anchoTabla = w => { vista.style.gridTemplateColumns = `${w}px 6px 1fr`; };
  anchoTabla(prefs.anchoTabla || 760);
  $('#divisor').addEventListener('pointerdown', e => {
    e.preventDefault();
    const mover = ev => { prefs.anchoTabla = Math.max(120, Math.min(window.innerWidth - 120, ev.clientX - vista.getBoundingClientRect().left)); anchoTabla(prefs.anchoTabla); };
    const fin = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', fin); guardarPrefs(); };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', fin);
  });

  document.addEventListener('keydown', e => {
    if (!visible || !estado.proyecto || document.querySelector('dialog[open]')) return;
    const enCampo = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z' && !enCampo) { e.preventDefault(); deshacer(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y' && !enCampo) { e.preventDefault(); rehacer(); }
    else if (e.altKey && e.shiftKey && k === 'ArrowRight') { e.preventDefault(); document.activeElement?.blur(); cambiarNivel(1); }
    else if (e.altKey && e.shiftKey && k === 'ArrowLeft') { e.preventDefault(); document.activeElement?.blur(); cambiarNivel(-1); }
    else if (e.ctrlKey && e.shiftKey && k === 'F2') { e.preventDefault(); desvincular(); }
    else if (e.ctrlKey && k === 'F2') { e.preventDefault(); vincular(); }
    else if (e.shiftKey && k === 'F2') { e.preventDefault(); ACCIONES.informacion(); }
    else if (k === 'Insert') { e.preventDefault(); ACCIONES.nuevaTarea(); }
    else if (k === 'Delete' && !enCampo) { e.preventDefault(); eliminar(); }
  });
  window.addEventListener('resize', () => visible && estado.proyecto && render());
  window.addEventListener('beforeprint', () => render());
}

// ---------- Arranque ----------
let visible = false;
let correoActual = null;
export async function iniciarGantt(ses) {
  correoActual = ses.correo?.toLowerCase() || null;
  conectarInterfaz();
  estado.almacen = ses.modo === 'firebase' ? new AlmacenFirebase(ses.fs, ses.db, ses.correo) : new AlmacenLocal();
  try { await iniciarProyectos(); } catch (e) { console.error(e); ponerEstado('Error al cargar: ' + e.message, true); }
}

// La vista Gantt se muestra u oculta (el Kanban vive en la misma página)
export function mostrarGantt(si) {
  visible = si;
  if (!si || !estado.proyecto) return;
  document.title = `${estado.proyecto.nombre} · Diagrama de Gantt`;
  const url = new URL(location.href); url.searchParams.set('proyecto', estado.proyecto.id); history.replaceState(null, '', url);
  render();
}

// ---------- Lo que necesitan los enlaces con el Kanban ----------
const completar = p => { for (const k of ['excepciones', 'tareas', 'dependencias', 'recursos', 'asignaciones']) p[k] ||= []; return p; };
export const ganttApi = {
  redibujar: () => { if (visible && estado.proyecto) render(); },
  listarProyectos: () => estado.almacen.listar(),
  async leerProyecto(id) {
    if (estado.proyecto?.id === id) return { p: estado.proyecto, calc: estado.calc };
    const p = await estado.almacen.cargar(id);
    if (!p) return null;
    return { p: completar(p), calc: programar(p) };
  },
  // Cambia un proyecto: el abierto pasa por "cambiar" (con deshacer); otro se carga, se cambia y se guarda
  async modificarProyecto(id, fn) {
    if (estado.proyecto?.id === id) { cambiar(fn, { sinEnlaces: true }); return; }
    const p = await estado.almacen.cargar(id);
    if (!p) throw new Error('No se encontró el proyecto del Gantt.');
    fn(completar(p));
    await estado.almacen.guardar(p);
  },
  async abrirTarea(proyecto, tarea) {
    if (estado.proyecto?.id !== proyecto) await abrirProyecto(proyecto).catch(err => console.warn(err));
    if (estado.proyecto?.id !== proyecto) return aviso('No tienes acceso a ese proyecto.', true);
    if (!T(tarea)) return aviso('La tarea ya no existe.', true);
    // Se despliegan sus épicas para que se vea
    for (const a of ancestros(estado.calc.info, tarea)) estado.plegadas.delete(a);
    estado.filtro = ''; $('#txtFiltro').value = '';
    estado.sel = new Set([tarea]);
    render();
    desplazarA(addDaysISO(R(tarea).comienzo, -3));
    document.querySelector(`#panelTabla [data-id="${tarea}"]`)?.scrollIntoView({ block: 'center' });
  },
};
