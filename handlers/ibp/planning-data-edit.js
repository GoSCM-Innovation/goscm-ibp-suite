// POST /api/ibp/planning-data-edit — guardar key figures editadas a mano en «Ver Dato Transaccional».
//
// **ESTO ESCRIBE EN SAP**: cambia valores que ya existen en el tenant. Por eso pide una confirmación
// en el cuerpo, como la edición de dato maestro: sin ella no se escribe nada.
//
// El navegador manda la definición del nivel aplicado y las filas editadas; las filas a enviar las
// arma el servidor con `core/`, que solo deja pasar las KEY FIGURES del nivel. Dimensiones y tiempo
// son la identidad de la fila y no se editan.

import { requireModule } from '../../core/auth/guards.js'
import { getAnyCredentials, getConnectionTarget } from '../../core/connections/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'
import { filasDeEdicionDeCifras } from '../../core/ibp/planning-data-edit.js'
import { escribirCifrasEditadas } from '../../core/ibp/planning-data-edit-run.js'
import { esNombreDeCampo } from '../../core/ibp/planning-data-model.js'

const ACUERDOS = ['SAP_COM_0720', 'SAP_COM_0326']

/** La palabra que hay que mandar para escribir. La misma que al guardar dato maestro. */
const CONFIRMACION = 'guardar'

/**
 * Tope de filas por llamada.
 *
 * Una edición a mano son docenas de filas. Un número grande aquí no habilita nada útil y sí permite
 * que un error de la pantalla mande miles sin que nadie las haya revisado.
 */
const MAX_FILAS = 2000

/** Solo los nombres de campo de verdad: van a la dirección y al cuerpo que se manda a SAP. */
const nombres = (lista) => (Array.isArray(lista) ? lista.filter(esNombreDeCampo) : [])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  // El mismo módulo que la lectura: el visor es una pestaña de IBP Tools.
  const session = await requireModule(req, res, 'jobs')
  if (!session) return

  const {
    connectionId, area, versionId = '', atributos, tiempo, cifras, edits = {}, confirmacion,
  } = req.body ?? {}

  if (confirmacion !== CONFIRMACION) {
    return res.status(400).json({ error: 'Falta la confirmación de que se quiere escribir en el tenant.' })
  }
  if (!esNombreDeCampo(area)) return res.status(400).json({ error: 'Falta el área de planificación.' })
  if (!esNombreDeCampo(tiempo) || nombres(cifras).length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos un key figure y un nivel de tiempo.' })
  }

  const { campos, cifras: cambiadas, filas } = filasDeEdicionDeCifras({
    edits: edits && typeof edits === 'object' ? edits : {},
    atributos: nombres(atributos),
    tiempo,
    cifras: nombres(cifras),
  })

  if (filas.length === 0) return res.status(400).json({ error: 'No hay nada que escribir.' })
  if (filas.length > MAX_FILAS) return res.status(400).json({ error: `Como mucho ${MAX_FILAS} filas por vez.` })

  try {
    const conexion = await getConnectionTarget(session.clientId, connectionId)
    if (conexion.kind !== 'ibp') return res.status(400).json({ error: 'Esa conexión no es de IBP.' })

    const credentials = await getAnyCredentials(session.clientId, connectionId, ACUERDOS)

    const salida = await escribirCifrasEditadas({
      baseUrl: conexion.baseUrl,
      credentials,
      area,
      versionId: String(versionId ?? ''),
      campos,
      cifras: cambiadas,
      filas,
    })

    // Queda registrado quién tocó qué: modifica valores que ya existían.
    console.log(`[ibp/planning-data-edit] ${session.userId ?? session.clientId} · ${area}/${versionId || 'base'}`
      + ` · ${cambiadas.join(',')} · ${filas.length} filas · ${salida.estado}`)

    return res.status(200).json(salida)
  } catch (error) {
    console.error(`[ibp/planning-data-edit] ${error.stack || error.message}`)
    // Una key figure CALCULADA no se puede escribir nunca; SAP lo dice con un 500 «invalid column
    // name». Se dice con el texto de v8, que nombra cuál.
    if (error?.cifraCalculada) {
      return res.status(400).json({
        error: `La key figure ${error.cifraCalculada} es calculada (no editable): SAP rechazó el cambio.`,
      })
    }
    const mensaje = explicarFallo(error, ACUERDOS)
    const detalle = String(error?.detail ?? '')
    return res.status(400).json({
      error: detalle && !mensaje.includes(detalle) ? `${mensaje}: ${detalle}` : mensaje,
      detalle,
    })
  }
}
