// /api/orchestration-run — ejecutar una orquestación y ver cómo va, sea de CI-DS o de IBP.
//
//   GET    ?id=…                    el estado de la ejecución
//   POST   { id, action, defaults } arrancar, retomar, cortar, o avanzar una vuelta
//
// Una vuelta ("tick") avanza la ejecución un paso y devuelve: mira qué tareas están corriendo en
// SAP, lanza las que ya pueden y guarda. Se llama repetidamente porque una función serverless se
// corta a los diez segundos y una orquestación puede durar horas.
//
// Quién la llama: por ahora la propia pantalla mientras esté abierta. Cuando exista la programación
// por cron, también el reloj —y por eso `tick` es una acción como cualquier otra en vez de estar
// escondida dentro de "arrancar".

import { hasModule, requireSession } from '../core/auth/guards.js'
import { getConnectionTarget } from '../core/connections/index.js'
import { getOrchestration } from '../core/orchestrations/orchestrations.js'
import { cancelRun, getRun, resumeRun, startRun, tickRun } from '../core/orchestrations/runner.js'

const ACCIONES = new Set(['start', 'tick', 'resume', 'cancel'])

/** Qué módulo hay que tener contratado para orquestar cada tipo de conexión. */
const MODULO_DE = Object.freeze({ cids: 'cids', ibp: 'jobs' })

export default async function handler(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  const { clientId } = session

  /**
   * Comprueba que el módulo del tipo de la conexión de esa orquestación esté contratado.
   *
   * Se mira por la CONEXIÓN y no por la ruta: encadenar tareas de CI-DS y encadenar Application Jobs
   * son la misma cosa por dentro, pero se contratan por separado, y esto es lo que impide que quien
   * tenga uno solo llegue a las del otro.
   */
  async function exigirModulo(id) {
    const orquestacion = await getOrchestration(clientId, id)
    if (!orquestacion) return false

    const conexion = await getConnectionTarget(clientId, orquestacion.connectionId)
    const modulo = MODULO_DE[conexion.kind]
    if (!modulo) throw new Error(`No hay forma de orquestar una conexión de tipo "${conexion.kind}".`)
    if (!(await hasModule(clientId, modulo))) throw new Error('Tu empresa no tiene contratado ese módulo.')
    return true
  }

  try {
    if (req.method === 'GET') {
      const id = req.query?.id
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      // Igual que si fuera de otro cliente: contestar distinto confirmaría que existe.
      if (!(await exigirModulo(id))) return res.status(404).json({ error: 'La orquestación no existe.' })
      return res.status(200).json({ run: await getRun(clientId, id) })
    }

    if (req.method === 'POST') {
      const { id, action, defaults } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      if (!ACCIONES.has(action)) {
        return res.status(400).json({ error: `Acción desconocida: "${action}".` })
      }
      if (!(await exigirModulo(id))) return res.status(404).json({ error: 'La orquestación no existe.' })

      // `defaults` son el agente, la configuración y las variables que valen para todos los pasos
      // que no traigan los suyos. Los elige quien lanza, en el diálogo de ejecución.
      if (action === 'start') return res.status(200).json({ run: await startRun(clientId, id, { defaults }) })
      if (action === 'resume') return res.status(200).json({ run: await resumeRun(clientId, id) })
      if (action === 'cancel') return res.status(200).json({ run: await cancelRun(clientId, id) })
      return res.status(200).json({ run: await tickRun(clientId, id) })
    }

    return res.status(405).json({ error: 'Método no permitido.' })
  } catch (error) {
    // Los mensajes del motor están escritos para mostrarse: dicen si ya hay una ejecución en curso,
    // si no hay nada que retomar, o qué paso no se pudo lanzar.
    console.error(`[orchestration-run] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
