// Bajar el dato maestro del tenant a la base local, viendo qué pasa.
//
// Portada de las dos descargas de v7 —la del árbol (`doFetchAll` de `main.js`) y la fase 1 de los
// analizadores (`analyzer.js`, `prodAnalyzer.js`)—, que eran la misma cosa con distintas etiquetas.
//
// TIENE LA FORMA DE v7, que son tres cosas y ninguna más:
//
//   ① una BARRA de progreso que se va llenando,
//   ② una LÍNEA DE ESTADO con color —«Descargando Production Source Header...»—, y
//   ③ un botón «Ver logs técnicos» que abre el registro de ESTA descarga.
//
// Y va DENTRO del panel que la dispara, debajo de su fila de botones. En v7 la descarga no era una
// pantalla: era lo que pasaba al pulsar «Descargar datos y construir jerarquía» en el paso ① del
// árbol, o «▶ Ejecutar análisis» en el paso ⑤ de un analizador. Por eso este componente NO tiene
// botón propio —lo pone quien lo monta— y se dispara por su `ref`.
//
// Aquí hubo un panel aparte con una tabla de «qué se baja», que v7 no tenía. Lo que esa tabla decía
// —contra qué tabla del tenant resolvió cada papel, cuántas filas descartó SAP, y si faltan filas—
// no se perdió: vive en el registro, con el formato de v7. Ver `lib/registro-de-descarga.js`.

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { planificarExtraccion } from '../../../core/ibp/explorer-extract-plan.js'
import { fetchExplorerMap } from '../../lib/ibp-explorer.js'
import { extraer } from '../../lib/explorer-extract.js'
import {
  PREPARANDO,
  descargando,
  estadoAlTerminar,
  horaDe,
  linea,
  lineaDePeticion,
  lineasDeTabla,
} from '../../lib/registro-de-descarga.js'

/** El color de la línea de estado según el tipo. Son los de `setStatus` de v7, literales. */
const COLOR = {
  ok: 'var(--accent)',
  err: 'var(--red)',
  warn: 'var(--amber)',
  info: 'var(--text2)',
}

