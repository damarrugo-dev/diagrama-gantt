# Diagrama de Gantt

Planificador de proyectos en línea al estilo de **Microsoft Project**: tabla de tareas a la izquierda y diagrama de Gantt a la derecha.

Es un sitio estático (`index.html`, `styles.css`, `js/`) que se publica gratis con GitHub Pages. Los datos viven en una base de datos **privada y gratuita en Supabase** (PostgreSQL). Mientras `config.js` tenga `supabaseUrl = null`, funciona en **modo de prueba** (solo guarda en el navegador).

## Funciones

| Microsoft Project | Aquí |
| --- | --- |
| Tareas, subtareas y tareas de resumen (sangría / anular sangría, contraer, EDT) | ✔ |
| Hitos (duración 0) | ✔ |
| Programación automática y manual | ✔ |
| Vínculos FC, CC, FF, CF con posposición o adelanto (`5CC+2d`) | ✔ — en la columna *Predecesoras*, en el diálogo o arrastrando de una barra a otra |
| Restricciones (Lo antes posible, No comenzar antes/después del, No finalizar antes/después del, Debe comenzar/finalizar el) | ✔ |
| Fecha límite | ✔ (marca verde; roja si se incumple) |
| Ruta crítica y margen de demora total | ✔ |
| Calendario laboral (días laborables, festivos, horas por día) | ✔ |
| Recursos de trabajo, material y costo; asignación con unidades (`Ana[50%]`) | ✔ |
| Trabajo, costo (tasa estándar, costo por uso, costo fijo) y totales en resúmenes | ✔ |
| Detección de recursos sobreasignados | ✔ |
| % completado y barra de progreso | ✔ |
| Línea base (todo el proyecto o tareas seleccionadas) | ✔ |
| Escala de tiempo: días, semanas, meses, trimestres; línea de hoy | ✔ |
| Mover barras y cambiar duración arrastrando | ✔ |
| Mostrar nivel de esquema, buscar tarea | ✔ |
| Deshacer / rehacer | ✔ |
| Exportar a Excel (CSV) e imprimir / guardar como PDF | ✔ |
| Varios proyectos por usuario, compartir con otros (tabla `miembros`) | ✔ base de datos lista; falta la pantalla para invitar |

Atajos de teclado como en Project: `Insert` (nueva tarea), `Supr` (eliminar), `Alt+Shift+→ / ←` (sangría), `Ctrl+F2` (vincular), `Ctrl+Shift+F2` (desvincular), `Shift+F2` (información de la tarea), `Ctrl+Z / Ctrl+Y`.

Duraciones: `5`, `5d`, `2sem`, `16h`, `1mes`.

## Puesta en marcha

### 1. Subir el código a GitHub y publicarlo (GitHub Pages)

1. Crea un repositorio vacío llamado **`diagrama-gantt`** en <https://github.com/new> (sin README).
   - **Público** permite GitHub Pages gratis. El código no tiene secretos; los datos quedan privados en Supabase.
   - Si lo quieres **privado**, GitHub Pages pide plan de pago: en ese caso publícalo gratis con Netlify, Vercel o Cloudflare Pages conectando el repositorio.
2. Sube estos archivos (`git push`).
3. En el repositorio: **Settings** → **Pages** → *Source*: **Deploy from a branch** → *Branch*: **main** y **/ (root)** → **Save**.
4. En uno o dos minutos queda en `https://damarrugo-dev.github.io/diagrama-gantt/`.

### 2. Base de datos privada (Supabase, gratis)

1. Entra a <https://supabase.com> → **Start your project** → inicia sesión con tu cuenta de GitHub.
2. **New project** → nombre `diagrama-gantt` → escribe una contraseña para la base de datos (guárdala) → región **South America (São Paulo)** → plan **Free** → **Create new project**.
3. Menú izquierdo **SQL Editor** → **New query** → pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Crea las tablas y las reglas de privacidad (RLS): cada usuario solo ve sus proyectos.
4. **Authentication** → **URL Configuration**:
   - *Site URL*: `https://damarrugo-dev.github.io/diagrama-gantt/`
   - *Redirect URLs* → **Add URL**: la misma dirección.
5. **Project Settings** → **API** (o **Data API** / **API Keys**): copia **Project URL** y la clave **anon public** y pégalas en [`config.js`](config.js). Sube el cambio a GitHub.
6. Abre el sitio, escribe tu correo y entra con el enlace que te llega.

Para que nadie más pueda crear cuenta: cuando tú (y tu equipo) ya hayan entrado una vez, ve a **Authentication** → **Sign In / Providers** y desactiva **Allow new users to sign up**.

> La clave **anon** es pública por diseño: lo que protege los datos son las reglas RLS. **Nunca** pongas en `config.js` la clave **service_role**.

Límites del plan gratuito que conviene saber: 500 MB de base de datos (sobra para miles de proyectos), el proyecto se **pausa tras una semana sin uso** (se reactiva desde el panel de Supabase con un clic), y el correo integrado envía pocos mensajes por hora (para un equipo grande conviene configurar un SMTP propio en *Authentication → Emails*).

## Probar en tu computador

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura

```
index.html            pantalla principal
styles.css            estilos (incluye impresión y modo oscuro)
config.js             conexión a Supabase (null = modo de prueba)
js/app.js             interfaz: tabla, diagrama, diálogos, barra de herramientas
js/programador.js     motor de programación: vínculos, restricciones, ruta crítica, recursos
js/calendario.js      calendario laboral (días hábiles y festivos)
js/almacen.js         guardado en el navegador o en Supabase
supabase/schema.sql   tablas, índices y reglas de privacidad (RLS)
```
