// Llevar una ejecución de orquestación desde la pantalla.
//
// El motor avanza por vueltas: cada llamada a `tick` empuja un paso y devuelve. Alguien tiene que ir
// llamándolo, y hoy ese alguien es esta pantalla —el reloj del servidor existe pero todavía no está
// declarado en Vercel—. Por eso el gancho tiene su propio reloj mientras la ejecución esté viva.
//
// Si se cierra la pantalla, la ejecución queda donde está y se retoma después sin repetir lo que ya
// salió bien. No se pierde nada; simplemente deja de avanzar.

import { useCallback, useEffect, useRef, useState } from 'react'
import { avisarFinDeCorrida, pedirPermisoDeAviso } from '../../../lib/aviso-de-corrida.js'
import {
  cancelRun,
  getRun,
  isRunFinished,
  resumeRun,
  startRun,
  tickRun,
} from '../../../lib/orchestrations.js'

/**
 * Cada cuánto se empuja la ejecución.
 *
 * Una vuelta consulta a SAP el estado de cada paso en marcha, y cada consulta tarda lo suyo. Cinco
 * segundos deja terminar la vuelta anterior en la mayoría de los casos; para las que no, hay una
 * guarda que impide encimarlas.
 */
const VUELTA_MS = 5000

export function useOrchestrationRun(orchestrationId, nombre) {
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // Impide encimar dos vueltas si una tarda más que el reloj: la segunda no aportaría nada y
  // duplicaría las consultas a SAP.
  const enVuelo = useRef(false)

  // El estado de la vuelta anterior, para avisar SOLO en el momento en que pasa de en marcha a
  // terminada. Sin esto, cada vuelta sobre una corrida ya terminada volvería a avisar; y al abrir la
  // pantalla de una corrida vieja avisaría de algo que pasó ayer.
  const estadoAnterior = useRef(null)
  // El nombre en una ref porque el aviso se dispara desde el reloj, que se armó con el nombre que
  // había entonces: si se renombra a mitad, el aviso tiene que decir el nuevo. Se pone en un efecto y
  // no en el cuerpo, que es escribir una ref durante el render.
  const nombreActual = useRef(nombre)
  useEffect(() => { nombreActual.current = nombre }, [nombre])

  useEffect(() => {
    let abandonado = false
    getRun(orchestrationId)
      .then((estado) => { if (!abandonado) setRun(estado) })
      .catch(() => { /* Sin ejecución previa no es un error: es lo normal la primera vez. */ })
    return () => { abandonado = true }
  }, [orchestrationId])

  const enMarcha = Boolean(run) && !isRunFinished(run)

  // El reloj que empuja la ejecución. Se apaga solo cuando termina.
  useEffect(() => {
    if (!enMarcha) return undefined

    let abandonado = false
    const empujar = async () => {
      if (enVuelo.current || abandonado) return
      enVuelo.current = true
      try {
        const siguiente = await tickRun(orchestrationId)
        if (!abandonado) {
          if (estadoAnterior.current === 'running' && isRunFinished(siguiente)) {
            avisarFinDeCorrida(nombreActual.current, siguiente?.status)
          }
          estadoAnterior.current = siguiente?.status ?? null
          setRun(siguiente)
        }
      } catch (fallo) {
        if (!abandonado) setError(fallo.message)
      } finally {
        enVuelo.current = false
      }
    }

    const reloj = setInterval(empujar, VUELTA_MS)
    const primera = setTimeout(empujar, 0)
    return () => { abandonado = true; clearInterval(reloj); clearTimeout(primera) }
  }, [enMarcha, orchestrationId])

  const accion = useCallback(async (hacer) => {
    setOcupado(true)
    setError('')
    try {
      setRun(await hacer())
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setOcupado(false)
    }
  }, [])

  return {
    run,
    error,
    ocupado,
    enMarcha,
    arrancar: (defaults) => accion(() => {
      // El permiso se pide aquí y no al montar: ver `aviso-de-corrida.js`.
      pedirPermisoDeAviso()
      estadoAnterior.current = null
      return startRun(orchestrationId, defaults)
    }),
    retomar: () => accion(() => {
      pedirPermisoDeAviso()
      estadoAnterior.current = null
      return resumeRun(orchestrationId)
    }),
    cortar: () => accion(() => cancelRun(orchestrationId)),
  }
}
