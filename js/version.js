// Aviso de versión nueva: cada pocos minutos se revisa si cambió algún archivo publicado
// (GitHub Pages) y, si cambió, se ofrece recargar. No se recarga solo para no cortar lo que se está haciendo.
import { $, h } from './util.js';

const CADA = 3 * 60 * 1000;

// Los mismos archivos que carga la página (la lista del importmap de index.html) más la página y los estilos
function archivos() {
  let mapa = {};
  try { mapa = JSON.parse(document.querySelector('script[type=importmap]')?.textContent || '{}').imports || {}; } catch {}
  return [location.pathname, 'styles.css', ...Object.keys(mapa)].map(f => new URL(f, location.href).href);
}

// Huella de un archivo sin descargarlo: su ETag o su fecha de modificación
async function huella(url) {
  const r = await fetch(`${url}?revisar=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  return r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length') || '';
}
const huellas = () => Promise.all(archivos().map(huella)).then(x => x.join('|'));

let inicial = null, avisado = false;
async function revisar() {
  if (avisado || document.hidden) return;
  let actual;
  try { actual = await huellas(); } catch { return; } // sin conexión: se intenta en la siguiente vuelta
  if (inicial === null) { inicial = actual; return; }
  if (actual !== inicial) mostrarAviso();
}

function mostrarAviso() {
  avisado = true;
  const aviso = h('div', { class: 'nueva-version', role: 'status' },
    h('span', {}, 'Hay una versión nueva de la página.'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => location.reload() }, 'Actualizar'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Más tarde', 'aria-label': 'Cerrar', onclick: () => aviso.remove() }, '✕'));
  document.body.append(aviso);
}

export function vigilarVersion() {
  if (!/^https?:$/.test(location.protocol)) return;
  revisar();
  setInterval(revisar, CADA);
  document.addEventListener('visibilitychange', revisar);
}
