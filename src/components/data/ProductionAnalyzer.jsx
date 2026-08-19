// Calidad de datos de la jerarquía y de la red: qué productos están mal armados y por qué.
//
// Portado de `prodAnalyzer.js` y `analyzer.js` de v7. Las reglas están en
// `core/ibp/production-rules.js`, el juicio en `production-analysis.js` y `network-analysis.js`, y el
// cruce de datos en `src/lib/production-analyze.js` y `network-analyze.js`.
//
// La pantalla tiene tres partes y ese orden no es casual:
//
//   1. DECIR QUÉ ES CADA TIPO DE MATERIAL. Sin esto ningún informe vale: exigirle una receta a una
//      materia prima da miles de errores falsos, y no exigírsela a un producto terminado deja pasar el
//      error de verdad. Los tipos son del cliente, así que esto lo dice el consultor una vez y se
//      guarda por área de planificación.
//   2. EL INFORME DE LA JERARQUÍA: si cada material tiene lo que necesita para planificarse.
//   3. EL INFORME DE LA RED: si lo que se fabrica llega a alguien.
//   4. LOS MISMOS PROBLEMAS POR UBICACIÓN Y POR RECURSO: los dos de arriba contestan «¿a este material
//      le falta algo?»; estos contestan «¿esta planta está bien montada?» y «¿esta máquina está de
//      verdad en el plan?». Es la misma información agrupada por la entidad de la que alguien es
//      dueño, que es la que se puede llevar a una reunión.
//
// La clasificación se hace UNA vez y sirve para los cuatro. v7 tenía dos pantallas y pedía clasificar
// dos veces, con lo que las dos podían acabar diciendo cosas distintas del mismo material.

import { useEffect, useMemo, useState } from 'react'

