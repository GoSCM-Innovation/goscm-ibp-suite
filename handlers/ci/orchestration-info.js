// GET /api/ci/orchestration-info?id=… — qué lleva una orquestación de CI Tools y qué pide para lanzarse.
//
// Lo usa la pantalla para dos cosas: enseñar, en cada paso, la integración que ejecuta (nombre, carpeta, tipo,
// comando), y armar el diálogo de «Ejecutar» con las variables que piden las integraciones y los valores con que
// se corrió la última vez.

import { requireModule } from '../../core/auth/guards.js'
import { getConnectionTarget } from '../../core/connections/index.js'
import { infoDeOrquestacion, ultimasVariables } from '../../core/ci/index.js'
import { getOrchestration } from '../../core/orchestrations/orchestrations.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'ci')
  if (!session) return

  const { id } = req.query ?? {}
  if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })

  try {
    const orquestacion = await getOrchestration(session.clientId, id)
    // Igual que si fuera de otro cliente: contestar distinto confirmaría que existe.
    if (!orquestacion) return res.status(404).json({ error: 'La orquestación no existe.' })

    const conexion = await getConnectionTarget(session.clientId, orquestacion.connectionId)
    if (conexion.kind !== 'ci') return res.status(400).json({ error: 'Esa orquestación no es de CI Tools.' })

    const info = await infoDeOrquestacion(session.clientId, orquestacion)
    const ultimas = await ultimasVariables(session.clientId, { orchestrationId: id })

    return res.status(200).json({
      // Sin el body de cada integración: la pantalla no lo necesita aquí, y pesa.
      pasos: info.pasos.map(({ integracion, ...paso }) => ({
        ...paso,
        integracion: integracion && {
          id: integracion.id,
          name: integracion.name,
          folder: integracion.folder,
          resumen: integracion.resumen,
        },
      })),
      variables: info.variables,
      variablesDeFecha: info.variablesDeFecha ?? [],
      // Lo que los ajustes de la orquestación (los del lote, y por paso en `pasos`) cambian: lo que se enviaría.
      ajustes: orquestacion.ajustes ?? {},
      rotos: info.rotos,
      ultimas,
    })
  } catch (error) {
    console.error(`[ci/orchestration-info] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
