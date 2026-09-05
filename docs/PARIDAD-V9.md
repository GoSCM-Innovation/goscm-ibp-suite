# Paridad con v9 (`ibp-bom-v9`)

Inventario recorrido contra `origin/master` de v9 —no contra la carpeta local, que puede estar
atrasada—. Igual que el de v8, existe porque «¿ya está v9?» se contestó de memoria y mal.

Última revisión: 2026-08-12, contra `82108cf` de v9. Son **63 archivos** entre `src/`, `api/` y
`public/legacy/` (sin contar `assets/`, `.css`, `.json`, imágenes ni el armazón de configuración), y
este documento da cuenta de todos.

A diferencia de v8, en v9 la funcionalidad no está solo en `src/`: dos módulos enteros vivían en
`public/legacy/` como JavaScript sin build, embebidos con iframe.

## Portado

| v9 | Aquí | Notas |
|---|---|---|
| `Resumen/Resumen.jsx` | `cids/Summary.jsx` | |
| `Resumen/GlobalResumen.jsx` | `cids/GlobalSummary.jsx` | |
| `Tasks/Tasks.jsx` | `cids/TaskLauncher.jsx` | Lanzar una tarea aún no se ha estrenado |
| `Tasks/TaskMonitor.jsx` | `cids/TaskMonitor.jsx` | |
| `Orchestrations/Orchestrations.jsx`, `OrchList.jsx` | `cids/orchestrations/Orchestrations.jsx`, `OrchestrationList.jsx` | Motor unificado con IBP |
| `Orchestrations/canvas/*` | `cids/orchestrations/OrchestrationCanvas.jsx`, `TaskNode.jsx`, `GroupNode.jsx`, `NodeConfigPanel.jsx` | `@xyflow/react` en vez de vis-network por CDN |
| `Orchestrations/mobile/*` (5 archivos), `ui/Sheet.jsx`, `hooks/useViewport.js` | `cids/orchestrations/MobileEditor.jsx`, `src/lib/useIsNarrow.js` | Editor en lista, no asistente por pasos — ver abajo |
| `Orchestrations/panel/TaskPalette.jsx` | `cids/orchestrations/TaskPalette.jsx` | |
| `Orchestrations/useOrchestration.js` | `cids/orchestrations/useOrchestrationRun.js` + `core/orchestrations/*` | La decisión de qué paso sigue está en `core`, con tests |
| `Orchestrations/RunModal.jsx`, `RunSingleModal.jsx` | `cids/RunTaskModal.jsx`, `orchestrations/RunBar.jsx` | |
| `Orchestrations/RunLogModal.jsx` | `cids/TaskLogsModal.jsx`, `orchestrations/RunDetail.jsx` | |
| `Orchestrations/ImportOrchestrationsModal.jsx` | Revisión dentro de `Orchestrations.jsx` + `src/lib/orchestration-file.js` | |
| `Orchestrations/canvasUtils.js` | `core/orchestrations/graph.js` | |
| `ui/PromotedBadge.jsx` | `cids/PromotedBadge.jsx` | |
| `hooks/usePromotedTasks.js` | `core/cids/promoted-tasks.js` | Las credenciales del productivo ya no pasan por el navegador |
| `ConnectionTabs.jsx` | Selector de tenant en `CidsTools.jsx` / `IbpTools.jsx` | |
| `TechLogs.jsx` | `src/lib/tech-logs.js` + panel | Aquí se registra solo, en `api.js` |
| `apiFetch.js` | `src/lib/api.js` | Sin token en el bundle: sesión en cookie httpOnly |
| `api/soapCall.js`, `api/soap.js`, `api/cids.js` | `api/cids/call.js` + `core/cids/*` | |
| `api/orchestrate.js` | `api/orchestration-run.js` + `core/orchestrations/engine.js` | |
| `api/orchestrations.js` | `api/orchestrations.js` | Ahora en Postgres, no en el navegador |
| `api/cron-tick.js` | `api/cids/cron-tick.js` | |
| `api/ibp-proxy.js` | `api/ibp/*` | Un endpoint por operación en vez de un proxy con discriminador |
| `api/connections.js` | `api/connections.js`, `api/admin/connections.js` | |
| `api/_auth.js`, `_cors.js`, `_ssrf.js` | `core/auth/*`, `core/transport/ssrf.js` | |
| `utils/dateUtils.js` | `src/lib/dates.js` | |
| **`public/legacy/js/explorer.js`** (2.972 líneas) | `cids/explorer/*` (11 componentes) + `src/lib/integration-index.js`, `integration-view.js`, `cids-atl.js`, `atl-enrich.js`, `chain-layout.js`, `dataflow-layout.js`, `explorer-copy.js` | Reescrito a React; las 8 dimensiones de v9 y sus dos vistas |
| **`public/legacy/js/docs.js`** (3.031 líneas) | `cids/documenter/*` + `src/lib/cids-doc.js`, `cids-export.js`, `cids-expression.js`, `cids-stats.js`, `xlsx.js`, `ibp-jobs-order.js` | Reescrito a React; Excel con `xlsx.js` propio |
| `public/legacy/js/api.js`, `state.js`, `utils.js` | `core/ibp/*`, `core/transport/*` | |

