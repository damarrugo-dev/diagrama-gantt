// Conexión a la base de datos (Firebase), inicio de sesión, nombre de la persona, tema claro/oscuro
// y control de acceso. Es lo mismo para la vista Gantt y la vista Kanban: se entra una sola vez.
import { firebaseConfig, login } from '../config.js';
import { $, h, ask, showMenu, downloadCsv } from './util.js';

export const VERSION_FIREBASE = '10.12.2';
const GS = `https://www.gstatic.com/firebasejs/${VERSION_FIREBASE}`;

// modo: 'local' (modo de prueba, solo este navegador) o 'firebase'
export const sesion = { modo: 'local', fs: null, db: null, app: null, auth: null, correo: '' };

// ---------- Nombre de la persona ----------
const USER_KEY = 'kanban:usuario';
let signedInName = null; // con inicio de sesión de Microsoft, el nombre viene de la cuenta
export function me() {
  if (signedInName) return signedInName;
  const fallback = sesion.correo || 'Anónimo';
  try { return localStorage.getItem(USER_KEY) || fallback; } catch { return fallback; }
}
export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
export function hueOf(text) {
  let n = 0;
  for (const ch of text || '') n = (n * 31 + ch.charCodeAt(0)) % 360;
  return n;
}
export async function askName(first = false) {
  const name = await ask({
    title: first ? '¿Cómo te llamas?' : 'Cambiar mi nombre',
    hint: 'Tu nombre aparece en el historial cuando creas o mueves tarjetas.',
    value: first ? '' : me(),
  });
  if (name) { try { localStorage.setItem(USER_KEY, name); } catch {} }
  renderUser();
}
export function preguntarNombreSiFalta() {
  try { if (!signedInName && !localStorage.getItem(USER_KEY)) askName(true); } catch {}
}
function renderUser() {
  const chip = $('#userChip');
  chip.textContent = '';
  chip.append(h('span', { class: 'avatar', style: `--h:${hueOf(me())}` }, initials(me())), h('span', { class: 'user-name' }, me()));
}

// ---------- Modo claro / oscuro (se recuerda en cada navegador) ----------
function renderThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const btn = $('#themeBtn');
  btn.textContent = dark ? '☀' : '☾';
  btn.title = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  btn.setAttribute('aria-label', btn.title);
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('kanban:tema', dark ? 'dark' : 'light'); } catch {}
  renderThemeBtn();
  window.dispatchEvent(new Event('cambio-tema'));
}

// ---------- Conexión ----------
export async function conectar() {
  $('#themeBtn').onclick = toggleTheme;
  renderThemeBtn();
  $('#userChip').onclick = () => askName(false);
  $('#accessBtn').onclick = openAccessLog;
  renderUser();
  if (!firebaseConfig) return sesion;

  const { initializeApp } = await import(`${GS}/firebase-app.js`);
  const fs = await import(`${GS}/firebase-firestore.js`);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  Object.assign(sesion, { modo: 'firebase', fs, db, app });
  if (login) {
    accessLog = createAccessLog(fs, db);
    await signIn(app);
  }
  return sesion;
}

