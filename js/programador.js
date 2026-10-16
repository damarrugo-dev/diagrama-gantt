// Motor de programación (como el de Microsoft Project):
// - Esquema de tareas por niveles (tareas de resumen, subtareas)
// - Vínculos FC, CC, FF, CF con posposición/adelanto
// - Restricciones (Lo antes posible, No comenzar antes de, Debe comenzar el, ...)
// - Pasada hacia adelante y hacia atrás: holgura total y ruta crítica
// - Trabajo y sobreasignación de recursos
import { Calendario } from './calendario.js';

export const TIPOS_VINCULO = ['FS', 'SS', 'FF', 'SF'];
export const NOMBRE_VINCULO = { FS: 'FC', SS: 'CC', FF: 'FF', SF: 'CF' };
const DESDE_ES = { FC: 'FS', CC: 'SS', FF: 'FF', CF: 'SF', FS: 'FS', SS: 'SS', SF: 'SF' };

export const RESTRICCIONES = {
  ASAP: 'Lo antes posible',
  SNET: 'No comenzar antes del',
  SNLT: 'No comenzar después del',
  FNET: 'No finalizar antes del',
  FNLT: 'No finalizar después del',
  MSO: 'Debe comenzar el',
  MFO: 'Debe finalizar el',
};

// Calcula padres, hijos, niveles válidos y EDT (1, 1.1, 1.2 ...)
export function esquema(tareas) {
  const info = new Map();
  const pila = [];
  const contadores = [0];
  let nivelPrevio = 0;
  tareas.forEach((t, fila) => {
    const nivel = Math.max(1, Math.min(t.nivel || 1, nivelPrevio + 1));
    t.nivel = nivel;
    while (pila.length >= nivel) pila.pop();
    contadores.length = nivel;
    contadores[nivel - 1] = (contadores[nivel - 1] || 0) + 1;
    const padre = pila.length ? pila[pila.length - 1] : null;
    info.set(t.id, { fila, nivel, padre, hijos: [], edt: contadores.slice(0, nivel).join('.') });
    if (padre) info.get(padre).hijos.push(t.id);
    pila.push(t.id);
    nivelPrevio = nivel;
  });
  for (const v of info.values()) v.resumen = v.hijos.length > 0;
  return info;
}

export function ancestros(info, id) {
  const r = [];
  for (let p = info.get(id)?.padre; p; p = info.get(p).padre) r.push(p);
  return r;
}

// "3;5CC+2d;7FF-1" → [{fila: 3, tipo: 'FS', retraso: 0}, ...]
export function parsePredecesoras(texto) {
  const out = [];
  for (const parte of String(texto || '').split(/[;,]/)) {
    const m = parte.trim().toUpperCase().match(/^(\d+)\s*(FC|CC|FF|CF|FS|SS|SF)?\s*([+-]\s*\d+)?\s*(D|DÍAS?|DIAS?)?$/);
    if (!m) { if (parte.trim()) return null; continue; }
    out.push({ fila: +m[1], tipo: DESDE_ES[m[2] || 'FS'], retraso: m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0 });
  }
  return out;
}

export function textoPredecesoras(deps, numeroDeFila) {
  return deps.map(d => {
    const n = numeroDeFila(d.pred);
    if (!n) return '';
    const tipo = d.tipo === 'FS' && !d.retraso ? '' : NOMBRE_VINCULO[d.tipo];
    const r = d.retraso ? (d.retraso > 0 ? `+${d.retraso}d` : `${d.retraso}d`) : '';
    return `${n}${tipo}${r}`;
  }).filter(Boolean).join(';');
}

