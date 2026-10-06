// Lo que el Network Analyzer escribe mientras baja: línea de estado y registro técnico.
//
// Portado de la fase 1 de `doAnalyzeAndExport` de `analyzer.js` de v7. Los textos son LOS DE v7 literales
// (`Descargando Location Source → IDB...`, `Indexando Product (lookup en memoria)...`, `Location Source: N
// reg → IDB (M productos)`…): quien lleva años mirándolos no gana nada con que hoy digan otra cosa.
//
// Es el plug para `ExplorerExtract` (`formato`): decide cómo se llama cada tabla en la línea de estado, en
// qué porcentaje de la barra empieza y cómo se escribe el registro cuando termina. Es el equivalente de
// `registro-pa.js` para la red.
//
// DIFERENCIAS CON v7:
//
//   - v7 escribía la URL completa del tenant en `[GET] <URL>` y una línea `↳ URL: …` por página. Aquí el
//     navegador nunca la conoce (vive cifrada en el servidor, regla de seguridad de la plataforma), así
//     que la línea dice la ENTIDAD que se pidió, que es lo que sirve para detectar una mal elegida.
//   - v7 escribía cada línea al terminar su tabla; aquí se escriben todas al terminar la descarga, con la
//     hora en que llegó la última página de cada una (`ExplorerExtract` no avisa tabla por tabla).

import { linea } from './registro-de-descarga.js'
import { porCursor } from './explorer-db.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/**
 * Cómo trata v7 cada tabla del análisis de la red.
 *
 *   nombre   el nombre largo, el de la línea de estado y el de las líneas del registro
 *   verbo    «Descargando X → IDB...» las que se guardaban en IndexedDB; «Indexando X (lookup en
 *            memoria)...» los maestros, que solo se indexaban en memoria
 *   pct      dónde empieza su tramo de la barra: el número en que terminaba la tabla anterior en v7
 *   nota     la nota del bloque «ENTIDADES ODATA» del Resumen, si la tenía
 *   hoja     con qué hoja se cruza el recuento de «analizados» (`statKey`)
 *   conRetenidas  si v7 contaba «retenidas» (las que pasan por un filtro automático)
 */
export const TABLAS_DE_RED = Object.freeze({
  sn_loc: { nombre: 'Location Source', verbo: 'Descargando', pct: 0, nota: 'Excluye TINVALID=X', hoja: 'Location Source', conRetenidas: true },
  sn_cust: { nombre: 'Customer Source', verbo: 'Descargando', pct: 8, nota: 'Excluye CINVALID=X', hoja: 'Customer Source', conRetenidas: true },
  bom_prd: { nombre: 'Product', verbo: 'Indexando', pct: 17, hoja: 'Product' },
  sn_plant: { nombre: 'Production Source Header', verbo: 'Descargando', pct: 25, nota: 'Excluye PINVALID=X', conRetenidas: true },
  sn_psi: { nombre: 'Production Source Item', verbo: 'Descargando', pct: 28, nota: 'Solo SOURCEIDs activos en PSH', conRetenidas: true },
  bom_loc: { nombre: 'Location', verbo: 'Indexando', pct: 33, nota: 'Excluye LOCVALID=X', hoja: 'Location', conRetenidas: true },
  sn_loc_prod: { nombre: 'Location Product', verbo: 'Descargando', pct: 38 },
  sn_cust_master: { nombre: 'Customer', verbo: 'Indexando', pct: 42, nota: 'Excluye CUSTVALID=X', hoja: 'Customer', conRetenidas: true },
  sn_cust_prod: { nombre: 'Customer Product', verbo: 'Descargando', pct: 46 },
})

/** Las tablas del análisis, en el orden de v7. El orden importa: el componente se ata a su cabecera. */
export const TABLAS_QUE_BAJA_RED = Object.freeze(Object.keys(TABLAS_DE_RED))

/**
 * Las que v7 exigía (`required: true` en `validateEntityFields`): las ocho entidades de la red. El maestro
 * de productos no está en la lista: v7 no lo validaba.
 */
export const TABLAS_REQUERIDAS_RED = Object.freeze(TABLAS_QUE_BAJA_RED.filter((tabla) => tabla !== 'bom_prd'))

