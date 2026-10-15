// Una fecha del filtro o de un valor de ejecución: se elige en un calendario, o se deja como variable.
//
// La fecha va en el body como `AAAAMMDD` (`20261005`); el calendario del navegador trabaja con `AAAA-MM-DD`. Aquí se traduce en
// los dos sentidos (ver `lib/fechas.js`), así que quien lo usa solo ve el formato del body.
//
// Una fecha puede ser FIJA (la que se elige) o una VARIABLE (`{{FECHA_DESDE}}`, que se pide al ejecutar). Un botón pasa de una a
// otra. Un valor que ya es una variable, o cualquier texto que no es una fecha, se enseña tal cual como texto y no se pierde.

import { useState } from 'react'
import { aFechaDelCalendario, deFechaDelCalendario, esFechaAAAAMMDD } from '../../lib/fechas.js'

export default function CampoDeFecha({ id, valor, onCambiar, ariaLabel, deshabilitado = false, conVariable = true }) {
  // Texto si el valor ya es una variable o algo que no es una fecha; calendario si está vacío o es una fecha.
  const [comoTexto, setComoTexto] = useState(() => valor !== '' && !esFechaAAAAMMDD(valor))

  if (!comoTexto) {
    return (
      <span className="ci-fecha">
        <input
          id={id}
          type="date"
          className="input input-sm mono"
          value={aFechaDelCalendario(valor)}
          disabled={deshabilitado}
          aria-label={ariaLabel}
          onChange={(evento) => onCambiar(deFechaDelCalendario(evento.target.value))}
        />
        {conVariable && !deshabilitado && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Usar una variable en lugar de una fecha fija: se pide al ejecutar"
            onClick={() => setComoTexto(true)}
          >
            Variable
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="ci-fecha">
      <input
        id={id}
        className="input input-sm mono"
        value={valor}
        placeholder="{{FECHA}}"
        disabled={deshabilitado}
        aria-label={ariaLabel}
        onChange={(evento) => onCambiar(evento.target.value.trim())}
      />
      {!deshabilitado && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Elegir la fecha en un calendario"
          onClick={() => {
            // Lo que no es una fecha no cabe en el calendario: se vacía en lugar de dejarlo escondido.
            if (!esFechaAAAAMMDD(valor)) onCambiar('')
            setComoTexto(false)
          }}
        >
          Calendario
        </button>
      )}
    </span>
  )
}
