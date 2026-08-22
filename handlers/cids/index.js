// Las operaciones de CI-DS, con su dirección. Tabla cerrada: ver `handlers/ibp/index.js`.

import call from './call.js'
import cronTick from './cron-tick.js'
import promoted from './promoted.js'
import taskDetails from './task-details.js'

export const RUTAS = Object.freeze({
  call,
  // No la llama ninguna pantalla: la dispara el programador de tareas. Tiene que estar en la tabla
  // igual, o al pasar a mostradores dejaría de existir sin que nadie lo note hasta que algo no corra.
  'cron-tick': cronTick,
  promoted,
  'task-details': taskDetails,
})

export default RUTAS
