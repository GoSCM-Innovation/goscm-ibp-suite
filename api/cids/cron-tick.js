// /api/cids/cron-tick — avanza una vuelta TODAS las orquestaciones que estén corriendo.
//
// Portado de `api/cron-tick.js` de v9. Es lo que permite que una ejecución siga adelante sin que
// nadie tenga el navegador abierto: el reloj llama aquí cada tanto y cada llamada empuja un paso.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// OJO: hoy NADIE llama a este endpoint. Es lo mismo que pasa en v9
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// En v9 este endpoint existe, la documentación dice que lo invoca Vercel Cron... y `vercel.json` no
// declara ningún cron. Nadie lo llama nunca. En la práctica, allí la ejecución avanza solo mientras
// la pantalla esté abierta y se congela al cerrarla.
//
// Se porta igual de a propósito, con la decisión tomada y anotada en vez de heredada por descuido.
// Para que funcione de verdad falta declararlo en `vercel.json`:
//
//     "crons": [{ "path": "/api/cids/cron-tick", "schedule": "* * * * *" }]
//
// Con una salvedad que decide cuándo hacerlo: en el plan Hobby de Vercel los cron corren **una vez
// por día**, y con eso no se puede llevar una ejecución hasta el final —serviría para arrancar algo,
// no para empujarlo—. Cada minuto hace falta plan Pro.
//
// Mientras tanto la pantalla es la que empuja, y una ejecución que quede a medias se retoma con
// "retomar", que no repite lo que ya salió bien.

import { bearerMatches } from '../../core/auth/secrets.js'
import { listActiveRuns, tickRun } from '../../core/orchestrations/runner.js'

/** Un secreto corto se adivina. Dieciséis caracteres es el mínimo que exigía v9. */
const LARGO_MINIMO_DEL_SECRETO = 16

export default async function handler(req, res) {
  const secreto = process.env.CRON_SECRET

  // Sin secreto configurado no se abre: un endpoint que avanza cargas en SAP no puede quedar
  // expuesto porque falte una variable de entorno.
  if (!secreto || secreto.length < LARGO_MINIMO_DEL_SECRETO) {
    console.error('[cron-tick] CRON_SECRET sin configurar o más corto que el mínimo.')
    return res.status(500).json({ error: 'El reloj no está configurado.' })
  }

  // Comparación resistente a temporización: v9 usaba `!==`, que tarda distinto según cuántos
  // caracteres acertaste y permite adivinar el secreto a fuerza de intentos.
  if (!bearerMatches(req.headers?.authorization, secreto)) {
    return res.status(401).json({ error: 'No autorizado.' })
  }

  const enMarcha = await listActiveRuns()
  if (enMarcha.length === 0) return res.status(200).json({ avanzadas: 0 })

  // allSettled: una orquestación que falle no puede impedir que avancen las demás, que pueden ser
  // de otros clientes.
  const resultados = await Promise.allSettled(
    enMarcha.map(({ clientId, orchestrationId }) => tickRun(clientId, orchestrationId)),
  )

  const fallos = resultados
    .map((resultado, i) => (resultado.status === 'rejected'
      ? { orchestrationId: enMarcha[i].orchestrationId, error: resultado.reason?.message }
      : null))
    .filter(Boolean)

  for (const fallo of fallos) {
    console.error(`[cron-tick] ${fallo.orchestrationId}: ${fallo.error}`)
  }

  return res.status(200).json({
    avanzadas: resultados.filter((resultado) => resultado.status === 'fulfilled').length,
    // Los identificadores de cliente no salen en la respuesta: quien llama al reloj no es de nadie.
    fallos: fallos.length || undefined,
  })
}
