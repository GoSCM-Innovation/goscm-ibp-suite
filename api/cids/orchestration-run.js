// /api/cids/orchestration-run — ejecutar una orquestación y ver cómo va.
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

import { requireModule } from '../../core/auth/guards.js'
import { cancelRun, getRun, resumeRun, startRun, tickRun } from '../../core/orchestrations/runner.js'

const ACCIONES = new Set(['start', 'tick', 'resume', 'cancel'])

export default async function handler(req, res) {
  const session = await requireModule(req, res, 'cids')
  if (!session) return
  const { clientId } = session

  try {
    if (req.method === 'GET') {
      const id = req.query?.id
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      return res.status(200).json({ run: await getRun(clientId, id) })
    }

    if (req.method === 'POST') {
      const { id, action, defaults } = req.body ?? {}
      if (!id) return res.status(400).json({ error: 'Falta la orquestación.' })
      if (!ACCIONES.has(action)) {
        return res.status(400).json({ error: `Acción desconocida: "${action}".` })
      }

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
    console.error(`[cids/orchestration-run] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
