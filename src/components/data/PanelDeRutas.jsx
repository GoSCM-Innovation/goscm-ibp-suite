// Las rutas de la red: si lo que sale de cada planta llega a algún cliente.
//
// Portado del `vizRutasPanel` de `index.html` de v7 y de `vizRenderRutas`, `vizRutasSetTipo`,
// `vizRutasRenderTable` y `vizRutasCsv` de `visualizer.js`. El recorrido y la clasificación están en
// `core/ibp/supply-network.js` con sus pruebas; aquí solo se filtra y se dibuja.
//
// POR QUÉ NO BASTA EL DIBUJO: una planta huérfana —cuyo cien por cien de rutas muere sin llegar a
// nadie— tiene sus flechas como cualquier otra. Mirando el lienzo no se distingue. Esta tabla es lo
// que la señala, y es el hallazgo que más veces justifica abrir el visualizador.

import { useMemo, useState } from 'react'

import { FINALES, resumirRutas, rutasDeLaRed } from '../../../core/ibp/supply-network.js'
import { MARCA_DE_CODIFICACION } from '../../../core/ibp/export-csv.js'
import { descargarTexto } from '../../lib/descargar-csv.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Cuántas filas se dibujan. Es el tope de v7: con más, la tabla deja de responder. */
const TOPE_DE_FILAS = 500

const TIPOS = [
  { id: 'todas', label: 'Todas' },
  { id: 'cliente', label: 'Con llegada a cliente' },
  { id: 'sinCliente', label: 'Sin llegada a cliente' },
]

const FINALES_FILTRO = [
  { id: 'todos', label: 'Todos' },
  { id: FINALES.sinSalida, label: 'Sin salida' },
  { id: FINALES.ciclo, label: 'Ciclo' },
]

