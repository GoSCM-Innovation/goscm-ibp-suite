// GET /api/connections?kind=cids — a qué tenants puede apuntar un módulo.
//
// Distinto de /api/admin/connections: ese es para configurar y exige ser administrador. Este es
// para trabajar y lo usa cualquier usuario, así que devuelve **solo lo que hace falta para
// elegir y para decir contra qué sistema se está trabajando**: identificador, nombre, dirección,
// organización y si es productivo. Ni la dirección ni la organización son secretos —son lo que la
// cabecera del sistema de v9 enseñaba—; las credenciales sí lo son y no salen.

import { contractedModules, requireSession } from '../core/auth/guards.js'
import { listConnections } from '../core/connections/connections.js'

/**
 * Qué módulos dan derecho a ver las conexiones de cada tipo.
 *
 * La comprobación va aquí y no en la interfaz: un desplegable vacío no impide que alguien
 * llame al endpoint a mano. Una conexión de IBP la usan dos módulos, así que con cualquiera
 * de los dos alcanza.
 */
const MODULES_BY_KIND = Object.freeze({
  ibp: ['explorer', 'jobs'],
  cids: ['cids'],
})

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireSession(req, res)
  if (!session) return

  const kind = req.query?.kind
  const habilitantes = MODULES_BY_KIND[kind]
  if (!habilitantes) {
    return res.status(400).json({ error: "Falta el tipo de conexión ('ibp' o 'cids')." })
  }

  try {
    const contratados = await contractedModules(session.clientId)
    if (!habilitantes.some((module) => contratados.includes(module))) {
      return res.status(403).json({ error: 'Ningún módulo contratado usa este tipo de conexión.' })
    }

    const connections = await listConnections(session.clientId, { kind })
    return res.status(200).json({
      // La dirección va incluida: no es un secreto —es el nombre de host del tenant, que el consultor
      // reconoce— y sin ella la pantalla no puede decir contra QUÉ sistema está corriendo.
      // `etiquetaDeConexion` ya la esperaba y se quedaba muda sin ella. Las credenciales siguen sin
      // salir de aquí: viven cifradas y solo el servidor las descifra.
      // La organización (`orgName` de CI-DS) acompaña a la dirección por el mismo motivo: la cabecera
      // de CI-DS Tools dice «dirección · organización · Producción|Sandbox», como la de v9.
      connections: connections.map(({ id, name, baseUrl, organization, isProduction, agreements }) => (
        { id, name, baseUrl, organization: organization ?? null, isProduction, agreements: agreements ?? [] }
      )),
    })
  } catch (error) {
    console.error(`[connections] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
