// Un campo del body que se puede elegir de una lista o escribir a mano.
//
// La lista puede salir de IBP (áreas, versiones, tipos de maestro) o ser fija (el tipo de dato, el comando) y se
// elige con el selector de siempre de la plataforma: todas las opciones a la vez, no un cuadro de texto con
// sugerencias del navegador, que filtra por lo que ya está escrito y esconde las demás.
//
// Escribir a mano sigue siendo posible, y es lo que se ve cuando el valor que el body ya tiene no está en la lista:
// se enseña tal cual en un campo de texto, con un aviso, y no se cambia por otro sin que nadie lo decida. Es sticky:
// una vez en modo texto, no vuelve solo al selector mientras se escribe (un valor a medias puede coincidir con una
// opción y el control cambiaría debajo del cursor).
//
// `onCambiar` recibe lo que se ESCRIBE a mano. `alElegir` recibe lo que se elige de la lista (por omisión, lo mismo):
// sirve para que elegir pueda hacer más que escribir, como rellenar otro campo.

import { useState } from 'react'
import { conValorActual, esVariable } from '../../lib/ci-ibp.js'
import SelectorDeLista from '../ui/SelectorDeLista.jsx'

/** Lo que el control dice de sí mismo. `aviso` vacío no avisa de un valor que no está en la lista. */
const TEXTOS = { lista: 'Elegir de la lista', aviso: 'No es uno de los valores de la lista.', sufijo: 'no está en la lista' }

export default function CampoConLista({
  id, valor, opciones, onCambiar, alElegir = onCambiar, deshabilitado = false, titulo, ariaLabel, textos = {},
}) {
  const dicen = { ...TEXTOS, ...textos }
  const conocido = valor === '' || opciones.some((una) => una.value === valor)
  const [aMano, setAMano] = useState(!conocido)

  return (
    <div className="ci-campo-ibp">
      {aMano ? (
        <>
          <input
            id={id}
            className="input mono"
            list={`${id}-opciones`}
            value={valor}
            disabled={deshabilitado}
            aria-label={ariaLabel}
            onChange={(evento) => onCambiar(evento.target.value)}
          />
          <datalist id={`${id}-opciones`}>
            {opciones.filter((una) => una.value !== '').map((una) => <option key={una.value} value={una.value}>{una.label}</option>)}
          </datalist>
        </>
      ) : (
        <SelectorDeLista
          id={id}
          className="select"
          value={valor}
          options={conValorActual(opciones, valor, dicen.sufijo)}
          disabled={deshabilitado}
          titulo={titulo}
          ariaLabel={ariaLabel}
          onChange={alElegir}
        />
      )}
      {!deshabilitado && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setAMano((v) => !v)}
          title={aMano ? dicen.lista : 'Escribir el valor a mano'}
        >
          {aMano ? dicen.lista : 'A mano'}
        </button>
      )}
      {aMano && !conocido && dicen.aviso && !esVariable(valor) && !deshabilitado && <span className="ci-aviso-fila">{dicen.aviso}</span>}
    </div>
  )
}