## Lo que NO se porta, y por qué

- **`Legacy/LegacyModuleView.jsx`, `public/legacy/*.html`, `css/`, `i18n/`, `ci-ds-export.png`** — el
  iframe y el puente de token por `postMessage`. Los dos módulos están reescritos a React; el envoltorio
  desaparece. Es una decisión de producto, no una preferencia.
- **`Connections/*` (5 archivos), `Connections/SapLoginModal.jsx`, `api/sap-login.js`** — v9 guardaba
  las conexiones en el navegador y pedía las credenciales de SAP en un diálogo. Aquí viven cifradas en
  Postgres y **nunca llegan al navegador**, así que no hay diálogo de login ni endpoint que lo sirva.
  `ImportConnectionsModal` importaba un archivo con credenciales dentro: eso no se porta.
- **`App.jsx`, `main.jsx`, `Header.jsx`, `Sidebar/Sidebar.jsx`, `System/SystemView.jsx`** — el armazón
  de v9. Aquí es el de la suite.
- **`ui/ProgressBar.jsx`** — pieza suelta de interfaz; la cubren las clases de `src/index.css`.
- **`utils/taskMetadata.js`** — **código muerto en v9**: nadie lo importa (comprobado con
  `git grep -in taskMetadata origin/master -- src`). Su propio comentario dice que las claves son una
  «hipótesis» a validar con una sesión real. Portar una hipótesis que nunca corrió sería portar deuda.
- **`i18n` del legacy** — el idioma es una fase propia al final.

## Diferencias deliberadas

No son huecos: son decisiones con motivo, y conviene que estén escritas antes de que alguien las lea
como un descuido.

- **Editor móvil.** v9 tenía un asistente por pasos (5 archivos). Aquí es una lista en orden, y ante un
  grafo con ramas o grupos **se declara incapaz** en vez de aplanarlo. v9 lo aplanaba en silencio, que
  es como se pierde una rama.
- **Documentador de mapeos: tres modos → dos.** v9 tenía «ZIP», «ZIP+Jobs» y «Jobs»; los dos últimos
  hacían lo mismo y se diferenciaban solo en qué archivo pedían primero.
- **Importar orquestaciones: sin aviso de tenant cruzado.** v9 guardaba en el archivo de qué repositorio
  salió, y avisaba si no coincidía con el actual. Aquí el archivo **no lleva el origen ni los
  identificadores**, a propósito: así una exportación de pruebas no puede apuntar en silencio al
  repositorio productivo. La garantía sustituye al aviso. Lo que sí se dice es dónde van a caer.
- **Nada se pisa al importar.** v9 ofrecía reemplazar las que ya existían con ese nombre. Aquí las
  repetidas entran con un número detrás o no entran: una orquestación se configura una vez, y
  sobrescribirla por un nombre igual es una pérdida que no se deshace.

## Lo que pide cada pantalla, comparado con lo que pedía v9

Recorrido el 2026-08-25 contra `api/soap.js`, `api/cids.js` y las pantallas de `src/`. **Sin
diferencias.** Los cuerpos de las peticiones SOAP son los mismos elemento por elemento —incluido el
orden que el XSD de SAP exige en `taskLogsRequest`—, la lista de operaciones permitidas es la misma, y
el monitor de tareas pide el mismo rango: tope de 90 días, siete de arranque, y el extremo de arriba
llevado a `59.999` para que el último día entre.

