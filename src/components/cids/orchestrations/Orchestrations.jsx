// Orquestaciones: la lista a la izquierda y el editor a la derecha.
//
// Portada de `Orchestrations.jsx` de v9. Sin nada abierto, el panel de la derecha dice qué hacer en
// vez de quedarse en blanco como si estuviera roto.

import { Suspense, lazy, useEffect, useState } from 'react'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  listOrchestrations,
  saveOrchestration,
} from '../../../lib/orchestrations.js'
import { downloadFile, fromFile, toFile } from '../../../lib/orchestration-file.js'
import Modal from '../../ui/Modal.jsx'
import OrchestrationList from './OrchestrationList.jsx'

// El lienzo se carga aparte: su librería de dibujo pesa tanto como la de gráficos, y quien solo
// viene a mirar la lista no tiene por qué descargarla.
const OrchestrationCanvas = lazy(() => import('./OrchestrationCanvas.jsx'))

export default function Orchestrations({ destino }) {
  const [orquestaciones, setOrquestaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [elegida, setElegida] = useState(null)
  const [aBorrar, setABorrar] = useState(null)
  const [recarga, setRecarga] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [errorAlGuardar, setErrorAlGuardar] = useState('')

  useEffect(() => {
    let abandonado = false
    listOrchestrations(destino)
      .then((lista) => {
        if (abandonado) return
        setOrquestaciones(lista)
        setError('')
        setCargando(false)
      })
      .catch((fallo) => {
        if (abandonado) return
        setError(fallo.message)
        setCargando(false)
      })
    return () => { abandonado = true }
  }, [destino, recarga])

  const recargar = () => setRecarga((numero) => numero + 1)

  // Las tres acciones comparten el mismo manejo: si algo falla, se dice y la lista no queda a medias.
  const hacer = (accion) => accion().then(recargar).catch((fallo) => setError(fallo.message))

  const crear = (nombre) => hacer(async () => {
    const nueva = await createOrchestration(destino, nombre)
    setElegida(nueva.id)
  })

  const duplicar = (id) => hacer(async () => {
    const copia = await duplicateOrchestration(id)
    setElegida(copia.id)
  })

  const borrar = () => {
    const id = aBorrar.id
    setABorrar(null)
    return hacer(async () => {
      await deleteOrchestration(id)
      // Si se borró la que estaba abierta, el panel de la derecha vuelve a vacío.
      setElegida((actual) => (actual === id ? null : actual))
    })
  }

  function exportar() {
    const fecha = new Date().toISOString().slice(0, 10)
    downloadFile(toFile(orquestaciones), `orquestaciones-${destino.name}-${fecha}.json`)
  }

  /**
   * Trae orquestaciones de un archivo. Cada una nace en ESTE destino, con nombre libre si choca.
   *
   * Se crean de a una y no todas juntas a propósito: si el servidor rechaza una —un ciclo, una
   * conexión rota— las demás entran igual, y el error dice cuál falló en vez de perderse el lote.
   */
  const importar = (archivo) => hacer(async () => {
    const leidas = fromFile(JSON.parse(await archivo.text()))
    const usados = new Set(orquestaciones.map((una) => una.name))
    const fallidas = []

    for (const una of leidas) {
      let nombre = una.name
      for (let numero = 2; usados.has(nombre); numero += 1) nombre = `${una.name} (${numero})`
      usados.add(nombre)
      try {
        await createOrchestration(destino, nombre)
          .then((creada) => saveOrchestration(creada.id, { nodes: una.nodes, edges: una.edges }))
      } catch (fallo) {
        fallidas.push(`${una.name}: ${fallo.message}`)
      }
    }

    if (fallidas.length > 0) throw new Error(`No se pudieron importar ${fallidas.length}. ${fallidas[0]}`)
  })

  const abierta = orquestaciones.find((una) => una.id === elegida) ?? null

  /**
   * Guarda el grafo. El error NO se muestra arriba con los de la lista: es del lienzo y hay que
   * leerlo ahí, porque dice qué pasos forman el ciclo o a qué nodo apunta una conexión rota.
   */
  async function guardar(grafo) {
    setGuardando(true)
    setErrorAlGuardar('')
    try {
      const guardada = await saveOrchestration(abierta.id, grafo)
      setOrquestaciones((previas) => previas.map((una) => (una.id === guardada.id ? guardada : una)))
    } catch (fallo) {
      setErrorAlGuardar(fallo.message)
      // Se relanza para que el lienzo no dé por guardados unos cambios que no entraron.
      throw fallo
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="orq">
      {error && <div className="notice notice-error orq-error">✕ {error}</div>}

      <div className="orq-cuerpo">
        <OrchestrationList
          destino={destino}
          orquestaciones={orquestaciones}
          elegida={elegida}
          cargando={cargando}
          onElegir={setElegida}
          onCrear={crear}
          onDuplicar={duplicar}
          onBorrar={setABorrar}
          onExportar={exportar}
          onImportar={importar}
        />

        <div className="orq-editor">
          {abierta ? (
            <Suspense fallback={<div className="page-hint" style={{ padding: 24 }}>Cargando el lienzo…</div>}>
              <OrchestrationCanvas
                key={abierta.id}
                destino={destino}
                orquestacion={abierta}
                onGuardar={guardar}
                guardando={guardando}
                error={errorAlGuardar}
              />
            </Suspense>
          ) : (
            <div className="orq-vacio">
              <div className="orq-vacio-titulo">Ninguna orquestación abierta</div>
              <p className="page-hint">Elegí una de la lista, o creá una nueva con el <b>+</b>.</p>
            </div>
          )}
        </div>
      </div>

      {aBorrar && (
        <Modal
          title="Borrar la orquestación"
          subtitle={aBorrar.name}
          onClose={() => setABorrar(null)}
          footer={(
            <>
              <div className="modal-foot-info" />
              <button type="button" className="btn btn-sm" onClick={() => setABorrar(null)}>No, dejarla</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={borrar}>Sí, borrarla</button>
            </>
          )}
        >
          <p>
            Se va a borrar <b>{aBorrar.name}</b> y no se puede deshacer.
          </p>
          <p className="page-hint" style={{ marginTop: 10 }}>
            Las tareas de CI-DS no se tocan: lo que se borra es el encadenado, no las tareas.
          </p>
        </Modal>
      )}
    </div>
  )
}
