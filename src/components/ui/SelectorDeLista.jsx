// Elegir UNA opción de una lista, con el criterio único de la plataforma (`lib/lista-extensa.js`):
// hasta 12 opciones, el `<select>` de siempre; más, un botón que abre la ventana con buscador.
//
// Es el sustituto directo de `<select>` + `<option>`: misma clase, mismo estilo, mismo `id`, así que la
// pantalla se ve igual y solo cambia lo que ocurre al pulsar cuando la lista es larga. Por eso hay una
// regla de pruebas que prohíbe `<select>` sueltos (ver `selector-homologado.test.js`): cada selector
// nuevo pasa por aquí y hereda el criterio sin acordarse de él.
//
// `onChange` recibe el VALOR, no el evento.
//
// Una opción con valor '' (la «— Sin especificar —» de muchos selectores) cuenta como opción, pero NO
// para decidir si la lista es extensa: no es un elemento que haya que buscar.

import { useState } from 'react'
import { esListaExtensa } from '../../lib/lista-extensa.js'
import VentanaDeSeleccion from './VentanaDeSeleccion.jsx'

/**
 * @param {object} props
 * @param {string} props.value
 * @param {(valor: string) => void} props.onChange
 * @param {Array<{ value: string, label?: string, disabled?: boolean }>} props.options
 * @param {string} [props.placeholder]  Lo que dice el botón cuando no hay nada elegido.
 * @param {string} [props.titulo]       Título de la ventana.
 * @param {string} [props.className]
 * @param {import('react').CSSProperties} [props.style]
 * @param {string} [props.id]
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]
 */
export default function SelectorDeLista({
  value,
  onChange,
  options,
  placeholder = '—',
  titulo,
  className = 'select',
  style,
  id,
  disabled = false,
  ariaLabel,
}) {
  const [abierta, setAbierta] = useState(false)
  const extensa = esListaExtensa(options.filter((o) => o.value !== '').length)

  if (!extensa) {
    return (
      <select
        id={id}
        className={className}
        style={style}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(evento) => onChange(evento.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label ?? o.value}</option>
        ))}
      </select>
    )
  }

  const actual = options.find((o) => o.value === value)
  const nombres = Object.fromEntries(options.map((o) => [o.value, o.label ?? o.value]))
  return (
    <>
      <button
        type="button"
        id={id}
        className={`${className} selector-lista-boton`}
        style={style}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setAbierta(true)}
      >
        <span className="selector-lista-texto">{actual ? (actual.label ?? actual.value) : placeholder}</span>
        <span className="selector-lista-flecha" aria-hidden="true">▾</span>
      </button>
      {abierta && (
        <VentanaDeSeleccion
          modo="unica"
          titulo={titulo || ariaLabel || 'Elegir de la lista'}
          opciones={options.filter((o) => !o.disabled).map((o) => o.value)}
          nombres={nombres}
          valor={value}
          onElegir={(elegido) => { onChange(elegido); setAbierta(false) }}
          onCerrar={() => setAbierta(false)}
        />
      )}
    </>
  )
}
