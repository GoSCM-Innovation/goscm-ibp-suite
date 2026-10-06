# Paridad con v9 (`ibp-bom-v9`)

Inventario recorrido contra `origin/master` de v9 —no contra la carpeta local, que puede estar
atrasada—. Igual que el de v8, existe porque «¿ya está v9?» se contestó de memoria y mal.

Última revisión: 2026-08-12, contra `82108cf` de v9. Son **63 archivos** entre `src/`, `api/` y
`public/legacy/` (sin contar `assets/`, `.css`, `.json`, imágenes ni el armazón de configuración), y
este documento da cuenta de todos.

## Revisión del 2026-10-05, contra `b078052` (58 commits desde `82108cf`)

Los commits nuevos son casi todos de **estructura sin cambio de comportamiento**: sistema de tokens de
diseño, `useOrchestration` partido en cuatro hooks, ESLint, Vitest y CI. Eso no se porta. Lo que SÍ
estaba pendiente, y se encontró al recorrer:

| Qué | Dónde en v9 | Estado aquí |
|---|---|---|
| **Scripts pre/post-load del Job en el Integration Explorer**: se leen del export (`parseJobScripts`), se buscan por su texto, hay un interruptor «Solo con script» con contador, una insignia 📜 en la tarea y una sección en el detalle con el código y si es pre o post | `public/legacy/js/docs.js` + `explorer.js` (`85666bd`, **anterior** a la revisión del 2026-08-12 y no detectado) | **Hecho el 2026-10-05**: `parseJobScripts` en `cids-export.js`, texto de los scripts en el buscador, interruptor «Solo con script» con contador, insignia 📜 y sección «📜 Scripts pre/post-load» (abierta, antes del diagrama). Pruebas en `cids-job-scripts.test.js` y `explorer/ScriptsDelJob.test.js` |
| Los logs de tarea traen cada `<messageLine>` codificado por separado dentro de `<messageLines>` | `api/soap.js` (`a81ddf6`) | **Hecho el 2026-10-05**: `decodeLogLine` de `core/soap/operations.js` descodifica cada `<messageLine>` hijo por separado y los une con salto de línea. Tres pruebas nuevas en `operations.test.js` |
| SSRF: IPv4 embebida en IPv6 una vez normalizada (`::ffff:7f00:1`) | `api/_ssrf.js` (`3a4eee3`) | **No es explotable aquí, pero el comprobador queda flojo.** `isPrivateAddress` de `core/transport/ssrf.js` solo reconoce la forma decimal y dice «pública» para `::ffff:7f00:1` (comprobado). Pero `validateSapHost` rechaza SIEMPRE cualquier host numérico antes de llamarlo, y solo lo usa con lo que devuelve DNS, que viene en forma decimal. v9 sí lo necesitaba porque aceptaba direcciones. Endurecerlo sería defensa en profundidad |

Comprobados y ya portados: el aviso del navegador al terminar una orquestación (`aviso-de-corrida.js`),
la regla del linaje sin espacios y los paréntesis al expandir (`cids-expression.js`), el token solo en
llamadas `/api` del mismo origen (aquí no hay token en el cliente). Las dos páginas de `public/legacy/`
(`integration-explorer.html`, `mapping-dataflow.html`) son los dos módulos ya portados; `i18n.js` queda
para la fase de idioma.

A diferencia de v8, en v9 la funcionalidad no está solo en `src/`: dos módulos enteros vivían en
`public/legacy/` como JavaScript sin build, embebidos con iframe.

## Integration Explorer y Mapping Dataflow Generator, idénticos a v9 (2026-10-05)

Pedido del usuario: las dos pantallas que v9 tenía como módulos `legacy` tienen que verse y comportarse
como las de v9. Se recorrieron **control por control** (`integration-explorer.html`, `explorer.js`,
`mapping-dataflow.html`, `docs.js` y los textos de `es.json`) y se igualaron. Tema de color: el de la
suite (claro/oscuro); lo que se copia es la estructura, el orden, los textos y el comportamiento.

