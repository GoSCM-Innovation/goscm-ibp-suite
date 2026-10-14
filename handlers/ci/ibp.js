// GET /api/ci/ibp — lo que CI Tools le pregunta al SAP IBP de destino para sugerir al armar un body.
//
//   ?connectionId=<conexión de CI>&accion=resumen                       áreas, versiones y tablas de dato maestro
//   ?connectionId=…&accion=campos-maestro&entidad=<tabla>               campos de una tabla, con su etiqueta
//   ?connectionId=…&accion=cifras&area=<área>                           dimensiones y cifras clave de un área
//   ?connectionId=…&accion=valores&entidad=<tabla>|area=<área>&campo=…  valores distintos de un campo
//   … &actualizar=1                                                     salta lo guardado y vuelve a leer
//
// A qué IBP se pregunta lo dice la conexión de Cloud Integration (se elige en Administración → Conexiones). Es
// solo lectura y exige el módulo `ci`: un cliente que solo tiene CI Tools puede leer el catálogo de SU IBP vinculado
// y nada más. Si IBP no contesta, el formulario sigue funcionando: aquí no hay nada obligatorio.

import { requireModule } from '../../core/auth/guards.js'
import { ACUERDOS_IBP, leerCatalogo } from '../../core/ci/index.js'
import { explicarFallo } from '../../core/ibp/explicar-fallo.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'ci')
  if (!session) return

  const { connectionId, accion, area, entidad, campo, actualizar } = req.query ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
  if (!accion) return res.status(400).json({ error: 'Falta qué se quiere leer.' })

  try {
    const respuesta = await leerCatalogo({
      clientId: session.clientId,
      connectionId,
      accion,
      area,
      entidad,
      campo,
      actualizar: actualizar === '1' || actualizar === 'true',
    })
    return res.status(200).json(respuesta)
  } catch (error) {
    // «Sin IBP de destino» es un estado esperado de una conexión recién creada, no un fallo: 409 y sin llenar el
    // registro de errores. La pantalla lo lee para ofrecer el camino en lugar de enseñar un error.
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message, codigo: error.codigo ?? null })
    }
    console.error(`[ci/ibp] ${error.stack || error.message}`)
    return res.status(400).json({ error: explicarFallo(error, ACUERDOS_IBP) })
  }
}
