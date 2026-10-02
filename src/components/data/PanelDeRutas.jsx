// Las rutas de la red: si lo que sale de cada planta llega a algún cliente.
//
// Portado del `vizRutasPanel` y del `vizFsRutasPanel` de `index.html` de v7 y de `vizRenderRutas`,
// `vizRutasSetTipo`, `vizRutasRenderTable` y `vizRutasCsv` de `visualizer.js`. El recorrido y la
// clasificación están en `core/ibp/supply-network.js` con sus pruebas; el texto, el filtro y el CSV,
// en `lib/rutas-de-red.js`. Aquí solo se dibuja.
//
// POR QUÉ NO BASTA EL DIBUJO: una planta huérfana —cuyo cien por cien de rutas muere sin llegar a
// nadie— tiene sus flechas como cualquier otra. Mirando el lienzo no se distingue. Esta tabla es lo
// que la señala, y es el hallazgo que más veces justifica abrir el visualizador.
//
// Hay DOS paneles con la misma información —el de debajo del lienzo y el de la pantalla completa— y
// comparten el filtro, que vive en quien los monta: lo que se filtra en uno se ve filtrado en el otro,
// como en v7. Cada uno tiene su propio «▶ Rutas / ▼ Rutas».

import { useMemo, useState } from 'react'

import { FINALES } from '../../../core/ibp/supply-network.js'
import {
  TOPE_DE_FILAS, filtrarRutas, notaDeTope, resumenDeRutas, rotuloDeRuta, rutaComoTexto, saltosDe,
  terminaEn,
} from '../../lib/rutas-de-red.js'

const TIPOS = [
  { id: 'todas', etiqueta: 'Todas' },
  { id: 'cliente', etiqueta: 'Con llegada a cliente' },
  { id: 'sinCliente', etiqueta: 'Sin llegada a cliente' },
]

const CAUSAS = [
  { id: 'todos', etiqueta: 'Todas' },
  { id: FINALES.sinSalida, etiqueta: 'Dead-end' },
  { id: FINALES.ciclo, etiqueta: 'Ciclo' },
]

/** Un botón del filtro: sin borde, el activo en negrita y con el color del acento. */
function BotonDeFiltro({ activo, onClick, children }) {
  return (
    <button
      type="button"
      className={`nv-rutas-filtro${activo ? ' activo' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * `analisis` es lo que devuelve `rutasDeLaRed`. `filtro` es `{ tipo, final, q }` y `onFiltro` recibe
 * lo que cambia. `onResaltar(indice)` resalta la ruta en el grafo; `onExportar` baja el CSV.
 */
export default function PanelDeRutas({
  analisis, filtro, onFiltro, onResaltar, onExportar, variante = 'pagina',
}) {
  const [abierto, setAbierto] = useState(false)

  const { rutas, truncado, plantasHuerfanas } = analisis
  const resumen = useMemo(
    () => resumenDeRutas({ rutas, truncado, plantasHuerfanas }),
    [rutas, truncado, plantasHuerfanas],
  )
  const filtradas = useMemo(() => filtrarRutas(rutas, filtro), [rutas, filtro])

  const mostradas = filtradas.slice(0, TOPE_DE_FILAS)
  const nota = notaDeTope(filtradas.length)

  return (
    <div className={`nv-rutas${variante === 'pantalla' ? ' nv-rutas--pantalla' : ''}`}>
      <div className="nv-rutas-cabecera">
        <div className="nv-rutas-resumen">
          <button type="button" className="nv-rutas-boton" onClick={() => setAbierto(!abierto)}>
            {abierto ? '▼ Rutas' : '▶ Rutas'}
          </button>
          <span className="nv-rutas-texto">{resumen}</span>
        </div>
        {rutas.length > 0 && (
          <button type="button" className="btn btn-secondary btn-small" style={{ fontSize: 11 }} onClick={onExportar}>
            ↓ Exportar CSV
          </button>
        )}
      </div>

      {abierto && (
        <div className="nv-rutas-cuerpo">
          <div className="nv-rutas-filtros">
            <span className="nv-rutas-rotulo">Tipo:</span>
            {TIPOS.map((uno) => (
              <BotonDeFiltro
                key={uno.id}
                activo={filtro.tipo === uno.id}
                // El filtro de causa solo aplica dentro de «Sin llegada a cliente»: al salir se limpia.
                onClick={() => onFiltro(uno.id === 'sinCliente'
                  ? { tipo: uno.id }
                  : { tipo: uno.id, final: 'todos' })}
              >
                {uno.etiqueta}
              </BotonDeFiltro>
            ))}
            {filtro.tipo === 'sinCliente' && (
              <span className="nv-rutas-causa">
                <span className="nv-rutas-rotulo chico">Causa:</span>
                {CAUSAS.map((uno) => (
                  <BotonDeFiltro
                    key={uno.id}
                    activo={filtro.final === uno.id}
                    onClick={() => onFiltro({ final: uno.id })}
                  >
                    {uno.etiqueta}
                  </BotonDeFiltro>
                ))}
              </span>
            )}
            <input
              className="nv-rutas-buscar"
              type="text"
              value={filtro.q}
              onChange={(evento) => onFiltro({ q: evento.target.value })}
              placeholder="Buscar planta, nodo final o cliente…"
              aria-label="Buscar en las rutas"
            />
          </div>

          <div className="nv-rutas-tabla">
            {filtradas.length === 0 ? (
              <p className="nv-rutas-vacio">
                {rutas.length > 0
                  ? 'Sin rutas que coincidan con el filtro.'
                  : 'No hay rutas configuradas para este producto.'}
              </p>
            ) : (
              <>
                {nota && <p className="nv-rutas-nota">{nota}</p>}
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tipo</th>
                      <th>Ruta</th>
                      <th>Termina en</th>
                      <th className="der">Saltos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mostradas.map(({ ruta, indice }, i) => {
                      const rotulo = rotuloDeRuta(ruta)
                      return (
                        <tr
                          key={indice}
                          className={i % 2 === 0 ? 'par' : 'impar'}
                          onClick={() => onResaltar(indice)}
                          title="Click para resaltar en el grafo"
                        >
                          <td className="num">{i + 1}</td>
                          <td><span style={{ color: rotulo.color, fontWeight: 600 }}>{rotulo.texto}</span></td>
                          <td className="mono">{rutaComoTexto(ruta)}</td>
                          <td
                            className="mono"
                            style={ruta.llegaACliente
                              ? { color: 'var(--green)' }
                              : { color: '#F59E0B', fontWeight: 600 }}
                          >
                            {terminaEn(ruta)}
                          </td>
                          <td className="der num">{saltosDe(ruta)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
