// El analizador de la jerarquía de producción: qué productos están mal armados y por qué.
//
// Portado de `prodAnalyzer.js` de v7. Las reglas están en `core/ibp/production-rules.js`, el juicio en
// `core/ibp/production-analysis.js` y el cruce de datos en `src/lib/production-analyze.js`.
//
// La pantalla tiene dos partes y ese orden no es casual:
//
//   1. DECIR QUÉ ES CADA TIPO DE MATERIAL. Sin esto el informe no vale: exigirle una receta a una
//      materia prima da miles de errores falsos, y no exigírsela a un producto terminado deja pasar el
//      error de verdad. Los tipos son del cliente, así que esto lo dice el consultor una vez y se
//      guarda por área de planificación.
//   2. LEER EL INFORME. Filas ordenadas por gravedad, con el motivo escrito, y el resumen de qué falla
//      más — que es lo que convierte mil errores en una tarea concreta.
//
// El informe se guarda en la base local y se lee por tramos, como todo lo grande: nueve mil filas de
// dieciséis columnas caben en memoria, cien mil no.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { COLUMNAS } from '../../../core/ibp/production-analysis.js'
import {
  CATEGORIAS, repartirTipos, sinClasificar,
} from '../../../core/ibp/production-rules.js'
import { contar, leerTramo } from '../../lib/explorer-db.js'
import { analizar, tiposDeMaterial } from '../../lib/production-analyze.js'
import { descargarTexto } from '../../lib/descargar-csv.js'
import { filasACsv, MARCA_DE_CODIFICACION, nombreDeArchivo } from '../../../core/ibp/export-csv.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Filas por página del informe. */
const POR_PAGINA = 100

/** Cómo se llama y se pinta cada severidad. */
const SEVERIDAD = {
  red: { etiqueta: 'Error', icono: '🔴' },
  yel: { etiqueta: 'Aviso', icono: '🟡' },
  info: { etiqueta: 'Nota', icono: '🔵' },
  ok: { etiqueta: 'Bien', icono: '🟢' },
}

/** Dónde se guarda la clasificación. Por área, porque los tipos y su significado son de cada una. */
const claveGuardada = (area) => `mattype_${area || 'default'}`

function leerGuardada(area) {
  try {
    const crudo = localStorage.getItem(claveGuardada(area))
    return crudo ? JSON.parse(crudo) : null
  } catch {
    return null
  }
}

function guardarClasificacion(area, configuracion) {
  try {
    localStorage.setItem(claveGuardada(area), JSON.stringify(configuracion))
  } catch {
    // Que no se pueda guardar no invalida el análisis; solo habrá que clasificar otra vez.
  }
}

