// Las condiciones con las que se acota UNA tabla.
//
// Portado de `Migration/FilterControls.jsx` de v8. Se usa por tabla y no por migración a propósito:
// filtrar por marca solo tiene sentido en la tabla de productos, y aplicado a la de ubicaciones se
// llevaría todo por delante —o nada, que es peor porque parece que no hay datos—.
//
// Solo operadores de INCLUSIÓN, igual que en el visor: se copia exactamente lo que nombran. «Distinto
// de» no existe porque en SAP también descarta las filas donde el campo está vacío.

import { OPERADORES, etiquetaDeCondicion } from '../../../core/ibp/master-data-model.js'

/** Una condición: campo, operador y valores. */
function Condicion({ condicion, campos, onCambiar, onQuitar }) {
  const operador = OPERADORES.find((uno) => uno.id === condicion.op) ?? OPERADORES[0]

  return (
    <div className="condicion">
      <select
        className="select input-sm"
        value={condicion.field}
        onChange={(evento) => onCambiar({ ...condicion, field: evento.target.value, value: '' })}
        aria-label="Campo del filtro"
      >
        <option value="">Elegí un campo…</option>
        {campos.map((campo) => <option key={campo} value={campo}>{campo}</option>)}
      </select>

      <select
        className="select input-sm"
        value={condicion.op}
        onChange={(evento) => onCambiar({ ...condicion, op: evento.target.value })}
        aria-label="Operador del filtro"
      >
        {OPERADORES.map((uno) => <option key={uno.id} value={uno.id}>{uno.label}</option>)}
      </select>

      {operador.id === 'nb'
        ? <span className="exp-sub condicion-ayuda">{operador.ayuda}</span>
        : (
          <input
            className="input input-sm"
            value={condicion.value}
            onChange={(evento) => onCambiar({ ...condicion, value: evento.target.value })}
            placeholder={operador.ayuda}
          />
        )}

      <button type="button" className="btn btn-sm" onClick={onQuitar} aria-label="Quitar la condición">✕</button>
    </div>
  )
}

export default function FiltroDeTabla({ tabla, campos, condiciones = [], onCambiar }) {
  const cambiarUna = (id, cambiada) => onCambiar(condiciones.map((una) => (una.id === id ? cambiada : una)))

  return (
    <div className="filtro-de-tabla">
      {condiciones.map((una) => (
        <Condicion
          key={una.id}
          condicion={una}
          campos={campos}
          onCambiar={(cambiada) => cambiarUna(una.id, cambiada)}
          onQuitar={() => onCambiar(condiciones.filter((otra) => otra.id !== una.id))}
        />
      ))}

      <div className="monitor-bar">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onCambiar([...condiciones, { id: `${tabla}-${condiciones.length}-${Date.now()}`, field: '', op: 'in', value: '' }])}
        >
          + Condición
        </button>

        {condiciones.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => onCambiar([])}>Quitar el filtro</button>
        )}

        {/* Las etiquetas de las condiciones completas: es la forma corta de comprobar que el filtro
            dice lo que uno cree que dice antes de copiar nada. */}
        {condiciones.map(etiquetaDeCondicion).filter(Boolean).map((chip) => (
          <span className="tag" key={chip}>{chip}</span>
        ))}
      </div>
    </div>
  )
}
