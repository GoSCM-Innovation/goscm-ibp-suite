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

## Huecos abiertos

Ninguno. El último —importar sin ver qué trae el archivo— se cerró el 2026-08-12: ahora se enseña
cuántas vienen, cuáles ya existen, sus pasos y uniones, y en qué repositorio van a nacer.

## Sin estrenar

Lanzar una tarea de CI-DS y lanzar una orquestación están construidos y probados en lectura, pero **no
se han ejecutado** contra un repositorio real. Se estrenan con el usuario delante.
