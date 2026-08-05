// El modelo de conexión: dónde está el SAP de cada cliente y con qué usuario se entra.
//
// Unifica lo que en las apps viejas eran tres modelos incompatibles: el de v7 (base de OData),
// el de v8 (acuerdos de comunicación, cada uno con su usuario) y el de v9 (endpoints de CI-DS
// con su organización). Y añade lo que ninguno tenía: aislamiento por cliente y contraseñas
// cifradas en el servidor.
//
// Regla que atraviesa todo el archivo: **las contraseñas no salen de aquí**. Las funciones de
// consulta nunca devuelven el secreto, ni cifrado. La única que devuelve una contraseña en
// claro es `getCredentials`, y su resultado va directo al transporte — nunca a una respuesta
// HTTP.

import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { assertSapHost } from '../transport/ssrf.js'
import { decryptSecret, encryptSecret } from './crypto.js'

export const CONNECTION_KINDS = Object.freeze(['ibp', 'cids'])

/**
 * Los acuerdos de comunicación que usan las apps actuales. Es una ayuda para la interfaz, no
 * una restricción: la base acepta cualquiera, porque SAP publica acuerdos nuevos y dar de alta
 * uno no debería exigir tocar el código.
 */
export const KNOWN_AGREEMENTS = Object.freeze([
  'SAP_COM_0326',
  'SAP_COM_0068',
  'SAP_COM_0720',
  'SAP_COM_0924',
])

/**
 * CI-DS no tiene acuerdos de comunicación: es un solo usuario y contraseña por endpoint. Para
 * no inventar una segunda tabla que guardaría exactamente lo mismo, sus credenciales viven en
 * la misma con este nombre fijo. La interfaz no lo muestra: para una conexión de CI-DS pide
 * simplemente usuario y contraseña.
 */
export const CIDS_AGREEMENT = 'CIDS'

// Traducción de los nombres de la base al estilo del resto de la aplicación. Se hace en la
// frontera para que ninguna pantalla tenga que saber cómo se llaman las columnas.

const toConnection = (row) => row && ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  baseUrl: row.base_url,
  organization: row.organization,
  isProduction: row.is_production,
  createdAt: row.created_at,
  ...(row.agreement_count === undefined ? {} : { agreementCount: row.agreement_count }),
})