/**
 * Los campos que v7 pedía de cada tabla (`efGetSelect` y los `select` fijos de `fetchAndIndex`), para que a
 * SAP se le pida EXACTAMENTE lo que pedía v7 y nada más. Las listas de campos obligatorios y ocultos de
 * cada entidad son `EF_MAND_VISIBLE.sn` y `EF_MAND_HIDDEN.sn`; los campos adicionales del paso ④ se suman.
 *
 * Es el MISMO CONJUNTO de campos que pedía v7, no el mismo orden en dos tablas (SAP no distingue el orden
 * del `$select`). El `$orderby` con que se pagina NO sale de aquí sino de la `clave` de cada tabla en
 * `EXTRACCIONES`.
 */
export const CAMPOS_DE_RED = Object.freeze({
  sn_loc: ['LOCID', 'LOCFR', 'PRDID', 'TLEADTIME', 'TINVALID'],
  sn_cust: ['LOCID', 'PRDID', 'CUSTID', 'CLEADTIME', 'CINVALID'],
  bom_prd: ['PRDID', 'PRDDESCR', 'MATTYPEID'],
  sn_plant: ['SOURCEID', 'PRDID', 'LOCID', 'PLEADTIME', 'PRATIO', 'PINVALID'],
  sn_psi: ['SOURCEID', 'PRDID', 'COMPONENTCOEFFICIENT'],
  bom_loc: ['LOCID', 'LOCDESCR', 'LOCTYPE', 'LOCVALID'],
  sn_loc_prod: ['LOCID', 'PRDID'],
  sn_cust_master: ['CUSTID', 'CUSTDESCR', 'CUSTVALID'],
  sn_cust_prod: ['CUSTID', 'PRDID'],
})

/** `[+1234ms]`, el prefijo con el que v7 escribía el tiempo transcurrido en cada línea. */
export const marca = (ms) => `[+${Math.max(0, Math.round(ms))}ms]`

