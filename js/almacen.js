// Dónde se guardan los proyectos:
// - AlmacenLocal: en el navegador (modo de prueba, sin base de datos)
// - AlmacenSupabase: en la base de datos privada de Supabase (Postgres + RLS)

export const nuevoId = () => crypto.randomUUID();

export function proyectoVacio(nombre, inicio) {
  return {
    id: nuevoId(), nombre: nombre || 'Proyecto nuevo', inicio,
    diasLaborables: [1, 2, 3, 4, 5], horasDia: 8, moneda: 'COP',
    excepciones: [], tareas: [], dependencias: [], recursos: [], asignaciones: [],
  };
}

// ---------- Navegador ----------
export class AlmacenLocal {
  modo = 'local';
  clave = 'gantt:proyectos';
  leer() {
    try { return JSON.parse(localStorage.getItem(this.clave)) || {}; } catch { return {}; }
  }
  escribir(todos) { localStorage.setItem(this.clave, JSON.stringify(todos)); }
  async listar() {
    return Object.values(this.leer()).map(p => ({ id: p.id, nombre: p.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  async cargar(id) { return structuredClone(this.leer()[id] || null); }
  async guardar(p) {
    const todos = this.leer();
    todos[p.id] = p;
    this.escribir(todos);
  }
  async crear(p) { await this.guardar(p); return p; }
  async eliminar(id) {
    const todos = this.leer();
    delete todos[id];
    this.escribir(todos);
  }
}

// ---------- Supabase ----------
// Columnas de cada tabla ↔ propiedades en la aplicación
const MAPAS = {
  tareas: {
    id: 'id', posicion: 'posicion', nivel: 'nivel', nombre: 'nombre', duracion: 'duracion', modo: 'modo',
    comienzo_manual: 'comienzoManual', restriccion: 'restriccion', fecha_restriccion: 'fechaRestriccion',
    fecha_limite: 'fechaLimite', porcentaje: 'porcentaje', costo_fijo: 'costoFijo', notas: 'notas',
    lb_comienzo: 'lbComienzo', lb_fin: 'lbFin', lb_duracion: 'lbDuracion', lb_costo: 'lbCosto', color: 'color',
  },
  dependencias: { id: 'id', predecesora: 'pred', sucesora: 'succ', tipo: 'tipo', retraso: 'retraso' },
  recursos: {
    id: 'id', nombre: 'nombre', iniciales: 'iniciales', tipo: 'tipo', max_unidades: 'maxUnidades',
    tasa_estandar: 'tasaEstandar', costo_por_uso: 'costoPorUso', grupo: 'grupo', correo: 'correo',
  },
  asignaciones: { id: 'id', tarea_id: 'tarea', recurso_id: 'recurso', unidades: 'unidades' },
  excepciones_calendario: { id: 'id', fecha: 'fecha', laborable: 'laborable', nombre: 'nombre' },
};
const CLAVE_EN_APP = { tareas: 'tareas', dependencias: 'dependencias', recursos: 'recursos', asignaciones: 'asignaciones', excepciones_calendario: 'excepciones' };

const aApp = (tabla, fila) => Object.fromEntries(Object.entries(MAPAS[tabla]).map(([col, prop]) => [prop, fila[col] ?? undefined]));
const aBD = (tabla, obj, proyectoId) => {
  const fila = { proyecto_id: proyectoId };
  for (const [col, prop] of Object.entries(MAPAS[tabla])) fila[col] = obj[prop] === undefined || obj[prop] === '' ? null : obj[prop];
  return fila;
};

export class AlmacenSupabase {
  modo = 'supabase';
  constructor(cliente) {
    this.sb = cliente;
    this.guardado = new Map(); // proyecto → { tabla → Set(ids) } tal como quedó en la base de datos
  }
  async ok(promesa) {
    const { data, error } = await promesa;
    if (error) throw new Error(error.message);
    return data;
  }
  async listar() {
    return this.ok(this.sb.from('proyectos').select('id, nombre').order('nombre'));
  }
  async cargar(id) {
    const [p] = await this.ok(this.sb.from('proyectos').select('*').eq('id', id));
    if (!p) return null;
    const proyecto = {
      id: p.id, nombre: p.nombre, inicio: p.inicio, diasLaborables: p.dias_laborables,
      horasDia: +p.horas_dia, moneda: p.moneda, propietario: p.propietario,
    };
    const ids = {};
    await Promise.all(Object.keys(MAPAS).map(async tabla => {
      let q = this.sb.from(tabla).select('*').eq('proyecto_id', id);
      if (tabla === 'tareas') q = q.order('posicion');
      const filas = await this.ok(q);
      proyecto[CLAVE_EN_APP[tabla]] = filas.map(f => aApp(tabla, f));
      ids[tabla] = new Set(filas.map(f => f.id));
    }));
    for (const t of proyecto.tareas) t.duracion = +t.duracion;
    for (const d of proyecto.dependencias) d.retraso = +d.retraso;
    this.guardado.set(id, ids);
    return proyecto;
  }
  async crear(p) {
    await this.ok(this.sb.from('proyectos').insert({
      id: p.id, nombre: p.nombre, inicio: p.inicio, dias_laborables: p.diasLaborables, horas_dia: p.horasDia, moneda: p.moneda,
    }));
    this.guardado.set(p.id, Object.fromEntries(Object.keys(MAPAS).map(t => [t, new Set()])));
    await this.guardar(p);
    return p;
  }
  async guardar(p) {
    await this.ok(this.sb.from('proyectos').update({
      nombre: p.nombre, inicio: p.inicio, dias_laborables: p.diasLaborables, horas_dia: p.horasDia, moneda: p.moneda,
    }).eq('id', p.id));
    const antes = this.guardado.get(p.id) || {};
    const ahora = {};
    // Primero se borra lo eliminado (vínculos y asignaciones antes que tareas y recursos)
    for (const tabla of ['dependencias', 'asignaciones', 'excepciones_calendario', 'tareas', 'recursos']) {
      ahora[tabla] = new Set(p[CLAVE_EN_APP[tabla]].map(x => x.id));
      const borrar = [...(antes[tabla] || [])].filter(id => !ahora[tabla].has(id));
      if (borrar.length) await this.ok(this.sb.from(tabla).delete().in('id', borrar));
    }
    // Luego se guarda lo nuevo y lo modificado (tareas y recursos antes que lo que los referencia)
    for (const tabla of ['tareas', 'recursos', 'excepciones_calendario', 'dependencias', 'asignaciones']) {
      const filas = p[CLAVE_EN_APP[tabla]].map((x, i) => {
        const f = aBD(tabla, x, p.id);
        if (tabla === 'tareas') f.posicion = i;
        return f;
      });
      if (filas.length) await this.ok(this.sb.from(tabla).upsert(filas));
    }
    this.guardado.set(p.id, ahora);
  }
  async eliminar(id) {
    await this.ok(this.sb.from('proyectos').delete().eq('id', id));
  }
}
