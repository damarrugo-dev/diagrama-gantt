// Calendario laboral: convierte fechas en "índices de día laborable" y viceversa.
// El índice 0 es el primer día laborable en o después del comienzo del proyecto.
// Todas las cuentas del programador se hacen con índices enteros:
//   una tarea ocupa [inicio, fin) — p. ej. inicio 3, duración 2 → fin 5 (días 3 y 4).

const DAY = 86400000;

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDaysISO(iso, n) {
  return toISO(parseISO(iso) + n * DAY);
}
export function weekday(iso) {
  return new Date(parseISO(iso)).getUTCDay(); // 0 = domingo
}

export class Calendario {
  // diasLaborables: números de día de la semana (1 = lunes ... 0 = domingo)
  // excepciones: [{ fecha: 'YYYY-MM-DD', laborable: false, nombre: 'Festivo' }]
  constructor(inicioProyecto, diasLaborables = [1, 2, 3, 4, 5], excepciones = []) {
    this.dias = new Set(diasLaborables);
    this.exc = new Map(excepciones.map(e => [e.fecha, !!e.laborable]));
    if (!this.dias.size && ![...this.exc.values()].some(Boolean)) this.dias = new Set([1, 2, 3, 4, 5]);
    this.fechas = [];
    let d = inicioProyecto;
    while (!this.esLaborable(d)) d = addDaysISO(d, 1);
    this.base = d;
    this.extender(400);
  }
  esLaborable(iso) {
    if (this.exc.has(iso)) return this.exc.get(iso);
    return this.dias.has(weekday(iso));
  }
  extender(n) {
    let d = this.fechas.length ? addDaysISO(this.fechas[this.fechas.length - 1], 1) : this.base;
    while (this.fechas.length < n) {
      if (this.esLaborable(d)) this.fechas.push(d);
      d = addDaysISO(d, 1);
    }
  }
  // Fecha del día laborable con índice i (i >= 0)
  fecha(i) {
    i = Math.max(0, i);
    if (i >= this.fechas.length) this.extender(i + 400);
    return this.fechas[i];
  }
  // Índice del primer día laborable en o después de la fecha
  indice(iso) {
    if (!iso || iso <= this.base) return 0;
    while (this.fechas[this.fechas.length - 1] < iso) this.extender(this.fechas.length * 2);
    let lo = 0, hi = this.fechas.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.fechas[mid] < iso) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // Fecha que se muestra como "Comienzo" y "Fin" de una tarea [s, e)
  fechaComienzo(s, e) {
    return s === e && s > 0 ? this.fecha(s - 1) : this.fecha(s);
  }
  fechaFin(s, e) {
    return e > s ? this.fecha(e - 1) : this.fechaComienzo(s, e);
  }
}
