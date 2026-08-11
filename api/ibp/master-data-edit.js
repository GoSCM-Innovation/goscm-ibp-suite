// POST /api/ibp/master-data-edit — modificar o borrar filas de dato maestro.
//
// **ESTO ESCRIBE EN SAP**, y a diferencia de la migración toca filas que ya existen: alguien cambió
// un valor a mano.
//
// Dos confirmaciones DISTINTAS a propósito. Modificar un valor se puede volver a cambiar; borrar en
// SAP IBP es IRREVERSIBLE —no hay papelera ni deshacer— así que pedir la misma palabra para las dos
// las igualaría, y no son iguales.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { escribirDatoMaestro } from '../../core/ibp/master-data-edit-run.js'
import { filasParaBorrar, filasParaModificar } from '../../core/ibp/master-data-edit.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** La palabra que hay que mandar para cada operación. */
const CONFIRMACION = Object.freeze({ modificar: 'guardar', borrar: 'borrar' })

/**
 * Tope de filas por llamada.
 *
 * Una edición a mano son docenas de filas. Un número grande aquí no habilita nada útil y sí permite
 * que un error de la pantalla mande miles sin que nadie los haya revisado.
 */
const MAX_FILAS = 2000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const {
    accion, connectionId, entidad, planningArea, versionId = '',
    edits = {}, filas = [], claves = [], confirmacion,
  } = req.body ?? {}

  if (accion !== 'modificar' && accion !== 'borrar') {
    return res.status(400).json({ error: `Acción desconocida: "${accion}".` })
  }
  if (confirmacion !== CONFIRMACION[accion]) {
    return res.status(400).json({
      error: accion === 'borrar'
        ? 'Falta la confirmación de que se quiere BORRAR, que en SAP no se puede deshacer.'
        : 'Falta la confirmación de que se quiere escribir en el tenant.',
    })
  }
  if (!entidad) return res.status(400).json({ error: 'Falta la tabla.' })
  if (!Array.isArray(claves) || claves.length === 0) {
    return res.status(400).json({
      error: 'Sin las claves de negocio no se puede identificar qué registro tocar.',
    })
  }

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getAnyCredentials(session.clientId, connectionId, ACUERDOS)

    const aEscribir = accion === 'borrar'
      ? filasParaBorrar(filas, claves)
      : filasParaModificar(edits, claves)

    if (aEscribir.length === 0) return res.status(400).json({ error: 'No hay nada que escribir.' })
    if (aEscribir.length > MAX_FILAS) {
      return res.status(400).json({ error: `De a ${MAX_FILAS} filas como mucho.` })
    }

    const salida = await escribirDatoMaestro({
      baseUrl: conexion.baseUrl,
      credentials,
      entidad,
      filas: aEscribir,
      borrar: accion === 'borrar',
      planningArea,
      versionId,
      nombre: `GoSCM · ${accion} ${entidad}`,
    })

    // Queda registrado quién tocó qué. Es la única operación que modifica filas existentes.
    console.log(`[ibp/master-data-edit] ${session.userId ?? session.clientId} · ${accion} · ${entidad}`
      + ` · ${planningArea}/${versionId || 'base'} · ${aEscribir.length} filas · ${salida.ok ? 'ok' : salida.estado}`)

    return res.status(200).json(salida)
  } catch (error) {
    console.error(`[ibp/master-data-edit] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message, detalle: error.detail ?? '' })
  }
}
