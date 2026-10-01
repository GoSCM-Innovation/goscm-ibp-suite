// Glosario Analyzers: la guía de lectura del Excel de Production Analyzer y de Network Analyzer.
//
// ES EL DE V7, TAL CUAL. Dos pestañas arriba (una por analizador) con «↓ Exportar PDF» a la derecha,
// un índice lateral con una entrada por sección y el contenido a la derecha, con el índice siguiendo
// la lectura. Lo ocupa de lado a lado, sin la cinta de presentación de las otras aplicaciones: v7 no
// la ponía aquí.
//
// Una versión anterior de esta pantalla DERIVABA el glosario del código de las reglas. Era una idea
// propia que nadie pidió, y el resultado no se parecía en nada al original (otros títulos, otra
// estructura, sin pestañas ni PDF). Se descartó: la regla de este proyecto es portar la interfaz de
// v7, v8 y v9 como era. El texto vive en `lib/glosario-v7.js`, copiado de `glosario.js` de v7.

import { useEffect, useMemo, useRef, useState } from 'react'

import { PA_SECTIONS, SN_SECTIONS, section } from '../../lib/glosario-v7.js'

const MODULOS = [
  { id: 'pa', nombre: 'Production Analyzer', etiqueta: '🔬 Production Analyzer', secciones: PA_SECTIONS },
  { id: 'sn', nombre: 'Network Analyzer', etiqueta: '🌐 Network Analyzer', secciones: SN_SECTIONS },
]

export default function Glosario() {
  const [modulo, setModulo] = useState('pa')
  const [activa, setActiva] = useState(null)
  const [generando, setGenerando] = useState(false)
  const contenido = useRef(null)
  // Mientras el scroll lo mueve un clic en el índice, el seguimiento de lectura se calla: si no,
  // marcaría las secciones que va cruzando de camino en vez de la que se pidió.
  const bloqueado = useRef(false)
  const temporizador = useRef(null)

  const actual = MODULOS.find((m) => m.id === modulo)

  // El HTML sale de texto fijo escrito por nosotros: no lleva ningún dato del usuario ni de SAP.
  const html = useMemo(
    () => actual.secciones
      .map((s) => section(s.id, s.icon, s.title, s.content()))
      .join('<hr class="glos-hr">'),
    [actual],
  )

  useEffect(() => {
    if (contenido.current) contenido.current.scrollTop = 0
  }, [modulo])

  useEffect(() => () => clearTimeout(temporizador.current), [])

  function irA(evento, id) {
    evento.preventDefault()
    bloqueado.current = true
    clearTimeout(temporizador.current)
    const el = document.getElementById(id)
    const cont = contenido.current
    if (el && cont) {
      const dentro = el.getBoundingClientRect().top - cont.getBoundingClientRect().top
      cont.scrollTo({ top: cont.scrollTop + dentro - 16, behavior: 'smooth' })
    }
    setActiva(id)
    temporizador.current = setTimeout(() => { bloqueado.current = false }, 600)
  }

  function alDesplazar() {
    if (bloqueado.current || !contenido.current) return
    const tope = contenido.current.scrollTop + 40
    let id = null
    contenido.current.querySelectorAll('.glos-section').forEach((s) => {
      if (s.offsetTop <= tope) id = s.id
    })
    setActiva(id)
  }

  async function exportarPdf() {
    setGenerando(true)
    try {
      // jsPDF pesa cientos de kilobytes y solo hace falta aquí: se baja al pulsar.
      const [{ jsPDF }, { default: autoTable }, { construirPdf }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('../../lib/glosario-pdf.js'),
      ])
      const hoy = new Date()
      const nombre = `Glosario_${modulo.toUpperCase()}_${hoy.toISOString().slice(0, 10)}.pdf`
      construirPdf({ jsPDF }, autoTable, contenido.current, actual.nombre, hoy, nombre)
    } catch (error) {
      // v7 avisaba con un alert si la librería no estaba. Es el mismo caso, con el motivo.
      alert(`No se pudo generar el PDF: ${error.message}`)
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="glosario-pagina">
      <div className="glosario-shell">
        <div className="glosario-module-bar">
          {MODULOS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`glosario-mod-btn${modulo === m.id ? ' active' : ''}`}
              onClick={() => { setModulo(m.id); setActiva(null) }}
            >
              {m.etiqueta}
            </button>
          ))}
          <button
            type="button"
            className="glosario-pdf-btn"
            title="Exportar glosario a PDF"
            disabled={generando}
            onClick={exportarPdf}
          >
            {generando ? 'Generando...' : '↓ Exportar PDF'}
          </button>
        </div>

        <div className="glosario-body">
          <nav className="glosario-sidenav">
            {actual.secciones.map((s) => (
              <a
                key={s.id}
                className={`glos-nav-link${activa === s.id ? ' active' : ''}`}
                href={`#${s.id}`}
                onClick={(e) => irA(e, s.id)}
              >
                {s.icon} {s.title}
              </a>
            ))}
          </nav>
          <div
            ref={contenido}
            className="glosario-content"
            onScroll={alDesplazar}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  )
}
