// POST /api/ibp/pa-doc-live  { connectionId, accion, ids? } — los datos en vivo del documentador.
//
//   accion: 'entidades'         → { entidades: { ID: 'Entidad' | null } }   qué tipos tienen entidad.
//   accion: 'volumetria'        → { cuentas:   { ID: número | null } }      registros por tipo.
//   accion: 'application-jobs'  → { entidades, jobs }                       plantillas y sus pasos.
//
// Es el enriquecimiento opcional de «Planning Area Documenter». Cada fuente va por su propio acuerdo y
// falla aislada: si solo hay uno de los dos activo, el otro contesta con su error y el documento sale
// igual con lo disponible. Las credenciales se descifran aquí y no salen de aquí.
//
// La volumetría se pide en dos operaciones y por tandas porque una función de Vercel tiene tiempo
// limitado y un área puede tener un centenar de tipos: el navegador decide cuántos manda por llamada.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import {
  conjuntosDeDatoMaestro,
  contarTipos,
  leerAppJobs,
  resolverEntidades,
} from '../../core/ibp/pa-doc-live.js'

/** Dato maestro se habilita con 0720; se cae a 0326 porque hay tenants con un único usuario. */
const ACUERDOS_DE_DATO_MAESTRO = ['SAP_COM_0720', 'SAP_COM_0326']
const ACUERDOS_DE_JOBS = ['SAP_COM_0326', 'SAP_COM_0720']

/** Cuántos tipos entran en una llamada, como máximo. */
export const MAX_IDS = 400

/** Los identificadores que llegan del navegador, limpios: texto, sin repetir y con tope. */
export function idsDe(valor) {
  if (!Array.isArray(valor)) return []
  const limpios = valor
    .filter((uno) => typeof uno === 'string')
    .map((uno) => uno.trim())
    .filter((uno) => uno && uno.length <= 100)
  return [...new Set(limpios)].slice(0, MAX_IDS)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  // El documentador es una aplicación de Data Tools.
  const session = await requireModule(req, res, 'explorer')
  if (!session) return

  const { connectionId, accion } = req.body ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })

  const acuerdos = accion === 'application-jobs' ? ACUERDOS_DE_JOBS : ACUERDOS_DE_DATO_MAESTRO

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getAnyCredentials(session.clientId, connectionId, acuerdos)
    const contexto = { baseUrl: conexion.baseUrl, credentials }

    switch (accion) {
      case 'entidades': {
        const conjuntos = await conjuntosDeDatoMaestro(contexto)
        return res.status(200).json({ entidades: resolverEntidades(idsDe(req.body.ids), conjuntos) })
      }

      case 'volumetria': {
        const ids = idsDe(req.body.ids)
        if (ids.length === 0) return res.status(400).json({ error: 'No se indicó ningún tipo de dato maestro.' })
        return res.status(200).json({ cuentas: await contarTipos({ ...contexto, ids }) })
      }

      case 'application-jobs':
        return res.status(200).json(await leerAppJobs(contexto))

      default:
        return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
    }
  } catch (error) {
    console.error(`[ibp/pa-doc-live] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, acuerdos) })
  }
}