**Integration Explorer.** Banner «🔎 Explora visualmente…»; panel de carga plegable que SIGUE a la vista
al explorar (los ATL se pueden añadir después y el cruce se rehace); «Conectar SAP CI-DS / IBP» con su
pastilla, «Desconectar» y el «?» con la ayuda de v9; dimensiones rectangulares; Lista/Grafo en
segmentos; búsqueda por varias palabras (AND); el texto ya no se aplica dos veces en las dimensiones;
interruptores en lugar de casillas; filtros «PA:», «Origen:», «Destino:» con «Sin PA» y «(sin DS)»; barra
de estado del ATL con su pastilla y «Solo conflictos»; «Solo con script» con contador; cabecera
«Tareas (N)» con «⧉ Copiar» y aviso flotante; insignias ✓, IBP y 📜 en el orden de v9; proyectos plegados
con «nombre (N)»; subtítulos de dos renglones en las dimensiones; detalle con las secciones abiertas por
omisión, los títulos de v9 («Mappings», «Filtros», «Target:», «ZIP:», «Atrás», «Alimentado por»…) y el
detalle de dimensión con «N campos» y el «Ver»; copiado con las cabeceras de v9; diagrama con sus doce
tipos de nodo, tooltip, detalle por tipo, pantalla completa de verdad con divisor arrastrable; grafo con
la leyenda de v9.

**Mapping Dataflow Generator.** Banner; conexión a IBP arriba con «Planning Area (para los ejemplos de
datos)»; los **tres modos** («📦 Desde archivos ZIP», «🔄 Desde Application Jobs», «🔗 ZIP + Jobs»); avance
por pasos; «Pro tip»; paneles que siguen visibles al analizar; selección con sus textos y contadores;
«⚙️ Generar Excel» separado de «⬇️ Descargar Excel»; panel «📊 Resultado»; log de procesamiento con los
mensajes de v9; ayuda «?» con la imagen de exportación; guía del Communication Arrangement. Excel con
las cabeceras, los textos vacíos y el nombre de archivo de v9; el ATL se aplica al generar, sin reordenar,
y varios se acumulan; ejemplos de IBP con muestra de 50 filas, escalado a 200 y consulta dirigida.

### Lo que sigue siendo distinto, y por qué

| Qué | v9 | Aquí | Motivo |
|---|---|---|---|
| Conectar a CI-DS / IBP | modal con URL, usuario y contraseña | se ELIGE una conexión dada de alta | Las credenciales viven cifradas en el servidor y no llegan al navegador (regla de seguridad) |
| «Qué configurar» del «?» y paso 6 de la guía | «escribe la URL…» / «usa las mismas credenciales en el panel» | «las da de alta quien administra la cuenta en Administración → Conexiones» | Misma regla; es el único texto portado que se reescribe |
| Duplicados al soltar un archivo | ignora el nuevo | reemplaza por el nuevo | Volver a soltar un archivo es querer la versión nueva |
| Filtros de Datastore y las dimensiones | no afectan a las dimensiones | sí afectan | Más coherente; v9 lo hacía por descuido |
| Selección de plantilla de job | por nombre | por nombre y versión | Con varias versiones, v9 marcaba todas |
| Tipo KF/MD/FILE | solo por el nombre del trabajo | primero por la tabla destino | Mejora ya documentada arriba |
| Un paso repetido en el índice de IBP | el primero que devuelve la API | el de menor posición | El índice del servidor viene ordenado |
| Pantalla completa del explorador | no existía | botón del módulo | Se conserva de antes |
| Ancho de la lista | 340 px, sin memoria | 340 px, y se recuerda | Se conserva de antes |
| Aviso de pasos duplicados de un job | no | sí | Ahorra una búsqueda |

### Cotejo ejecutado contra el código real de v9 (2026-10-05)

Se ejecutó el `docs.js` REAL de v9 en jsdom con las mismas entradas que nuestro código —tres XML de
muestra: una carga con unión, filtro, lookup, división sin espacios y campo en minúsculas; una salida a
archivo y a una tabla de key figures en el mismo XML; y un job con scripts pre/post-load— y se compararon
los resultados:

- **El Excel completo**: las cuatro hojas (`sheet1` a `sheet4`), sus enlaces y los estilos son
  **idénticos byte a byte**. El resto del paquete (`workbook.xml`, `[Content_Types].xml`, relaciones)
  difiere solo en espacios y comentarios del XML. La comparación encontró **una diferencia real**, ya
  corregida: las tres tablas de abajo de cada hoja de detalle llevaban dos celdas vacías de más (nueve
  en vez de siete).
- **El análisis de cada integración** (`parseIntegration`): idéntico campo por campo —mapeos, filtros,
  lookups, variables, diagrama y scripts del job— salvo dos campos que aquí se añaden y que v9 no trae:
  `targetDS` y un `fileName` vacío en los nodos de archivo.

No es una prueba permanente (necesita el repo de v9 al lado); el método está en esta sección para
repetirlo cuando v9 cambie.

