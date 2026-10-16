// Conexión a la base de datos. Si las dos quedan en null, el diagrama funciona en
// "modo de prueba" (solo guarda en este navegador).

// ---- Opción 1: Firebase (Firestore) ----
// Firebase → ⚙ Configuración del proyecto → Tus apps → app web → copia el bloque firebaseConfig.
// Esa configuración es pública por diseño: los datos los protegen las reglas de firestore.rules.
export const firebaseConfig = null;
// export const firebaseConfig = {
//   apiKey: "...",
//   authDomain: "diagrama-gantt.firebaseapp.com",
//   projectId: "diagrama-gantt",
//   storageBucket: "diagrama-gantt.firebasestorage.app",
//   messagingSenderId: "...",
//   appId: "..."
// };

// Inicio de sesión con Firebase: llega un enlace al correo.
// Solo se aceptan correos de estos dominios (deben coincidir con firestore.rules). [] = cualquier correo.
export const login = {
  dominios: ["hitss.com", "anava.com"],
};

// ---- Opción 2: Supabase (PostgreSQL) ----
// Supabase → Project Settings → API: "Project URL" y la clave "anon public".
// NUNCA pongas aquí la clave "service_role".
export const supabaseUrl = null;
export const supabaseAnonKey = null;
