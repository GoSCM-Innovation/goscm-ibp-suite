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
| `Migration/KeyFigureMigration.jsx` | `ibp/KfMigration.jsx` | Ver los huecos de abajo |
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

Queda uno, y no impide usar el módulo.

1. **Informe en PDF de una corrida de cifras clave.** v8 generaba un PDF con la configuración, las
   cifras, los resultados y los tiempos por fase. No se porta tal cual porque el modelo de corrida es
   distinto: v8 copiaba una cifra por transacción y medía fases por cifra; aquí varias cifras viajan
   en la misma fila y el progreso es por segmento. Un informe equivalente hay que **diseñarlo**, no
   traducirlo, y además traería dos dependencias nuevas (`jspdf`, `jspdf-autotable`).

Cerrados el 2026-08-11: pegar una lista de cifras, y las unidades y monedas del tenant como lista
(se leen de la tabla que acaba en `UOMTO` / `CURRENCYTO`, buscada por sufijo porque el prefijo es del
tenant).

## Sin estrenar

Todo lo que escribe en SAP está construido y probado en lectura, pero **no se ha ejecutado**:
lanzar un trabajo, la carga de una migración de dato maestro, modificar y borrar dato maestro,
copiar cifras clave, y lanzar una orquestación. Se estrenan con el usuario delante.