### Lo que NO se pudo comprobar

- **Contra un tenant real**: nada. Las lecturas de IBP (muestra de 50/200 filas, consulta dirigida,
  índice de tareas) están probadas con respuestas simuladas.
- **El contenido enriquecido con IBP** (descripciones, tipos y ejemplos): el cotejo de arriba fue sin
  conexión a IBP.
- **Con los ojos**: se miraron las dos pantallas en el navegador con datos de muestra (andamio temporal,
  ya borrado), en un panel angosto. No se compararon píxeles ni tipografías contra v9.

## Las otras pestañas de CI-DS Tools y su marco, como v9 (2026-10-05)

Segunda mitad de la revisión: Resumen Global, Resumen, Projects & Tasks, Task Monitor, el marco de
CI-DS Tools y Requisitos Técnicos. Se leyó cada archivo de v9 y el nuestro **control por control**. Lo que
sigue es lo que se igualó y lo que se dejó distinto a propósito.

**Estados de las tareas** (`core/cids/task-status.js`): los nombres de v9 en inglés («Running», «Success»,
«Success w/ errors D», «Error», «Queueing»…), con el nombre corto de la leyenda de los gráficos
(«Success w/err D»); `TERMINATION_FAILED` con su rojo propio; un código desconocido ya no pierde su nombre.
**Resumen y Resumen Global**: tarjetas «Exitosas»/«Fallidas», el subtítulo con el repositorio, la pantalla
«Cargando resumen de …», «Sin warnings» y «Éxito con errores (críticos|ignorados)», el selector «Filtrar
por cliente», el cuadro «Sin repositorios en el filtro», la línea de contexto y las rejillas `v9-grid-*`.
Sin la nota de «avisos» que se había añadido y sin las llamadas a `getAgents` que v9 no hacía.
**Projects & Tasks**: contador «N proyectos · repositorio», los tres `title` del botón «Solo fijados», «Limpiar»
con su título, «Fijar proyecto», «N tasks», los textos de vacío y los del modal («▶ Ejecutar task»,
«Cargando configuración…», «— Sin especificar —», «✓ Task enviada», «▶ Ver en Task Monitor →»).
**Task Monitor**: columnas que se arrastran (mínimo 60 px), `title` con el valor crudo de SAP en cada celda,
«⚠ máx 90d» en rojo con los campos de fecha enmarcados, chip «Todos» azul, la tabla y la paginación
desaparecen con un error, «pág X/Y», «cargando fin/duración…», «Task», «✕ Error», «📋 Ver logs», «RunID: »,
cancelar con el `confirm` del navegador y la barra que se suelta sola a los 2,5 s, la insignia «PRD» verde en
mono («Promovido a producción») y la búsqueda que se suelta al salir del monitor o cambiar de repositorio.
El visor de logs con los textos de v9 («Logs de ejecución», «Cargando logs…», «Sin contenido en este log»).
**Error de v9 que se arregla, no se copia**: al cambiar de página con la nueva ya en caché, el aviso «cargando
fin/duración…» se quedaba encendido y «Copiar» bloqueado (el efecto salía sin apagarlo). Prueba en
`TaskMonitor.test.js`.
**Marco** (`CidsTools.jsx`): el detalle del sistema de v9 (`dirección · organización · Producción|Sandbox`)
**ya no va en una franja propia** (cambio del 2026-10-06, pedido por el usuario): vive en el «ⓘ» de la
pestaña activa de la tira, con lo que desaparece el ▴/▾ de contraerla; para ello `/api/connections`
devuelve también la **organización** (junto a la dirección, que ya salía; no es un secreto y las
credenciales siguen sin salir). «Sandbox» en vez de «Pruebas». La tira de pestañas de repositorio se ve
siempre, también sobre el tablero global y los dos módulos de ZIP (desde el global, elegir una lleva a su
Resumen). El avatar sale del nombre de la conexión, no del texto de la pestaña (antes decía «C·»). El orden
de las pestañas añadidas es el del menú de v9: **Mapping Dataflow Generator antes que Integration Explorer**.
El Explorer y el documentador **se quedan montados** al cambiar de pestaña (v9 los mantenía vivos): el ZIP, el
análisis y lo generado ya no se pierden. Requisitos Técnicos abre en la pestaña del módulo en el que estás,
con el título de v9, y la guía de IBP ya no se ofrece en las pestañas de CI-DS ni de IBP Tools. El panel de
«Ver logs técnicos» muestra la operación (`getProjects`, `runTask`…), se oculta mientras no hay llamadas y
enseña la llamada MÁS RECIENTE de cada grupo (enseñaba la más antigua). Una sesión vencida a mitad del trabajo
lleva a la pantalla de acceso en vez de repetir el mismo error cada 30 s.

