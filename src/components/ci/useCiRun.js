// Llevar una ejecución de orquestación de CI Tools desde la pantalla.
//
// El motor avanza por vueltas: cada llamada a `tick` empuja la ejecución un paso y devuelve. Alguien tiene que
// ir llamándolo, y hoy ese alguien es esta pantalla —no hay un reloj en el servidor—. Si se cierra, la
// ejecución queda donde está y se retoma después, sin repetir lo que ya salió bien.
//
// Una diferencia con la de CI-DS (`cids/orchestrations/useOrchestrationRun.js`), y es la razón de que esto sea
// otro archivo: allí una vuelta consulta a SAP y vuelve en segundos; aquí una vuelta ENVÍA la carga y espera a
// CPI, así que puede durar minutos. Mientras tanto la pantalla no sabría nada, así que, con una vuelta en
// camino, se lee el estado guardado cada pocos segundos: el servidor lo guarda como «en marcha» ANTES de enviar
// y se ve avanzar sin esperar a que termine la vuelta.

import { useCallback, useEffect, useRef, useState } from 'react'
import { avisarFinDeCorrida, pedirPermisoDeAviso } from '../../lib/aviso-de-corrida.js'
import { cancelRun, getRun, isRunFinished, resumeRun, startRun, tickRun } from '../../lib/orchestrations.js'

/** Cada cuánto se empuja la ejecución. Una guarda impide encimar vueltas si una tarda más. */
export const VUELTA_MS = 5000

/** Cada cuánto se lee el estado mientras una vuelta está esperando a CPI. */
export const LECTURA_MS = 3000

export function useCiRun(orchestrationId, nombre) {
  const [run, setRun] = useState(null)
  // Dos errores y no uno: el de una vuelta se borra solo en la siguiente vuelta buena (un fallo de red pasajero
  // no debe dejar una franja roja para siempre), pero el de una acción (arrancar, cortar) lo causó alguien y se
  // queda hasta la próxima acción.
  const [errorDeVuelta, setErrorDeVuelta] = useState('')
  const [errorDeAccion, setErrorDeAccion] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const enVuelo = useRef(false)
  // El estado anterior, para avisar SOLO en el momento en que pasa de en marcha a terminada.
  const estadoAnterior = useRef(null)
  const nombreActual = useRef(nombre)
  useEffect(() => { nombreActual.current = nombre }, [nombre])

  const poner = useCallback((siguiente) => {
    if (estadoAnterior.current === 'running' && isRunFinished(siguiente)) {
      avisarFinDeCorrida(nombreActual.current, siguiente?.status)
    }
    estadoAnterior.current = siguiente?.status ?? null
    setRun(siguiente)
  }, [])

  useEffect(() => {
    let abandonado = false
    getRun(orchestrationId)
      .then((estado) => {
        if (abandonado) return
        estadoAnterior.current = estado?.status ?? null
        setRun(estado)
      })
      // Sin ejecución previa no es un error: es lo normal la primera vez.
      .catch(() => {})
    return () => { abandonado = true }
  }, [orchestrationId])

  const enMarcha = Boolean(run) && !isRunFinished(run)

  useEffect(() => {
    if (!enMarcha) return undefined

    let abandonado = false

    const empujar = async () => {
      if (enVuelo.current || abandonado) return
      enVuelo.current = true
      try {
        const siguiente = await tickRun(orchestrationId)
        if (!abandonado) {
          poner(siguiente)
          setErrorDeVuelta('')
        }
      } catch (fallo) {
        if (!abandonado) setErrorDeVuelta(fallo.message)
      } finally {
        enVuelo.current = false
      }
    }

    // Con una vuelta esperando a CPI, leer lo guardado para ver avanzar los pasos.
    const leer = async () => {
      if (!enVuelo.current || abandonado) return
      try {
        const estado = await getRun(orchestrationId)
        if (!abandonado && enVuelo.current && estado) poner(estado)
      } catch {
        // Una lectura que falla no importa: la siguiente, o el resultado de la vuelta, lo arreglan.
      }
    }

    const reloj = setInterval(empujar, VUELTA_MS)
    const lector = setInterval(leer, LECTURA_MS)
    const primera = setTimeout(empujar, 0)
    return () => {
      abandonado = true
      clearInterval(reloj)
      clearInterval(lector)
      clearTimeout(primera)
    }
  }, [enMarcha, orchestrationId, poner])

  /** Corre una acción del usuario: marca ocupado y guarda su error aparte del de las vueltas. */
  async function accion(hacer) {
    setOcupado(true)
    setErrorDeAccion('')
    try {
      const siguiente = await hacer()
      poner(siguiente)
      return siguiente
    } catch (fallo) {
      setErrorDeAccion(fallo.message)
      throw fallo
    } finally {
      setOcupado(false)
    }
  }

  /** Arranca desde cero con los valores de las variables. Revienta si no se puede, para que lo vea el diálogo. */
  const arrancar = (variables) => {
    // El permiso de avisar se pide aquí, al lanzar, y no al abrir la pantalla: pedirlo sin que la persona haya
    // hecho nada es lo que hace que lo niegue de entrada.
    pedirPermisoDeAviso()
    return accion(() => startRun(orchestrationId, { variables }))
  }
  const retomar = () => accion(() => resumeRun(orchestrationId))
  const cortar = () => accion(() => cancelRun(orchestrationId))

  return {
    run,
    enMarcha,
    ocupado,
    error: errorDeAccion || errorDeVuelta,
    arrancar,
    retomar,
    cortar,
  }
}