export default function ExplorerExtract({
  destino,
  gruposFijos = null,
  extras = null,
  /**
   * Para los módulos que bajan un subconjunto propio: `tablas` es la lista ordenada de lo que se baja
   * (manda sobre `gruposFijos`), `camposMas` son campos canónicos extra por tabla, y `requeridas` las
   * tablas sin las cuales no se empieza. Lo usa el Production Analyzer: v7 bajaba diez tablas de dos
   * grupos y se negaba a correr si faltaban la cabecera, los componentes, los sustitutos o los arcos.
   */
  tablas = null,
  camposMas = null,
  /**
   * La lista EXACTA de campos canónicos de cada tabla, si el módulo pide justo los de v7 y nada más
   * (`{ bom_prd: ['PRDID', 'PRDDESCR', 'MATTYPEID'] }`). Manda sobre los del plan y sobre `camposMas`.
   */
  solo = null,
  /**
   * Ajusta lo que el mapeo resolvió antes de planificar: `(efectivo) → efectivo`. Lo usa el Network
   * Analyzer, cuyas tarjetas «Product» y «Location» editan los maestros del grupo de la RED y el plan los
   * lee del árbol.
   */
  ajustarEfectivo = null,
  requeridas = null,
  /**
   * Cómo habla este módulo mientras baja, si no es como el árbol:
   * `{ estado(paso) → { texto, pct? }, lineas({ plan, salida, destino, inicio, tiempos }) → líneas,
   *    alFaltar(pasos) → texto }`.
   * Sin esto se usan los textos del árbol de v7 (`registro-de-descarga.js`).
   */
  formato = null,
  /** v7 no tenía botón «Cancelar» en los analizadores: la descarga corre hasta el final. */
  sinCancelar = false,
  onTerminada = null,
  ref = null,
}) {
  const [estado, setEstado] = useState(null)
  const [registro, setRegistro] = useState([])
  const [logsAbiertos, setLogsAbiertos] = useState(false)
  const [porcentaje, setPorcentaje] = useState(0)
  const [bajando, setBajando] = useState(false)

  // Una ref y no estado: el bucle de descarga la consulta en cada página, y con estado leería el
  // valor que tenía cuando arrancó.
  const cancelar = useRef(false)

  /**
   * El catálogo del tenant, pedido UNA vez por destino.
   *
   * En una ref y no en estado porque quien dispara la descarga puede pulsar antes de que termine de
   * cargar, y entonces hay que esperar a la misma petición y no lanzar otra.
   */
  const pedido = useRef({ destino: null, promesa: null })

  const pedirMapa = useCallback(() => {
    if (pedido.current.destino !== destino) {
      pedido.current = { destino, promesa: fetchExplorerMap(destino) }
    }
    return pedido.current.promesa
  }, [destino])

  // Se pide al montar para que esté listo cuando pulsen, no para enseñar nada: mientras carga, la
  // pantalla no dice nada — igual que v7, donde el paso ① no anunciaba la descarga hasta dispararla.
  useEffect(() => { pedirMapa().catch(() => {}) }, [pedirMapa])

  const decir = useCallback((tipo, texto) => setEstado({ tipo, texto }), [])
  const anotar = useCallback(
    (clase, texto) => setRegistro((previas) => [...previas, linea(clase, texto)]),
    [],
  )

  /** Las tablas imprescindibles que este tenant no puede dar. */
  const tablasQueFaltan = useCallback(
    (plan) => plan.pasos.filter((uno) => !uno.sePuede && (requeridas ?? []).includes(uno.tabla)),
    [requeridas],
  )
  const textoDeLoQueFalta = useCallback(
    (faltan) => formato?.alFaltar?.(faltan) ?? 'Falta alguna tabla imprescindible. Revisa el mapeo de entidades.',
    [formato],
  )

  /**
   * ¿Se puede correr con este mapeo? Sin bajar nada.
   *
   * Es lo que v7 hacía ANTES de preguntar cómo se quería ver el análisis: si falta algo, el error sale
   * enseguida y no después de elegir y esperar. Devuelve `true` si se puede seguir; si no, deja el
   * motivo en la línea de estado y en el registro.
   */
  const validar = useCallback(async () => {
    let leido
    try {
      leido = await pedirMapa()
    } catch (fallo) {
      decir('err', `Error: ${fallo.message}`)
      anotar('err', `Error leyendo el catálogo del tenant: ${fallo.message}`)
      return false
    }
    const plan = planificarExtraccion({
      efectivo: ajustarEfectivo ? ajustarEfectivo(leido.efectivo) : leido.efectivo,
      mapa: leido.guardado.fields,
      grupos: gruposFijos ?? ['arbol', 'red'],
      extras: extras ?? {},
      tablas,
      mas: camposMas ?? {},
      solo: solo ?? {},
    })
    const faltan = tablasQueFaltan(plan)
    if (faltan.length === 0) return true

    const texto = textoDeLoQueFalta(faltan)
    setRegistro([...plan.avisos.map((aviso) => linea('warn', aviso)), linea('err', texto)])
    setLogsAbiertos(true)
    decir('err', texto)
    return false
  }, [pedirMapa, gruposFijos, extras, tablas, camposMas, solo, ajustarEfectivo, tablasQueFaltan, textoDeLoQueFalta, decir, anotar])

  /**
   * Baja lo que dice el plan, contando el avance como lo contaba v7.
   *
   * Devuelve el resultado de la descarga, o `null` si no se pudo ni empezar. Quien la dispara lo
   * necesita: el árbol tiene que releer la base y el analizador tiene que juzgar lo bajado.
   */
  const bajar = useCallback(async () => {
    if (bajando) return null

    cancelar.current = false
    setBajando(true)
    setRegistro([])
    setPorcentaje(0)
    decir('info', PREPARANDO)

    let leido
    try {
      leido = await pedirMapa()
    } catch (fallo) {
      decir('err', `Error: ${fallo.message}`)
      anotar('err', `Error leyendo el catálogo del tenant: ${fallo.message}`)
      setBajando(false)
      return null
    }

    const plan = planificarExtraccion({
      efectivo: ajustarEfectivo ? ajustarEfectivo(leido.efectivo) : leido.efectivo,
      mapa: leido.guardado.fields,
      grupos: gruposFijos ?? ['arbol', 'red'],
      extras: extras ?? {},
      tablas,
      mas: camposMas ?? {},
      solo: solo ?? {},
    })

    // Las tablas sin las que v7 no corría. Se comprueba ANTES de bajar nada: bajar nueve tablas para
    // enterarse de que falta la décima es hacer esperar al consultor por un informe que no va a salir.
    const faltan = tablasQueFaltan(plan)
    if (faltan.length > 0) {
      const texto = textoDeLoQueFalta(faltan)
      setRegistro([
        ...plan.avisos.map((aviso) => linea('warn', aviso)),
        linea('err', texto),
      ])
      setLogsAbiertos(true)
      decir('err', texto)
      setBajando(false)
      return null
    }

    // Lo que no se va a poder, ANTES de bajar nada. Es lo que v7 hacía con su panel de corrección:
    // enterarse a los seis minutos de que falta la tabla principal, después de bajar tres que no
    // sirven sin ella, es la diferencia entre una herramienta y un castigo.
    const previas = plan.avisos.map((aviso) => linea('warn', aviso))
    if (plan.gruposPosibles.length === 0) {
      setRegistro([...previas, linea('err', 'No se puede bajar nada: falta alguna tabla imprescindible.')])
      setLogsAbiertos(true)
      decir('err', 'Falta alguna tabla imprescindible. Revisa el mapeo de entidades.')
      setBajando(false)
      return null
    }
    setRegistro(previas)

    const pasosQueVan = plan.pasos.filter((uno) => uno.sePuede)
    const inicio = Date.now()
    // Cuándo llegó la última página de cada tabla: es lo que v7 escribía como `[+1234ms]` delante de
    // cada línea del registro, y el registro se arma al final.
    const tiempos = new Map()

    try {
      const salida = await extraer({
        conexionId: destino.connectionId,
        destino,
        plan,
        mapa: leido.guardado.fields,
        // La barra avanza MIENTRAS se baja, como la de v7, y no de golpe al final: una barra quieta
        // durante seis minutos y luego llena de un salto no informa de nada.
        onProgreso: (paso) => {
          tiempos.set(paso.tabla, Date.now() - inicio)
          const cual = pasosQueVan.findIndex((uno) => uno.tabla === paso.tabla)
          const propio = formato?.estado?.(paso)
          if (propio?.pct !== undefined) setPorcentaje(propio.pct)
          else if (cual >= 0) setPorcentaje(Math.round((cual / pasosQueVan.length) * 100))
          // Sin contador de filas: v7 decía solo «Descargando Production Source Header...».
          decir('info', propio ? propio.texto : descargando(paso))
        },
        cancelado: () => cancelar.current,
      })

      // El registro se arma al final y no paso a paso porque `extraer` no avisa de cada tabla
      // terminada: avisa de cada PÁGINA. Las líneas salen de lo que devolvió, que es lo mismo que
      // v7 escribía justo después de cada `fetchAndIndex`.
      let lineas = []
      if (formato?.lineas) {
        lineas = await formato.lineas({ plan, salida, destino, inicio, tiempos })
      } else {
        for (const paso of plan.pasos) {
          const suyo = salida.hechos.find((uno) => uno.tabla === paso.tabla)
          if (paso.sePuede) lineas.push(lineaDePeticion(paso, destino))
          lineas.push(...lineasDeTabla(paso, suyo))
        }
      }
      setRegistro((antes) => [...antes, ...lineas])

      if (salida.seVacio) anotar('warn', 'Se borró lo que había guardado de otro tenant, área o versión.')

      setPorcentaje(100)
      const final = estadoAlTerminar(salida)
      decir(final.tipo, final.texto)
      // Un final que no es limpio se enseña abierto: si hay que mirarlo, que no haya que buscarlo.
      if (final.tipo !== 'ok') setLogsAbiertos(true)

      onTerminada?.(salida)
      return salida
    } catch (fallo) {
      decir('err', `Error: ${fallo.message}`)
      anotar('err', `Error: ${fallo.message}`)
      setLogsAbiertos(true)
      return null
    } finally {
      setBajando(false)
    }
  }, [bajando, pedirMapa, gruposFijos, extras, tablas, camposMas, solo, ajustarEfectivo, tablasQueFaltan, textoDeLoQueFalta, formato, destino, decir, anotar, onTerminada])

  // Lo que se puede pedir desde fuera. `decir`, `anotar` y `avanzar` están porque en v7 `setStatus`,
  // `log` y `setProgress` eran globales y las llamaba quien quisiera: la barra, la línea y el
  // registro del paso ⑤ de un analizador servían a las DOS fases —bajar y juzgar—, no solo a la
  // descarga. El árbol las usa para «✓ N productos en caché local».
  useImperativeHandle(ref, () => ({
    bajar,
    validar,
    decir,
    anotar,
    avanzar: (pct) => setPorcentaje(Math.max(0, Math.min(100, Math.round(pct)))),
    cancelar: () => { cancelar.current = true },
  }), [bajar, validar, decir, anotar])

  // Hasta que se dispara no hay nada que enseñar. En v7 la barra, el estado y los logs estaban
  // ocultos hasta que `doFetchAll` los mostraba.
  if (!estado) return null

  return (
    <ProgresoDeDescarga
      estado={estado}
      porcentaje={porcentaje}
      bajando={bajando}
      registro={registro}
      logsAbiertos={logsAbiertos}
      onAlternarLogs={() => setLogsAbiertos((previo) => !previo)}
      onCancelar={sinCancelar ? null : () => { cancelar.current = true }}
    />
  )
}

