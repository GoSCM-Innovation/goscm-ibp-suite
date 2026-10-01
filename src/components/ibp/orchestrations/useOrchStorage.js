// Las orquestaciones de una conexión: leerlas, crearlas, guardarlas, duplicarlas, borrarlas e
// importarlas. Hace lo que hacía `useOrchStorage.js` de v8, con UNA diferencia de fondo:
//
// v8 las guardaba en el `localStorage` del navegador, así que vivían en un solo equipo. Aquí viven
// en la base, por cliente y por conexión, y las ejecuta el motor del servidor; es la decisión de
// arquitectura de esta plataforma. Por eso cada operación es una llamada a `/api/orchestrations`.
//
// Lo que se conserva de v8 es lo que se ve:
//
//   - Cada cambio se guarda SOLO, sin botón de «Guardar». Se agrupan los cambios seguidos (escribir
//     un nombre letra a letra) en una sola llamada, un momento después del último.
//   - La lista va en el orden de creación, no alfabético.
//   - En la pantalla las orquestaciones son listas de pasos (`steps`), como en v8; la traducción al
//     grafo que se guarda está en `lib/ibp-orchestration.js`.

import { useCallback, useEffect, useRef, useState } from 'react'

import { graphToSteps, planImport, stepsToGraph } from '../../../lib/ibp-orchestration.js'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  listOrchestrations,
  saveOrchestration,
} from '../../../lib/orchestrations.js'

/** Cuánto se espera tras el último cambio antes de guardar. */
const ESPERA_DE_GUARDADO_MS = 700

/** Una orquestación como la usa la pantalla de v8. `isList` dice si el grafo guardado era una lista. */
function desdeServidor(orquestacion) {
  const { steps, isList } = graphToSteps(orquestacion.nodes ?? [], orquestacion.edges ?? [])
  return {
    id: orquestacion.id,
    name: orquestacion.name,
    createdAt: orquestacion.createdAt,
    steps,
    isList,
  }
}

/** El orden de v8: el de creación. */
const enOrdenDeCreacion = (lista) => [...lista].sort((a, b) => (
  String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.name).localeCompare(String(b.name))
))

export function useOrchStorage(connectionId) {
  const destino = { connectionId, production: false }
  // `null` mientras se lee la lista la primera vez.
  const [orchs, setOrchs] = useState(null)
  const [error, setError] = useState('')

  // Los cambios que todavía no se mandaron, por orquestación: el temporizador y la última versión.
  const pendientes = useRef(new Map())

  useEffect(() => {
    let abandonado = false
    listOrchestrations({ connectionId, production: false })
      .then((lista) => { if (!abandonado) setOrchs(enOrdenDeCreacion(lista.map(desdeServidor))) })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setOrchs([])
      })
    return () => { abandonado = true }
  }, [connectionId])

  /** Manda al servidor la última versión pendiente de una orquestación. */
  const guardar = useCallback(async (id) => {
    const pendiente = pendientes.current.get(id)
    if (!pendiente) return
    clearTimeout(pendiente.timer)
    pendientes.current.delete(id)

    const { name, steps } = pendiente.orch
    // Un nombre en blanco no se manda: el servidor lo rechaza, y v8 dejaba borrar el nombre para
    // escribir otro. Se guarda el resto y el nombre en cuanto vuelva a tener algo.
    const cambios = { ...stepsToGraph(steps), ...(String(name ?? '').trim() ? { name } : {}) }
    try {
      await saveOrchestration(id, cambios)
      setError('')
      // Lo que se acaba de guardar ya es una lista, aunque viniera dibujado en el lienzo.
      setOrchs((lista) => lista?.map((una) => (una.id === id ? { ...una, isList: true } : una)) ?? lista)
    } catch (fallo) {
      setError(fallo.message)
    }
  }, [])

  // Al salir de la pantalla no se pierde lo último que se escribió.
  useEffect(() => {
    const mapa = pendientes.current
    return () => { for (const id of [...mapa.keys()]) guardar(id) }
  }, [guardar])

  /** Cambia una orquestación en pantalla y programa el guardado. */
  const update = useCallback((orch) => {
    setOrchs((lista) => lista?.map((una) => (una.id === orch.id ? { ...una, ...orch } : una)) ?? lista)
    const anterior = pendientes.current.get(orch.id)
    if (anterior) clearTimeout(anterior.timer)
    const timer = setTimeout(() => { guardar(orch.id) }, ESPERA_DE_GUARDADO_MS)
    pendientes.current.set(orch.id, { timer, orch: { ...(anterior?.orch ?? {}), ...orch } })
  }, [guardar])

  /** Guarda ya lo pendiente: de una orquestación, o de todas. Antes de ejecutar, duplicar o exportar. */
  const flush = useCallback(async (id) => {
    const ids = id ? [id] : [...pendientes.current.keys()]
    await Promise.all(ids.map((uno) => guardar(uno)))
  }, [guardar])

  /** Guarda una orquestación como lista ya mismo, aunque no tenga cambios. Ver `isList`. */
  const saveAsList = useCallback(async (orch) => {
    pendientes.current.set(orch.id, { timer: null, orch })
    await guardar(orch.id)
  }, [guardar])

  const create = useCallback(async (name) => {
    const nueva = desdeServidor(await createOrchestration(destino, name.trim()))
    setOrchs((lista) => [...(lista ?? []), nueva])
    return nueva
  }, [connectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const duplicate = useCallback(async (id) => {
    await flush(id)
    const copia = desdeServidor(await duplicateOrchestration(id))
    setOrchs((lista) => [...(lista ?? []), copia])
    return copia
  }, [flush])

  const remove = useCallback(async (id) => {
    const pendiente = pendientes.current.get(id)
    if (pendiente) clearTimeout(pendiente.timer)
    pendientes.current.delete(id)
    await deleteOrchestration(id)
    setOrchs((lista) => (lista ?? []).filter((una) => una.id !== id))
  }, [])

  /**
   * Importa lo que se leyó de un archivo. Devuelve los recuentos de v8: nuevas, reemplazadas y
   * omitidas. Al terminar se vuelve a leer la lista, que es lo que de verdad quedó guardado.
   */
  const importOrchs = useCallback(async (leidas, reemplazar) => {
    await flush()
    const { crear, reemplazos, reemplazadas, omitidas } = planImport(leidas, orchs ?? [], reemplazar)

    for (const una of crear) await createOrchestration(destino, una.name, stepsToGraph(una.steps))
    for (const una of reemplazos) await saveOrchestration(una.id, { name: una.name, ...stepsToGraph(una.steps) })

    setOrchs(enOrdenDeCreacion((await listOrchestrations(destino)).map(desdeServidor)))
    return { added: crear.length, replaced: reemplazadas, skipped: omitidas }
  }, [connectionId, flush, orchs]) // eslint-disable-line react-hooks/exhaustive-deps

  return { orchs, error, setError, update, flush, saveAsList, create, duplicate, remove, importOrchs }
}
