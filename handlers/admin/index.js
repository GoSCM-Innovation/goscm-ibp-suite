// Las operaciones de administración, con su dirección. Tabla cerrada: ver `handlers/ibp/index.js`.

import clients from './clients.js'
import connections from './connections.js'
import subscriptions from './subscriptions.js'
import users from './users.js'

export const RUTAS = Object.freeze({
  clients,
  connections,
  subscriptions,
  users,
})

export default RUTAS
