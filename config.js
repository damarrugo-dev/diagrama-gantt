// Conexión a la base de datos compartida (Firebase). Es la misma del Tablero Kanban:
// así el Gantt y el Kanban ven los mismos datos y se entra una sola vez.
// Si se pone en null, la página funciona en "modo de prueba" (solo guarda en este navegador).
// Esta configuración es pública por diseño: los datos los protegen las reglas de firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyA0c0X87PBi3a21YJOkH970xE12OHiaY_Y",
  authDomain: "tablero-kanban-f5f28.firebaseapp.com",
  projectId: "tablero-kanban-f5f28",
  storageBucket: "tablero-kanban-f5f28.firebasestorage.app",
  messagingSenderId: "670983517801",
  appId: "1:670983517801:web:f2918705cfdc983870d4f8"
};

// Inicio de sesión: solo entran personas con correo de la empresa.
//   metodo: "correo"     → llega un enlace al correo | "microsoft" → cuenta de Microsoft
//   dominios             → solo se aceptan correos de estos dominios (deben coincidir con firestore.rules)
//   administradores      → ven el registro de accesos (botón "Accesos"); deben coincidir con firestore.rules
//   tenant: "..."        → solo para "microsoft": ID del directorio de Microsoft Entra
export const login = {
  metodo: "correo",
  dominios: ["hitss.com", "anava.com"],
  administradores: ["marrugod@hitss.com"],
};

// Base de datos que usaba el Diagrama de Gantt antes de unirse con el Kanban.
// Solo se usa para "Traer proyectos del Gantt anterior" (menú de proyectos).
export const firebaseAnterior = {
  apiKey: "AIzaSyBxlBYme-zQKNdn3bg6SFejD0VUfpK6s2k",
  authDomain: "diagrama-gantt-a9d62.firebaseapp.com",
  projectId: "diagrama-gantt-a9d62",
  storageBucket: "diagrama-gantt-a9d62.firebasestorage.app",
  messagingSenderId: "679581264616",
  appId: "1:679581264616:web:101d889cc075045566375d"
};