### Lo que sigue siendo distinto en estas pestañas, y por qué

| Qué | v9 | Aquí | Motivo |
|---|---|---|---|
| Rango máximo de fechas | 90 días, sin más | 90 días, y al pasarlo se arrastra la otra punta | Regla del servicio de SAP; así nunca queda un rango inválido |
| Fin del rango | segundo exacto | `:59.999` del minuto elegido | Una ejecución de las 12:30:40 quedaba fuera de un rango que termina a las 12:30 |
| Fechas a medio escribir | consulta sin rango (devuelve TODO el tenant) | se exige el rango completo y se aplica a los 500 ms | Agujero de v9 en las tres pantallas |
| Contar «fallidas» | solo `ERROR` | también `TERMINATION_FAILED` | Una terminación fallida es un fallo |
| Búsqueda del monitor | nombre, estado, RunID | además el JobID y el nombre en pantalla | Es lo que la persona tiene delante |
| Fin y duración | una consulta por fila en el navegador | las junta el servidor por tandas de 15 (6 a la vez contra SAP) | El navegador no habla con SAP |
| Insignia «PRD» | la calcula el navegador con la sesión de producción | la calcula el servidor (caché de 15 min) | La sesión de SAP vive en el servidor |
| Sesión de SAP | modal de login y banner «Sesión expirada» | no existen | Las credenciales nunca llegan al navegador; el servidor renueva la sesión |
| Pestañas de repositorio | solo las conexiones abiertas, con ✕ y punto de sesión | todas siempre, punto de «productivo» | Decidido por el usuario el 2026-10-05 |
| Cambiar de repositorio | cada conexión conserva su vista montada | se empieza de cero en el nuevo | Misma decisión que Data Tools (apps que reinician al cambiar de tenant) |
| Salir del módulo y volver | las conexiones siguen montadas | vuelve a Resumen | Consecuencia del armazón de la suite |
| Tarjetas 2, 5 y 7 de Requisitos Técnicos | «usuario y contraseña se usan al iniciar sesión», «la contraseña no se almacena», «token Bearer» | las tres dicen cómo funciona AQUÍ (alta por el administrador, contraseña cifrada en el servidor, sesión por cookie) | Los textos de v9 describen un mecanismo que esta plataforma no usa; las tarjetas 3, 5 y 6 conservan sus palabras |
| Botón de Requisitos | en la cabecera | en el pie del menú lateral | Decisión de armazón de la suite |
| Logs técnicos | un panel por pantalla, 50 llamadas, sin colores | uno solo para toda la aplicación, 100 llamadas, con colores, «Limpiar» y hora | El panel compartido lo alimenta `api.js`; mantener los extras ya aceptados |
| Reordenar conexiones arrastrando | en el menú lateral | no existe | El orden lo da el servidor; **sin decisión del usuario** |
| Lista del menú lateral con las conexiones | sí | no | La tira de pestañas lo sustituye |

### Lo que NO se pudo comprobar en estas pestañas

- **Contra un tenant real**: nada. Los textos, la lógica y los estados están probados con respuestas simuladas.
- **Con los ojos y píxel por píxel**: no se compararon tipografías, espacios ni la tira de pestañas cuando
  se envuelve.
- **El tiempo máximo de la función `api/cids`** ante un rango de 90 días o un log muy grande (`vercel.json`
  no fija `maxDuration`, igual que v9).

## Orquestaciones, como v9 (2026-10-05)

Revisadas control por control contra `Orchestrations/` de v9 y `api/orchestrate.js`. v9 **no tiene
programación por cron ni historial de corridas** (solo guarda la última): no son huecos nuestros.

