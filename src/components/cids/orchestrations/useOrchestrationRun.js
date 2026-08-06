// Llevar una ejecución de orquestación desde la pantalla.
//
// El motor avanza por vueltas: cada llamada a `tick` empuja un paso y devuelve. Alguien tiene que ir
// llamándolo, y hoy ese alguien es esta pantalla —el reloj del servidor existe pero todavía no está
// declarado en Vercel—. Por eso el gancho tiene su propio reloj mientras la ejecución esté viva.
//
// Si se cierra la pantalla, la ejecución queda donde está y se retoma después sin repetir lo que ya
// salió bien. No se pierde nada; simplemente deja de avanzar.

import { useCallback, useEffect, useRef, useState } from 'react'
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

export function useOrchestrationRun(orchestrationId) {
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // Impide encimar dos vueltas si una tarda más que el reloj: la segunda no aportaría nada y
  // duplicaría las consultas a SAP.
  const enVuelo = useRef(false)

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
        if (!abandonado) setRun(siguiente)
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
    arrancar: (defaults) => accion(() => startRun(orchestrationId, defaults)),
    retomar: () => accion(() => resumeRun(orchestrationId)),
    cortar: () => accion(() => cancelRun(orchestrationId)),
  }
}
