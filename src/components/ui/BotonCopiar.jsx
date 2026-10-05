// El botón «⧉ Copiar» de v9 (`ex-copy-btn`), con su parpadeo.
//
// Al copiar, el icono pasa a ✓ (verde) si salió o a ✕ (naranja) si no, durante un segundo y medio, y
// vuelve a ⧉: es el aviso de que algo pasó sin tapar la pantalla con un diálogo.
//
// `onCopiar` devuelve si se pudo copiar (o lanza). El aviso de texto —el «toast»— lo da quien lo usa.

import { useEffect, useRef, useState } from 'react'

const DURACION = 1500

export default function BotonCopiar({ onCopiar, titulo = 'Copiar', className = '' }) {
  const [estado, setEstado] = useState('')
  const reloj = useRef(null)

  useEffect(() => () => clearTimeout(reloj.current), [])

  async function pulsar() {
    let salio = false
    try { salio = Boolean(await onCopiar()) } catch { salio = false }

    setEstado(salio ? 'ok' : 'error')
    clearTimeout(reloj.current)
    reloj.current = setTimeout(() => setEstado(''), DURACION)
  }

  return (
    <button type="button" className={`exp-copy-btn ${className}`.trim()} onClick={pulsar} title={titulo}>
      <span className={`exp-copy-ico${estado ? ` es-${estado}` : ''}`} aria-hidden="true">
        {estado === 'ok' ? '✓' : estado === 'error' ? '✕' : '⧉'}
      </span>
      <span className="exp-copy-lbl">Copiar</span>
    </button>
  )
}
