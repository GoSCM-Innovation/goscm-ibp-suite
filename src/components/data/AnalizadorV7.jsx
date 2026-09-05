// El acordeón de los dos analizadores de v7, de ① a ⑤.
//
// Portado de los paneles de `tab-pa` y `tab-network` de `index.html` de v7, y de `mattype-config.js`
// y `extraFields.js`. Los dos analizadores tenían EXACTAMENTE los mismos cinco pasos con los mismos
// textos y los mismos botones; en v7 estaban escritos dos veces, con identificadores distintos
// (`panelPAExclude` y `panelSNExclude`, `mattypeExcludeBody` y su gemelo…). Aquí es uno.
//
//   ① Mapeo de entidades            — contra qué tablas de este tenant
//   ② Excluir tipos de material     — opcional
//   ③ Categorizar tipos de material — opcional
//   ④ Campos adicionales            — opcional
//   ⑤ Ejecutar análisis
//
// Cada paso APARECE al confirmar el anterior. No se deshabilita ni se ve en gris: no está. Un botón
// deshabilitado invita a preguntarse qué falta; un paso que todavía no existe no se pregunta nada.
//
// La clasificación de los pasos ② y ③ es COMPARTIDA entre los dos analizadores, guardada por área.
// En v7 cada uno pedía la suya, y eso es cómo se llegaba a que los dos informes del mismo tenant
// dijeran cosas distintas del mismo material.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import PanelMapeo from './PanelMapeo.jsx'
import PasoPlegable from './PasoPlegable.jsx'
import ExplorerExtract from './ExplorerExtract.jsx'
import { CATEGORIAS, repartirTipos, sinClasificar } from '../../../core/ibp/production-rules.js'
import { EXTRACCIONES } from '../../../core/ibp/explorer-extract-plan.js'
import { tiposDeMaterial } from '../../lib/production-analyze.js'
import {
  guardarClasificacion,
  leerGuardada,
  mezclarClasificacion,
  restablecer,
  resumenDeCategorias,
  resumenDeExclusion,
  resumenDeExtras,
} from '../../lib/clasificacion-de-tipos.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/**
 * Qué tablas ofrece el paso ④ para cada grupo, y con qué nombre.
 *
 * Son las mismas siete y cinco de `EF_ENTITY_META` en `extraFields.js` de v7, nombradas por su tabla
 * del plan de extracción. El grupo y el papel NO se listan aquí: se sacan del propio plan, porque dos
 * de ellas —el maestro de productos y el de ubicaciones— pertenecen al grupo del árbol y sirven
 * también a la red, y escribir eso a mano en dos sitios es cómo se acaban desincronizando.
 */
const TABLAS_CON_EXTRAS = {
  arbol: ['bom_prd', 'bom_loc', 'bom_res', 'bom_resloc', 'bom_psh', 'bom_psi', 'bom_psr'],
  red: ['bom_prd', 'bom_loc', 'sn_cust_master', 'sn_loc', 'sn_cust'],
}

/** Cómo se llama cada tabla en el paso ④. Son los nombres de v7. */
const NOMBRE_DE_TABLA = {
  bom_prd: 'Product',
  bom_loc: 'Location',
  bom_res: 'Resource',
  bom_resloc: 'Resource Location',
  bom_psh: 'Prod Source Header',
  bom_psi: 'Prod Source Item',
  bom_psr: 'Prod Source Resource',
  sn_cust_master: 'Customer',
  sn_loc: 'Location Source',
  sn_cust: 'Customer Source',
}

