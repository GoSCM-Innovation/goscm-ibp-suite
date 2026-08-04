// Superficie pública de core/accounts: lo que hace el panel de administración.
//
// No estaba en el mapa original de la capa transversal porque el levantamiento no llegó a
// decidir dónde vivían estas operaciones. Van aquí, y no en `core/auth`, porque `auth`
// responde a "quién eres y qué puedes"; esto es "quién existe y qué contrató".

export {
  createClient,
  createUser,
  deleteUser,
  listClients,
  listSubscriptions,
  listUsers,
  setClientStatus,
  setSubscription,
  setUserRoles,
  setUserStatus,
} from './accounts.js'
