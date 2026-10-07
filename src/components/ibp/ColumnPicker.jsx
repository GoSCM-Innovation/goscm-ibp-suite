// Qué columnas se ven, con preselecciones. Portado de `DataViewer/ColumnPicker.jsx` de v8.
//
// Un botón «▦ Columnas n/total» que abre una VENTANA (pedido el 2026-10-06; en v8 era un desplegable
// de 320 px, que con decenas de columnas se queda corto) con tres preselecciones fijas —«Solo
// claves», «Claves + descripciones» y «Todas»—, las que cada persona guardó con un nombre, un
// buscador que mira el nombre técnico y la descripción, y un interruptor por columna. Lo marcado no
// se aplica hasta pulsar «Aplicar»; «Cancelar» lo descarta.
//
// Las preselecciones propias se guardan por CONEXIÓN en este navegador, como en v8: son una
// preferencia de trabajo de quien mira, no un dato del cliente. Al aplicarlas se quedan solo las
// columnas que existen en la tabla abierta.

import { useState } from 'react'
import VentanaDeSeleccion from '../ui/VentanaDeSeleccion.jsx'

const PRESET_KEY = connId => `ibp:viewer:presets:master:${connId}`

function loadPresets(connId) {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY(connId))) || {} } catch { return {} }
}
function savePresets(connId, obj) {
  try { localStorage.setItem(PRESET_KEY(connId), JSON.stringify(obj)) } catch { /* sin espacio */ }
}

const btn = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, fontWeight: 600, padding: '7px 12px',
  cursor: 'pointer',
}
const chip = {
  background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 5,
  color: 'var(--text2)', fontSize: 11, fontWeight: 600, padding: '4px 9px', cursor: 'pointer',
}
const linkBtn = {
  background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11,
  fontWeight: 600, padding: 0, cursor: 'pointer',
}

const isDesc = c => /DESCR/i.test(c)

export default function ColumnPicker({ allColumns, keyNames = [], selected, onChange, connId, labels = {} }) {
  const [open, setOpen]       = useState(false)
  const [presets, setPresets] = useState(() => loadPresets(connId))

  const hasDesc = allColumns.some(isDesc)
  const keySet  = new Set(keyNames)
  const customNames = Object.keys(presets)

  const saveCurrent = temporal => {
    const name = window.prompt('Nombre de la preselección de columnas:')
    if (!name || !name.trim()) return
    const next = { ...presets, [name.trim()]: [...temporal] }
    setPresets(next); savePresets(connId, next)
  }
  const deleteCustom = name => {
    const next = { ...presets }; delete next[name]
    setPresets(next); savePresets(connId, next)
  }

  // Las preselecciones se aplican sobre la selección TEMPORAL de la ventana, no sobre la real, y
  // conservan el orden de la tabla.
  const cabecera = ({ temporal, setTemporal }) => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <button type="button" style={chip} onClick={() => setTemporal(allColumns.filter(c => keySet.has(c)))}>Solo claves</button>
        {hasDesc && (
          <button type="button" style={chip} onClick={() => setTemporal(allColumns.filter(c => keySet.has(c) || isDesc(c)))}>
            Claves + descripciones
          </button>
        )}
        <button type="button" style={chip} onClick={() => setTemporal([...allColumns])}>Todas</button>
        <span style={{ flex: 1 }} />
        <button type="button" style={linkBtn} onClick={() => saveCurrent(temporal)}>Guardar selección…</button>
      </div>

      {customNames.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
            Mis preselecciones
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {customNames.map(name => (
              <span key={name} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button
                  type="button"
                  style={{ ...chip, borderRadius: '5px 0 0 5px' }}
                  onClick={() => setTemporal(allColumns.filter(c => (presets[name] || []).includes(c)))}
                >{name}</button>
                <button
                  type="button"
                  title="Eliminar preselección"
                  onClick={() => deleteCustom(name)}
                  style={{ ...chip, borderLeft: 'none', borderRadius: '0 5px 5px 0', color: 'var(--red)', padding: '4px 7px' }}
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btn} className="vs-boton">
        ▦ Columnas
        <span className="vs-boton-cuenta">{selected.length}/{allColumns.length}</span>
      </button>
      {open && (
        <VentanaDeSeleccion
          titulo="Columnas de la tabla"
          opciones={allColumns}
          seleccion={selected}
          etiquetas={labels}
          claves={keyNames}
          cabecera={cabecera}
          sufijoDeConteo="columna(s) seleccionada(s)"
          onGuardar={sel => { onChange(sel); setOpen(false) }}
          onCerrar={() => setOpen(false)}
        />
      )}
    </>
  )
}
