// Las operaciones de CI Tools, con su dirección. Tabla cerrada: ver `handlers/ibp/index.js`.

import integrations from './integrations.js'
import orchestrationInfo from './orchestration-info.js'
import run from './run.js'
import runs from './runs.js'

export const RUTAS = Object.freeze({
  integrations,
  'orchestration-info': orchestrationInfo,
  run,
  runs,
})

export default RUTAS