/**
 * Las tres cosas de v7 y nada más: la barra, la línea de estado y el registro plegado.
 *
 * Está aparte de la descarga para poder dibujarla con datos de muestra y verla sin un tenant
 * delante. Es lo único de todo esto que las pruebas no pueden juzgar: que se vea bien.
 */
export function ProgresoDeDescarga({
  estado, porcentaje, bajando, registro, logsAbiertos, onAlternarLogs, onCancelar,
}) {
  return (
    <>
      <div className="progress-bar">
        <div className="fill" style={{ width: `${porcentaje}%` }} />
      </div>

      <div className="prog-estado">
        <span style={{ color: COLOR[estado.tipo] ?? COLOR.info }}>{estado.texto}</span>

        {bajando && onCancelar && (
          <button type="button" className="btn btn-secondary btn-small" onClick={onCancelar}>
            Cancelar
          </button>
        )}

        <button
          type="button"
          className="btn btn-secondary btn-small prog-logs-btn"
          onClick={onAlternarLogs}
          aria-expanded={logsAbiertos}
        >
          {logsAbiertos ? 'Ocultar logs' : 'Ver logs técnicos'}
        </button>
      </div>

      {logsAbiertos && (
        <div className="log-area">
          {registro.length === 0
            ? <div className="info">Todavía no hay nada anotado.</div>
            : registro.map((una) => (
              <div className={una.clase} key={una.id}>
                {horaDe(una.cuando)} · {una.texto}
              </div>
            ))}
        </div>
      )}
    </>
  )
}
