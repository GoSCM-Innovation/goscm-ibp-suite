// Superficie pública de core/connections.
//
// Las contraseñas de SAP entran por `upsertAgreement` y salen únicamente por `getCredentials`,
// que solo se llama desde el servidor y cuyo resultado va directo al transporte.

export { decryptSecret, encryptSecret } from './crypto.js'

export {
  CONNECTION_KINDS,
  KNOWN_AGREEMENTS,
  createConnection,
  deleteAgreement,
  deleteConnection,
  getConnection,
  getConnectionTarget,
  getAnyCredentials,
  getCredentials,
  listConnections,
  renameConnection,
  upsertAgreement,
} from './connections.js'
