// Un campo de ajustes: «versión», «comando», «origen» o «destino» de una orquestación o de un paso.
//
// Es una lista corta: lo primero es SIEMPRE «como en la integración» (no cambiar nada), después lo que ya usan las integraciones de la
// conexión, y al final «Otro valor…» para escribir uno a mano. Cambiar un ajuste es elegir; quitarlo, volver a la primera opción o
// pulsar ↺. Un campo con valor se marca (borde ámbar) para que se vea de un vistazo qué se está cambiando.
//
// `valor` es `undefined` si no se cambia nada. La versión `''` es la versión BASE: es un valor (`conBase`).
//
// El valor puede ser también una variable (`{{VERSION}}`), que se escribe a mano y se pide al ejecutar.

import { useState } from 'react'

const SIN_CAMBIO = '__sin_cambio__'
const BASE = '__base__'
const OTRO = '__otro__'

export default function CampoDeAjuste({ etiqueta, valor, opciones, textoSinCambio, conBase = false, onCambiar, id }) {
  // A mano si el valor no es de la lista (o se pidió «Otro valor…»).
  const [pidioOtro, setPidioOtro] = useState(false)
  const aMano = pidioOtro || (valor !== undefined && valor !== '' && !opciones.includes(valor))
  const cambiado = valor !== undefined

  function elegir(elegido) {
    if (elegido === OTRO) { setPidioOtro(true); return }
    setPidioOtro(false)
    if (elegido === SIN_CAMBIO) onCambiar(undefined)
    else if (elegido === BASE) onCambiar('')
    else onCambiar(elegido)
  }

  function restablecer() {
    setPidioOtro(false)
    onCambiar(undefined)
  }

  return (
    <div className={`ci-ajuste${cambiado ? ' cambiado' : ''}`}>
      <label className="ci-ajuste-etiqueta" htmlFor={id}>{etiqueta}</label>
      <div className="ci-ajuste-control">
        {aMano ? (
          <>
            <input
              id={id}
              className="input input-sm mono"
              value={valor ?? ''}
              placeholder="Escribe un valor"
              aria-label={`${etiqueta}: valor a mano`}
              onChange={(evento) => onCambiar(evento.target.value.trim() === '' ? undefined : evento.target.value)}
            />
            <button type="button" className="btn btn-ghost btn-sm" title="Elegir de la lista" onClick={restablecer}>Lista</button>
          </>
        ) : (
          // select-fijo: lista corta de lo que ya usan las integraciones, no crece con los datos
          <select
            id={id}
            className="select"
            value={valor === undefined ? SIN_CAMBIO : valor === '' ? BASE : valor}
            onChange={(evento) => elegir(evento.target.value)}
          >
            <option value={SIN_CAMBIO}>{textoSinCambio}</option>
            {conBase && <option value={BASE}>Versión base (vacío)</option>}
            {opciones.map((opcion) => <option key={opcion} value={opcion}>{opcion}</option>)}
            <option value={OTRO}>Otro valor…</option>
          </select>
        )}
        {cambiado && !aMano && (
          <button type="button" className="ci-ajuste-restablecer" title="Volver a lo de la integración" aria-label={`Restablecer ${etiqueta}`} onClick={restablecer}>↺</button>
        )}
      </div>
    </div>
  )
}
