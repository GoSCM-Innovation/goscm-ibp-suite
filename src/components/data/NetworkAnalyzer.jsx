// Network Analyzer — el flujo de v7, de ① a ⑤, con los algoritmos de v7.
//
// Portado del `tab-network` de `index.html` y de `analyzer.js` de v7. Reemplaza al analizador anterior de la
// suite, que juzgaba con una tabla de calidad propia (Error / Aviso / Nota / Bien, chips de colores y
// «Descargar CSV»): esa no era la herramienta de v7, y la decisión del 2026-10-01 fue que los analizadores
// se migran con sus algoritmos idénticos.
//
//   ① MAPEO DE ENTIDADES          — `PanelMapeo`, variante `na` (9 tarjetas)
//   ② Excluir tipos de material   — opcional; los tipos se leen de SAP al confirmar ①
//   ③ Categorizar tipos           — opcional; matriz de interruptores con la ayuda «?»
//   ④ Campos adicionales          — opcional; un botón por tabla con su diálogo
//   ⑤ Ejecutar análisis           — pregunta cómo verlo, baja, analiza y entrega
//
// Cada paso APARECE al confirmar el anterior y «← Volver» lo hace desaparecer, como en v7
// (`doBackToMapping`, `snBackToExtraFields`…).
//
// El algoritmo está en `core/ibp/network-analyzer.js`; la lectura de lo descargado, en
// `src/lib/red-analizar.js`; el Excel, en `src/lib/xlsx-analisis.js`; la vista web, en
// `VistaWebAnalisis.jsx`. Aquí solo está el recorrido, que es el del `AnalizadorProduccion` con los datos de
// la red: mismas piezas (`PasoPlegable`, `TablaExcluirTipos`, `MatrizDeCategorias`, `CamposAdicionales`,
// `ModalModoDeSalida`).

import { useCallback, useMemo, useRef, useState } from 'react'

import PanelMapeo from './PanelMapeo.jsx'
import PasoPlegable from './PasoPlegable.jsx'
import ExplorerExtract from './ExplorerExtract.jsx'
import TablaExcluirTipos from './TablaExcluirTipos.jsx'
import MatrizDeCategorias from './MatrizDeCategorias.jsx'
import CamposAdicionales from './CamposAdicionales.jsx'
import ModalModoDeSalida from './ModalModoDeSalida.jsx'
import VistaWebAnalisis from './VistaWebAnalisis.jsx'
import { DESCRIPCION_DE_CAMPO } from '../../../core/ibp/explorer-fields.js'
import {
  RESUMEN_POR_DEFECTO_RED,
  desdeClasificacion,
  resumenDeCategoriasV7,
  resumenDeEjecucionV7,
  resumenDeExclusionV7,
} from '../../../core/ibp/mattype-config.js'
import {
  CAMPOS_OBLIGATORIOS_RED,
  CAMPOS_OCULTOS_RED,
  ENTIDADES_CON_EXTRAS_RED,
} from '../../../core/ibp/network-analyzer.js'
import {
  configuracionInicial,
  guardarClasificacion,
  leerGuardada,
  mezclarClasificacion,
  restablecer,
} from '../../lib/clasificacion-de-tipos.js'
import {
  TABLA_DE_ENTIDAD_RED,
  extrasPorTabla,
  guardarCamposAdicionales,
  leerCamposAdicionales,
} from '../../lib/campos-adicionales.js'
import { descargarLibro } from '../../lib/bom-export.js'
import { efectivoDeLaRed } from '../../lib/network-load-sap.js'
import { analizarRedDescargada } from '../../lib/red-analizar.js'
import {
  CAMPOS_DE_RED,
  TABLAS_QUE_BAJA_RED,
  TABLAS_REQUERIDAS_RED,
  formatoDeRed,
  lineasDeCierre,
  marca,
} from '../../lib/registro-sn.js'
import { leerTiposDeMaterial } from '../../lib/tipos-de-material.js'
import { armarLibroDeAnalisis } from '../../lib/xlsx-analisis.js'