/** La duración como la escribía v7 (`fmtDuration`): «45 s» o «2 min 5 s». Se conserva su redondeo. */
export function fmtDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)} s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m} min${s > 0 ? ` ${s} s` : ''}`
}

/**
 * Las dos líneas con que v7 cierra el análisis, según cómo se quiso ver (`'web' | 'excel' | 'both'`):
 * la del registro y la de la línea de estado. La de estado dice siempre «Excel descargado», aunque el
 * modo fuera solo vista web: así está en `analyzer.status.complete` de v7.
 */
export function lineasDeCierre({ totalProducts, modo, ms }) {
  const n = Number(totalProducts ?? 0).toLocaleString('es-CL')
  const dur = fmtDuration(ms)
  const queSeEntrego = modo === 'both' ? 'Excel descargado + vista web' : modo === 'web' ? 'vista web generada' : 'Excel descargado'
  return {
    registro: `Análisis completado. ${n} productos analizados · ${queSeEntrego} · ${dur}.`,
    estado: `✓ Análisis completado — Excel descargado | ${n} productos · ${dur}`,
  }
}

/**
 * Las entidades que se usaron, en la forma que lee el Resumen del Excel (`SN_EXEC_META.entities`).
 *
 * Solo entran las que se bajaron: v7 no anotaba las que no tenían entidad mapeada.
 */
export function entidadesDeLaEjecucion(hechos) {
  const salida = []
  for (const tabla of TABLAS_QUE_BAJA_RED) {
    const hecho = (hechos ?? []).find((uno) => uno.tabla === tabla)
    if (!hecho || hecho.omitido || hecho.error || hecho.cancelado) continue
    const suya = TABLAS_DE_RED[tabla]
    const entrada = { name: suya.nombre, entityName: hecho.entidad, downloaded: hecho.bajadas }
    if (suya.conRetenidas) entrada.retained = hecho.guardadas
    if (suya.hoja) entrada.statKey = suya.hoja
    if (suya.nota) entrada.note = suya.nota
    salida.push(entrada)
  }
  return salida
}

/**
 * El formato de la descarga del Network Analyzer para `ExplorerExtract`.
 *
 * `leerCuentas` cuenta lo que v7 anotaba entre paréntesis (los productos con arcos de Location Source y los
 * componentes únicos); se inyecta para poder probar sin una base local.
 */
export function formatoDeRed({ leerCuentas = contarProductos } = {}) {
  return {
    /** «Descargando Location Source → IDB...» o «Indexando Product (lookup en memoria)...». */
    estado(paso) {
      const suyo = TABLAS_DE_RED[paso.tabla]
      if (!suyo) return null
      return {
        texto: suyo.verbo === 'Descargando'
          ? `Descargando ${suyo.nombre} → IDB...`
          : `Indexando ${suyo.nombre} (lookup en memoria)...`,
        pct: suyo.pct,
      }
    },

    /** Lo que v7 dice cuando falta lo imprescindible. */
    alFaltar(pasos) {
      const faltan = new Set(pasos.map((uno) => uno.tabla))
      // v7: «ninguna de las tres entidades de red» → hay que configurar al menos una.
      if (['sn_loc', 'sn_cust', 'sn_plant'].every((tabla) => faltan.has(tabla))) {
        return 'Configura al menos una entidad de red antes de analizar'
      }
      return 'Hay correcciones pendientes. Resuélvelas en el paso de mapeo de entidades antes de ejecutar.'
    },

    /** El registro de la descarga, como el de v7: una línea de petición y una de resultado por tabla. */
    async lineas({ plan, salida, tiempos }) {
      const lineas = []
      const ms = (tabla) => tiempos?.get(tabla) ?? 0
      // Las cuentas se leen una sola vez, y solo si alguna línea las necesita.
      let cuentasLeidas
      const cuentas = async () => { cuentasLeidas ??= await leerCuentas(); return cuentasLeidas }

      for (const paso of plan.pasos) {
        const hecho = salida.hechos.find((uno) => uno.tabla === paso.tabla)
        const suyo = TABLAS_DE_RED[paso.tabla]
        // v7 no decía nada de una entidad sin configurar: la saltaba.
        if (!suyo || !paso.sePuede) continue

        lineas.push(linea('info', `${marca(0)} [GET] ${paso.entidad}`))

        if (hecho?.error) {
          lineas.push(linea('err', `${marca(ms(paso.tabla))} ${suyo.nombre}: error — ${hecho.error}`))
          continue
        }
        if (hecho?.cancelado || hecho?.omitido) {
          lineas.push(linea('warn', `${marca(ms(paso.tabla))} ${suyo.nombre}: ${hecho.omitido ? `saltada — ${hecho.motivo ?? 'sin motivo'}` : 'cancelada'}`))
          continue
        }

        const base = `${marca(ms(paso.tabla))} ${suyo.nombre}: ${hecho.bajadas}`
        let texto
        if (suyo.verbo === 'Indexando') texto = `${base} reg`
        else if (paso.tabla === 'sn_loc') texto = `${base} reg → IDB (${(await cuentas()).productosEnArcos ?? 0} productos)`
        else if (paso.tabla === 'sn_psi') texto = `${base} reg → IDB (${(await cuentas()).componentes ?? 0} componentes únicos)`
        else texto = `${base} reg → IDB`
        lineas.push(linea('ok', texto))

        // Los campos que este tenant no tiene: el informe sale sin ellos.
        if (paso.omitidos?.length > 0) {
          lineas.push(linea(
            'warn',
            `${suyo.nombre}: este tenant no tiene ${paso.omitidos.join(', ')}. Se baja sin ${paso.omitidos.length === 1 ? 'ese campo' : 'esos campos'}.`,
          ))
        }
        // El único aviso que invalida lo que se analice después, así que va en rojo.
        if (hecho.faltan > 0) {
          lineas.push(linea('err', `✕ ${suyo.nombre}: incompleta — SAP dice ${numero(hecho.enSap)} filas y llegaron ${numero(hecho.bajadas)}`))
        }
      }

      // Aviso visible: entidades configuradas que devolvieron 0 registros. Suele indicar una entidad
      // OData mal detectada o seleccionada para esta Planning Area.
      for (const e of entidadesDeLaEjecucion(salida.hechos)) {
        if (e.downloaded === 0) {
          lineas.push(linea(
            'warn',
            `${marca(Math.max(0, ...[...(tiempos?.values() ?? [])]))} ⚠️ ${e.name} (${e.entityName || '?'}): 0 registros. `
            + 'Verifica que la entidad OData seleccionada sea la correcta para esta Planning Area.',
          ))
        }
      }
      return lineas
    },
  }
}

/** Cuántos productos distintos hay en Location Source y cuántos componentes únicos en Production Source Item. */
async function contarProductos() {
  const enArcos = new Set()
  await porCursor('sn_loc', (fila) => {
    const p = String(fila.PRDID ?? '').trim()
    if (p) enArcos.add(p)
  })
  const componentes = new Set()
  await porCursor('sn_psi', (fila) => {
    const p = String(fila.PRDID ?? '').trim()
    if (p) componentes.add(p)
  })
  return { productosEnArcos: enArcos.size, componentes: componentes.size }
}