**Lista.** Los `title` y textos de v9 (importar, exportar, favoritos, «Duplicar orquestación», «Eliminar»,
«Sin orquestaciones.» + «Crear una»), panel que se contrae a 28 px, favoritas primero en el orden del
servidor y con su borde. «+» pide el nombre con `prompt` y borrar usa `confirm`, como v9 (antes había un
formulario en línea y un modal propios: se quitaron). **Importar**: píldoras «N en archivo / nuevas / ya
existen / inválidas», «Entradas omitidas (N)» con el motivo de cada una, «Importar N», aviso final; una
entrada sin `nodes` ya no entra vacía; exportar avisa «N orquestación(es) exportada(s)».
**Paleta**: «Task Palette», contraer, ancho arrastrable (160–520), proyectos fijados con 📌, «+ Nuevo grupo»
al pie, tipo con color, `PRD` y descripción en el `title`; arrastrar y soltar además del clic.
**Lienzo**: renombrar con clic en el nombre; **autoguardado a los 600 ms** (sin botón «Guardar»), «⚡ Auto»,
«⊞ Auto Layout», minimapa, grupo redimensionable con insignia de modo y «N/M completadas», aristas
animadas, `isValidConnection`, aviso «⚠ Ciclo detectado», lienzo bloqueado con su banner mientras corre,
nodos como los de v9 (210 de ancho, icono de estado, agente/perfil/variables, «error: …», `#id` de SAP,
entradas a la izquierda y salidas a la derecha), tecla Delete. **Errores de v9 que sí se arreglan**: los
pasos dentro de un grupo ahora se pintan según su estado; quitar un grupo borra a sus hijos (antes quedaban
huérfanos y el guardado fallaba).
**Panel del nodo**: cabecera, rama de grupo, «En caso de error», «Máx reintentos», variables como
desplegable con las reales de SAP (`getTaskInfo`). **Barra de ejecución**: «▶ Iniciar», «■ Cancelar»,
«⏭ Reanudar», «↺ Repetir», «hechos/total», guarda de tasks fuera de grupo, modal «Iniciar orquestación»
con **ejecución rápida (presets)**, agentes y configuración de sistema en desplegable (la configuración no
se podía enviar antes) y variables descubiertas, y «Ejecutar solo este task» desde el ▶ del nodo.
**Detalle de la corrida**: cabecera con hora y duración, `#id`, «Logs SAP».
**Motor**: la variable global de la corrida **pisa** el valor del nodo y solo va a los nodos que la declaran
(estaba al revés); un fallo al lanzar se **reintenta una vez** tras 1,5 s (salvo errores de sesión);
cancelar deja los pendientes en `skipped` y reintenta el cerrojo 5×500 ms; **no se puede borrar** una
orquestación con una corrida activa (409); los ciclos se validan también dentro de cada grupo; palabras de
estado y «(intento n/m)» de v9. Todo ello solo para CI-DS: IBP conserva su política.
**Editor móvil**: ejecuta, corta y muestra el resultado (antes no tenía la barra de ejecución y su texto
decía lo contrario); y se corrigió un error propio: «Agregar paso» guardaba el paso en el servidor pero el
editor no lo mostraba, y un «Guardar» posterior lo borraba.

### Lo que sigue siendo distinto en Orquestaciones, y por qué

| Qué | v9 | Aquí | Motivo |
|---|---|---|---|
| Importar con nombre repetido | REEMPLAZAR | RENOMBRAR (número detrás); nada se pisa | Una orquestación se configura una vez y sobrescribirla no se deshace |
| Aviso de «Tenant SAP distinto» | sí | no; se muestra «origen» solo si el archivo lo trae | El archivo no lleva identificadores a propósito (una exportación de pruebas no puede apuntar en silencio a producción) |
| Duplicar | `(copia)` siempre | `(copia 2)`… | Evita nombres repetidos |
| Cancelar sin conseguir el cerrojo | devuelve la corrida como si hubiera cortado | falla tras 5 intentos con un mensaje | No afirmar que se cortó lo que no se cortó |
| Reintentar el lanzamiento sin `runId` | reintenta | no reintenta | CI-DS pudo haber arrancado la tarea: reintentar duplicaría una carga |
| Variables vacías en «task individual» | las manda | no las manda | No pisar el valor por omisión de CI-DS (igual que «Projects & Tasks») |
| Marca de agente desconectado | `includes('CONNECTED')` (nunca marca a «DISCONNECTED») | sí lo marca | Error de v9 |
| Detalle de la corrida | modal «Log de ejecución» | panel plegable «Detalle por paso» con la cabecera de v9 | Hay que poder mirar el dibujo mientras corre |
| Agente y configuración en el panel del nodo | no existen | existen | El motor los usa; quitarlos sería perder funcionalidad |
| Pantalla completa | overlay propio | la del navegador | Decidido antes |
| Arranque de los hijos de un grupo | en el mismo tick | en el siguiente (≈5 s por grupo) | Documentado en el motor |
| Editor móvil | asistente por pasos con grupos, paralelos y deshacer | lista en orden que se declara incapaz ante ramas | No aplanar en silencio |
| Vida del estado de una corrida | 48 h | 7 días | Mejora declarada |