/**
 * De qué tarjeta del mapeo sale cada entidad del paso ④. Son las cinco de `EF_ENTITY_META.sn` de v7, y
 * todas están en el grupo de la RED (el mapeo `na` no tiene tarjetas del árbol).
 */
const ORIGEN_DE_ENTIDAD = Object.freeze({
  product: 'product',
  location: 'locMaster',
  customer: 'custMaster',
  locationSource: 'location',
  customerSource: 'customer',
})

/** Los textos de la descarga son siempre los mismos: una sola instancia, no una por dibujo. */
const FORMATO = formatoDeRed()

const ceder = () => new Promise((resolver) => setTimeout(resolver, 0))

const CLAVES_DE_ENTIDAD = ENTIDADES_CON_EXTRAS_RED.map((una) => una.clave)

export default function NetworkAnalyzer({ area = '', destino }) {
  const [mapeoAbierto, setMapeoAbierto] = useState(true)
  // El paso más lejano al que se llegó (1 = solo el mapeo) y cuál tiene el cuerpo abierto.
  const [paso, setPaso] = useState(1)
  const [abierto, setAbierto] = useState(0)

  const [mapa, setMapa] = useState(null)
  const [clasificacion, setClasificacion] = useState(null)
  const [cargandoTipos, setCargandoTipos] = useState(false)
  const [extras, setExtras] = useState(() => leerCamposAdicionales('sn', CLAVES_DE_ENTIDAD, area))

  const [ejecutando, setEjecutando] = useState(false)
  const [pidiendoModo, setPidiendoModo] = useState(false)
  const [informe, setInforme] = useState(null)
  const [modo, setModo] = useState('excel')
  const [numeroDeEjecucion, setNumeroDeEjecucion] = useState(0)

  const descarga = useRef(null)
  const respuestaDelModo = useRef(null)

  const cfgV7 = useMemo(() => desdeClasificacion(clasificacion ?? {}), [clasificacion])
  const extrasDeDescarga = useMemo(() => extrasPorTabla(extras, TABLA_DE_ENTIDAD_RED), [extras])

  const tipos = useMemo(() => Object.keys(clasificacion ?? {}).sort(), [clasificacion])

  // ── ② y ③: la clasificación de los tipos de material ──────────────────────────────────────────

  const guardar = useCallback((siguiente) => {
    guardarClasificacion(area, siguiente)
    setClasificacion(siguiente)
  }, [area])

  /**
   * Al confirmar el mapeo: se leen los tipos de material de SAP con una consulta ligera.
   *
   * v7 NO miraba lo ya descargado (`snFetchMattypes`): pedía `PRDID,MATTYPEID` mientras el paso ②
   * enseñaba «⏳ Cargando tipos de material desde SAP IBP…». Así los pasos ② y ③ sirven desde la primera
   * corrida de un tenant, cuando todavía no hay nada descargado.
   */
  async function leerTipos(efectivo, leido) {
    setCargandoTipos(true)
    try {
      const entidad = efectivo?.red?.product?.entidad
      const { cuenta } = await leerTiposDeMaterial({
        destino,
        entidad,
        mapa: leido?.guardado?.fields ?? {},
      })
      setClasificacion(mezclarClasificacion(configuracionInicial(cuenta), leerGuardada(area)))
    } catch (fallo) {
      // v7 solo lo anotaba en la consola y dejaba la lista vacía.
      console.warn('[snFetchMattypes] fetch falló:', fallo)
      setClasificacion({})
    } finally {
      setCargandoTipos(false)
    }
  }

  function alConfirmarMapeo(efectivo, leido) {
    setMapa({ efectivo, campos: leido?.campos ?? {} })
    setMapeoAbierto(false)
    setPaso(2)
    setAbierto(2)
    leerTipos(efectivo, leido)
  }

  function cambiarInclusion(tipo, incluido) {
    guardar({ ...clasificacion, [tipo]: { ...clasificacion[tipo], excluido: !incluido } })
  }

  function alternarCategoria(tipo, categoria, marcado) {
    const suyas = clasificacion[tipo]?.categorias ?? []
    guardar({
      ...clasificacion,
      [tipo]: {
        ...clasificacion[tipo],
        categorias: marcado
          ? [...suyas.filter((una) => una !== categoria), categoria]
          : suyas.filter((una) => una !== categoria),
      },
    })
  }

  // ── Navegación entre pasos (los `snContinueTo…` y `snBackTo…` de v7) ───────────────────────────

  function volverAlMapeo() {
    setPaso(1)
    setAbierto(0)
    setMapeoAbierto(true)
  }

  /** «Continuar →»: el paso `n` aparece (si no estaba) y se abre; el anterior se pliega. */
  const avanzarA = (n) => { setPaso((previo) => Math.max(previo, n)); setAbierto(n === 5 ? 0 : n) }
  /** «← Volver»: los pasos de `n` en adelante desaparecen, como en v7, y `n` se abre. */
  const retrocederA = (n) => { setPaso(n); setAbierto(n) }

  // ── ④: campos adicionales ───────────────────────────────────────────────────────────────────

  const entidadesConExtras = ENTIDADES_CON_EXTRAS_RED.map((una) => {
    const entidad = mapa?.efectivo?.red?.[ORIGEN_DE_ENTIDAD[una.clave]]?.entidad
    return { clave: una.clave, etiqueta: una.etiqueta, campos: entidad ? (mapa?.campos?.[entidad] ?? []) : null }
  })

  function guardarExtras(clave, campos) {
    guardarCamposAdicionales('sn', clave, area, campos)
    setExtras((previos) => ({ ...previos, [clave]: campos }))
  }

  // ── ⑤: ejecutar ───────────────────────────────────────────────────────────────────────────

  /** El modal «¿Cómo quieres ver el análisis?»: se resuelve con la elección, o `null` al cancelar. */
  const pedirModo = () => new Promise((resolver) => {
    respuestaDelModo.current = resolver
    setPidiendoModo(true)
  })

  function elegirModo(elegido) {
    setPidiendoModo(false)
    respuestaDelModo.current?.(elegido)
    respuestaDelModo.current = null
  }

  async function descargarExcel(delInforme) {
    const buffer = await armarLibroDeAnalisis(delInforme, { ceder })
    descargarLibro(buffer, delInforme.archivo)
  }

  /**
   * «▶ Ejecutar análisis» (`doAnalyzeAndExport` de v7): validar, preguntar cómo verlo, bajar, analizar y
   * entregar. Se baja SIEMPRE: reutilizar lo guardado no captura lo que cambió en el tenant desde la
   * última vez (decisión del 2026-10-01).
   */
  async function ejecutar() {
    setEjecutando(true)
    setInforme(null)
    try {
      // Si falta algo imprescindible se dice ya, antes de preguntar cómo se quiere ver.
      if (!(await descarga.current?.validar())) return

      const elegido = await pedirModo()
      if (!elegido) return

      const t0 = Date.now()
      const nota = (clase, texto) => descarga.current?.anotar(clase, `${marca(Date.now() - t0)} ${texto}`)

      try {
        const salida = await descarga.current?.bajar()
        // Una tabla fallida o incompleta ya dejó su motivo en la línea de estado y en el registro.
        if (!salida || !salida.ok) return
        descarga.current?.avanzar(50)

        const resultado = await analizarRedDescargada({
          hechos: salida.hechos,
          destino,
          // El navegador no conoce la dirección del tenant (vive cifrada en el servidor), así que el
          // Resumen del Excel no puede traer «API Base URL».
          conexion: { url: '', pa: destino.planningArea, pver: destino.versionId },
          clasificacion: clasificacion ?? {},
          extras,
          hoy: new Date().toISOString().slice(0, 10),
          web: elegido !== 'excel',
          alEstado: (texto) => descarga.current?.decir('info', texto),
          alProgreso: (pct) => descarga.current?.avanzar(pct),
          registrar: nota,
          ceder,
        })

        if (elegido !== 'web') {
          descarga.current?.decir('info', 'Generando archivo Excel...')
          await descargarExcel(resultado)
        }

        descarga.current?.avanzar(100)
        const cierre = lineasDeCierre({ totalProducts: resultado.totales.totalProducts, modo: elegido, ms: Date.now() - t0 })
        nota('ok', cierre.registro)
        descarga.current?.decir('ok', cierre.estado)

        setModo(elegido)
        setNumeroDeEjecucion((n) => n + 1)
        setInforme(resultado)
      } catch (fallo) {
        nota('err', `Error: ${fallo?.message}`)
        descarga.current?.decir('err', `Error: ${fallo?.message}`)
        // v7 escondía la barra para no dejar un avance a medias junto al error.
        descarga.current?.avanzar(0)
      }
    } finally {
      setEjecutando(false)
    }
  }

  const datosWeb = useMemo(() => (informe && {
    titulo: informe.titulo,
    generadoEl: informe.generadoEl,
    orden: informe.orden,
    hojas: informe.hojasWeb,
    resumen: informe.resumen,
    estadisticas: informe.estadisticas,
    nombreEstadisticas: informe.nombreEstadisticas,
  }), [informe])

  const quiereVerLaWeb = informe && modo !== 'excel'

  return (
    <>
      {/* ── Interpretación de resultados (`panelSNGuide`) ─────────────────────────────────────── */}
      <div className="panel" style={{ borderLeft: '3px solid var(--cyan)', padding: '14px 18px' }}>
        <div className="panel-title" style={{ marginBottom: 6, fontSize: 13 }}>
          Interpretación de resultados
        </div>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>
          Consulta la pestaña{' '}
          <a href="#/explorer/glosario" style={{ color: 'var(--accent)', fontWeight: 700 }}>
            Glosario Analyzers
          </a>{' '}
          para entender los campos que entrega este analizador y los análisis que realiza.
        </p>
      </div>

      {/* ── ① ──────────────────────────────────────────────────────────────────────────────── */}
      <PanelMapeo
        variante="na"
        destino={destino}
        abierto={mapeoAbierto}
        onAlternar={() => setMapeoAbierto((previo) => !previo)}
        onConfirmar={alConfirmarMapeo}
      />

      {/* ── ② Excluir tipos de material ───────────────────────────────────────────────────── */}
      <PasoPlegable
        numero="②"
        titulo="Excluir tipos de material"
        opcional
        oculto={paso < 2}
        resumen={resumenDeExclusionV7(cfgV7)}
        onRestablecer={() => { if (clasificacion) guardar(restablecer(clasificacion, { excluidos: true, categorias: false })) }}
        abierto={abierto === 2}
        onAlternar={() => setAbierto(abierto === 2 ? 0 : 2)}
      >
        <TablaExcluirTipos
          tipos={tipos.map((tipo) => ({
            tipo,
            productos: clasificacion[tipo].productos ?? 0,
            excluido: Boolean(clasificacion[tipo].excluido),
          }))}
          cargando={cargandoTipos}
          onCambiar={cambiarInclusion}
        />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary btn-small" onClick={() => avanzarA(3)}>
            Continuar →
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={volverAlMapeo}>
            ← Volver al mapeo
          </button>
        </div>
      </PasoPlegable>

      {/* ── ③ Categorizar tipos de material ─────────────────────────────────────────────────── */}
      <PasoPlegable
        numero="③"
        titulo="Categorizar tipos de material"
        opcional
        oculto={paso < 3}
        resumen={resumenDeCategoriasV7(cfgV7)}
        onRestablecer={() => { if (clasificacion) guardar(restablecer(clasificacion, { excluidos: false, categorias: true })) }}
        abierto={abierto === 3}
        onAlternar={() => setAbierto(abierto === 3 ? 0 : 3)}
      >
        <MatrizDeCategorias
          tipos={tipos.filter((tipo) => !clasificacion[tipo].excluido).map((tipo) => ({
            tipo,
            productos: clasificacion[tipo].productos ?? 0,
            categorias: clasificacion[tipo].categorias ?? [],
          }))}
          onAlternar={alternarCategoria}
        />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary btn-small" onClick={() => avanzarA(4)}>
            Continuar →
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(2)}>
            ← Volver
          </button>
        </div>
      </PasoPlegable>

      {/* ── ④ Campos adicionales de datos maestros ───────────────────────────────────────────── */}
      <PasoPlegable
        numero="④"
        titulo="Campos adicionales de datos maestros"
        opcional
        oculto={paso < 4}
        abierto={abierto === 4}
        onAlternar={() => setAbierto(abierto === 4 ? 0 : 4)}
      >
        <CamposAdicionales
          entidades={entidadesConExtras}
          obligatorios={CAMPOS_OBLIGATORIOS_RED}
          ocultos={CAMPOS_OCULTOS_RED}
          descripciones={DESCRIPCION_DE_CAMPO}
          seleccion={extras}
          onGuardar={guardarExtras}
        />
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary btn-small" onClick={() => avanzarA(5)}>
            Continuar a ejecución →
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => retrocederA(3)}>
            ← Volver
          </button>
        </div>
      </PasoPlegable>

      {/* ── ⑤ Ejecutar análisis ───────────────────────────────────────────────────────────── */}
      {paso >= 5 && (
        <div className="panel">
          <div className="panel-title">⑤ Ejecutar análisis</div>

          <div
            style={{
              fontSize: 12,
              color: 'var(--text2)',
              marginBottom: 14,
              padding: '10px 12px',
              background: 'rgba(41,171,226,.05)',
              borderLeft: '3px solid var(--cyan)',
              borderRadius: 4,
            }}
          >
            {resumenDeEjecucionV7(cfgV7, RESUMEN_POR_DEFECTO_RED)}
          </div>

          <div className="btn-row">
            {/* El texto no cambia mientras corre: v7 solo deshabilitaba el botón. */}
            <button type="button" className="btn btn-primary" onClick={ejecutar} disabled={ejecutando}>
              ▶ Ejecutar análisis
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => retrocederA(4)}>
              ← Volver
            </button>
          </div>

          {/* La barra, la línea de estado y el registro sirven a las dos fases —bajar y analizar—,
              como `progBarSN`, `progStatusTextSN` y `logSN` en v7. Sin «Cancelar»: v7 no lo tenía. */}
          <ExplorerExtract
            ref={descarga}
            destino={destino}
            tablas={TABLAS_QUE_BAJA_RED}
            requeridas={TABLAS_REQUERIDAS_RED}
            solo={CAMPOS_DE_RED}
            ajustarEfectivo={efectivoDeLaRed}
            extras={extrasDeDescarga}
            formato={FORMATO}
            sinCancelar
          />
        </div>
      )}

      {pidiendoModo && <ModalModoDeSalida onElegir={elegirModo} />}

      {/* ── El resultado ─────────────────────────────────────────────────────────────────────── */}
      {informe && modo === 'excel' && (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <div className="icon">✅</div>
          <strong style={{ fontSize: 15, color: 'var(--green)' }}>¡Análisis completado!</strong>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6 }}>
            El informe ha sido descargado exitosamente.
          </p>
        </div>
      )}

      {quiereVerLaWeb && (
        <VistaWebAnalisis
          key={numeroDeEjecucion}
          datos={datosWeb}
          descargarExcel={modo === 'web' ? () => descargarExcel(informe) : null}
          excelDescargado={modo === 'both'}
        />
      )}
    </>
  )
}
