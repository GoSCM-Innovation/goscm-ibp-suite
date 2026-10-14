// Un campo del body que se puede elegir de una lista de IBP o escribir a mano.
//
// La lista sale de IBP (áreas, versiones…) y se elige con el selector de siempre de la plataforma. Escribir a mano
// sigue siendo posible, y es lo que se ve cuando el valor que el body ya tiene no está en IBP: el valor se enseña
// tal cual en un campo de texto, con un aviso, y no se cambia por otro sin que nadie lo decida. Es sticky: una vez
// en modo texto, no vuelve solo al selector mientras se escribe (un valor a medias puede coincidir con una opción y
// el control cambiaría debajo del cursor).

import { useState } from 'react'
import { conValorActual, esVariable } from '../../lib/ci-ibp.js'
import SelectorDeLista from '../ui/SelectorDeLista.jsx'

export default function CampoConIbp({ id, valor, opciones, onCambiar, deshabilitado = false, titulo, ariaLabel }) {
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
          options={conValorActual(opciones, valor)}
          disabled={deshabilitado}
          titulo={titulo}
          ariaLabel={ariaLabel}
          onChange={onCambiar}
        />
      )}
      {!deshabilitado && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setAMano((v) => !v)}
          title={aMano ? 'Elegir de la lista de IBP' : 'Escribir el valor a mano'}
        >
          {aMano ? 'Elegir de IBP' : 'A mano'}
        </button>
      )}
      {aMano && !conocido && !esVariable(valor) && !deshabilitado && <span className="ci-aviso-fila">No está en IBP.</span>}
    </div>
  )
}
