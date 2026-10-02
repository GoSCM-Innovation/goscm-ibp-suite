// El modal «¿Cómo quieres ver el análisis?» de v7 (`askOutputMode` en snWebView.js). Es genérico: lo
// usan Production Analyzer y Network Analyzer, así que no dice nada de ninguno de los dos.
//
// El componente no decide qué hacer con la respuesta; solo la entrega: 'web', 'excel', 'both' o null
// (Cancelar, Escape o clic en el fondo). Quien lo monta lo desmonta al recibirla, igual que la promesa
// de v7 retiraba el modal al resolverse.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const OPCIONES = [
  {
    modo: 'web',
    titulo: '🖥️ Ver en la web',
    detalle: 'Explora el análisis en pantalla sin descargar nada.',
  },
  {
    modo: 'excel',
    titulo: '⬇️ Descargar Excel',
    detalle: 'Genera y descarga el informe .xlsx (comportamiento actual).',
  },
  {
    modo: 'both',
    titulo: '📊 Ambos',
    detalle: 'Descarga el Excel y además muestra la vista web.',
  },
]

export default function ModalModoDeSalida({ onElegir }) {
  const primera = useRef(null)
  // El oyente de Escape se registra una sola vez; la referencia le da siempre la función vigente sin
  // volver a registrarlo en cada render del padre.
  const elegir = useRef(onElegir)
  useEffect(() => { elegir.current = onElegir })

  useEffect(() => {
    primera.current?.focus()
    function alTeclear(e) {
      if (e.key === 'Escape') elegir.current?.(null)
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [])

  // Va al <body> como en v7: así ningún contenedor con `overflow` o `transform` del padre lo recorta.
  return createPortal(
    <div
      className="snwv-ov"
      onClick={(e) => { if (e.target === e.currentTarget) onElegir?.(null) }}
    >
      <div className="snwv-modal" role="dialog" aria-modal="true" aria-labelledby="snwv-modal-titulo">
        <h3 id="snwv-modal-titulo">¿Cómo quieres ver el análisis?</h3>
        <p>Puedes explorar el resultado directamente en la web, descargar el Excel, o ambos.</p>
        <div className="snwv-opts">
          {OPCIONES.map((o, i) => (
            <button
              key={o.modo}
              ref={i === 0 ? primera : undefined}
              type="button"
              className="snwv-opt"
              data-m={o.modo}
              onClick={() => onElegir?.(o.modo)}
            >
              <b>{o.titulo}</b>
              <span>{o.detalle}</span>
            </button>
          ))}
        </div>
        <div className="snwv-modal-foot">
          <button type="button" className="snwv-btn" data-m="cancel" onClick={() => onElegir?.(null)}>
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
