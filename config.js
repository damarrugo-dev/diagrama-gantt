// Conexión a la base de datos privada (Supabase).
// Mientras supabaseUrl sea null, el diagrama funciona en "modo de prueba" (solo guarda en este navegador).
//
// Estos dos valores están en Supabase → Project Settings → API:
//   - Project URL
//   - anon / public key  (es pública por diseño: los datos los protegen las reglas RLS de supabase/schema.sql)
// NUNCA pongas aquí la clave "service_role": esa sí es secreta.
export const supabaseUrl = null;      // p. ej. "https://abcdefghijk.supabase.co"
export const supabaseAnonKey = null;  // p. ej. "eyJhbGciOi..."
