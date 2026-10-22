# Planeación: Diagrama de Gantt y Tablero Kanban

Una sola página con dos vistas que se cambian con el interruptor **Gantt | Kanban** de la barra roja:

- **Gantt**: planificador al estilo de **Microsoft Project**, tabla de tareas a la izquierda y diagrama a la derecha.
- **Kanban**: el [Tablero Kanban](https://github.com/damarrugo-dev/tablero-kanban) de siempre, con varios tableros.

Es un sitio estático (`index.html`, `styles.css`, `js/`, `kanban/`) que se publica gratis con GitHub Pages. Los datos viven en la base de datos **Firebase del Tablero Kanban** (Firestore), así las dos vistas comparten el inicio de sesión y los datos. La dirección anterior del Kanban sigue funcionando con los mismos tableros. Mientras `config.js` tenga `firebaseConfig = null`, funciona en **modo de prueba** (solo guarda en el navegador).

## Tarjetas y tareas enlazadas

Cada tarjeta del Kanban y cada tarea del Gantt existen por su cuenta; enlazarlas es opcional.

- **Al crear una tarjeta** (＋ en una celda del Kanban) se elige: *Solo en el Kanban*, *Crear también la tarea* (en el proyecto y la épica que elijas) o *Enlazar con una tarea existente*.
- **Desde el Gantt**, la columna *Kanban* de cada tarea tiene un ＋ para crear su tarjeta o enlazarla con una existente.
- **En edición**: la ventana de la tarjeta tiene la sección *Gantt* y la información de la tarea tiene la pestaña *Kanban*, para enlazar, abrir el otro lado o desenlazar.
- Enlazadas, se sincronizan el **nombre** y el **avance**: primera columna = 0 %, última = 100 %, las del medio = avance intermedio. La tarjeta muestra las fechas de la tarea.
- Borrar una de las dos no borra la otra; solo se quita el enlace.

## Funciones

| Microsoft Project | Aquí |
| --- | --- |
| Épicas que agrupan tareas (botón *Épica*, sangría / anular sangría, EDT); contraer o expandir cada épica, *Solo épicas* para una vista limpia de tiempos | ✔ |
| Vínculos entre tareas de épicas distintas (con la épica contraída, la flecha llega a su barra) | ✔ |
| Pasar tareas de una épica a otra (botón *Mover a épica* o campo *Épica* en Información de la tarea) | ✔ |
| Tareas en paralelo: columna *En paralelo con* (la tarea empieza a la vez que la que elijas; es un vínculo CC sin posposición) | ✔ |
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
| Varios proyectos, visibles para todo el equipo; cambios de otros se ven sin recargar | ✔ |

Atajos de teclado como en Project: `Insert` (nueva tarea), `Supr` (eliminar), `Alt+Shift+→ / ←` (sangría), `Ctrl+F2` (vincular), `Ctrl+Shift+F2` (desvincular), `Shift+F2` (información de la tarea), `Ctrl+Z / Ctrl+Y`.

Duraciones: `5`, `5d`, `2sem`, `16h`, `1mes`.

## Puesta en marcha

### 1. Publicar el sitio (GitHub Pages, gratis)

El repositorio es **público** para poder usar GitHub Pages gratis. El código no tiene secretos: los datos están protegidos por las reglas de Firebase (`firestore.rules`).

1. En el repositorio: **Settings** → **Pages**.
2. En *Build and deployment* → *Source*: **Deploy from a branch**.
3. En *Branch*: **main** y carpeta **/ (root)** → **Save**.
4. En uno o dos minutos queda en `https://damarrugo-dev.github.io/diagrama-gantt/`. Cada cambio que se sube a `main` se publica solo.

### 2. Base de datos (Firebase del Tablero Kanban)

Se usa el proyecto de Firebase `tablero-kanban-f5f28`, que ya tiene el inicio de sesión por enlace al correo y el dominio `damarrugo-dev.github.io` autorizado. Solo hay que publicar las reglas de este repositorio, que son las del Kanban más las de los proyectos del Gantt:

1. <https://console.firebase.google.com> → proyecto **tablero-kanban** → **Firestore Database** → pestaña **Reglas**.
2. Borra lo que hay, pega [`firestore.rules`](firestore.rules) → **Publicar**.
3. Abre el sitio y entra con tu correo.

**Traer los proyectos del Gantt anterior** (los que estaban en el Firebase `diagrama-gantt-a9d62`): en el menú de proyectos, elige **⇪ Traer proyectos del Gantt anterior…**, marca los que quieras y pulsa *Traer*. Usa la sesión que ya tenías en ese navegador; los originales no se borran.

Quién entra: solo correos **@hitss.com** o **@anava.com** (igual que el Kanban). Para cambiarlo, edita `login.dominios` en `config.js` **y** la línea `matches(...)` en `firestore.rules`.

**Control de acceso** (igual que en el Kanban): cada vez que alguien pide el enlace, entra o intenta con un correo no permitido, queda registrado en Firestore (colección `accesos`). Los administradores de `config.js` (`login.administradores`) ven el botón **Accesos** arriba a la derecha, con el resumen por persona, el detalle de movimientos y la opción de exportarlo a Excel. Nadie puede cambiar ni borrar ese registro. Si cambias los administradores, cámbialos también en `esAdministrador()` de `firestore.rules`.

Quién ve cada proyecto: todas las personas de la empresa que entran ven y editan todos los proyectos del Gantt, igual que los tableros del Kanban. Solo quien creó un proyecto puede borrarlo. Si otra persona guarda cambios en el proyecto que tienes abierto, se muestran solos (si estás escribiendo en una celda, espera a que termines).

> La configuración `firebaseConfig` es pública por diseño: lo que protege los datos son las reglas de `firestore.rules`.

Plan gratuito (Spark): 1 GiB de datos, 50.000 lecturas y 20.000 escrituras por día, compartidos con el Kanban. Cada proyecto es un solo documento (hasta ~1 MB, varios miles de tareas).

## Probar en tu computador

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura

```
index.html            pantalla principal (las dos vistas)
styles.css            estilos de las dos vistas (incluye impresión y modo oscuro)
config.js             conexión a Firebase (null = modo de prueba) y quién entra
firestore.rules       reglas de seguridad de Firebase (Kanban + Gantt + accesos)
js/principal.js       arranque y cambio entre Gantt y Kanban
js/sesion.js          inicio de sesión, registro de accesos, tema claro / oscuro
js/enlaces.js         enlaces tarjeta ↔ tarea y su sincronización
js/util.js            utilidades compartidas (ventanas, menús, avisos)
js/app.js             Gantt: tabla, diagrama, diálogos, barra de herramientas
js/programador.js     motor de programación: vínculos, restricciones, ruta crítica, recursos
js/calendario.js      calendario laboral (días hábiles y festivos)
js/almacen.js         guardado de proyectos en el navegador o en Firebase
js/migrar.js          traer proyectos del Firebase anterior del Gantt
kanban/kanban.js      Kanban: tableros, carriles, procesos y tarjetas
```