const toAgreement = (row) => row && ({
  id: row.id,
  agreement: row.agreement,
  sapUser: row.sap_user,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

function assertKind(kind) {
  if (!CONNECTION_KINDS.includes(kind)) {
    throw new Error(`Tipo de conexión desconocido: "${kind}". Debe ser 'ibp' o 'cids'.`)
  }
}

/**
 * Las conexiones de un cliente, sin secretos y con cuántos acuerdos tiene cada una.
 * Con `kind` se limita a un tipo, que es lo que pide un módulo: el monitor de CI-DS no tiene
 * nada que hacer con las conexiones de IBP.
 */
export async function listConnections(clientId, { kind = null } = {}) {
  if (kind !== null) assertKind(kind)
  const rows = await queryScoped(
    clientId,
    `select c.id, c.kind, c.name, c.base_url, c.organization, c.is_production, c.created_at,
            count(a.id)::int as agreement_count
     from connections c
     left join connection_agreements a on a.connection_id = c.id and a.client_id = c.client_id
     where c.client_id = $1${kind === null ? '' : ' and c.kind = $2'}
     group by c.id
     order by c.name`,
    kind === null ? [clientId] : [clientId, kind],
  )
  return rows.map(toConnection)
}

/** Una conexión con sus acuerdos. Cada acuerdo trae su usuario de SAP, nunca su contraseña. */
export async function getConnection(clientId, connectionId) {
  const connection = await queryOneScoped(
    clientId,
    `select id, kind, name, base_url, organization, is_production, created_at
     from connections where id = $1 and client_id = $2`,
    [connectionId, clientId],
  )
  if (!connection) return null

  const agreements = await queryScoped(
    clientId,
    `select id, agreement, sap_user, created_at, updated_at
     from connection_agreements
     where connection_id = $1 and client_id = $2
     order by agreement`,
    [connectionId, clientId],
  )
  return { ...toConnection(connection), agreements: agreements.map(toAgreement) }
}

export async function createConnection(clientId, { kind, name, baseUrl, organization = null, isProduction = false }) {
  assertKind(kind)
  if (!name?.trim()) throw new Error('La conexión necesita un nombre.')
  if (!baseUrl?.trim()) throw new Error('La conexión necesita una dirección.')

  // Se valida al guardar, no solo al llamar: un error de escritura se descubre ahora, con el
  // administrador delante, y no dentro de meses cuando alguien intente usar la conexión.
  await assertSapHost(baseUrl, { kind })

  return toConnection(await queryOneScoped(
    clientId,
    `insert into connections (client_id, kind, name, base_url, organization, is_production)
     values ($1, $2, $3, $4, $5, $6)
     returning id, kind, name, base_url, organization, is_production, created_at`,
    [clientId, kind, name.trim(), baseUrl.trim(), organization, Boolean(isProduction)],
  ))
}

export async function deleteConnection(clientId, connectionId) {
  // Los acuerdos se van con ella por la relación en cascada del esquema.
  const rows = await queryScoped(
    clientId,
    'delete from connections where id = $1 and client_id = $2 returning id',
    [connectionId, clientId],
  )
  return rows.length > 0
}

/**
 * Da de alta o actualiza un acuerdo de comunicación con su propio usuario de SAP.
 *
 * Cada acuerdo tiene SU usuario: el 0326 entra con uno y el 0720 con otro. Es una regla de los
 * tenants reales, no una posibilidad teórica, y por eso el usuario vive en el acuerdo y no en
 * la conexión.
 */
export async function upsertAgreement(clientId, connectionId, { agreement, sapUser, password }) {
  if (!agreement?.trim()) throw new Error('El acuerdo necesita un nombre.')
  if (!sapUser?.trim()) throw new Error('El acuerdo necesita un usuario de SAP.')
  if (!password) throw new Error('El acuerdo necesita una contraseña.')

  const connection = await queryOneScoped(
    clientId,
    'select id from connections where id = $1 and client_id = $2',
    [connectionId, clientId],
  )
  if (!connection) throw new Error('La conexión no existe para este cliente.')

  const name = agreement.trim()
  const secret = encryptSecret(password, { clientId, connectionId, agreement: name })

  return toAgreement(await queryOneScoped(
    clientId,
    `insert into connection_agreements
       (client_id, connection_id, agreement, sap_user, secret_ciphertext, secret_iv, secret_tag)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (connection_id, agreement) do update set
       sap_user = excluded.sap_user,
       secret_ciphertext = excluded.secret_ciphertext,
       secret_iv = excluded.secret_iv,
       secret_tag = excluded.secret_tag,
       updated_at = now()
     returning id, agreement, sap_user, created_at, updated_at`,
    [clientId, connectionId, name, sapUser.trim(), secret.ciphertext, secret.iv, secret.tag],
  ))
}

export async function deleteAgreement(clientId, agreementId) {
  const rows = await queryScoped(
    clientId,
    'delete from connection_agreements where id = $1 and client_id = $2 returning id',
    [agreementId, clientId],
  )
  return rows.length > 0
}

/**
 * Usuario y contraseña EN CLARO de un acuerdo, para dárselos al transporte.
 *
 * Es la única función de todo el sistema que devuelve una contraseña de SAP descifrada. Su
 * resultado se pasa a `core/transport` y no se guarda, no se registra y **no se devuelve
 * nunca en una respuesta HTTP**.
 */
export async function getCredentials(clientId, connectionId, agreement) {
  const row = await queryOneScoped(
    clientId,
    `select sap_user, secret_ciphertext, secret_iv, secret_tag
     from connection_agreements
     where connection_id = $1 and agreement = $2 and client_id = $3`,
    [connectionId, agreement, clientId],
  )
  if (!row) throw new Error(`La conexión no tiene configurado el acuerdo ${agreement}.`)

  return {
    user: row.sap_user,
    password: decryptSecret(
      { ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag },
      { clientId, connectionId, agreement },
    ),
  }
}

/** La dirección base y el tipo de una conexión, para armar las llamadas. */
export async function getConnectionTarget(clientId, connectionId) {
  const row = await queryOneScoped(
    clientId,
    `select id, kind, name, base_url, organization, is_production
     from connections where id = $1 and client_id = $2`,
    [connectionId, clientId],
  )
  if (!row) throw new Error('La conexión no existe para este cliente.')
  return toConnection(row)
}
