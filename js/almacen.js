// Dónde se guardan los proyectos:
// - AlmacenLocal: en el navegador (modo de prueba, sin base de datos)

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


// ---------- Firebase (Firestore) ----------
// Cada proyecto es un documento de la colección "gantt_proyectos" con todas sus tareas.
// Solo lo leen y modifican los correos que están en "acceso" (ver firestore.rules).
const DATOS = ['tareas', 'dependencias', 'recursos', 'asignaciones', 'excepciones'];

export class AlmacenFirebase {
  modo = 'firebase';
  constructor(fs, db, correo) {
    this.fs = fs;
    this.db = db;
    this.correo = correo.toLowerCase();
    this.col = fs.collection(db, 'gantt_proyectos');
  }
  async listar() {
    const qs = await this.fs.getDocs(this.fs.query(this.col, this.fs.where('acceso', 'array-contains', this.correo)));
    return qs.docs.map(d => ({ id: d.id, nombre: d.data().nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  async cargar(id) {
    const snap = await this.fs.getDoc(this.fs.doc(this.col, id));
    if (!snap.exists()) return null;
    const d = snap.data();
    const p = {
      id, nombre: d.nombre, inicio: d.inicio, diasLaborables: d.diasLaborables, horasDia: d.horasDia, moneda: d.moneda,
      propietario: d.propietario, acceso: d.acceso,
    };
    for (const k of DATOS) p[k] = d.datos?.[k] || [];
    return p;
  }
  documento(p) {
    // Firestore no acepta "undefined": se quita con JSON
    const datos = JSON.parse(JSON.stringify(Object.fromEntries(DATOS.map(k => [k, p[k] || []]))));
    return {
      nombre: p.nombre, inicio: p.inicio, diasLaborables: p.diasLaborables, horasDia: p.horasDia, moneda: p.moneda,
      datos, actualizado: this.fs.serverTimestamp(), actualizadoPor: this.correo,
    };
  }
  async crear(p) {
    p.propietario = this.correo;
    p.acceso = [this.correo];
    await this.fs.setDoc(this.fs.doc(this.col, p.id), { ...this.documento(p), propietario: p.propietario, acceso: p.acceso });
    return p;
  }
  async guardar(p) {
    await this.fs.updateDoc(this.fs.doc(this.col, p.id), this.documento(p));
  }
  async eliminar(id) {
    await this.fs.deleteDoc(this.fs.doc(this.col, id));
  }
}
