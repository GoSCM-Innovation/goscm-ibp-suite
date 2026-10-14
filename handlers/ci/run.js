// POST /api/ci/run { connectionId, integrationId, variables } — ejecutar UNA integración y esperar a CPI.
//
// Es el botón «Ejecutar» de la biblioteca. Contesta cuando CPI contestó (o a los 270 s, lo que pase primero), así
// que la función necesita sus 300 s: ver `vercel.json`.
//
// Responde 200 con el resultado AUNQUE la carga haya fallado: que CPI conteste un error es un resultado, no un
// fallo de esta API. Los códigos de error de HTTP son para lo que está mal en la petición.
//
// Cualquier usuario del cliente con el módulo contratado puede ejecutar. Quien lo hizo queda en el historial, y
// sale de la sesión, no del cuerpo.

import { requireModule } from '../../core/auth/guards.js'
import { esNombreDeVariable, executeIntegration } from '../../core/ci/index.js'

/** Deja solo las variables bien formadas. Lo demás se ignora: el valor lo valida `aplicarVariables` al enviar. */
function variablesLimpias(crudas) {
  if (!crudas || typeof crudas !== 'object' || Array.isArray(crudas)) return {}
  return Object.fromEntries(
    Object.entries(crudas).filter(([nombre, valor]) => esNombreDeVariable(nombre) && typeof valor === 'string'),
  )
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })

  const session = await requireModule(req, res, 'ci')
  if (!session) return

  const { connectionId, integrationId, variables } = req.body ?? {}
  if (!connectionId) return res.status(400).json({ error: 'Falta la conexión.' })
  if (!integrationId) return res.status(400).json({ error: 'Falta la integración.' })

  try {
    const salida = await executeIntegration({
      clientId: session.clientId,
      connectionId,
      integrationId,
      variables: variablesLimpias(variables),
      origin: 'manual',
      user: { id: session.userId, email: session.email },
    })
    return res.status(200).json({ run: salida })
  } catch (error) {
    console.error(`[ci/run] ${error.stack || error.message}`)
    return res.status(400).json({ error: error.message })
  }
}
