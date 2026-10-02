// El cuerpo del paso ② «Excluir tipos de material»: una tabla de interruptores, uno por tipo.
//
// Portado de `mattyeRenderExclude` de `mattype-config.js` de v7. Es de presentación pura: no sabe de
// dónde salen los tipos ni dónde se guarda lo que se decide —lo recibe y lo avisa—, que es lo que
// permite que lo usen igual el Production Analyzer y el Network Analyzer.
//
// El orden de las filas lo pone quien llama (v7 las ordenaba con `Object.keys(...).sort()`): aquí
// ordenar sería adivinar un criterio que no es de esta tabla.
//
// Interruptor ENCENDIDO = incluido en el análisis (el estado inicial); apagado = excluido. Está al
// revés de lo que sugiere el nombre del paso, pero es como lo conocen quienes ya usan v7.

/**
 * @param {object}   props
 * @param {Array<{ tipo: string, productos: number, excluido: boolean }>} props.tipos  Ya ordenados.
 * @param {boolean}  props.cargando   Se están leyendo los tipos de SAP: no hay tabla ni aviso de vacío.
 * @param {(tipo: string, incluido: boolean) => void} props.onCambiar
 */
export default function TablaExcluirTipos({ tipos, cargando = false, onCambiar }) {
  if (cargando) {
    return <p style={{ fontSize: '12px', color: 'var(--text2)' }}>⏳ Cargando tipos de material desde SAP IBP…</p>
  }

  if (!tipos?.length) {
    return <p className="mattype-empty">Carga datos primero para detectar los tipos de material.</p>
  }

  return (
    <>
      <table className="mattype-toggle-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Productos</th>
            <th>Incluir en análisis</th>
          </tr>
        </thead>
        <tbody>
          {tipos.map(({ tipo, productos, excluido }) => {
            const incluido = !excluido
            return (
              <tr key={tipo} className={incluido ? '' : 'mattype-row-excluded'}>
                <td><span className="mattype-code">{tipo}</span></td>
                {/* Sin separador de miles, como v7: «1500 prods». */}
                <td className="mattype-col-count">{productos || 0} prods</td>
                <td className="mattype-col-toggle">
                  <label className="mattype-toggle">
                    <input
                      type="checkbox"
                      checked={incluido}
                      onChange={(evento) => onCambiar(tipo, evento.target.checked)}
                    />
                    <span className="mattype-toggle-slider" />
                  </label>
                  <span className="mattype-toggle-label">{incluido ? 'Incluido' : 'Excluido'}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mattype-note">ℹ️ Los tipos excluidos que actúen como componentes PSI de productos incluidos se validan igualmente en contexto.</p>
    </>
  )
}
