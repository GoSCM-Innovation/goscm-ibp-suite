// Qué columnas se ven de la tabla, con buscador y preselecciones guardadas.
//
// Portado de `DataViewer/ColumnPicker.jsx` de v8. Lo que había aquí eran tres botones fijos —«Todas»,
// «Las de siempre», «Solo las claves»— y las sesenta casillas sin buscador.
//
// Las dos cosas que faltaban y que v8 tenía:
//
//   - EL BUSCADOR. Una tabla de dato maestro de SAP tiene sesenta columnas con nombres como
//     `MATLGRPID`. Encontrar una a ojo entre sesenta casillas es el tipo de tarea que hace que la
//     gente se rinda y se lleve todas.
//   - LAS PRESELECCIONES GUARDADAS. A cada consultor le importan seis columnas, casi siempre las
//     mismas, y las vuelve a marcar cada vez que abre la tabla. Guardarlas con un nombre lo convierte
//     en un clic. Se guardan por tabla, en este navegador.

import { useMemo, useState } from 'react'

import {
  borrarPreseleccion, guardarPreseleccion, leerPreselecciones,
} from '../../lib/preselecciones-de-columnas.js'

export default function SelectorDeColumnas({ tabla, todas, claves, porOmision, elegidas, onCambiar }) {
  const [busqueda, setBusqueda] = useState('')
  const [guardadas, setGuardadas] = useState(() => leerPreselecciones(tabla))
  const [nombrando, setNombrando] = useState(false)
  const [nombre, setNombre] = useState('')

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    return texto ? todas.filter((una) => una.toUpperCase().includes(texto)) : todas
  }, [todas, busqueda])

  /** Marca o desmarca una columna, conservando el ORDEN de la tabla y no el de los clics. */
  function alternar(columna, marcada) {
    onCambiar(marcada
      ? todas.filter((una) => elegidas.includes(una) || una === columna)
      : elegidas.filter((una) => una !== columna))
  }

  function guardar() {
    const limpio = nombre.trim()
    if (!limpio) return
    setGuardadas(guardarPreseleccion(tabla, limpio, elegidas))
    setNombrando(false)
    setNombre('')
  }

  return (
    <>
      <div className="monitor-bar">
        <span className="exp-sub">Columnas {elegidas.length}/{todas.length}</span>
        <input
          className="input input-sm"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar columna…"
          aria-label="Buscar columna"
        />
      </div>

      <div className="columnas">
        {visibles.map((columna) => {
          const esClave = claves.includes(columna)
          return (
            <label key={columna} className={`columna${esClave ? ' columna-clave' : ''}`}>
              <input
                type="checkbox"
                checked={elegidas.includes(columna)}
                onChange={(evento) => alternar(columna, evento.target.checked)}
              />
              {columna}
              {esClave && <span className="exp-sub"> clave</span>}
            </label>
          )
        })}
        {visibles.length === 0 && <div className="sin-datos">Ninguna columna coincide</div>}
      </div>

      <div className="monitor-bar">
        <button type="button" className="btn btn-sm" onClick={() => onCambiar(todas)}>Todas</button>
        <button type="button" className="btn btn-sm" onClick={() => onCambiar(porOmision)}>
          Claves + descripciones
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onCambiar(claves)}
          disabled={claves.length === 0}
        >
          Solo claves
        </button>

        {/* Las guardadas van detrás de las tres de siempre, como en v8. */}
        {guardadas.map((una) => (
          <span key={una.nombre} className="preseleccion">
            <button type="button" className="btn btn-sm" onClick={() => onCambiar(una.columnas)}>
              {una.nombre}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              title="Eliminar preselección"
              aria-label={`Eliminar la preselección ${una.nombre}`}
              onClick={() => setGuardadas(borrarPreseleccion(tabla, una.nombre))}
            >
              ✕
            </button>
          </span>
        ))}

        {nombrando
          ? (
            <>
              <input
                className="input input-sm"
                value={nombre}
                autoFocus
                onChange={(evento) => setNombre(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter') guardar()
                  if (evento.key === 'Escape') { setNombrando(false); setNombre('') }
                }}
                placeholder="Nombre de la preselección de columnas:"
                aria-label="Nombre de la preselección de columnas"
              />
              <button type="button" className="btn btn-sm btn-primary" onClick={guardar} disabled={!nombre.trim()}>
                Guardar
              </button>
              <button type="button" className="btn btn-sm" onClick={() => { setNombrando(false); setNombre('') }}>
                Cancelar
              </button>
            </>
          )
          : (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setNombrando(true)}
              disabled={elegidas.length === 0}
            >
              Guardar selección…
            </button>
          )}
      </div>
    </>
  )
}