export default function PanelDeRutas({ red, nombreDe }) {
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState('todas')
  const [final, setFinal] = useState('todos')
  const [busqueda, setBusqueda] = useState('')

  // Se recorre una vez por red: en una red grande son decenas de miles de caminos.
  const { rutas, truncado, plantasHuerfanas } = useMemo(
    () => rutasDeLaRed(red?.nodos, red?.arcos),
    [red],
  )

  const resumen = useMemo(() => resumirRutas(rutas), [rutas])

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toUpperCase()
    return rutas.filter((una) => {
      if (tipo === 'cliente' && !una.llegaACliente) return false
      if (tipo === 'sinCliente' && una.llegaACliente) return false
      if (tipo === 'sinCliente' && final !== 'todos' && una.final !== final) return false
      if (!texto) return true
      return una.planta.toUpperCase().includes(texto)
        || una.ultimo.toUpperCase().includes(texto)
        || (una.cliente ?? '').toUpperCase().includes(texto)
        || una.nodos.some((uno) => uno.toUpperCase().includes(texto))
    })
  }, [rutas, tipo, final, busqueda])

  function volcar() {
    const cabecera = ['Planta', 'Ruta', 'Termina en', 'Cliente', 'Estado']
    const filas = filtradas.map((una) => [
      una.planta,
      una.nodos.join(' > '),
      una.ultimo,
      una.cliente ?? '',
      una.llegaACliente
        ? 'Con llegada a cliente'
        : (una.final === FINALES.ciclo ? 'Ciclo' : 'Sin salida'),
    ])
    const escapar = (valor) => `"${String(valor).replace(/"/g, '""')}"`
    const texto = [cabecera, ...filas].map((fila) => fila.map(escapar).join(';')).join('\r\n')
    // La marca de codificación va delante o Excel abre el CSV con los acentos rotos.
    descargarTexto(
      MARCA_DE_CODIFICACION + texto,
      `Rutas_${red.producto}_${new Date().toISOString().slice(0, 10)}.csv`,
    )
  }

  if (!red) return null

  return (
    <div className="viz-rutas">
      <button type="button" className="viz-rutas-cabecera" onClick={() => setAbierto(!abierto)}>
        <span className="mattype-arr">{abierto ? '▼' : '▶'}</span>
        <b>Rutas</b>
        <span className="mattype-summary">
          {numero(resumen.conCliente)} con llegada a cliente
          {resumen.sinCliente > 0 && (
            ` · ${numero(resumen.sinCliente)} sin llegada `
            + `(${numero(resumen.sinSalida)} sin salida, ${numero(resumen.ciclos)} en ciclo)`
          )}
          {plantasHuerfanas.length > 0 && (
            ` · ⚠ ${plantasHuerfanas.length} `
            + `${plantasHuerfanas.length === 1 ? 'planta huérfana' : 'plantas huérfanas'}`
          )}
          {truncado && ' · lista recortada'}
        </span>
      </button>

      {abierto && (
        <div className="viz-rutas-cuerpo">
          {/* Una planta huérfana no se ve en el dibujo: sus flechas son como las de cualquier otra. */}
          {plantasHuerfanas.length > 0 && (
            <div className="notice notice-error">
              ⚠ <b>{plantasHuerfanas.length === 1 ? 'Una planta no llega a nadie' : `${plantasHuerfanas.length} plantas no llegan a nadie`}</b>:
              {' '}<span className="mono">{plantasHuerfanas.join(', ')}</span>. Todas sus rutas mueren
              antes de un cliente. En el lienzo no se distingue: tienen sus flechas como cualquier otra.
            </div>
          )}

          {truncado && (
            <div className="notice notice-info">
              La red tiene más rutas de las que se pueden recorrer y la lista está <b>recortada</b>.
              Suele pasar cuando hay ciclos entre ubicaciones: cada vuelta multiplica los caminos.
            </div>
          )}

          <div className="monitor-bar">
            <div className="seg">
              {TIPOS.map((uno) => (
                <button
                  key={uno.id}
                  type="button"
                  className={`seg-btn${tipo === uno.id ? ' active' : ''}`}
                  onClick={() => { setTipo(uno.id); setFinal('todos') }}
                >
                  {uno.label}
                </button>
              ))}
            </div>

            {/* El sub-filtro solo tiene sentido dentro de «sin llegada». */}
            {tipo === 'sinCliente' && (
              <div className="seg">
                {FINALES_FILTRO.map((uno) => (
                  <button
                    key={uno.id}
                    type="button"
                    className={`seg-btn${final === uno.id ? ' active' : ''}`}
                    onClick={() => setFinal(uno.id)}
                  >
                    {uno.label}
                  </button>
                ))}
              </div>
            )}

            <input
              className="input input-sm"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Buscar planta, nodo final o cliente…"
              aria-label="Buscar en las rutas"
            />

            <button type="button" className="btn btn-sm" onClick={volcar} disabled={filtradas.length === 0}>
              ⬇ CSV
            </button>

            <span className="page-hint">
              {filtradas.length === rutas.length
                ? `${numero(rutas.length)} rutas`
                : `${numero(filtradas.length)} de ${numero(rutas.length)}`}
              {filtradas.length > TOPE_DE_FILAS && ` · se ven las primeras ${TOPE_DE_FILAS}`}
            </span>
          </div>

          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr><th>Planta</th><th>Ruta</th><th>Termina en</th><th>Cliente</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {filtradas.slice(0, TOPE_DE_FILAS).map((una, indice) => (
                  <tr key={`${una.planta}-${una.nodos.join('>')}-${una.cliente ?? una.ultimo}-${indice}`}>
                    <td className="mono">{una.planta}</td>
                    <td className="mono">{una.nodos.join(' › ')}</td>
                    <td className="mono">
                      {una.ultimo}
                      <div className="exp-sub">{nombreDe?.(una.ultimo)}</div>
                    </td>
                    <td className="mono">
                      {una.cliente ?? '—'}
                      {una.cliente && <div className="exp-sub">{nombreDe?.(una.cliente)}</div>}
                    </td>
                    <td>
                      {una.llegaACliente && <span style={{ color: 'var(--green)' }}>✓ llega</span>}
                      {!una.llegaACliente && una.final === FINALES.ciclo && (
                        <span style={{ color: 'var(--accent)' }}>🔁 ciclo</span>
                      )}
                      {!una.llegaACliente && una.final === FINALES.sinSalida && (
                        <span style={{ color: 'var(--red)' }}>✕ sin salida</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtradas.length === 0 && (
                  <tr><td colSpan={5} className="table-empty">Ninguna ruta coincide</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