### Lo que NO se pudo comprobar en Orquestaciones

- **Contra un tenant real**: ninguna orquestación se ejecutó contra SAP; el motor, los reintentos y la
  cancelación están probados con respuestas simuladas.
- **A la vista**: los componentes se probaron en jsdom; el dibujo del lienzo (`@xyflow`) no se miró en el
  navegador (en el panel de vista previa no dibuja las aristas, ver la memoria del proyecto).
- **Qué hace SAP CI-DS** ante una variable global no declarada por la tarea o repetida en el XML (por eso se
  portó la regla de v9 de mandarla solo a quien la declara).
- Quedan reglas de CSS sin uso en `src/index.css` (`.nodo-tarea*`, `.nodo-grupo*`, `.orq-nueva`, …).

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
- **Documentador de mapeos: tres modos → dos. ESTO ERA FALSO Y SE CORRIGE (2026-10-05).** El texto
  decía que «ZIP+Jobs» y «Jobs» «hacían lo mismo». No es cierto: «ZIP+Jobs» no pide elegir ningún job ni
  subir ATL; baja las plantillas y los `P_TSKID` de TODO el tenant y empareja cada tarea por `P_TSKID`.
  El usuario pidió el 2026-10-05 que el documentador sea idéntico a v9, así que el tercer modo vuelve
  (fase 4 de la revisión). Hasta entonces sigue habiendo dos.
- **Clasificación KF/MD/FILE por tabla destino.** v9 la decide solo por el nombre del trabajo
  (`_KF_`, `_MD_`/`_DM_`, `_FILE_`). Aquí se mira primero la tabla destino (`SOPDD_STAGING_KFTAB_*` → KF,
  `SOPMD_STAG_*` → MD) y luego el nombre: un trabajo mal nombrado se clasifica bien. Cambia la columna
  «Tipo de Integración» y a qué entidad de IBP se le pide el ejemplo. Mejora deliberada; está en
  `cids-export.js` con su comentario.
- **Trabajo de IBP de un solo paso.** v9 exigía el nombre de la secuencia para leer el `P_TSKID` y por
  eso perdía las tareas de un trabajo sin secuencia. `core/ibp/app-jobs.js` (`readTaskIds`) las indexa
  con la secuencia vacía.
- **Paginación de los Application Jobs.** v9 pide `$top=50000` y cae a `$skip`; el servidor de aquí
  sigue `__next` hasta 20 páginas. Misma lectura, otra forma; en un tenant con muchísimas secuencias
  podría cortar antes.
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
| Tira de pestañas de conexiones | `ConnectionTabs.jsx` | `ui/ConnectionTabs.jsx` |
| Panel de «Requisitos Técnicos» propio | `Header.jsx` | `lib/requisitos-tecnicos.js` |
| Menú lateral minimizable | `Sidebar.jsx` | `Shell.jsx` |

**La tira de pestañas** se usa en los DOS módulos, no solo en CI-DS: es la respuesta a que en v8 los
tenants colgaran del menú lateral y aquí ese menú liste los tres módulos de la suite. Varios destinos
a la vista, con avatar.

> **Cambio del 2026-10-05, pedido por el usuario:** la tira dibuja **todas** las conexiones, siempre,
> y pulsar una la activa. Ya no hay «abrir» ni «cerrar», así que se retiraron el «+», su desplegable,
> la ✕ y `lib/pestanas-de-conexion.js` (lo que recordaba las abiertas). Si no caben en una línea pasan
> a la siguiente (`flex-wrap`), sin scroll horizontal. La sección de abajo sobre el «+» queda como
> historia de por qué existió; el problema que resolvía —no poder cambiar de conexión— no puede
> volver a darse, porque no hay conexión escondida. Además, la cabecera de la conexión pone el nombre
> y «Abrir en SAP IBP ↗» en una sola fila (v8 los apilaba) para ocupar menos alto.
>
> **Cambio del 2026-10-06, pedido por el usuario:** la franja de la conexión (v8 y v9) **desaparece**. La
> pestaña activa de la tira se ensancha (hasta 320 px), lleva el «↗» al launchpad (solo IBP) y un «ⓘ»
> que abre el nombre con ambiente, la dirección y, en CI-DS, la organización y el ambiente. El tooltip de
> toda pestaña lleva la dirección. Data Tools usa la misma tira sin `detalleDe`: no lleva «ⓘ».

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
