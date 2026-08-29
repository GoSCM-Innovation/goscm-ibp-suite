// Production Visualizer — el árbol de materiales, con la forma que tenía en v7.
//
// Portado del `tab-bom` de `index.html` de v7 y de `bom.js`. Tiene tres partes, y el orden es el suyo:
//
//   ① Mapeo de entidades, que termina con «Descargar datos y construir jerarquía». En v7 la descarga
//     NO era una pantalla aparte: era el botón con que se cerraba el mapeo. Se baja solo el grupo del
//     árbol, que es lo que esta aplicación usa.
//   ② La barra de pestañas de producto: se pueden tener varios árboles abiertos a la vez, cada uno con
//     su buscador y su estado. Es lo que hace que comparar dos productos no sea ir y volver.
//   ③ La exportación por lotes: se pega una lista de materiales y sale UN Excel con todas sus
//     jerarquías y un índice delante.
//
// Las pestañas se quedan MONTADAS aunque no se vean, escondidas con CSS. Es a propósito y es lo que
// hacía v7: cada árbol tiene su índice cargado y sus ramas abiertas, y desmontarla al cambiar de
// pestaña obligaría a volver a leerlo todo de la base local al volver.

import { useRef, useState } from 'react'

import BomTree from './BomTree.jsx'
import Modal from '../ui/Modal.jsx'
import PanelMapeo from './PanelMapeo.jsx'
import ExplorerExtract from './ExplorerExtract.jsx'
import BotonPantallaCompleta from '../ui/BotonPantallaCompleta.jsx'
import { usePantallaCompleta } from '../../lib/usePantallaCompleta.js'
import {
  aplanarArbol, armarLibroDeLote, descargarLibro, leerLista,
} from '../../lib/bom-export.js'
import { cargarSubarbol } from '../../lib/bom-load.js'
import { abrirTodo, raicesPorPlanta } from '../../../core/ibp/bom-tree.js'

/** El tope de pestañas de v7. Con más, la barra deja de ser navegable. */
const MAX_PESTANAS = 15

