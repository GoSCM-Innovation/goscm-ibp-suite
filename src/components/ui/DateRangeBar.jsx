// Los campos de rango de fechas y el selector de zona horaria.
//
// La parte visible de `useDateRange`. Va aparte del gancho porque el monitor y los tableros ponen
// otros controles al lado (buscador, copiar, actualizar) y cada uno los ordena a su manera.

import { TZ_OPTIONS } from '../../lib/dates.js'

/** Zonas que se ofrecen. La del equipo queda fuera del selector, igual que en v9. */
const ZONAS = TZ_OPTIONS.filter((opcion) => opcion.value !== 'local')

export default function DateRangeBar({ rango, zona, dias, onZona, onRango }) {
  return (
    <>
      <div className="seg" role="group" aria-label="Zona horaria">
        {ZONAS.map((opcion) => (
          <button
            key={opcion.value}
            type="button"
            className={`seg-btn${zona === opcion.value ? ' active' : ''}`}
            onClick={() => onZona(opcion.value)}
            aria-pressed={zona === opcion.value}
          >
            {opcion.label}
          </button>
        ))}
      </div>

      <input
        type="datetime-local"
        className="input input-sm"
        value={rango.desde}
        onChange={(evento) => onRango('desde', evento.target.value)}
        aria-label="Desde"
      />
      <span className="arrow" aria-hidden="true">→</span>
      <input
        type="datetime-local"
        className="input input-sm"
        value={rango.hasta}
        onChange={(evento) => onRango('hasta', evento.target.value)}
        aria-label="Hasta"
      />
      {dias !== null && <span className="tag tag-muted">{dias} d</span>}
    </>
  )
}
