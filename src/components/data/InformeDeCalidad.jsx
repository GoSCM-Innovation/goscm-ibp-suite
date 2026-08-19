// Un informe de calidad: los contadores por gravedad, qué falla más, la tabla y el archivo.
//
// Lo comparten el informe de la jerarquía y el de la red porque son la misma pantalla con otras
// columnas: filtrar por gravedad, pasar páginas y bajarlo. Tenerlo dos veces habría sido copiar
// cuatrocientas líneas para cambiar un nombre de tabla.
//
// Las filas se leen de la base local por tramos, y el filtro por gravedad usa el índice: pedir «solo
// los errores» de un informe de nueve mil filas no recorre nada.

import { useCallback, useEffect, useState } from 'react'

import { filasACsv, MARCA_DE_CODIFICACION, nombreDeArchivo } from '../../../core/ibp/export-csv.js'
import { contar, leerTramo } from '../../lib/explorer-db.js'
import { descargarTexto } from '../../lib/descargar-csv.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Filas por página. */
const POR_PAGINA = 100

/** Filas por tramo al armar el archivo. */
const POR_TRAMO = 2000

/** Cómo se llama y se pinta cada gravedad. */
const SEVERIDAD = {
  red: { etiqueta: 'Error', icono: '🔴' },
  yel: { etiqueta: 'Aviso', icono: '🟡' },
  info: { etiqueta: 'Nota', icono: '🔵' },
  ok: { etiqueta: 'Bien', icono: '🟢' },
}

export default function InformeDeCalidad({ tabla, columnas, resumen, analizados, excluidos, nombre }) {
  const [severidad, setSeveridad] = useState('todas')
  const [pagina, setPagina] = useState(0)
  const [filas, setFilas] = useState([])
  const [total, setTotal] = useState(0)
  const [bajando, setBajando] = useState(false)

  const cargar = useCallback(async (cual, cualSeveridad) => {
    const rango = { desde: cual * POR_PAGINA, cuantos: POR_PAGINA }
    const opciones = cualSeveridad === 'todas'
      ? rango
      : { ...rango, indice: 'by_severity', valor: cualSeveridad }

    const [leidas, cuantas] = await Promise.all([
      leerTramo(tabla, opciones),
      cualSeveridad === 'todas'
        ? contar(tabla)
        : contar(tabla, { indice: 'by_severity', valor: cualSeveridad }),
    ])

    setFilas(leidas)
    setTotal(cuantas)
    setPagina(cual)
  }, [tabla])

  // Se abre por lo peor que haya: es lo que se viene a ver.
  //
  // Diferido para no encadenar renders: marcar el filtro y pedir la página en el cuerpo del efecto
  // hace que React vuelva a dibujar antes de terminar el que está haciendo.
  useEffect(() => {
    const id = setTimeout(() => {
      const primera = resumen.porSeveridad.red > 0 ? 'red'
        : resumen.porSeveridad.yel > 0 ? 'yel' : 'todas'
      setSeveridad(primera)
      cargar(0, primera)
    }, 0)
    return () => clearTimeout(id)
  }, [resumen, cargar])

  async function bajar() {
    setBajando(true)
    try {
      // Se lee por tramos y se arma el archivo: el informe entero no pasa por memoria de una.
      const todas = []
      for (let desde = 0; ; desde += POR_TRAMO) {
        const tramo = await leerTramo(tabla, severidad === 'todas'
          ? { desde, cuantos: POR_TRAMO }
          : { desde, cuantos: POR_TRAMO, indice: 'by_severity', valor: severidad })
        todas.push(...tramo)
        if (tramo.length < POR_TRAMO) break
      }

      const comoObjeto = todas.map((una) => Object.fromEntries(
        columnas.map((columna, indice) => [columna, una.c[indice]]),
      ))
      descargarTexto(
        MARCA_DE_CODIFICACION + filasACsv(columnas, comoObjeto),
        nombreDeArchivo([...nombre, severidad, todas.length]),
      )
    } finally {
      setBajando(false)
    }
  }

  const paginas = Math.ceil(total / POR_PAGINA)

  return (
    <>
      <div className="tablero">
        <div className="card">
          <div className="card-label">Cómo quedó</div>
          <div className="pa-conteo">
            {Object.entries(SEVERIDAD).map(([clave, cual]) => (
              <button
                key={clave}
                type="button"
                className={`pa-chip${severidad === clave ? ' active' : ''}`}
                onClick={() => { setSeveridad(clave); cargar(0, clave) }}
              >
                {cual.icono} {numero(resumen.porSeveridad[clave] ?? 0)} {cual.etiqueta}
              </button>
            ))}
            <button
              type="button"
              className={`pa-chip${severidad === 'todas' ? ' active' : ''}`}
              onClick={() => { setSeveridad('todas'); cargar(0, 'todas') }}
            >
              {numero(analizados)} todos
            </button>
          </div>
          {excluidos?.length > 0 && (
            <p className="exp-sub">Fuera del análisis: {excluidos.join(', ')}.</p>
          )}
          {resumen.porEstado?.length > 0 && (
            <>
              <div className="exp-sub" style={{ paddingTop: 8 }}>Estados de la red</div>
              <div className="pa-conteo">
                {resumen.porEstado.slice(0, 8).map(([estado, cuantos]) => (
                  <span className="tag" key={estado}>{numero(cuantos)} {estado}</span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Lo que convierte mil errores en una tarea concreta. */}
        <div className="card">
          <div className="card-label">Qué falla más</div>
          <ol className="pa-frecuentes">
            {resumen.masFrecuentes.slice(0, 7).map((uno) => (
              <li key={uno.texto}><b>{numero(uno.cuantos)}</b> {uno.texto}</li>
            ))}
          </ol>
          {resumen.masFrecuentes.length === 0 && (
            <p className="exp-sub">Ningún producto tiene problemas.</p>
          )}
        </div>
      </div>

      <div className="monitor-bar">
        <button type="button" className="btn btn-sm" onClick={bajar} disabled={total === 0 || bajando}>
          {bajando ? 'Armando el archivo…' : 'Descargar CSV'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => cargar(pagina - 1, severidad)}
          disabled={pagina === 0}
        >
          ‹ Anterior
        </button>
        <span className="page-hint">
          {numero(total)} filas
          {paginas > 1 && ` · página ${pagina + 1} de ${numero(paginas)}`}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => cargar(pagina + 1, severidad)}
          disabled={pagina + 1 >= paginas}
        >
          Siguiente ›
        </button>
      </div>

      <div className="table-scroll table-alta">
        <table className="table-dense">
          <thead>
            <tr>{columnas.map((una) => <th key={una}>{una}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.c.slice(0, 4).join('|')} className={`pa-${fila.s}`}>
                <td>{SEVERIDAD[fila.s]?.icono} {SEVERIDAD[fila.s]?.etiqueta}</td>
                {columnas.slice(1).map((columna, indice) => (
                  <td key={columna}>{fila.c[indice + 1]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filas.length === 0 && <div className="sin-datos">Ninguna fila con ese estado</div>}
      </div>
    </>
  )
}
