// Orquestaciones: la lista a la izquierda y el editor a la derecha.
//
// Portada de `Orchestrations.jsx` de v9. Sin nada abierto, el panel de la derecha dice qué hacer en
// vez de quedarse en blanco como si estuviera roto. Crear pide el nombre con `prompt` y borrar
// confirma con `confirm`, como allí.
//
// Diferencias, a propósito:
//   - Cargando y errores no reemplazan la pantalla entera: salen dentro de la lista y en una franja
//     arriba, y el resto de la pantalla sigue usable.
//   - Importar no reemplaza nunca una orquestación que ya existe (ver `ImportOrchestrationsModal`).
//   - Duplicar numera la copia («(copia 2)») en vez de repetir el nombre.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  createOrchestration,
  deleteOrchestration,
  duplicateOrchestration,
  listOrchestrations,
  saveOrchestration,
} from '../../../lib/orchestrations.js'
import {
  clavesDeNombres,
  downloadFile,
  nombreDeArchivoExportado,
  nombreLibre,
  parseOrchImportText,
  resumirExportacion,
  resumirImportacion,
  toFile,
} from '../../../lib/orchestration-file.js'
import { useIsNarrow } from '../../../lib/useIsNarrow.js'
import ImportOrchestrationsModal from './ImportOrchestrationsModal.jsx'
import OrchestrationList from './OrchestrationList.jsx'
import './lista.css'

// El lienzo se carga aparte: su librería de dibujo pesa tanto como la de gráficos, y quien solo
// viene a mirar la lista no tiene por qué descargarla.
const OrchestrationCanvas = lazy(() => import('./OrchestrationCanvas.jsx'))

// En pantalla angosta se usa el editor en lista, que no carga la librería de dibujo: en el teléfono
// un lienzo con nodos que se arrastran es inservible, y bajar esa librería sería pagar por nada.
const MobileEditor = lazy(() => import('./MobileEditor.jsx'))
const TaskPalette = lazy(() => import('./TaskPalette.jsx'))

/** Lo que se pregunta antes de tirar lo que el editor tiene pendiente de guardar. */
const PREGUNTA_DESCARTAR = 'Hay cambios sin guardar. ¿Descartarlos?'

