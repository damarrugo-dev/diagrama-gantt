// Traer los proyectos que se hicieron en el Diagrama de Gantt cuando tenía su propia base de datos.
// Usa la sesión que quedó guardada en este navegador para esa base (no hay que volver a entrar).
import { firebaseAnterior } from '../config.js';
import { VERSION_FIREBASE } from './sesion.js';
import { $, h, toast } from './util.js';

const GS = `https://www.gstatic.com/firebasejs/${VERSION_FIREBASE}`;

// Firebase guarda la sesión por "nombre de app": se copia la de la app principal de antes a una app aparte
function copiarSesion(apiKey, nombre) {
  return new Promise(resolve => {
    let pedido;
    try { pedido = indexedDB.open('firebaseLocalStorageDb'); } catch { return resolve(false); }
    pedido.onerror = () => resolve(false);
    pedido.onupgradeneeded = () => { pedido.transaction.abort(); resolve(false); };
    pedido.onsuccess = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); return resolve(false); }
      const tx = db.transaction('firebaseLocalStorage', 'readwrite');
      const store = tx.objectStore('firebaseLocalStorage');
      const origen = `firebase:authUser:${apiKey}:[DEFAULT]`;
      const leer = store.get(origen);
      leer.onsuccess = () => {
        const reg = leer.result;
        if (!reg) return resolve(false);
        store.put({ ...reg, fbase_key: `firebase:authUser:${apiKey}:${nombre}` });
      };
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
  });
}

let anterior = null;
async function conectarAnterior() {
  if (anterior) return anterior;
  const { initializeApp } = await import(`${GS}/firebase-app.js`);
  const fs = await import(`${GS}/firebase-firestore.js`);
  const au = await import(`${GS}/firebase-auth.js`);
  await copiarSesion(firebaseAnterior.apiKey, 'gantt-anterior');
  const app = initializeApp(firebaseAnterior, 'gantt-anterior');
  const auth = au.getAuth(app);
  await auth.authStateReady();
  anterior = { fs, db: fs.getFirestore(app), usuario: auth.currentUser };
  return anterior;
}

// almacen: el de la página (base nueva); alTerminar(id): abre el proyecto traído
export async function dialogoMigrar(almacen, alTerminar) {
  const d = $('#enlaceDialog');
  const cuerpo = h('div', { class: 'migrar' }, h('p', { class: 'hint' }, 'Buscando tus proyectos del Gantt anterior…'));
  const botonOk = h('button', { value: 'ok', class: 'btn primary', disabled: true }, 'Traer');
  d.replaceChildren(h('form', { method: 'dialog' }, h('h2', {}, 'Traer proyectos del Gantt anterior'), cuerpo,
    h('div', { class: 'ask-actions' }, h('button', { value: 'cancel', formnovalidate: true, class: 'btn' }, 'Cancelar'), botonOk)));
  d.returnValue = '';
  d.showModal();

  let proyectos = [];
  try {
    const { fs, db, usuario } = await conectarAnterior();
    if (!usuario) {
      cuerpo.replaceChildren(h('p', {}, 'No encontré tu sesión del Gantt anterior en este navegador. Abre esta página en el navegador y la cuenta con que usabas el Gantt y vuelve a intentarlo.'));
      return;
    }
    const correo = usuario.email.toLowerCase();
    const qs = await fs.getDocs(fs.query(fs.collection(db, 'gantt_proyectos'), fs.where('acceso', 'array-contains', correo)));
    proyectos = qs.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  } catch (err) {
    console.error(err);
    cuerpo.replaceChildren(h('p', {}, 'No se pudo leer la base de datos anterior: ' + (err.message || err)));
    return;
  }
  if (!proyectos.length) {
    cuerpo.replaceChildren(h('p', {}, 'No tienes proyectos en el Gantt anterior.'));
    return;
  }
  const yaEstan = new Set((await almacen.listar()).map(p => p.id));
  const casillas = proyectos.map(p => {
    const ya = yaEstan.has(p.id);
    return h('label', { class: 'radio' }, h('input', { type: 'checkbox', value: p.id, checked: !ya, disabled: ya }),
      `${p.nombre || 'Proyecto'} (${p.datos?.tareas?.length || 0} tareas)${ya ? ' · ya está aquí' : ''}`);
  });
  cuerpo.replaceChildren(
    h('p', { class: 'hint' }, 'Se copian a la base de datos compartida con el Kanban. Los originales no se borran.'),
    h('div', { class: 'radios' }, casillas));
  botonOk.disabled = false;

  d.addEventListener('close', async () => {
    if (d.returnValue !== 'ok') return;
    const elegidos = casillas.map(c => c.querySelector('input')).filter(i => i.checked && !i.disabled).map(i => i.value);
    let primero = null;
    for (const p of proyectos.filter(x => elegidos.includes(x.id))) {
      const nuevo = {
        id: p.id, nombre: p.nombre, inicio: p.inicio, diasLaborables: p.diasLaborables, horasDia: p.horasDia, moneda: p.moneda,
        ...Object.fromEntries(['tareas', 'dependencias', 'recursos', 'asignaciones', 'excepciones'].map(k => [k, p.datos?.[k] || []])),
      };
      try { await almacen.crear(nuevo); primero ||= nuevo.id; }
      catch (err) { console.error(err); toast(`No se pudo traer "${p.nombre}": ${err.message || err}`); }
    }
    if (primero) { toast(elegidos.length === 1 ? 'Proyecto traído.' : `${elegidos.length} proyectos traídos.`); alTerminar(primero); }
  }, { once: true });
}
