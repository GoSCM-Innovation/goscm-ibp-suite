# Paridad con v8 (`ibp-bom-v8`)

Inventario recorrido contra `origin/master` de v8 —no contra la carpeta local, que puede estar
atrasada—. Existe porque «¿ya está v8?» se contestó dos veces de memoria y las dos veces mal: la
única respuesta honesta sale de recorrer el árbol de `src/` de v8 y marcar cada pieza.

Última revisión: 2026-08-11, contra `ed718ed` de v8. Son **61 archivos** en su `src/` (sin contar
`assets/`, `.json` y `.css`), y este documento da cuenta de todos.

## Portado y verificado contra tenants reales

| v8 | Aquí | Notas |
|---|---|---|
| `Resumen/Resumen.jsx` | `ibp/Resumen.jsx` | |
| `Resumen/GlobalResumen.jsx` | `ibp/GlobalSummary.jsx` | |
| `Jobs/Jobs.jsx`, `Jobs/JobMonitor.jsx`, `Jobs/StepsPanel.jsx` | `ibp/JobMonitor.jsx` | Usa `SAP_COM_0326`, no `0068` |
| `Jobs/ScheduleModal.jsx` | `ibp/JobTemplates.jsx` | Lanzar un trabajo aún no se ha estrenado |
| `ResourceStats/ResourceStats.jsx` | `ibp/ResourceStats.jsx` | |
| `Metering/Metering.jsx` | `ibp/Metering.jsx` | El filtro de fechas de v8 nunca funcionó; aquí sí |
| `DataViewer/MasterDataViewer.jsx` (leer) | `ibp/MasterDataViewer.jsx` | |
| `DataViewer/EditReviewModal.jsx`, `DeleteConfirmModal.jsx` | `ibp/EdicionDeDatoMaestro.jsx` | Escritura sin estrenar |
| `DataViewer/TransactionalDataViewer.jsx` | `ibp/PlanningDataViewer.jsx` | |
| `utils/csv.js`, `config/migrationLimits.js` | `core/ibp/export-csv.js` | |
| `Migration/Migration.jsx`, `FilterControls.jsx` | `ibp/MigrationPlan.jsx` | Carga sin estrenar |
| `Migration/KeyFigureMigration.jsx` | `ibp/KfMigration.jsx` | Copia sin estrenar |
| `utils/kfReportPdf.js` | `core/ibp/kf-run-report.js` + `src/lib/kf-report-pdf.js` | Rediseñado, no traducido — ver abajo |
| `Orchestrations/*` | `cids/orchestrations/*` | Motor unificado con CI-DS |
| `TechLogs.jsx` | `src/lib/tech-logs.js` + panel | Aquí se registra solo, en `api.js` |
| `services/*`, `utils/sapUrl.js`, `dateUtils.js` | `core/ibp/*`, `core/transport/*` | |

## Lo que NO se porta, y por qué

- **`Connections/*`** — v8 guardaba las conexiones en `localStorage` en texto plano. Aquí viven
  cifradas en Postgres y se administran en Administración. `ImportConnectionsModal` importaba un
  archivo de conexiones con credenciales dentro: eso no se porta.
- **`App.jsx`, `main.jsx`, `System/SystemView.jsx`, `Sidebar/`, `Header.jsx`, `hooks/useTheme.js`** —
  el armazón de v8. Aquí es el de la suite.
- **`ui/ProgressBar.jsx`, `ui/TruncText.jsx`** — piezas sueltas de interfaz; aquí las cubren las
  clases compartidas de `src/index.css`.
- **`context/I18nContext.jsx`, `i18n/*`** — el idioma es una fase propia al final.
- **`DataViewer/DataGrid.jsx`, `ColumnPicker.jsx`, `CollapsibleSection.jsx`, `ViewerTabs.jsx`** —
  presentación. Lo que hacían está repartido en los visores.

## Lo que pide cada pantalla, comparado con lo que pedía v8

Recorrido el 2026-08-25 contra `services/masterDataApi.js`, `planningDataApi.js`, `filterUtils.js`,
`metering.js`, `jobHeaders.js` y las pantallas que los usan. El eje es el alcance y los filtros, no de
dónde salen los datos.

**Igual que v8, comprobado campo por campo:**