export default function ProductionVisualizer({ destino }) {
  const [mapeoAbierto, setMapeoAbierto] = useState(true)
  const [descargaAbierta, setDescargaAbierta] = useState(false)

  const [pestanas, setPestanas] = useState([{ id: 1 }])
  const [activa, setActiva] = useState(1)
  const siguiente = useRef(2)

  const [lote, setLote] = useState(false)
  const lienzo = useRef(null)
  const pantalla = usePantallaCompleta(lienzo)

  function agregar() {
    if (pestanas.length >= MAX_PESTANAS) return
    const id = siguiente.current
    siguiente.current += 1
    setPestanas((previas) => [...previas, { id }])
    setActiva(id)
  }

  function cerrar(id) {
    setPestanas((previas) => {
      const quedan = previas.filter((una) => una.id !== id)
      if (quedan.length === 0) return previas
      if (activa === id) setActiva(quedan[Math.min(previas.findIndex((una) => una.id === id), quedan.length - 1)].id)
      return quedan
    })
  }

  return (
    <>
      {/* ── ① Mapeo de entidades, con la descarga dentro ─────────────────────────────────────── */}
      <PanelMapeo
        grupo="arbol"
        destino={destino}
        abierto={mapeoAbierto}
        onAlternar={() => setMapeoAbierto((previo) => !previo)}
        textoConfirmar="Descargar datos y construir jerarquía"
        onConfirmar={() => { setDescargaAbierta(true); setMapeoAbierto(false) }}
      />

      {/* La descarga arranca sola si no hay nada bajado, que es lo que hacía el botón de v7. Con datos
          ya guardados enseña el plan y espera: rebajar tres millones de filas sin pedirlo no. */}
      {descargaAbierta && (
        <div className="panel">
          <div className="panel-title">Descarga del árbol de materiales</div>
          <ExplorerExtract destino={destino} gruposFijos={['arbol']} arrancarSiVacio />
        </div>
      )}

      {/* ── ② Las pestañas de producto ───────────────────────────────────────────────────────── */}
      <div ref={lienzo} className="a-pantalla-completa">
        <div className="bom-tabs-bar">
          <div className="bom-tabs-scroll">
            {pestanas.map((una, indice) => (
              <span key={una.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`bom-tab-btn${activa === una.id ? ' active' : ''}`}
                  onClick={() => setActiva(una.id)}
                >
                  Árbol {indice + 1}
                </button>
                {pestanas.length > 1 && (
                  <button
                    type="button"
                    className="bom-tab-close"
                    onClick={() => cerrar(una.id)}
                    aria-label={`Cerrar árbol ${indice + 1}`}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {pestanas.length < MAX_PESTANAS && (
              <button type="button" className="bom-tab-btn" onClick={agregar} aria-label="Abrir otro árbol">
                +
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setLote(true)}
            title="Exportar la jerarquía de una lista de materiales a un solo Excel"
          >
            📋 Exportar lista
          </button>
          <BotonPantallaCompleta {...pantalla} que="el árbol" />
        </div>

        {/* Todas montadas, solo una a la vista: cada árbol guarda su índice y sus ramas abiertas. */}
        {pestanas.map((una) => (
          <div key={una.id} style={{ display: activa === una.id ? 'block' : 'none' }}>
            <BomTree sinPantallaCompleta />
          </div>
        ))}
      </div>

      {lote && <DialogoDeLote onClose={() => setLote(false)} />}
    </>
  )
}

/**
 * ③ Exportar una lista de materiales a un solo Excel.
 *
 * Portado de `bomBatchDialog` y `bomBatchRun` de v7. Cada material se carga, se construye entero y se
 * aplana; el índice dice qué pasó con cada uno —listo, sin jerarquía, o el error— porque una lista de
 * treinta en la que fallaron dos y no se dice cuáles no sirve para nada.
 */
function DialogoDeLote({ onClose }) {
  const [texto, setTexto] = useState('')
  const [corriendo, setCorriendo] = useState(false)
  const [avance, setAvance] = useState(null)
  const [error, setError] = useState('')

  const codigos = leerLista(texto)

  async function correr() {
    if (codigos.length === 0) return
    setCorriendo(true)
    setError('')

    const resultados = []
    const filas = []

    try {
      for (const [indice, prdid] of codigos.entries()) {
        setAvance({ hechos: indice, total: codigos.length, prdid })
        // Ceder al navegador para que repinte el avance antes del trabajo pesado.
        await new Promise((listo) => { setTimeout(listo, 0) })

        try {
          const { indices } = await cargarSubarbol(prdid)
          const armado = raicesPorPlanta(indices, { soloDe: prdid })
          const raices = armado.plantas.flatMap((planta) => armado.porPlanta[planta] ?? [])

          if (raices.length === 0) {
            resultados.push({ prdid, estado: 'Sin jerarquía propia', filas: 0, plantas: [] })
            continue
          }

          abrirTodo(raices, indices)
          const suyas = aplanarArbol(raices)
          filas.push(...suyas)
          resultados.push({
            prdid, estado: 'Listo', filas: suyas.length, plantas: armado.plantas,
          })
        } catch (fallo) {
          resultados.push({ prdid, estado: `Error · ${fallo.message}`, filas: 0, plantas: [] })
        }
      }

      setAvance({ hechos: codigos.length, total: codigos.length, prdid: '' })
      const libro = await armarLibroDeLote(resultados, filas)
      descargarLibro(libro, `Jerarquias_${new Date().toISOString().slice(0, 10)}.xlsx`)
      onClose()
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setCorriendo(false)
      setAvance(null)
    }
  }

  return (
    <Modal
      title="Exportar lista de materiales"
      onClose={onClose}
      footer={(
        <>
          <span className="modal-foot-info">
            {codigos.length === 0
              ? 'Pega los códigos, uno por línea'
              : `${codigos.length} ${codigos.length === 1 ? 'material' : 'materiales'}`}
          </span>
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={corriendo}>Cerrar</button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={correr}
            disabled={corriendo || codigos.length === 0}
          >
            {corriendo ? 'Generando…' : '⬇ Generar Excel'}
          </button>
        </>
      )}
    >
      <p className="panel-desc">
        Pega los códigos de material —uno por línea, o separados por coma o espacio—. Sale un único
        Excel con una hoja combinada y un índice que dice qué salió de cada uno.
      </p>

      <textarea
        className="input code"
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        placeholder={'30000574\n30001693\n30001670'}
        style={{ width: '100%', height: 180, resize: 'vertical' }}
        aria-label="Códigos de material"
      />

      {error && <div className="notice notice-error">✕ {error}</div>}

      {avance && (
        <>
          <div className="page-hint" style={{ marginTop: 10 }}>
            {avance.prdid
              ? `${avance.hechos + 1} de ${avance.total} · ${avance.prdid}`
              : 'Armando el Excel…'}
          </div>
          <div className="progress-bar">
            <div className="fill" style={{ width: `${Math.round((avance.hechos / avance.total) * 100)}%` }} />
          </div>
        </>
      )}
    </Modal>
  )
}