// Inicio de sesión: solo entran correos del dominio de la empresa.
// login.metodo = "correo": la persona recibe un enlace en su correo y entra con él.
// login.metodo = "microsoft": entra con su cuenta de Microsoft (requiere registrar la app en Microsoft Entra).
async function signIn(app) {
  const au = await import(`${GS}/firebase-auth.js`);
  const auth = au.getAuth(app);
  sesion.auth = auth;
  const domains = [].concat(login.dominios || login.dominio || []).map(d => d.toLowerCase().trim().replace(/^@/, '')).filter(Boolean);
  const domainText = domains.length ? domains.map(d => '@' + d).join(' o ') : 'de la empresa';
  const allowed = email => !domains.length || domains.some(d => (email || '').toLowerCase().endsWith('@' + d));
  const EMAIL_KEY = 'kanban:correo-para-entrar';

  const gate = $('#loginGate');
  const msg = $('#loginMsg');
  const signOutBtn = $('#loginSignOut');
  const say = (text, ok = false) => { msg.textContent = text; msg.classList.toggle('ok', ok); };
  $('#loginDomain').textContent = domainText;

  if (login.metodo === 'microsoft') {
    const provider = new au.OAuthProvider('microsoft.com');
    provider.setCustomParameters({ tenant: login.tenant || 'organizations', prompt: 'select_account' });
    await au.getRedirectResult(auth).catch(err => console.error(err));
    $('#loginMs').hidden = false;
    $('#loginBtn').onclick = async () => {
      say('');
      try { await au.signInWithPopup(auth, provider); }
      catch (err) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) return au.signInWithRedirect(auth, provider);
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') say('No se pudo iniciar sesión: ' + (err.message || err.code));
      }
    };
  } else {
    // Volvió desde el enlace del correo
    if (au.isSignInWithEmailLink(auth, location.href)) {
      let email = '';
      try { email = localStorage.getItem(EMAIL_KEY) || ''; } catch {}
      if (!email) email = await ask({ title: 'Confirma tu correo', hint: 'Escribe el mismo correo al que llegó el enlace.' }) || '';
      try {
        await au.signInWithEmailLink(auth, email, location.href);
        try { localStorage.removeItem(EMAIL_KEY); } catch {}
      } catch (err) {
        console.error(err);
        say('El enlace ya se usó o venció. Pide uno nuevo.');
      }
      const clean = new URL(location.href);
      for (const k of [...clean.searchParams.keys()]) if (!['vista', 'proyecto', 'tablero'].includes(k)) clean.searchParams.delete(k);
      history.replaceState(null, '', clean.href);
    }
    $('#loginEmailForm').hidden = false;
    $('#loginEmailForm').onsubmit = async e => {
      e.preventDefault();
      const email = $('#loginEmail').value.trim().toLowerCase();
      if (!allowed(email)) {
        accessLog.record('rechazado', email);
        return say(`Usa tu correo ${domainText}.`);
      }
      const btn = $('#loginSend');
      btn.disabled = true;
      try {
        const url = new URL(location.href);
        url.hash = '';
        await au.sendSignInLinkToEmail(auth, email, { url: url.href, handleCodeInApp: true });
        accessLog.record('solicitud', email);
        try { localStorage.setItem(EMAIL_KEY, email); } catch {}
        say(`Listo. Revisa tu correo ${email} (también la carpeta de spam) y abre el enlace en este mismo dispositivo.`, true);
      } catch (err) {
        console.error(err);
        say('No se pudo enviar el enlace: ' + (err.message || err.code));
      } finally { btn.disabled = false; }
    };
  }

  signOutBtn.onclick = () => au.signOut(auth);
  $('#userChip').onclick = e => showMenu(e.currentTarget, [
    { label: auth.currentUser?.email || '', disabled: true, action: () => {} },
    { label: 'Cambiar mi nombre', action: () => askName(false) },
    { label: 'Cerrar sesión', action: () => au.signOut(auth).then(() => location.reload()) },
  ]);

  await auth.authStateReady();
  return new Promise(resolve => {
    au.onAuthStateChanged(auth, user => {
      if (user && allowed(user.email)) {
        sesion.correo = user.email.toLowerCase();
        accessLog.recordEntry(user);
        if (isAdmin(user.email)) $('#accessBtn').hidden = false;
        signedInName = user.displayName || null;
        renderUser();
        gate.hidden = true;
        resolve(user);
        return;
      }
      gate.hidden = false;
      signOutBtn.hidden = !user;
      if (user) say(`La cuenta ${user.email || ''} no tiene acceso. Entra con tu correo ${domainText}.`);
    });
  });
}

// ---------- Control de acceso ----------
// Guarda en Firestore (colección "accesos") quién pide el enlace, quién entra y quién es rechazado.
// Solo los administradores de config.js pueden ver el registro.
let accessLog = { record() {}, recordEntry() {}, list: async () => [] };
const isAdmin = email => (login?.administradores || []).map(a => a.toLowerCase()).includes((email || '').toLowerCase());
const EVENT_TEXT = { solicitud: 'Pidió el enlace', ingreso: 'Entró', rechazado: 'Rechazado (correo no permitido)' };

function createAccessLog(fs, db) {
  const col = fs.collection(db, 'accesos');
  const browser = () => {
    const ua = navigator.userAgent;
    const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Celular' : 'Computador';
    const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Otro';
    return `${device} · ${name}`;
  };
  // "tablero" dice desde dónde entró: esta página se registra como "planeacion"
  const write = data => fs.addDoc(col, { ...data, tablero: 'planeacion', navegador: browser(), fecha: fs.serverTimestamp() })
    .catch(err => console.warn('No se pudo registrar el acceso', err));
  return {
    record: (tipo, email) => write({ tipo, email: (email || '').toLowerCase().slice(0, 200) }),
    // Una vez por visita (pestaña abierta), no en cada recarga
    recordEntry(user) {
      const key = 'kanban:ingreso-registrado';
      try { if (sessionStorage.getItem(key) === user.uid) return; sessionStorage.setItem(key, user.uid); } catch {}
      write({ tipo: 'ingreso', email: (user.email || '').toLowerCase(), nombre: me() === user.email ? '' : me() });
    },
    async list() {
      const q = fs.query(col, fs.orderBy('fecha', 'desc'), fs.limit(1000));
      const snap = await fs.getDocs(q);
      return snap.docs.map(d => { const x = d.data(); return { ...x, fecha: x.fecha?.toDate?.() || null }; });
    },
  };
}