| Pantalla | Qué se comparó |
|---|---|
| Visor de dato maestro | `$select`, `$orderby` por claves, `$top`, y el constructor de condiciones —incluido el literal `datetimeoffset` de los campos de fecha— |
| Migración de dato maestro | `$select` de las columnas comunes, y leer todas cuando el esquema del destino no se pudo verificar |
| Monitor de trabajos | La misma lista de trece campos en el `$select`, el mismo `$top=2000`, y el mismo reintento sin filtro cuando el tenant lo rechaza con 400 |
| Estadísticas de recurso | El mismo filtro y los mismos cinco rangos. Se añade `$top=10.000`, que a una fila cada diez minutos son 69 días: el rango más largo que ofrece la pantalla son 30 |
| Consumo (metering) | Los diez conjuntos de v8. Los topes son mayores a propósito y ya estaba documentado: v8 se quedaba con las primeras 1.000 de 15.623 y dibujaba el ranking con eso |

**Dos diferencias, las dos corregidas:**

**1. La copia de cifras clave leía el nivel entero.** v8 acotaba la lectura del origen a las filas
donde ALGUNA de las cifras del grupo tiene valor —`(KF gt 0 or KF lt 0)`, porque `ne 0` SAP lo ignora
en silencio— y su propio comentario dice por qué: «reads far less than the whole planning level». Un
nivel de planificación es casi todo ceros.

Aquí ese filtro existía (`filtroDeCifra`) y **no lo usaba nadie**. La copia leía el nivel completo.

No es solo lentitud: escribir una fila en cero **pisa con un cero un valor que el destino ya tenía**.
v8 no las escribía porque no las leía.

Corregido: se cuenta y se lee acotando a las filas con valor, con el mismo respaldo que v8 —si SAP no
acepta el predicado para esas cifras, se cuenta sin él y la pantalla dice que se va a leer el nivel
entero—. Y en cualquiera de los dos casos, una fila donde TODAS las cifras valen cero no se escribe.
Una fila con una cifra en cero y otra con valor sí: ese cero es parte del dato.

La cuenta de lo leído y la de lo escrito se dicen por separado, porque el `$skip` del segmento
siguiente depende de lo leído.

**2. El filtro de cifras no sabía de fechas.** En v8 el constructor de condiciones era **una** función
(`filterUtils.js`) para los dos servicios, y emitía un literal `datetimeoffset'…'` para los valores de
fecha, porque un campo de fecha comparado como texto lo rechaza SAP: «Invalid parametertype used at
function 'eq'». Aquí llegó duplicado en dos módulos, y la copia del lado de las cifras entrecomillaba
siempre. Corregido volviendo a una sola función, que es como estaba.

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

## Huecos abiertos

Ninguno, contando los tres de arriba como cerrados. El último que quedaba —el informe de una corrida de cifras clave— se cerró el 2026-08-11,
**rediseñado en vez de traducido**, porque traducir el de v8 habría dado un informe que miente:

- v8 copiaba **una cifra por transacción**, así que su informe tenía una fila por cifra con su estado,
  su duración y sus tiempos por fase.
- Aquí varias cifras viajan en la **misma fila** de planificación —es como funciona el dato de
  planificación: una combinación de atributos y periodo lleva todas sus cifras— y la unidad de avance
  es el **segmento**. Una fila por cifra sería inventarse un dato que no existe: no hay «cuánto tardó
  ADJUSTEDPRODUCTION» cuando las cinco cifras se escribieron juntas.

Así que la tabla de resultados es por segmento —que es además la unidad real de la transacción, y por
tanto lo que quedó escrito si la corrida se cortó— y las cifras se listan en la configuración.

Dependencias nuevas: `jspdf` y `jspdf-autotable`, con **import dinámico**, así que salen en su propio
trozo del paquete (399 kB + 30 kB) y no pesan para quien nunca migra cifras. Aviso heredado de v8: la
Helvetica que trae jsPDF solo cubre WinAnsi (cp1252). Los acentos y la ñ entran; las flechas y los
símbolos (→ ✓ ⚠ ×) **no**, y salen como un carácter roto — por eso el núcleo emite `->` en ASCII.

Cerrados antes, el mismo día: pegar una lista de cifras, y las unidades y monedas del tenant como
lista (se leen de la tabla que acaba en `UOMTO` / `CURRENCYTO`, buscada por sufijo porque el prefijo
es del tenant).

## Sin estrenar

Todo lo que escribe en SAP está construido y probado en lectura, pero **no se ha ejecutado**:
lanzar un trabajo, la carga de una migración de dato maestro, modificar y borrar dato maestro,
copiar cifras clave, y lanzar una orquestación. Se estrenan con el usuario delante.
