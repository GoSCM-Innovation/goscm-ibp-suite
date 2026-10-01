// La ejecución de una orquestación de IBP desde la pantalla. Es `useOrchRun.js` de v8 por fuera y el
// motor del servidor por dentro.
//
// En v8 el bucle corría en el navegador: programaba cada trabajo, preguntaba a SAP cada diez
// segundos y decidía. Aquí todo eso lo hace el motor (`core/orchestrations/runner.js`) con las
// reglas de v8 —ver la política del adaptador de IBP en `core/orchestrations/adapters.js`— y este
// gancho solo lo empuja: cada diez segundos le pide una vuelta, que es lo que en v8 era una consulta.
// La primera vuelta va en el acto (lanza los primeros trabajos, como v8 al pulsar «▶ Ejecutar») y
// la primera consulta a SAP llega diez segundos después, como en v8.
//
// Lo que cambia, y está pendiente de una decisión del usuario: v8 seguía mientras la página
// estuviera abierta, aunque se cambiara de pestaña dentro de la aplicación. Aquí la ejecución avanza
// mientras esta pantalla esté montada; si se cierra, queda donde está y sigue al volver, sin repetir
// nada. Un reloj del servidor la haría avanzar sola.
//
// Como en v8, la ejecución queda abierta hasta que se pulsa «← Volver al editor»: al volver a la
// pestaña se reabre la orquestación en su vista de ejecución. v8 guardaba la ejecución entera en el
// `localStorage`; aquí la guarda el servidor y en el navegador solo queda CUÁL está abierta.

import { useCallback, useEffect, useRef, useState } from 'react'

import { cancelRun, getRun, isRunFinished, startRun, tickRun } from '../../../lib/orchestrations.js'

/** Cada cuánto preguntaba v8 a SAP por un trabajo en marcha. */
export const POLL_MS = 10000

/** La misma clave que usaba v8 para la ejecución de una conexión. */
const CLAVE = (connId) => `ibp_orch_run_${connId}`

function leerAbierta(connId) {
  try { return localStorage.getItem(CLAVE(connId)) || null } catch { return null }
}
function guardarAbierta(connId, orchId) {
  try { localStorage.setItem(CLAVE(connId), orchId) } catch { /* sin almacenamiento, no se reabre */ }
}
function olvidarAbierta(connId) {
  try { localStorage.removeItem(CLAVE(connId)) } catch { /* nada que olvidar */ }
}

/** El aviso del navegador al terminar, con los textos de v8. */
const AVISO = Object.freeze({ success: 'Completada correctamente', error: 'Finalizó con errores', cancelled: 'Cancelada' })

function avisar(nombre, estado) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (window.Notification.permission !== 'granted') return
  new window.Notification(nombre || 'Orquestación', { body: AVISO[estado] || estado })
}

export function useOrchRun(connection) {
  const connId = connection.id
  // Qué orquestación tiene la ejecución abierta, y la ejecución misma.
  const [runOrchId, setRunOrchId] = useState(() => leerAbierta(connId))
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')

  const enVuelo = useRef(false)
  const nombre = useRef('')
  const anterior = useRef(null)

  // Al entrar: la ejecución que quedó abierta.
  useEffect(() => {
    if (!runOrchId) return undefined
    let abandonado = false
    getRun(runOrchId)
      .then((estado) => {
        if (abandonado) return
        // El servidor ya no la tiene (vence a la semana): no hay nada que reabrir.
        if (!estado) { olvidarAbierta(connId); setRunOrchId(null); return }
        anterior.current = estado.status ?? null
        setRun(estado)
      })
      .catch(() => {
        // La orquestación ya no existe o no se pudo leer: se vuelve al editor.
        if (abandonado) return
        olvidarAbierta(connId)
        setRunOrchId(null)
      })
    return () => { abandonado = true }
  }, [runOrchId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = Boolean(run) && !isRunFinished(run)

  // El reloj que empuja la ejecución mientras esté en marcha.
  useEffect(() => {
    if (!isRunning || !runOrchId) return undefined
    let abandonado = false

    const empujar = async () => {
      if (enVuelo.current || abandonado) return
      enVuelo.current = true
      try {
        const siguiente = await tickRun(runOrchId)
        if (abandonado) return
        if (anterior.current === 'running' && isRunFinished(siguiente)) avisar(nombre.current, siguiente?.status)
        anterior.current = siguiente?.status ?? null
        setRun(siguiente)
      } catch {
        // Una vuelta que no llegó no decide nada: la siguiente lo vuelve a intentar, como v8 cuando
        // una consulta a SAP fallaba.
      } finally {
        enVuelo.current = false
      }
    }

    const primera = setTimeout(empujar, 0)
    const reloj = setInterval(empujar, POLL_MS)
    return () => { abandonado = true; clearTimeout(primera); clearInterval(reloj) }
  }, [isRunning, runOrchId])

  /** Arranca la ejecución de una orquestación ya guardada. Devuelve si arrancó. */
  const start = useCallback(async (orch) => {
    setError('')
    try {
      const estado = await startRun(orch.id, {})
      nombre.current = orch.name
      anterior.current = estado?.status ?? null
      guardarAbierta(connId, orch.id)
      setRunOrchId(orch.id)
      setRun(estado)
      return true
    } catch (fallo) {
      setError(fallo.message)
      return false
    }
  }, [connId])

  /** Corta la orquestación. No se le pide nada a SAP: los trabajos lanzados terminan solos (v8). */
  const cancel = useCallback(async () => {
    if (!runOrchId) return
    try {
      const estado = await cancelRun(runOrchId)
      anterior.current = estado?.status ?? null
      setRun(estado)
    } catch (fallo) {
      setError(fallo.message)
    }
  }, [runOrchId])

  /** «← Volver al editor»: cierra la ejecución. */
  const reset = useCallback(() => {
    olvidarAbierta(connId)
    setRunOrchId(null)
    setRun(null)
  }, [connId])

  /**
   * Abre la ejecución en marcha de una orquestación, si la tiene. Es para la que se lanzó desde otro
   * equipo o desde otra pestaña: sin esto el editor dejaría pulsar «▶ Ejecutar» y el servidor
   * contestaría que ya hay una en curso. Devuelve si había una.
   */
  const adoptIfRunning = useCallback(async (orch) => {
    try {
      const estado = await getRun(orch.id)
      if (!estado || isRunFinished(estado)) return false
      nombre.current = orch.name
      anterior.current = estado.status
      guardarAbierta(connId, orch.id)
      setRunOrchId(orch.id)
      setRun(estado)
      return true
    } catch {
      return false
    }
  }, [connId])

  /** El nombre para el aviso de fin, por si se renombró. */
  const setRunName = useCallback((valor) => { nombre.current = valor }, [])

  return { run, runOrchId, isRunning, error, setError, start, cancel, reset, adoptIfRunning, setRunName }
}