export function programar(proyecto) {
  const { tareas, dependencias = [], recursos = [], asignaciones = [] } = proyecto;
  const cal = new Calendario(proyecto.inicio, proyecto.diasLaborables, proyecto.excepciones);
  const horasDia = proyecto.horasDia || 8;
  const info = esquema(tareas);
  const porId = new Map(tareas.map(t => [t.id, t]));
  const errores = [];

  // Vínculos válidos (sin auto-vínculos ni vínculos entre una tarea y su resumen)
  const deps = dependencias.filter(d => {
    if (!porId.has(d.pred) || !porId.has(d.succ) || d.pred === d.succ) return false;
    if (ancestros(info, d.succ).includes(d.pred) || ancestros(info, d.pred).includes(d.succ)) return false;
    return true;
  });
  // Predecesoras/sucesoras efectivas de cada tarea de detalle (incluye las de sus resúmenes)
  const predsDe = new Map(), sucsDe = new Map();
  for (const t of tareas) { predsDe.set(t.id, []); sucsDe.set(t.id, []); }
  for (const d of deps) { predsDe.get(d.succ).push(d); sucsDe.get(d.pred).push(d); }
  const efectivos = (mapa, id) => [id, ...ancestros(info, id)].flatMap(x => mapa.get(x));

  const hojas = tareas.filter(t => !info.get(t.id).resumen);
  const resumenesAbajoArriba = tareas.filter(t => info.get(t.id).resumen).reverse();
  const dur = t => Math.max(0, Math.round(+t.duracion || 0));
  const idxHito = (t, fecha) => cal.indice(fecha) + (dur(t) === 0 ? 1 : 0);

  const c = new Map(tareas.map(t => [t.id, { s: 0, e: dur(t) }]));
  const recalcResumenes = (campoS, campoE) => {
    for (const t of resumenesAbajoArriba) {
      const hijos = info.get(t.id).hijos.map(h => c.get(h));
      c.get(t.id)[campoS] = Math.min(...hijos.map(h => h[campoS]));
      c.get(t.id)[campoE] = Math.max(...hijos.map(h => h[campoE]));
    }
  };

  // ---------- Pasada hacia adelante ----------
  let cambio = true, vueltas = 0;
  const maxVueltas = tareas.length + 5;
  while (cambio && vueltas++ < maxVueltas) {
    cambio = false;
    recalcResumenes('s', 'e');
    for (const t of hojas) {
      const d = dur(t), x = c.get(t.id);
      let s;
      if (t.modo === 'manual' && t.comienzoManual) {
        s = idxHito(t, t.comienzoManual);
      } else {
        s = 0;
        for (const v of efectivos(predsDe, t.id)) {
          const p = c.get(v.pred), L = v.retraso || 0;
          if (v.tipo === 'FS') s = Math.max(s, p.e + L);
          else if (v.tipo === 'SS') s = Math.max(s, p.s + L);
          else if (v.tipo === 'FF') s = Math.max(s, p.e + L - d);
          else if (v.tipo === 'SF') s = Math.max(s, p.s + L - d);
        }
        const f = t.fechaRestriccion;
        if (f && t.restriccion === 'SNET') s = Math.max(s, idxHito(t, f));
        if (f && t.restriccion === 'FNET') s = Math.max(s, cal.indice(f) + 1 - d);
        if (f && t.restriccion === 'MSO') s = idxHito(t, f);
        if (f && t.restriccion === 'MFO') s = cal.indice(f) + 1 - d;
        s = Math.max(0, s);
      }
      if (s !== x.s || x.e !== s + d) { x.s = s; x.e = s + d; cambio = true; }
    }
  }
  if (cambio) errores.push('Hay una dependencia circular: revisa las predecesoras.');
  recalcResumenes('s', 'e');

  // ---------- Pasada hacia atrás ----------
  const finProyecto = Math.max(0, ...[...c.values()].map(x => x.e));
  for (const x of c.values()) { x.lf = finProyecto; x.ls = finProyecto - (x.e - x.s); }
  cambio = true; vueltas = 0;
  while (cambio && vueltas++ < maxVueltas) {
    cambio = false;
    recalcResumenes('ls', 'lf');
    for (const t of hojas) {
      const d = dur(t), x = c.get(t.id);
      let lf = finProyecto;
      for (const v of efectivos(sucsDe, t.id)) {
        const q = c.get(v.succ), L = v.retraso || 0;
        if (v.tipo === 'FS') lf = Math.min(lf, q.ls - L);
        else if (v.tipo === 'SS') lf = Math.min(lf, q.ls - L + d);
        else if (v.tipo === 'FF') lf = Math.min(lf, q.lf - L);
        else if (v.tipo === 'SF') lf = Math.min(lf, q.lf - L + d);
      }
      const f = t.fechaRestriccion;
      if (f && t.restriccion === 'SNLT') lf = Math.min(lf, idxHito(t, f) + d);
      if (f && t.restriccion === 'FNLT') lf = Math.min(lf, cal.indice(f) + 1);
      if (f && (t.restriccion === 'MSO' || t.restriccion === 'MFO')) lf = Math.min(lf, x.e);
      if (lf !== x.lf) { x.lf = lf; x.ls = lf - d; cambio = true; }
    }
  }
  recalcResumenes('ls', 'lf');

  // ---------- Recursos: trabajo y sobreasignación ----------
  const recPorId = new Map(recursos.map(r => [r.id, r]));
  const carga = new Map(); // recurso → Map(día → unidades)
  for (const t of tareas) Object.assign(c.get(t.id), { trabajo: 0, sobreasignada: false });
  for (const a of asignaciones) {
    const t = porId.get(a.tarea), r = recPorId.get(a.recurso);
    if (!t || !r || info.get(t.id).resumen) continue;
    const x = c.get(t.id), u = a.unidades ?? 1, d = dur(t);
    if (r.tipo && r.tipo !== 'trabajo') continue;
    const horas = u * d * horasDia;
    x.trabajo += horas;
    if (!carga.has(r.id)) carga.set(r.id, new Map());
    const m = carga.get(r.id);
    for (let i = x.s; i < x.e; i++) m.set(i, (m.get(i) || 0) + u);
  }
  const sobreasignados = new Set();
  for (const [rid, m] of carga) {
    const max = recPorId.get(rid).maxUnidades ?? 1;
    if ([...m.values()].some(u => u > max + 1e-9)) sobreasignados.add(rid);
  }
  for (const a of asignaciones) {
    if (!sobreasignados.has(a.recurso) || !c.has(a.tarea)) continue;
    const x = c.get(a.tarea), m = carga.get(a.recurso), max = recPorId.get(a.recurso).maxUnidades ?? 1;
    for (let i = x.s; i < x.e; i++) if (m.get(i) > max + 1e-9) { x.sobreasignada = true; break; }
  }

  // ---------- Resultado por tarea ----------
  for (const t of resumenesAbajoArriba) {
    const x = c.get(t.id), hijos = info.get(t.id).hijos.map(h => ({ t: porId.get(h), x: c.get(h) }));
    x.trabajo = hijos.reduce((a, h) => a + h.x.trabajo, 0);
    // % completado del resumen ponderado por duración
    const tot = hijos.reduce((a, h) => a + Math.max(1, h.x.e - h.x.s), 0);
    t.porcentaje = Math.round(hijos.reduce((a, h) => a + (h.t.porcentaje || 0) * Math.max(1, h.x.e - h.x.s), 0) / tot);
    t.duracion = x.e - x.s;
  }
  const res = new Map();
  for (const t of tareas) {
    const i = info.get(t.id), x = c.get(t.id);
    const holgura = x.ls - x.s;
    const r = {
      ...i, ...x, holgura,
      critica: !i.resumen && holgura <= 0,
      hito: !i.resumen && dur(t) === 0,
      comienzo: cal.fechaComienzo(x.s, x.e),
      fin: cal.fechaFin(x.s, x.e),
      tardeLimite: !!(t.fechaLimite && x.e > cal.indice(t.fechaLimite) + 1),
      conflicto: false,
    };
    if (t.restriccion === 'SNLT' && t.fechaRestriccion && x.s > idxHito(t, t.fechaRestriccion)) r.conflicto = true;
    if (t.restriccion === 'FNLT' && t.fechaRestriccion && x.e > cal.indice(t.fechaRestriccion) + 1) r.conflicto = true;
    res.set(t.id, r);
  }
  for (const t of resumenesAbajoArriba) {
    res.get(t.id).critica = info.get(t.id).hijos.some(h => res.get(h).critica);
  }
  return {
    cal, info, tareas: res, errores, sobreasignados,
    comienzo: cal.fecha(0),
    fin: cal.fechaFin(0, finProyecto),
    finIdx: finProyecto,
  };
}
