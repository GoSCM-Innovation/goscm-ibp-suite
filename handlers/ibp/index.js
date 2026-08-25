// Las operaciones de IBP, con su dirección.
//
// La tabla es CERRADA a propósito. El repartidor de `api/ibp/[...ruta].js` recibe la dirección de
// quien llama, así que si en vez de una tabla hiciera `import()` con lo que llega, cualquiera podría
// pedir un archivo que no es un endpoint. Con la tabla, lo que no está en esta lista no existe.
//
// Y es la MISMA tabla que usa el servidor de desarrollo. Que producción y desarrollo resuelvan las
// direcciones por caminos distintos es cómo se llega a «en mi máquina funciona»: aquí hay una sola
// lista y los dos la leen.

import catalog from './catalog.js'
import explorerMap from './explorer-map.js'
import jobRuns from './job-runs.js'
import jobSchedule from './job-schedule.js'
import jobs from './jobs.js'
import kfMigration from './kf-migration.js'
import masterData from './master-data.js'
import masterDataEdit from './master-data-edit.js'
import metering from './metering.js'
import migration from './migration.js'
import migrationRun from './migration-run.js'
import planningData from './planning-data.js'
import resourceStats from './resource-stats.js'
import sample from './sample.js'

export const RUTAS = Object.freeze({
  catalog,
  'explorer-map': explorerMap,
  'job-runs': jobRuns,
  'job-schedule': jobSchedule,
  jobs,
  'kf-migration': kfMigration,
  'master-data': masterData,
  'master-data-edit': masterDataEdit,
  metering,
  migration,
  'migration-run': migrationRun,
  'planning-data': planningData,
  'resource-stats': resourceStats,
  sample,
})

export default RUTAS
