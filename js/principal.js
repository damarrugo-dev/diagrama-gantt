// Página de planeación: el Diagrama de Gantt y el Tablero Kanban conviven en la misma página.
// El interruptor de arriba cambia de vista sin recargar; se entra una sola vez.
import { $ } from './util.js';
import { conectar, sesion } from './sesion.js';
import { iniciarGantt, mostrarGantt, ganttApi } from './app.js';
import { iniciarKanban, mostrarKanban, kanbanApi } from '../kanban/kanban.js';
import * as enlaces from './enlaces.js';

const VISTAS = ['gantt', 'kanban'];
let actual = null;

export function mostrar(vista) {
  if (!VISTAS.includes(vista)) vista = 'gantt';
  if (vista === actual) return;
  actual = vista;
  document.body.dataset.vista = vista;
  for (const v of VISTAS) {
    for (const el of document.querySelectorAll(`[data-de="${v}"]`)) el.hidden = v !== vista;
    $(`#ver-${v}`).setAttribute('aria-pressed', String(v === vista));
  }
  try { localStorage.setItem('planeacion:vista', vista); } catch {}
  const url = new URL(location.href);
  url.searchParams.set('vista', vista);
  history.replaceState(null, '', url);
  enlaces.invalidar(); // al cambiar de vista se ven los datos más recientes de la otra
  mostrarGantt(vista === 'gantt');
  mostrarKanban(vista === 'kanban');
}

async function arrancar() {
  for (const v of VISTAS) $(`#ver-${v}`).onclick = () => mostrar(v);
  let inicial = new URLSearchParams(location.search).get('vista');
  if (!inicial) { try { inicial = localStorage.getItem('planeacion:vista'); } catch {} }
  if (!inicial && new URLSearchParams(location.search).has('tablero')) inicial = 'kanban';
  mostrar(inicial || 'gantt');

  enlaces.registrar(ganttApi, kanbanApi, mostrar);
  try { await conectar(); }
  catch (err) {
    console.error(err);
    const b = $('#banner');
    b.className = 'banner error';
    b.textContent = 'No se pudo conectar con la base de datos en línea. Revisa tu conexión a internet y recarga la página.';
    b.hidden = false;
    return;
  }
  await Promise.all([iniciarGantt(sesion), iniciarKanban(sesion)]);
  const v = actual; actual = null; mostrar(v); // dibuja la vista visible ya con datos
}

arrancar();