export default function ProductionAnalyzer({ area = '' }) {
  const [configuracion, setConfiguracion] = useState(null)
  const [cuenta, setCuenta] = useState({})
  const [error, setError] = useState('')

  const [paso, setPaso] = useState('tipos')
  const [avance, setAvance] = useState(null)
  const [salida, setSalida] = useState(null)

  const [severidad, setSeveridad] = useState('red')
  const [pagina, setPagina] = useState(0)
  const [filas, setFilas] = useState([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let abandonado = false

    tiposDeMaterial()
      .then(({ cuenta: cuentas, configuracion: inicial }) => {
        if (abandonado) return
        setCuenta(cuentas)
        // Lo guardado manda, pero solo para los tipos que siguen existiendo.
        const guardada = leerGuardada(area)
        if (!guardada) { setConfiguracion(inicial); return }

        const mezclada = {}
        for (const [tipo, suya] of Object.entries(inicial)) {
          mezclada[tipo] = guardada[tipo]
            ? { ...suya, excluido: Boolean(guardada[tipo].excluido), categorias: guardada[tipo].categorias ?? [] }
            : suya
        }
        setConfiguracion(mezclada)
      })
      .catch((fallo) => { if (!abandonado) { setError(fallo.message); setConfiguracion({}) } })

    return () => { abandonado = true }
  }, [area])

  const reparto = useMemo(() => repartirTipos(configuracion), [configuracion])
  const faltanClasificar = useMemo(() => sinClasificar(configuracion), [configuracion])

  function cambiar(tipo, cambio) {
    setConfiguracion((previa) => {
      const siguiente = { ...previa, [tipo]: { ...previa[tipo], ...cambio } }
      guardarClasificacion(area, siguiente)
      return siguiente
    })
  }

  function alternarCategoria(tipo, categoria) {
    const suyas = configuracion[tipo]?.categorias ?? []
    cambiar(tipo, {
      categorias: suyas.includes(categoria)
        ? suyas.filter((una) => una !== categoria)
        : [...suyas, categoria],
    })
  }

  const cargarPagina = useCallback(async (cual, cualSeveridad) => {
    const opciones = cualSeveridad === 'todas'
      ? { desde: cual * POR_PAGINA, cuantos: POR_PAGINA }
      : { desde: cual * POR_PAGINA, cuantos: POR_PAGINA, indice: 'by_severity', valor: cualSeveridad }

    const [leidas, cuantas] = await Promise.all([
      leerTramo('pa_product_web', opciones),
      cualSeveridad === 'todas'
        ? contar('pa_product_web')
        : contar('pa_product_web', { indice: 'by_severity', valor: cualSeveridad }),
    ])

    setFilas(leidas)
    setTotal(cuantas)
    setPagina(cual)
  }, [])

  async function correr() {
    setError('')
    setSalida(null)
    setAvance({ paso: 'productos' })

    try {
      const hecho = await analizar(configuracion, { onAvance: setAvance })
      setSalida(hecho)
      setPaso('informe')
      // Se abre por los errores: es lo que se viene a ver.
      const primera = hecho.resumen.porSeveridad.red > 0 ? 'red'
        : hecho.resumen.porSeveridad.yel > 0 ? 'yel' : 'todas'
      setSeveridad(primera)
      await cargarPagina(0, primera)
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setAvance(null)
    }
  }

  async function bajarInforme() {
    // Se lee de la base por tramos y se arma el archivo: el informe entero no pasa por memoria de una.
    const todas = []
    for (let desde = 0; ; desde += 2000) {
      const tramo = await leerTramo('pa_product_web', severidad === 'todas'
        ? { desde, cuantos: 2000 }
        : { desde, cuantos: 2000, indice: 'by_severity', valor: severidad })
      todas.push(...tramo)
      if (tramo.length < 2000) break
    }

    const comoObjeto = todas.map((una) => Object.fromEntries(COLUMNAS.map((col, i) => [col, una.c[i]])))
    const texto = MARCA_DE_CODIFICACION + filasACsv(COLUMNAS, comoObjeto)
    descargarTexto(texto, nombreDeArchivo(['jerarquia', area, severidad, todas.length]))
  }

  if (configuracion === null) return <div className="page-hint">Leyendo los tipos de material…</div>

  if (Object.keys(configuracion).length === 0) {
    return (
      <div className="module-body">
        {error
          ? <div className="notice notice-error">✕ {error}</div>
          : (
            <div className="notice notice-info">
              No hay maestro de productos descargado. Andá a <b>Descargar</b> y bajá el grupo «Árbol de
              materiales» y el de «Red de suministro»: este análisis cruza los dos.
            </div>
          )}
      </div>
    )
  }

  const paginas = Math.ceil(total / POR_PAGINA)

  return (
    <div className="module-body">
      {error && <div className="notice notice-error">✕ {error}</div>}

      <div className="tabs">
        <button
          type="button"
          className={`tab${paso === 'tipos' ? ' active' : ''}`}
          onClick={() => setPaso('tipos')}
        >
          1 · Qué es cada tipo de material
        </button>
        <button
          type="button"
          className={`tab${paso === 'informe' ? ' active' : ''}`}
          onClick={() => setPaso('informe')}
          disabled={!salida}
        >
          2 · El informe
        </button>
      </div>

      {paso === 'tipos' && (
        <>
          <div className="notice notice-info">
            Un análisis que trate a todos los materiales igual no sirve: exigirle una receta a una
            materia prima da miles de errores falsos, y no exigírsela a un producto terminado deja pasar
            el de verdad. Decí qué es cada tipo <b>una vez</b> y queda guardado para esta área.
          </div>

          <div className="tablero">
            {CATEGORIAS.map((una) => (
              <div className="card" key={una.id}>
                <div className="card-label">{una.etiqueta}</div>
                <p className="exp-sub">{una.descripcion}</p>
                <ul className="pa-exige">
                  {una.exige.map((que) => <li key={que}>{que}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Productos</th>
                  <th>Se analiza</th>
                  {CATEGORIAS.map((una) => <th key={una.id}>{una.etiqueta}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.keys(configuracion).sort().map((tipo) => {
                  const suya = configuracion[tipo]
                  return (
                    <tr key={tipo} className={suya.excluido ? 'pa-excluido' : undefined}>
                      <td className="mono">{tipo}</td>
                      <td>{numero(cuenta[tipo])}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!suya.excluido}
                          onChange={(evento) => cambiar(tipo, { excluido: !evento.target.checked })}
                          aria-label={`Analizar ${tipo}`}
                        />
                      </td>
                      {CATEGORIAS.map((cat) => (
                        <td key={cat.id}>
                          <input
                            type="checkbox"
                            checked={(suya.categorias ?? []).includes(cat.id)}
                            onChange={() => alternarCategoria(tipo, cat.id)}
                            disabled={suya.excluido}
                            aria-label={`${tipo} es ${cat.etiqueta}`}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {faltanClasificar.length > 0 && (
            <div className="notice notice-info">
              {faltanClasificar.length === 1
                ? `Queda 1 tipo sin clasificar: ${faltanClasificar[0]}.`
                : `Quedan ${faltanClasificar.length} tipos sin clasificar: ${faltanClasificar.slice(0, 10).join(', ')}${faltanClasificar.length > 10 ? '…' : ''}.`}
              {' '}Se van a analizar igual, pero lo que a otros les sería un error a ellos les sale como
              aviso: nadie ha dicho todavía qué son.
            </div>
          )}

          <div className="monitor-bar">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={correr}
              disabled={Boolean(avance) || reparto.dentro.length === 0}
            >
              {avance ? 'Analizando…' : 'Analizar'}
            </button>
            <span className="page-hint">
              {numero(reparto.dentro.length)} tipos dentro
              {reparto.fuera.length > 0 && ` · ${numero(reparto.fuera.length)} excluidos`}
            </span>
            {avance && (
              <span className="page-hint">
                {avance.paso === 'analizando'
                  ? `Juzgando ${numero(avance.hechos)} de ${numero(avance.total)}…`
                  : `Leyendo ${avance.paso}…`}
              </span>
            )}
          </div>
        </>
      )}

      {paso === 'informe' && salida && (
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
                    onClick={() => { setSeveridad(clave); cargarPagina(0, clave) }}
                  >
                    {cual.icono} {numero(salida.resumen.porSeveridad[clave])} {cual.etiqueta}
                  </button>
                ))}
                <button
                  type="button"
                  className={`pa-chip${severidad === 'todas' ? ' active' : ''}`}
                  onClick={() => { setSeveridad('todas'); cargarPagina(0, 'todas') }}
                >
                  {numero(salida.analizados)} todos
                </button>
              </div>
              {salida.excluidos.length > 0 && (
                <p className="exp-sub">
                  Fuera del análisis: {salida.excluidos.join(', ')}.
                </p>
              )}
            </div>

            {/* Lo que convierte mil errores en una tarea concreta. */}
            <div className="card">
              <div className="card-label">Qué falla más</div>
              <ol className="pa-frecuentes">
                {salida.resumen.masFrecuentes.slice(0, 6).map((uno) => (
                  <li key={uno.comprobacion}>
                    <b>{numero(uno.cuantos)}</b> {uno.texto}
                  </li>
                ))}
              </ol>
              {salida.resumen.masFrecuentes.length === 0 && (
                <p className="exp-sub">Ningún producto tiene problemas.</p>
              )}
            </div>
          </div>

          <div className="monitor-bar">
            <button type="button" className="btn btn-sm" onClick={bajarInforme} disabled={total === 0}>
              Descargar CSV
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => cargarPagina(pagina - 1, severidad)}
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
              onClick={() => cargarPagina(pagina + 1, severidad)}
              disabled={pagina + 1 >= paginas}
            >
              Siguiente ›
            </button>
          </div>

          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr>{COLUMNAS.map((una) => <th key={una}>{una}</th>)}</tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.c[2]} className={`pa-${fila.s}`}>
                    <td>{SEVERIDAD[fila.s]?.icono} {SEVERIDAD[fila.s]?.etiqueta}</td>
                    {COLUMNAS.slice(1).map((columna, indice) => (
                      <td key={columna}>{fila.c[indice + 1]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {filas.length === 0 && <div className="sin-datos">Ninguna fila con ese estado</div>}
          </div>
        </>
      )}
    </div>
  )
}