const LUGAR = t => !t ? '—' : t === 'planeacion' ? 'Planeación (Gantt y Kanban)' : `Kanban: ${t}`;

async function openAccessLog() {
  const d = $('#accessDialog');
  const body = $('#accessBody');
  body.textContent = 'Cargando…';
  if (!d.open) d.showModal();
  let rows;
  try { rows = await accessLog.list(); }
  catch (err) {
    console.error(err);
    body.textContent = 'No se pudo leer el registro. Revisa que las reglas de Firestore estén publicadas.';
    return;
  }
  const fmt = dt => dt ? dt.toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  // Resumen por persona
  const people = new Map();
  for (const r of rows) {
    const p = people.get(r.email) || { email: r.email, nombre: '', solicitudes: 0, ingresos: 0, rechazos: 0, primero: null, ultimo: null };
    if (r.nombre) p.nombre = p.nombre || r.nombre;
    if (r.tipo === 'solicitud') p.solicitudes++;
    if (r.tipo === 'rechazado') p.rechazos++;
    if (r.tipo === 'ingreso') {
      p.ingresos++;
      if (r.fecha && (!p.ultimo || r.fecha > p.ultimo)) p.ultimo = r.fecha;
      if (r.fecha && (!p.primero || r.fecha < p.primero)) p.primero = r.fecha;
    }
    people.set(r.email, p);
  }
  const summary = [...people.values()].sort((a, b) => (b.ultimo || 0) - (a.ultimo || 0));

  let tab = 'personas';
  const draw = () => {
    body.textContent = '';
    body.append(
      h('div', { class: 'tabs' },
        h('button', { class: 'btn' + (tab === 'personas' ? ' primary' : ''), onclick: () => { tab = 'personas'; draw(); } }, `Personas (${summary.length})`),
        h('button', { class: 'btn' + (tab === 'eventos' ? ' primary' : ''), onclick: () => { tab = 'eventos'; draw(); } }, `Movimientos (${rows.length})`),
        h('button', { class: 'btn', onclick: () => exportAccess(rows) }, 'Exportar')),
      tab === 'personas'
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'access-table' },
            h('thead', {}, h('tr', {}, ['Correo', 'Nombre', 'Pidió enlace', 'Entradas', 'Primera entrada', 'Última entrada'].map(t => h('th', {}, t)))),
            h('tbody', {}, summary.map(p => h('tr', { class: p.rechazos && !p.ingresos ? 'denied' : '' },
              h('td', {}, p.email), h('td', {}, p.nombre || '—'), h('td', {}, p.solicitudes + (p.rechazos ? ` (${p.rechazos} rechazado)` : '')),
              h('td', {}, p.ingresos), h('td', {}, fmt(p.primero)), h('td', {}, fmt(p.ultimo)))))))
        : h('div', { class: 'table-wrap' }, h('table', { class: 'access-table' },
            h('thead', {}, h('tr', {}, ['Fecha', 'Correo', 'Qué pasó', 'Dónde', 'Dispositivo'].map(t => h('th', {}, t)))),
            h('tbody', {}, rows.map(r => h('tr', { class: r.tipo === 'rechazado' ? 'denied' : '' },
              h('td', {}, fmt(r.fecha)), h('td', {}, r.email + (r.nombre ? ` (${r.nombre})` : '')),
              h('td', {}, EVENT_TEXT[r.tipo] || r.tipo), h('td', {}, LUGAR(r.tablero)), h('td', {}, r.navegador || '—')))))),
      rows.length ? '' : h('p', { class: 'muted' }, 'Todavía no hay registros.'));
  };
  draw();
}

function exportAccess(rows) {
  const out = [['Fecha', 'Correo', 'Nombre', 'Qué pasó', 'Dispositivo', 'Dónde']];
  for (const r of rows) out.push([r.fecha ? r.fecha.toLocaleString('es-CO') : '', r.email, r.nombre || '', EVENT_TEXT[r.tipo] || r.tipo, r.navegador || '', LUGAR(r.tablero)]);
  downloadCsv(out, `accesos-${new Date().toISOString().slice(0, 10)}.csv`);
}