export default function AnalizadorV7({
  area,
  destino,
  grupo,
  /** `(configuracion, { onAvance }) => resultados`. Lo pone cada analizador. */
  correr,
  /** Lo que se dibuja cuando hay resultados. */
  children,
  /** Qué se está analizando, para los textos de progreso: «la jerarquía», «la red». */
  queEs,
}) {
  const [mapeoAbierto, setMapeoAbierto] = useState(true)
  const [paso, setPaso] = useState(1)
  const [abierto, setAbierto] = useState(0)

  const [mapaMdt, setMapaMdt] = useState(null)
  const [configuracion, setConfiguracion] = useState(null)
  const [cuenta, setCuenta] = useState({})
  const [extras, setExtras] = useState({})

  const [error, setError] = useState('')
  const [avance, setAvance] = useState(null)
  // La descarga del paso ⑤. Su barra, su línea de estado y su registro sirven también al
  // análisis, igual que en v7.
  const descarga = useRef(null)
  const [resultados, setResultados] = useState(null)

  useEffect(() => {
    let abandonado = false

    tiposDeMaterial()
      .then(({ cuenta: cuentas, configuracion: inicial }) => {
        if (abandonado) return
        setCuenta(cuentas)
        setConfiguracion(mezclarClasificacion(inicial, leerGuardada(area)))
      })
      .catch(() => { if (!abandonado) setConfiguracion({}) })

    return () => { abandonado = true }
  }, [area])

  const reparto = useMemo(() => repartirTipos(configuracion), [configuracion])
  const faltanClasificar = useMemo(() => sinClasificar(configuracion), [configuracion])
  const tipos = useMemo(() => Object.keys(configuracion ?? {}).sort(), [configuracion])

  const guardar = useCallback((siguiente) => {
    guardarClasificacion(area, siguiente)
    setConfiguracion(siguiente)
  }, [area])

  function cambiar(tipo, cambio) {
    guardar({ ...configuracion, [tipo]: { ...configuracion[tipo], ...cambio } })
  }

  function alternarCategoria(tipo, categoria) {
    const suyas = configuracion[tipo]?.categorias ?? []
    cambiar(tipo, {
      categorias: suyas.includes(categoria)
        ? suyas.filter((una) => una !== categoria)
        : [...suyas, categoria],
    })
  }

  /** Abre el paso `n` y deja registrado que ya se llegó hasta ahí. */
  const irA = (n) => { setPaso((previo) => Math.max(previo, n)); setAbierto(n) }

  /**
   * «▶ Ejecutar análisis»: bajar y juzgar de un tirón, que es lo que hacía v7.
   *
   * En v7 este botón corría la fase 1 —traerse las tablas— y la fase 2 —juzgarlas— sin preguntar
   * nada en medio. Lo único distinto aquí es que lo ya descargado se reutiliza en vez de volver a
   * bajarlo: v7 no guardaba nada entre sesiones y no tenía esa opción.
   */
  async function ejecutar() {
    setError('')
    setResultados(null)
    setAvance({ paso: 'empezando' })
    try {
      // Si la descarga hacía falta y no pudo ni empezar, no se juzga: un informe salido de una base
      // vacía se lee igual de creíble que uno bueno. El porqué queda en la línea de estado.
      if ((await descarga.current?.bajarSiVacio()) === false) return

      descarga.current?.anotar('ok', 'Índices listos. Iniciando análisis...')
      descarga.current?.decir('info', 'Iniciando análisis...')
      descarga.current?.avanzar(0)

      setResultados(await correr(configuracion, {
        onAvance: (paso) => {
          setAvance(paso)
          descarga.current?.decir('info', paso.paso === 'analizando'
            ? `juzgando ${numero(paso.hechos)} de ${numero(paso.total)} de ${queEs}…`
            : `leyendo ${paso.paso ?? ''}…`)
          descarga.current?.avanzar(paso.total ? (paso.hechos / paso.total) * 100 : 35)
        },
      }))

      descarga.current?.avanzar(100)
      descarga.current?.decir('ok', 'Análisis completado.')
      descarga.current?.anotar('ok', 'Análisis completado.')
      setAbierto(0)
    } catch (fallo) {
      setError(fallo.message)
      descarga.current?.decir('err', `Error: ${fallo.message}`)
      descarga.current?.anotar('err', `Error: ${fallo.message}`)
    } finally {
      setAvance(null)
    }
  }

  const tablas = TABLAS_CON_EXTRAS[grupo] ?? []

  /** Los campos que esa tabla tiene EN ESTE TENANT, resueltos por el mapeo del paso ①. */
  const camposDe = (tabla) => {
    const paso = EXTRACCIONES.find((una) => una.tabla === tabla)
    const entidad = paso ? mapaMdt?.efectivo?.[paso.grupo]?.[paso.papel]?.entidad : null
    return entidad ? (mapaMdt?.campos?.[entidad] ?? []) : []
  }

  function alternarExtra(tabla, campo) {
    setExtras((previos) => {
      const suyos = previos[tabla] ?? []
      const siguientes = suyos.includes(campo)
        ? suyos.filter((uno) => uno !== campo)
        : [...suyos, campo]
      const salida = { ...previos }
      if (siguientes.length === 0) delete salida[tabla]
      else salida[tabla] = siguientes
      return salida
    })
  }

  return (
    <>
      {/* ── ① ─────────────────────────────────────────────────────────────────────────────────── */}
      <PanelMapeo
        grupo={grupo}
        destino={destino}
        abierto={mapeoAbierto}
        onAlternar={() => setMapeoAbierto((previo) => !previo)}
        onConfirmar={(efectivo, mapa) => {
          setMapaMdt({ efectivo, campos: mapa?.campos ?? {} })
          setMapeoAbierto(false)
          irA(2)
        }}
      />

      {error && <div className="notice notice-error">✕ {error}</div>}

      {configuracion === null && paso >= 2 && (
        <div className="page-hint">Leyendo los tipos de material de lo descargado…</div>
      )}

      {/* ── ② Excluir tipos de material ───────────────────────────────────────────────────────── */}
      <PasoPlegable
        numero="②"
        titulo="Excluir tipos de material"
        opcional
        oculto={paso < 2}
        resumen={resumenDeExclusion(configuracion)}
        onRestablecer={() => guardar(restablecer(configuracion, { excluidos: true, categorias: false }))}
        abierto={abierto === 2}
        onAlternar={() => setAbierto(abierto === 2 ? 0 : 2)}
      >
        <p className="panel-desc">
          Los tipos que se dejen fuera no se analizan y no aparecen en el informe. Sirve para los que
          no son materiales de verdad —embalajes de servicio, textos, tipos de prueba— y que, contados
          como si lo fueran, llenan el informe de hallazgos que nadie va a mirar.
        </p>

        {tipos.length === 0
          ? (
            <div className="notice notice-info">
              No hay maestro de productos descargado todavía. Se puede seguir: los tipos aparecen
              después de la descarga del paso ⑤.
            </div>
          )
          : (
            <div className="table-scroll table-alta">
              <table className="table-dense">
                <thead><tr><th>Tipo</th><th>Productos</th><th>Se analiza</th></tr></thead>
                <tbody>
                  {tipos.map((tipo) => (
                    <tr key={tipo} className={configuracion[tipo].excluido ? 'pa-excluido' : undefined}>
                      <td className="mono">{tipo}</td>
                      <td>{numero(cuenta[tipo])}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!configuracion[tipo].excluido}
                          onChange={(evento) => cambiar(tipo, { excluido: !evento.target.checked })}
                          aria-label={`Analizar ${tipo}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-small" onClick={() => irA(3)}>
            Continuar →
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => { setAbierto(0); setMapeoAbierto(true) }}
          >
            ← Volver al mapeo
          </button>
        </div>
      </PasoPlegable>

      {/* ── ③ Categorizar tipos de material ───────────────────────────────────────────────────── */}
      <PasoPlegable
        numero="③"
        titulo="Categorizar tipos de material"
        opcional
        oculto={paso < 3}
        resumen={resumenDeCategorias(configuracion)}
        onRestablecer={() => guardar(restablecer(configuracion, { excluidos: false, categorias: true }))}
        abierto={abierto === 3}
        onAlternar={() => setAbierto(abierto === 3 ? 0 : 3)}
      >
        <p className="panel-desc">
          Un análisis que trate a todos los materiales igual no sirve: exigirle una receta a una
          materia prima da miles de errores falsos, y no exigírsela a un producto terminado deja pasar
          el de verdad. Se dice una vez, queda guardado para esta área y lo usan los dos analizadores.
        </p>

        <div className="tablero" style={{ maxHeight: 220 }}>
          {CATEGORIAS.map((una) => (
            <div className="card" key={una.id}>
              <div className="card-label">{una.etiqueta}</div>
              <p className="exp-sub">{una.descripcion}</p>
              <ul className="pa-exige">{una.exige.map((que) => <li key={que}>{que}</li>)}</ul>
            </div>
          ))}
        </div>

        {tipos.length > 0 && (
          <div className="table-scroll table-alta">
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Productos</th>
                  {CATEGORIAS.map((una) => <th key={una.id}>{una.etiqueta}</th>)}
                </tr>
              </thead>
              <tbody>
                {tipos.filter((tipo) => !configuracion[tipo].excluido).map((tipo) => (
                  <tr key={tipo}>
                    <td className="mono">{tipo}</td>
                    <td>{numero(cuenta[tipo])}</td>
                    {CATEGORIAS.map((cat) => (
                      <td key={cat.id}>
                        <input
                          type="checkbox"
                          checked={(configuracion[tipo].categorias ?? []).includes(cat.id)}
                          onChange={() => alternarCategoria(tipo, cat.id)}
                          aria-label={`${tipo} es ${cat.etiqueta}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {faltanClasificar.length > 0 && (
          <div className="mattype-note">
            {faltanClasificar.length === 1
              ? `Queda 1 tipo sin clasificar: ${faltanClasificar[0]}.`
              : `Quedan ${faltanClasificar.length} tipos sin clasificar: `
                + `${faltanClasificar.slice(0, 10).join(', ')}${faltanClasificar.length > 10 ? '…' : ''}.`}
            {' '}Se van a analizar igual, pero lo que a otros les sería un error a ellos les sale como
            aviso: nadie ha dicho todavía qué son.
          </div>
        )}

        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-small" onClick={() => irA(4)}>
            Continuar →
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(2)}>
            ← Volver
          </button>
        </div>
      </PasoPlegable>

      {/* ── ④ Campos adicionales de datos maestros ────────────────────────────────────────────── */}
      <PasoPlegable
        numero="④"
        titulo="Campos adicionales de datos maestros"
        opcional
        oculto={paso < 4}
        resumen={resumenDeExtras(extras)}
        onRestablecer={() => setExtras({})}
        abierto={abierto === 4}
        onAlternar={() => setAbierto(abierto === 4 ? 0 : 4)}
      >
        <p className="panel-desc">
          Campos del maestro que el análisis no necesita pero que quien lee el informe quiere ver —el
          grupo de compras, una unidad alternativa, un campo Z del cliente—. Se piden en la descarga
          del paso ⑤, así que <b>elegirlos aquí obliga a volver a bajar</b> esas tablas.
        </p>

        {tablas.map((tabla) => {
          const campos = camposDe(tabla)
          const puestos = extras[tabla] ?? []
          return (
            <div className="card" key={tabla} style={{ marginBottom: 10 }}>
              <div className="card-label">
                {NOMBRE_DE_TABLA[tabla] ?? tabla}
                <span className="exp-sub">
                  {campos.length === 0
                    ? 'sin resolver en el paso ①'
                    : `${campos.length} campos · ${puestos.length} elegidos`}
                </span>
              </div>
              {campos.length > 0 && (
                <div className="ef-campos">
                  {campos.map((campo) => (
                    <label key={campo} className="ef-campo">
                      <input
                        type="checkbox"
                        checked={puestos.includes(campo)}
                        onChange={() => alternarExtra(tabla, campo)}
                      />
                      <span className="mono">{campo}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-small" onClick={() => irA(5)}>
            Continuar a ejecución →
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(3)}>
            ← Volver
          </button>
        </div>
      </PasoPlegable>

      {/* ── ⑤ Ejecutar análisis ───────────────────────────────────────────────────────────────── */}
      {paso >= 5 && (
        <div className="panel">
          <div className="panel-title">⑤ Ejecutar análisis</div>

          <div className="mattype-note">
            {reparto.dentro.length === 0 && reparto.fuera.length === 0
              ? 'Configuración por defecto — análisis estándar'
              : `${numero(reparto.dentro.length)} tipos dentro`
                + (reparto.fuera.length > 0 ? ` · ${numero(reparto.fuera.length)} excluidos` : '')}
            {Object.keys(extras).length > 0 && ` · ${resumenDeExtras(extras)}`}
          </div>

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={ejecutar}
              disabled={Boolean(avance)}
            >
              {avance ? 'Analizando…' : '▶ Ejecutar análisis'}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(4)}>
              ← Volver
            </button>
          </div>

          {/* Debajo de la fila de botones, como en v7. Y la barra, la línea de estado y los logs son
              LOS MISMOS para las dos fases —bajar y juzgar—: en `analyzer.js` eran un solo `progBarSN`,
              un solo `progStatusTextSN` y un solo `logSN`. Por eso el avance del análisis se escribe
              aquí en vez de dibujar una segunda barra debajo. */}
          <ExplorerExtract ref={descarga} destino={destino} gruposFijos={[grupo]} extras={extras} />
        </div>
      )}

      {resultados && children(resultados)}
    </>
  )
}