import { COLUMNAS as COLUMNAS_JERARQUIA } from '../../../core/ibp/production-analysis.js'
import { COLUMNAS as COLUMNAS_RED } from '../../../core/ibp/network-analysis.js'
import { CATEGORIAS, repartirTipos, sinClasificar } from '../../../core/ibp/production-rules.js'
import { COLUMNAS as COLUMNAS_UBICACION } from '../../../core/ibp/location-analysis.js'
import { COLUMNAS as COLUMNAS_RECURSO } from '../../../core/ibp/resource-analysis.js'
import { analizar, tiposDeMaterial } from '../../lib/production-analyze.js'
import { analizarRedes } from '../../lib/network-analyze.js'
import { analizar as analizarUbicaciones } from '../../lib/location-analyze.js'
import { analizar as analizarRecursos } from '../../lib/resource-analyze.js'
import InformeDeCalidad from './InformeDeCalidad.jsx'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

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
  const [jerarquia, setJerarquia] = useState(null)
  const [red, setRed] = useState(null)
  const [ubicaciones, setUbicaciones] = useState(null)
  const [recursos, setRecursos] = useState(null)

  useEffect(() => {
    let abandonado = false

    tiposDeMaterial()
      .then(({ cuenta: cuentas, configuracion: inicial }) => {
        if (abandonado) return
        setCuenta(cuentas)
        // Lo guardado manda, pero solo para los tipos que siguen existiendo en el tenant.
        const guardada = leerGuardada(area)
        if (!guardada) { setConfiguracion(inicial); return }

        const mezclada = {}
        for (const [tipo, suya] of Object.entries(inicial)) {
          mezclada[tipo] = guardada[tipo]
            ? {
              ...suya,
              excluido: Boolean(guardada[tipo].excluido),
              categorias: guardada[tipo].categorias ?? [],
            }
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

  /**
   * Corre los cuatro análisis.
   *
   * Van juntos porque los cuatro salen de la misma clasificación: dejar uno viejo mientras los otros
   * están nuevos es la forma de que dos pantallas digan cosas distintas del mismo material, que es
   * justo lo que le pasaba a v7 con sus dos analizadores separados.
   *
   * El de recursos no recibe la clasificación: sus tres comprobaciones no dependen del tipo de
   * material, sino de en qué tablas aparece la máquina.
   */
  async function correr() {
    setError('')
    setJerarquia(null)
    setRed(null)
    setUbicaciones(null)
    setRecursos(null)
    setAvance({ paso: 'productos', cual: 'jerarquía' })

    try {
      const uno = await analizar(configuracion, {
        onAvance: (cual) => setAvance({ ...cual, cual: 'jerarquía' }),
      })
      setJerarquia(uno)
      setPaso('jerarquia')

      const otro = await analizarRedes(configuracion, {
        onAvance: (cual) => setAvance({ ...cual, cual: 'red' }),
      })
      setRed(otro)

      const porUbicacion = await analizarUbicaciones(configuracion, {
        onAvance: (cual) => setAvance({ ...cual, cual: 'ubicaciones' }),
      })
      setUbicaciones(porUbicacion)

      // Los recursos dependen de dos tablas que son opcionales en la descarga. Si no están, se dice y
      // los otros tres informes siguen valiendo: parar los cuatro por esto sería desproporcionado.
      try {
        setRecursos(await analizarRecursos({
          onAvance: (cual) => setAvance({ ...cual, cual: 'recursos' }),
        }))
      } catch {
        setRecursos({ sinDatos: true })
      }
    } catch (fallo) {
      setError(fallo.message)
    } finally {
      setAvance(null)
    }
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
              materiales» y el de «Red de suministro»: estos análisis cruzan los dos.
            </div>
          )}
      </div>
    )
  }

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
          className={`tab${paso === 'jerarquia' ? ' active' : ''}`}
          onClick={() => setPaso('jerarquia')}
          disabled={!jerarquia}
        >
          2 · La jerarquía
        </button>
        <button
          type="button"
          className={`tab${paso === 'red' ? ' active' : ''}`}
          onClick={() => setPaso('red')}
          disabled={!red}
        >
          3 · La red
        </button>
        <button
          type="button"
          className={`tab${paso === 'ubicaciones' ? ' active' : ''}`}
          onClick={() => setPaso('ubicaciones')}
          disabled={!ubicaciones}
        >
          4 · Por ubicación
        </button>
        <button
          type="button"
          className={`tab${paso === 'recursos' ? ' active' : ''}`}
          onClick={() => setPaso('recursos')}
          disabled={!recursos}
        >
          5 · Por recurso
        </button>
      </div>

      {paso === 'tipos' && (
        <>
          <div className="notice notice-info">
            Un análisis que trate a todos los materiales igual no sirve: exigirle una receta a una
            materia prima da miles de errores falsos, y no exigírsela a un producto terminado deja pasar
            el de verdad. Decí qué es cada tipo <b>una vez</b> y queda guardado para esta área; sirve
            para los dos informes.
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
                : `Quedan ${faltanClasificar.length} tipos sin clasificar: `
                  + `${faltanClasificar.slice(0, 10).join(', ')}${faltanClasificar.length > 10 ? '…' : ''}.`}
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
                {avance.cual}:{' '}
                {avance.paso === 'analizando'
                  ? `juzgando ${numero(avance.hechos)} de ${numero(avance.total)}…`
                  : `leyendo ${avance.paso}…`}
              </span>
            )}
          </div>
        </>
      )}

      {paso === 'jerarquia' && jerarquia && (
        <InformeDeCalidad
          tabla="pa_product_web"
          columnas={COLUMNAS_JERARQUIA}
          resumen={jerarquia.resumen}
          analizados={jerarquia.analizados}
          excluidos={jerarquia.excluidos}
          nombre={['jerarquia', area]}
        />
      )}

      {paso === 'red' && red && (
        <InformeDeCalidad
          tabla="sn_product_web"
          columnas={COLUMNAS_RED}
          resumen={red.resumen}
          analizados={red.analizados}
          excluidos={red.excluidos}
          nombre={['red', area]}
        />
      )}

      {paso === 'ubicaciones' && ubicaciones && (
        <>
          <div className="notice notice-info">
            Los mismos problemas, agrupados por <b>ubicación</b>. El rol de cada una no se lee de ningún
            campo de SAP: se deduce de cómo se comporta —tener recetas la hace planta; mandar algo que
            el destino consume la hace proveedor; mandar algo que el destino NO consume la hace nodo de
            transferencia— y a cada rol se le exige lo suyo. Una ubicación puede tener varios roles a la
            vez, y entonces se le pide lo de cada uno.
          </div>
          <InformeDeCalidad
            tabla="pa_location_web"
            columnas={COLUMNAS_UBICACION}
            resumen={ubicaciones.resumen}
            analizados={ubicaciones.analizados}
            nombre={['ubicaciones', area]}
            tituloDeEstados="Roles deducidos"
          />
        </>
      )}

      {paso === 'recursos' && recursos && (
        recursos.sinDatos
          ? (
            <div className="notice notice-info">
              Para este informe hacen falta el <b>maestro de recursos</b> y <b>Recurso por ubicación</b>,
              que se bajan con el grupo «Árbol de materiales». Volvé a <b>Descargar</b> y corré ese grupo
              otra vez: son dos tablas chicas.
            </div>
          )
          : (
            <>
              <div className="notice notice-info">
                Un recurso vive en dos tablas que nadie mira juntas: la que dice qué máquinas{' '}
                <b>usan</b> las recetas y la que dice qué máquinas están <b>asignadas</b> a una planta.
                Estar en una y no en la otra da un plan que no se puede ejecutar —capacidad que no
                restringe, o capacidad que nunca se va a cargar— y SAP no lo avisa.
              </div>
              <InformeDeCalidad
                tabla="pa_resource_web"
                columnas={COLUMNAS_RECURSO}
                resumen={recursos.resumen}
                analizados={recursos.analizados}
                nombre={['recursos', area]}
              />
            </>
          )
      )}
    </div>
  )
}
