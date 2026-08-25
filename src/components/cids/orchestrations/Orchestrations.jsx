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
import {
  clasificarImportacion, downloadFile, fromFile, toFile,
} from '../../../lib/orchestration-file.js'
import { useIsNarrow } from '../../../lib/useIsNarrow.js'
import Modal from '../../ui/Modal.jsx'
import OrchestrationList from './OrchestrationList.jsx'

// El lienzo se carga aparte: su librería de dibujo pesa tanto como la de gráficos, y quien solo
// viene a mirar la lista no tiene por qué descargarla.
const OrchestrationCanvas = lazy(() => import('./OrchestrationCanvas.jsx'))

// En pantalla angosta se usa el editor en lista, que no carga la librería de dibujo: en el teléfono
// un lienzo con nodos que se arrastran es inservible, y bajar esa librería sería pagar por nada.
const MobileEditor = lazy(() => import('./MobileEditor.jsx'))
const TaskPalette = lazy(() => import('./TaskPalette.jsx'))

// `Paleta` es lo único que cambia entre CI-DS e IBP: de dónde salen los pasos que se pueden
// agregar. El resto de la pantalla —lista, lienzo, ejecución— es la misma para los dos.
export default function Orchestrations({ destino, Paleta = TaskPalette, leerRegistro }) {
  const [orquestaciones, setOrquestaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [elegida, setElegida] = useState(null)
  const [aBorrar, setABorrar] = useState(null)
  // Lo que trae un archivo, ya repartido, esperando que se decida qué entra.
  const [porImportar, setPorImportar] = useState(null)
  const [traerRepetidas, setTraerRepetidas] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [errorAlGuardar, setErrorAlGuardar] = useState('')
  const [eligiendoTarea, setEligiendoTarea] = useState(false)
  const angosta = useIsNarrow()

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
    // Se enseña antes de crear nada. Un archivo de veinte orquestaciones entrando de golpe no deja
    // ver cuantas venian ni que doce ya estaban, hasta que la lista aparece con doce «(2)» detras.
    setPorImportar({ archivo: archivo.name, ...clasificarImportacion(leidas, orquestaciones) })
  })

  /** Crea de verdad lo revisado. `cuales` es lo que se decidio traer. */
  const confirmarImportacion = (cuales) => hacer(async () => {
    setPorImportar(null)
    const usados = new Set(orquestaciones.map((una) => una.name))
    const fallidas = []

    for (const una of cuales) {
      // Un nombre repetido se trae con un sufijo y NO se pisa lo que hay: una orquestacion se
      // configura una vez y sobrescribirla por un nombre igual es una perdida que no se deshace.
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

  const cuantasEntran = porImportar
    ? porImportar.nuevas.length + (traerRepetidas ? porImportar.repetidas.length : 0)
    : 0

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

  /** Agrega un paso al final de la cadena. Solo lo usa el editor del teléfono. */
  const agregarPasoAlFinal = (tarea) => hacer(async () => {
    setEligiendoTarea(false)
    const nodos = abierta.nodes ?? []
    const aristas = abierta.edges ?? []
    const id = `n-${Date.now()}`
    // El último de la cadena es el que no tiene a nadie detrás.
    const ultimo = nodos.find((nodo) => !aristas.some((arista) => arista.source === nodo.id))

    const nuevos = [...nodos, {
      id,
      type: 'task',
      position: { x: 80, y: 60 + nodos.length * 120 },
      data: {
        taskName: tarea.taskName,
        taskGuid: tarea.taskGuid ?? null,
        label: tarea.taskName,
        globalVariables: [],
        errorStrategy: 'stop',
        maxRetries: 0,
        retryDelaySeconds: 30,
      },
    }]
    const nuevas = ultimo
      ? [...aristas, { id: `e-${ultimo.id}-${id}`, source: ultimo.id, target: id }]
      : aristas

    const guardada = await saveOrchestration(abierta.id, { nodes: nuevos, edges: nuevas })
    setOrquestaciones((previas) => previas.map((una) => (una.id === guardada.id ? guardada : una)))
  })

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
            <Suspense fallback={<div className="page-hint" style={{ padding: 24 }}>Cargando el editor…</div>}>
              {angosta ? (
                <MobileEditor
                  key={abierta.id}
                  orquestacion={abierta}
                  onGuardar={guardar}
                  guardando={guardando}
                  error={errorAlGuardar}
                  onAgregarPaso={() => setEligiendoTarea(true)}
                />
              ) : (
                <OrchestrationCanvas
                  key={abierta.id}
                  destino={destino}
                  orquestacion={abierta}
                  onGuardar={guardar}
                  guardando={guardando}
                  error={errorAlGuardar}
                  Paleta={Paleta}
                  leerRegistro={leerRegistro}
                />
              )}
            </Suspense>
          ) : (
            <div className="orq-vacio">
              <div className="orq-vacio-titulo">Ninguna orquestación abierta</div>
              <p className="page-hint">Elige una de la lista, o crea una nueva con el <b>+</b>.</p>
            </div>
          )}
        </div>
      </div>

      {eligiendoTarea && (
        <Modal title="Agregar un paso" onClose={() => setEligiendoTarea(false)}>
          <Suspense fallback={<div className="page-hint">Cargando tareas…</div>}>
            <div className="movil-paleta">
              <Paleta destino={destino} onAgregar={agregarPasoAlFinal} />
            </div>
          </Suspense>
        </Modal>
      )}

      {porImportar && (
        <Modal
          wide
          title="Traer orquestaciones de un archivo"
          subtitle={porImportar.archivo}
          onClose={() => setPorImportar(null)}
          footer={(
            <>
              <div className="modal-foot-info" />
              <button type="button" className="btn btn-sm" onClick={() => setPorImportar(null)}>Cancelar</button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => confirmarImportacion(
                  traerRepetidas
                    ? [...porImportar.nuevas, ...porImportar.repetidas]
                    : porImportar.nuevas,
                )}
                disabled={cuantasEntran === 0}
              >
                {cuantasEntran === 0
                  ? 'No hay nada que traer'
                  : `Traer ${cuantasEntran}`}
              </button>
            </>
          )}
        >
          <p>
            El archivo trae <b>{porImportar.nuevas.length + porImportar.repetidas.length}</b>{' '}
            {porImportar.nuevas.length + porImportar.repetidas.length === 1 ? 'orquestación' : 'orquestaciones'}.
            {porImportar.repetidas.length > 0 && (
              <>
                {' '}<b>{porImportar.repetidas.length}</b> ya {porImportar.repetidas.length === 1 ? 'existe' : 'existen'} aquí con
                ese nombre.
              </>
            )}
          </p>

          {porImportar.repetidas.length > 0 && (
            <label className="exp-enriq">
              <input
                type="checkbox"
                checked={traerRepetidas}
                onChange={(evento) => setTraerRepetidas(evento.target.checked)}
              />
              <span>
                Traer también las repetidas, con un número detrás del nombre. Lo que ya está{' '}
                <b>no se pisa</b> nunca: una orquestación se configura una vez.
              </span>
            </label>
          )}

          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr><th>Orquestación</th><th>Pasos</th><th>Uniones</th><th>Entra</th></tr>
              </thead>
              <tbody>
                {[...porImportar.nuevas.map((una) => ({ ...una, repetida: false })),
                  ...porImportar.repetidas.map((una) => ({ ...una, repetida: true }))]
                  .map((una, indice) => (
                    <tr key={`${una.name}-${indice}`}>
                      <td>{una.name}</td>
                      <td>{una.pasos}</td>
                      <td>{una.uniones}</td>
                      <td className="exp-sub">
                        {una.repetida
                          ? (traerRepetidas ? 'sí, renombrada' : 'no: ya existe')
                          : 'sí'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* El archivo no lleva de qué repositorio salió, a propósito: así no puede apuntar en
              silencio al equivocado. Por eso el aviso es de dónde van a caer, no de dónde vienen. */}
          <p className="page-hint">
            Van a nacer en el repositorio donde estás parado
            {destino?.production ? ' — el PRODUCTIVO' : ''}, con identificadores nuevos.
          </p>
        </Modal>
      )}

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