El explorador de integraciones y el documentador de mapeos no consultan a SAP: leen el export del
proyecto que se sube a la pantalla, igual que en v9.

Nota: v9 avanzó de `82108cf` a `609e282` (0.5.38 → 0.5.45) desde la revisión anterior. Los 44 commits
son pruebas, lint, tokens de diseño y dos arreglos de seguridad que aquí ya estaban resueltos mejor
(`_ssrf.js` con IPv4 embebida en IPv6, y el token de `api-fetch` limitado al mismo origen). **Nada
funcional que portar.**

## Tres huecos que el inventario de archivos no podía ver

Encontrados el 2026-08-25, al contestar «¿qué nos va quedando?» recorriendo los árboles en vez de
contestar de memoria. **Este documento decía «huecos abiertos: ninguno» y no era cierto.**

Por qué se escaparon a dos revisiones: el inventario compara ARCHIVOS, y los tres vivían dentro de
archivos que el inventario daba por portados. Un archivo asignado no quiere decir un archivo agotado.

Lo que sí los encontró: barrer los tres originales por las APIs del navegador que se ven —
`Notification`, `beforeunload`, `requestFullscreen`, `keydown`, `clipboard`— y comparar la cuenta con
la nuestra. Vale repetirlo cuando se añada una pantalla.

| Qué faltaba | Estaba en | Aquí |
|---|---|---|
| Aviso del navegador al terminar una orquestación | v9 | **0** — `src/lib/aviso-de-corrida.js` |
| Guarda al salir con una copia en marcha | v8, en las dos migraciones | **0** — `src/lib/guarda-de-salida.js` |
| Pantalla completa | v7 (4 pantallas), v8 (4), v9 (2) | **0** — `src/lib/usePantallaCompleta.js` |

**El aviso al terminar.** Una orquestación de CI-DS tarda entre minutos y horas, así que nadie se queda
mirando. Sin el aviso hay que volver a la pestaña a comprobar. Se conserva la decisión de v9 de pedir el
permiso al ARRANCAR y no al abrir la pantalla: pedirlo sin que la persona haya hecho nada es lo que hace
que lo niegue de entrada, y una vez negado la página no puede volver a preguntar.

**La guarda al salir.** Las dos copias —dato maestro y cifras clave— las encadena el NAVEGADOR: la
pantalla pide un segmento, espera, pide el siguiente. Cambiar de módulo, de pestaña, cerrar o pulsar
«Salir» a mitad cortaba la cadena sin decir nada. v8 tenía las dos capas y aquí no había ninguna:
`beforeunload` para cerrar o recargar, y una confirmación propia para navegar dentro de la aplicación
—que no dispara `beforeunload`—. El texto dice lo que de verdad pasa: lo ya confirmado en SAP se queda,
el resto no se copia.

**Pantalla completa.** Son las pantallas de una tabla de sesenta columnas y de un grafo de trescientos
nodos; en un panel de media pantalla, con la barra y el menú al lado, son otra herramienta. Va con la
API del navegador y no con un panel de CSS —que es lo que hacía v9— porque es lo que hacían v7 y v8, y
porque el navegador ya sale con Escape solo. El envoltorio es el cuerpo del módulo, así que los
controles siguen a mano.

**Lo único sin comprobar:** cómo QUEDA a pantalla completa. El botón, el estado y la salida están
probados, y el CSS pone fondo y altura, pero no se pudo entrar a la aplicación para verlo con los ojos.
Es una mirada de diez segundos en las seis pantallas.

## La interfaz de v9, restaurada

Revisión del 2026-08-29, con el mismo método que v7 y v8: recorrer los controles del original uno a
uno contra `origin/master` (`609e282`).

### Nombres y orden de las pestañas

| v9 | Estaba como | Ahora |
|---|---|---|
| Resumen | Resumen | Resumen |
| Projects & Tasks | Proyectos y tareas | **Projects & Tasks** |
| Task Monitor | Monitor de tareas | **Task Monitor** |
| Orquestaciones | Orquestaciones | Orquestaciones |
| Integration Explorer | Explorador de integraciones | **Integration Explorer** |
| Mapping Dataflow Generator | Documentador de mapeos | **Mapping Dataflow Generator** |

