// Un diálogo. Lo usan el visor de registros y la confirmación de cancelar.
//
// Reemplaza a `window.confirm`, que v9 usaba para cancelar una ejecución: ese cuadro no se puede
// estilar, no muestra bien un nombre largo de tarea y en algunos navegadores se puede silenciar.
// Para confirmar algo que detiene una carga en SAP, conviene que se lea bien qué se va a detener.

import { useEffect, useRef } from 'react'

export default function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  const caja = useRef(null)

  // Escape cierra, y el foco entra en el diálogo para que el teclado no siga en la tabla de
  // detrás.
  useEffect(() => {
    const alTeclear = (evento) => { if (evento.key === 'Escape') onClose() }
    document.addEventListener('keydown', alTeclear)
    caja.current?.focus()
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose() }}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={caja}
      >
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-subtitle mono">{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
