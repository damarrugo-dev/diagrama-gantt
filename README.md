# Diagrama de Gantt

Planificador de proyectos en línea al estilo de **Microsoft Project**: tabla de tareas a la izquierda y diagrama de Gantt a la derecha.

Es un sitio estático (`index.html`, `styles.css`, `js/`) que se publica gratis con GitHub Pages. Los datos viven en una base de datos **privada y gratuita en Firebase** (Firestore). Mientras `config.js` tenga `firebaseConfig = null`, funciona en **modo de prueba** (solo guarda en el navegador).

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
| Recursos y asignación con unidades (`Ana[50%]`) | ✔ |
| Trabajo (horas) y totales en resúmenes | ✔ (sin costos: no se usan en este proyecto) |
| Detección de recursos sobreasignados | ✔ |
| % completado y barra de progreso | ✔ |
| Línea base (todo el proyecto o tareas seleccionadas) | ✔ |
| Escala de tiempo: días, semanas, meses, trimestres; línea de hoy | ✔ |
| Mover barras y cambiar duración arrastrando | ✔ |
| Mostrar nivel de esquema, buscar tarea | ✔ |
| Deshacer / rehacer | ✔ |
| Exportar a Excel (CSV) e imprimir / guardar como PDF | ✔ |
| Varios proyectos por usuario, compartir con otros (lista `acceso`) | ✔ reglas listas; falta la pantalla para invitar |

Atajos de teclado como en Project: `Insert` (nueva tarea), `Supr` (eliminar), `Alt+Shift+→ / ←` (sangría), `Ctrl+F2` (vincular), `Ctrl+Shift+F2` (desvincular), `Shift+F2` (información de la tarea), `Ctrl+Z / Ctrl+Y`.

Duraciones: `5`, `5d`, `2sem`, `16h`, `1mes`.

## Puesta en marcha

### 1. Publicar el sitio (GitHub Pages, gratis)

El repositorio es **público** para poder usar GitHub Pages gratis. El código no tiene secretos: los datos están protegidos por las reglas de Firebase (`firestore.rules`).

1. En el repositorio: **Settings** → **Pages**.
2. En *Build and deployment* → *Source*: **Deploy from a branch**.
3. En *Branch*: **main** y carpeta **/ (root)** → **Save**.
4. En uno o dos minutos queda en `https://damarrugo-dev.github.io/diagrama-gantt/`. Cada cambio que se sube a `main` se publica solo.

### 2. Base de datos privada (Firebase, gratis)

Se usa un proyecto de Firebase **nuevo y aparte** del tablero Kanban: así las reglas de seguridad de uno no pisan las del otro.

1. Entra a <https://console.firebase.google.com> → **Crear un proyecto** → nombre `diagrama-gantt` → desactiva Google Analytics → **Crear proyecto**.
2. **Compilación / Build** → **Firestore Database** → **Crear base de datos** → ubicación `southamerica-east1` → **modo de producción** → **Crear**.
3. Pestaña **Reglas**: borra lo que hay, pega [`firestore.rules`](firestore.rules) → **Publicar**.
4. **Compilación / Build** → **Authentication** → **Comenzar** → pestaña **Método de acceso** → **Correo electrónico/contraseña** → activa **Vínculo de correo electrónico (acceso sin contraseña)** → **Guardar**.
5. En **Authentication** → **Configuración** → **Dominios autorizados** → **Agregar dominio**: `damarrugo-dev.github.io`.
6. Rueda ⚙ → **Configuración del proyecto** → *Tus apps* → ícono **`</>`** (Web) → apodo `gantt` → **Registrar app** → copia el bloque `firebaseConfig` y pégalo en [`config.js`](config.js) en lugar de `null`. Sube el cambio a GitHub.
7. Abre el sitio, escribe tu correo y entra con el enlace que te llega.

Quién entra: solo correos **@hitss.com** o **@anava.com** (igual que el Kanban). Para cambiarlo, edita `login.dominios` en `config.js` **y** la línea `matches(...)` en `firestore.rules`.

Quién ve cada proyecto: solo quien lo creó y los correos de su lista `acceso` (el propietario puede compartirlo; los demás no pueden cambiar esa lista ni borrar el proyecto).

> La configuración `firebaseConfig` es pública por diseño: lo que protege los datos son las reglas de `firestore.rules`.

Plan gratuito (Spark): 1 GiB de datos, 50.000 lecturas y 20.000 escrituras por día. Cada proyecto es un solo documento (hasta ~1 MB, varios miles de tareas).

**Alternativa:** también puede usar Supabase (PostgreSQL). Pega [`supabase/schema.sql`](supabase/schema.sql) en el *SQL Editor* de Supabase y llena `supabaseUrl` y `supabaseAnonKey` en `config.js` dejando `firebaseConfig = null`.

## Probar en tu computador

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura

```
index.html            pantalla principal
styles.css            estilos (incluye impresión y modo oscuro)
config.js             conexión a Firebase o Supabase (null = modo de prueba)
firestore.rules       reglas de seguridad de Firebase
js/app.js             interfaz: tabla, diagrama, diálogos, barra de herramientas
js/programador.js     motor de programación: vínculos, restricciones, ruta crítica, recursos
js/calendario.js      calendario laboral (días hábiles y festivos)
js/almacen.js         guardado en el navegador, en Firebase o en Supabase
supabase/schema.sql   alternativa: tablas y reglas de privacidad para Supabase
```
