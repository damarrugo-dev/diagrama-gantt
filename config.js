// Conexión a la base de datos. Si las dos quedan en null, el diagrama funciona en
// "modo de prueba" (solo guarda en este navegador).

// ---- Opción 1: Firebase (Firestore) ----
// Firebase → ⚙ Configuración del proyecto → Tus apps → app web → copia el bloque firebaseConfig.
// Esa configuración es pública por diseño: los datos los protegen las reglas de firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyBxlBYme-zQKNdn3bg6SFejD0VUfpK6s2k",
  authDomain: "diagrama-gantt-a9d62.firebaseapp.com",
  projectId: "diagrama-gantt-a9d62",
  storageBucket: "diagrama-gantt-a9d62.firebasestorage.app",
  messagingSenderId: "679581264616",
  appId: "1:679581264616:web:101d889cc075045566375d"
};

// Inicio de sesión con Firebase: llega un enlace al correo.
// Solo se aceptan correos de estos dominios (deben coincidir con firestore.rules). [] = cualquier correo.
// administradores: ven el registro de accesos (botón "Accesos"); deben coincidir con firestore.rules.
export const login = {
  dominios: ["hitss.com", "anava.com"],
  administradores: ["marrugod@hitss.com"],
};

// ---- Opción 2: Supabase (PostgreSQL) ----
// Supabase → Project Settings → API: "Project URL" y la clave "anon public".
// NUNCA pongas aquí la clave "service_role".
export const supabaseUrl = null;
export const supabaseAnonKey = null;
