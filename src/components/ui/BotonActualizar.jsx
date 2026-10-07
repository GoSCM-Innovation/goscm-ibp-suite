// El botón «↺ Actualizar» con su proceso a la vista.
//
// Mientras `cargando` es verdadero: el ↺ gira, el botón se apaga y, si hay `mensaje`, una frase al
// lado dice qué se está leyendo («Leyendo áreas y catálogos de SAP…»). Al terminar sin error, y si se
// pidió con `confirmar`, aparece un «✓ Actualizado» unos segundos: sin él, quien pulsa no sabe si el
// refresco acabó o no hizo nada.
//
// `confirmar` es solo para las actualizaciones que alguien pidió con un clic. Los monitores que se
// refrescan solos cada pocos segundos NO lo usan: el aviso saltaría sin que nadie lo haya pedido.
//
// El texto del botón y su estilo los pone quien lo usa: así las pantallas portadas conservan su
// «↺ Refresh» y su aspecto tal cual, y solo ganan el giro y el aviso.

import { useEffect, useRef, useState } from 'react'
import EstadoDeCarga from './EstadoDeCarga.jsx'

const DURACION_CONFIRMACION = 3000

export default function BotonActualizar({
  etiqueta = 'Actualizar',
  onClick,
  cargando = false,
  mensaje = '',
  confirmar = false,
  error = false,
  deshabilitado = false,
  title,
  style,
  className = '',
}) {
  const [confirmado, setConfirmado] = useState(false)
  const antes = useRef(cargando)
  const reloj = useRef(null)
  // La primera lectura al abrir la pantalla también pasa por «cargando» y nadie pulsó nada: el
  // «✓ Actualizado» es solo para lo que se pidió con un clic.
  const pedido = useRef(false)

  useEffect(() => {
    // Solo cuenta el paso de «cargando» a «ya no», y solo si no terminó en error.
    if (antes.current && !cargando) {
      if (pedido.current && confirmar && !error) {
        setConfirmado(true)
        clearTimeout(reloj.current)
        reloj.current = setTimeout(() => setConfirmado(false), DURACION_CONFIRMACION)
      }
      pedido.current = false
    }
    antes.current = cargando
  }, [cargando, confirmar, error])

  useEffect(() => () => clearTimeout(reloj.current), [])

  // El aviso va ANTES del botón: en las cabeceras el botón queda pegado al borde derecho y el aviso
  // crece hacia dentro, sin empujar al botón de sitio.
  return (
    <>
      {cargando && mensaje && <EstadoDeCarga mensaje={mensaje} />}
      {!cargando && confirmado && (
        <span className="estado-de-carga estado-de-carga-ok" role="status">✓ Actualizado</span>
      )}
      <button
        type="button"
        className={`boton-actualizar${cargando ? ' cargando' : ''} ${className}`.trim()}
        onClick={(evento) => { pedido.current = true; onClick?.(evento) }}
        disabled={cargando || deshabilitado}
        aria-busy={cargando}
        title={title}
        style={{ ...style, ...(cargando ? { cursor: 'wait', opacity: 0.7 } : null) }}
      >
        <span className="boton-actualizar-icono" aria-hidden="true">↺</span>
        {' '}{etiqueta}
      </button>
    </>
  )
}