Y el orden: «Projects & Tasks» va antes que «Task Monitor», que estaba al revés.

Las dos últimas eran entradas del menú lateral en v9 y no pestañas de una conexión, porque no miran
ningún repositorio: leen los ZIP del equipo. Aquí el menú lateral es de módulos, así que van como
pestañas y se marcan sin destino.

### Controles que no existían aquí

| Qué | En v9 | Aquí |
|---|---|---|
| Tira de pestañas de conexiones abiertas | `ConnectionTabs.jsx` | `ui/ConnectionTabs.jsx` + `lib/pestanas-de-conexion.js` |
| Panel de «Requisitos Técnicos» propio | `Header.jsx` | `lib/requisitos-tecnicos.js` |
| Menú lateral minimizable | `Sidebar.jsx` | `Shell.jsx` |

**La tira de pestañas** se usa en los DOS módulos, no solo en CI-DS: es la respuesta a que en v8 los
tenants colgaran del menú lateral y aquí ese menú liste los tres módulos de la suite. Varios destinos
abiertos a la vez, con avatar y cierre, y recordados entre sesiones.

Una diferencia con v9, escrita al lado del código: su punto verde decía si la conexión tenía sesión
abierta contra SAP, porque allí la sesión la abría el navegador. Aquí vive en el servidor y se renueva
sola, así que ese punto estaría siempre verde. En su lugar va la marca de **productivo**, que es el
estado que sí cambia lo que uno debe hacer con esa pestaña.

#### El «+»: no había forma de cambiar de conexión

Encontrado el 2026-09-05 por el usuario: **IBP Tools no tenía dónde cambiar de conexión.** Y CI-DS
Tools tampoco — mismo componente, misma falta.

La tira dibujaba solo las pestañas YA abiertas. Con una sola abierta no había ningún control que
abriera otra: la función existía (`elegir` en `IbpTools.jsx`, que llama a `abrir`) y era **inalcanzable
desde la pantalla**.

Por qué pasó la revisión de paridad: en v9 este control **no estaba en la tira**. Su `ConnectionTabs`
tampoco tenía «+» — una conexión se abría pulsándola **en el menú lateral**, que listaba los tenants
(`handleSelect` en su `App.jsx`). Aquí el menú lateral lista los tres módulos de la suite, así que al
portar la tira tal cual nadie se quedó con ese trabajo. Comparar controles uno a uno tampoco lo
destapa cuando el control que falta **vivía en otra pantalla**.

Ahora la tira termina en un «+» que despliega las conexiones de la empresa, marcando las ya abiertas y
diciendo de cada una si es productiva o sandbox —a la vista, no en un `title`: se elige antes de
entrar—. Sirve para los dos módulos.

Y una cosa que se descubrió mirándolo en el navegador y no en el código: **la tira tiene
`overflow-x: auto`** —lo necesita, con seis tenants abiertos no caben— y eso **recorta** cualquier cosa
que se salga. El desplegable colgado ahí dentro no se veía. El «+» y su menú viven fuera del área que
hace scroll (`.conn-tabs-fila`), lo que además los deja a la vista cuando la tira está desplazada, que
es justo cuando hacen falta. Hay una prueba que lo fija.

Cubierto por `src/components/ui/ConnectionTabs.test.js`.

### Etiquetas devueltas a su redacción

`↺ Refresh` · `Buscar proyecto o task…` · `Top tasks ejecutadas` · `Últimas fallidas` · `Warnings` ·
`Ejecución seleccionada` · `Auto-refresh 5 min` · `🔄 Auto 30s`. Estaban traducidas.

## Huecos abiertos

Ninguno, contando los tres del inventario y los de la interfaz como cerrados. El último —importar sin ver qué trae el archivo— se cerró el 2026-08-12: ahora se enseña
cuántas vienen, cuáles ya existen, sus pasos y uniones, y en qué repositorio van a nacer.

## Sin estrenar

Lanzar una tarea de CI-DS y lanzar una orquestación están construidos y probados en lectura, pero **no
se han ejecutado** contra un repositorio real. Se estrenan con el usuario delante.
