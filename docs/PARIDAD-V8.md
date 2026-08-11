# Paridad con v8 (`ibp-bom-v8`)

Inventario recorrido contra `origin/master` de v8 —no contra la carpeta local, que puede estar
atrasada—. Existe porque «¿ya está v8?» se contestó dos veces de memoria y las dos veces mal: la
única respuesta honesta sale de recorrer el árbol de `src/` de v8 y marcar cada pieza.

Última revisión: 2026-08-11, contra `ed718ed` de v8.

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
- **`System/SystemView.jsx`, `Sidebar/`, `Header.jsx`, `hooks/useTheme.js`** — el armazón de v8.
  Aquí es el de la suite.
- **`context/I18nContext.jsx`, `i18n/*`** — el idioma es una fase propia al final.
- **`DataViewer/DataGrid.jsx`, `ColumnPicker.jsx`, `CollapsibleSection.jsx`, `ViewerTabs.jsx`** —
  presentación. Lo que hacían está repartido en los visores.

## Huecos abiertos

Ninguno. El último que quedaba —el informe de una corrida de cifras clave— se cerró el 2026-08-11,
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