// `Paleta` es lo único que cambia entre CI-DS e IBP: de dónde salen los pasos que se pueden
// agregar. El resto de la pantalla —lista, lienzo, ejecución— es la misma para los dos.
//
// `transportadas` son los nombres de tarea que ya están en el productivo (`CidsTools` los pide una
// vez por destino); llegan hasta la paleta para marcar cada tarea con «PRD».
export default function Orchestrations({ destino, Paleta = TaskPalette, leerRegistro, transportadas = null }) {
  const [orquestaciones, setOrquestaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [elegida, setElegida] = useState(null)
  // Lo que trae un archivo, ya leído, esperando que se decida qué entra.
  const [porImportar, setPorImportar] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [errorAlGuardar, setErrorAlGuardar] = useState('')
  // El editor avisa cuando tiene cambios que todavía no se guardaron.
  const [sinGuardar, setSinGuardar] = useState(false)
  // El aviso de exportar e importar: `{ tipo: 'ok' | 'error', texto }`.
  const [aviso, setAviso] = useState(null)
  const temporizador = useRef(null)
  const angosta = useIsNarrow()

  // Al pasar de lienzo a lista (o al revés) el editor se monta de nuevo y lo pendiente se pierde,
  // así que la marca no puede quedar encendida. Se ajusta al renderizar, que es el sitio para esto.
  const [angostaAntes, setAngostaAntes] = useState(angosta)
  if (angosta !== angostaAntes) {
    setAngostaAntes(angosta)
    setSinGuardar(false)
  }

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
  }, [destino])

  useEffect(() => {
    const pendiente = temporizador
    return () => clearTimeout(pendiente.current)
  }, [])

  /** Muestra un aviso. Con `ms` se quita solo; sin él se queda hasta que se cierre. */
  function avisar(tipo, texto, ms = 0) {
    clearTimeout(temporizador.current)
    setAviso({ tipo, texto })
    if (ms > 0) temporizador.current = setTimeout(() => setAviso(null), ms)
  }

  const abierta = orquestaciones.find((una) => una.id === elegida) ?? null

  /** Antes de dejar la orquestación abierta, o de tirarla: ¿se descartan los cambios pendientes? */
  const confirmarDescarte = () => !sinGuardar || window.confirm(PREGUNTA_DESCARTAR)

  function elegir(id) {
    if (id === elegida) return
    if (!confirmarDescarte()) return
    setSinGuardar(false)
    setElegida(id)
  }

  /** Suma una orquestación recién creada a la lista y la deja abierta, como v9. */
  function agregarYAbrir(nueva) {
    setOrquestaciones((previas) => [...previas, nueva])
    setSinGuardar(false)
    setElegida(nueva.id)
  }

  async function crear() {
    if (!confirmarDescarte()) return
    const nombre = window.prompt('Nombre de la nueva orquestación:')?.trim()
    if (!nombre) return
    try {
      agregarYAbrir(await createOrchestration(destino, nombre))
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function duplicar(id) {
    if (!confirmarDescarte()) return
    try {
      agregarYAbrir(await duplicateOrchestration(id))
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  async function borrar(orquestacion) {
    if (!window.confirm('¿Eliminar esta orquestación?')) return
    const esLaAbierta = orquestacion.id === elegida
    // Borrar la que está abierta tira también lo que tenga sin guardar.
    if (esLaAbierta && !confirmarDescarte()) return
    try {
      await deleteOrchestration(orquestacion.id)
      setOrquestaciones((previas) => previas.filter((una) => una.id !== orquestacion.id))
      if (esLaAbierta) {
        setElegida(null)
        setSinGuardar(false)
      }
    } catch (fallo) {
      setError(fallo.message)
    }
  }

  function exportar() {
    if (orquestaciones.length === 0) return
    try {
      const fecha = new Date().toISOString().slice(0, 10)
      downloadFile(toFile(orquestaciones), nombreDeArchivoExportado(destino.name, fecha))
      avisar('ok', resumirExportacion(orquestaciones.length), 3500)
    } catch (fallo) {
      avisar('error', `No se pudo exportar: ${fallo.message}`)
    }
  }

  /**
   * Lee un archivo y enseña lo que trae, antes de crear nada. Un archivo de veinte orquestaciones
   * entrando de golpe no deja ver cuántas venían ni que doce ya estaban, hasta que la lista aparece
   * con doce «(2)» detrás.
   */
  async function elegirArchivo(archivo) {
    setAviso(null)
    try {
      const leido = parseOrchImportText(await archivo.text())
      setPorImportar({ archivo: archivo.name, leido })
    } catch (fallo) {
      avisar('error', fallo.message)
    }
  }

  const cancelarImportacion = useCallback(() => setPorImportar(null), [])

  /**
   * Crea de verdad lo revisado en el diálogo. Cada una nace en ESTE destino, con un número detrás si
   * su nombre ya está: nunca se pisa lo que hay, porque una orquestación se configura una vez.
   *
   * Se crean de a una a propósito: si el servidor rechaza una —un ciclo, una conexión rota— las
   * demás entran igual, y el aviso dice cuántas fallaron en vez de perderse el lote.
   */
  async function confirmarImportacion(cuales, omitidas) {
    setPorImportar(null)
    setError('')
    const usados = clavesDeNombres(orquestaciones)
    const fallidas = []
    let agregadas = 0

    for (const una of cuales) {
      try {
        await createOrchestration(destino, nombreLibre(una.name, usados), { nodes: una.nodes, edges: una.edges })
        agregadas += 1
      } catch (fallo) {
        fallidas.push(`${una.name}: ${fallo.message}`)
      }
    }

    // La lista se vuelve a pedir aquí y no con un efecto: un efecto borraría el error de abajo en
    // cuanto llegara la respuesta, y el motivo de lo que falló se leería un instante.
    let fallaLaLista = ''
    try {
      setOrquestaciones(await listOrchestrations(destino))
    } catch (fallo) {
      fallaLaLista = fallo.message
    }

    avisar(
      fallidas.length > 0 ? 'error' : 'ok',
      resumirImportacion({ agregadas, omitidas, fallidas: fallidas.length }),
      5000,
    )
    // El aviso dice cuántas; este dice cuál y por qué, que es lo que hace falta para arreglarlo.
    if (fallidas.length > 0) setError(`No se pudieron importar ${fallidas.length}. ${fallidas[0]}`)
    else if (fallaLaLista) setError(fallaLaLista)
  }

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

  /**
   * Cambia el nombre de la abierta. Si el servidor lo rechaza, lanza: quien lo pidió (el lienzo o el
   * teléfono) sabe dónde enseñar el motivo. Solo se toma el nombre de la respuesta; el dibujo que
   * esté en pantalla es del editor y no se pisa.
   */
  async function renombrar(nombre) {
    const id = abierta.id
    const guardada = await saveOrchestration(id, { name: nombre })
    setOrquestaciones((previas) => previas.map((una) => (una.id === id ? { ...una, name: guardada.name } : una)))
  }

  const editorAbierto = abierta && (
    <Suspense fallback={<div className="page-hint" style={{ padding: 24 }}>Cargando el editor…</div>}>
      {angosta ? (
        <MobileEditor
          key={abierta.id}
          destino={destino}
          orquestacion={abierta}
          onGuardar={guardar}
          guardando={guardando}
          error={errorAlGuardar}
          Paleta={Paleta}
          transportadas={transportadas}
          onRenombrar={renombrar}
          onSinGuardar={setSinGuardar}
          leerRegistro={leerRegistro}
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
          transportadas={transportadas}
          onRenombrar={renombrar}
          onSinGuardar={setSinGuardar}
          leerRegistro={leerRegistro}
        />
      )}
    </Suspense>
  )

  return (
    <div className="orq">
      {error && <div className="notice notice-error orq-error">✕ {error}</div>}

      <div className="orq-cuerpo">
        {/* En el teléfono se ve la lista O el editor, no los dos: cada uno necesita todo el ancho. */}
        {!(angosta && abierta) && (
          <OrchestrationList
            destino={destino}
            orquestaciones={orquestaciones}
            elegida={elegida}
            cargando={cargando}
            angosta={angosta}
            onElegir={elegir}
            onCrear={crear}
            onDuplicar={duplicar}
            onBorrar={borrar}
            onExportar={exportar}
            onImportar={elegirArchivo}
          />
        )}

        {angosta && abierta ? (
          <div className="orq-editor orq-editor-movil">
            <div className="orq-volver-barra">
              <button type="button" className="orq-volver" onClick={() => elegir(null)}>← Orquestaciones</button>
            </div>
            {editorAbierto}
          </div>
        ) : !angosta && (
          <div className="orq-editor">
            {abierta ? editorAbierto : (
              <div className="orq-sin-seleccion">
                <div>
                  <div className="orq-sin-seleccion-icono">⚙</div>
                  Selecciona una orquestación o crea una nueva
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {porImportar && (
        <ImportOrchestrationsModal
          parsed={porImportar.leido}
          existing={orquestaciones}
          fileName={porImportar.archivo}
          destino={destino}
          onConfirm={confirmarImportacion}
          onCancel={cancelarImportacion}
        />
      )}

      {aviso && (
        <div className={`orq-aviso ${aviso.tipo}`} role="status">
          <span>{aviso.tipo === 'ok' ? '✓' : '✕'} {aviso.texto}</span>
          <button type="button" className="orq-aviso-cerrar" onClick={() => setAviso(null)} aria-label="Cerrar el aviso">×</button>
        </div>
      )}
    </div>
  )
}
