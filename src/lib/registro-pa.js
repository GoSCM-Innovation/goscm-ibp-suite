// Lo que el Production Analyzer escribe mientras baja y analiza: línea de estado y registro técnico.
//
// Portado de la fase 1 de `doProductionAnalysis` de `prodAnalyzer.js` de v7. Los textos son LOS DE v7
// literales (`xls.log.*` de `es.json`): quien lleva años mirando «Indexando Product...» no gana nada
// con que hoy diga otra cosa.
//
// Plug para `ExplorerExtract` (`formato`): decide cómo se llama cada tabla en la línea de estado, en qué
// porcentaje de la barra empieza, y cómo se escribe el registro cuando termina.
//
// DIFERENCIA CON v7, por la regla de seguridad de esta plataforma: v7 escribía la URL completa del
// tenant en la línea `[GET] <URL>`. Aquí el navegador nunca la conoce —vive cifrada en el servidor—,
// así que la línea dice la ENTIDAD que se pidió, que es lo que sirve para detectar una mal elegida.

import { linea } from './registro-de-descarga.js'
import { porCursor } from './explorer-db.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/**
 * Cómo trata v7 cada tabla del análisis.
 *
 *   nombre   el nombre largo, el de la línea de estado
 *   etiqueta la corta, la del registro («PSH: 2437 reg»)
 *   verbo    «Descargando X → IDB...» las que se guardaban en IndexedDB; «Indexando X...» las que solo se
 *            indexaban en memoria (maestros)
 *   pct      dónde empieza su tramo de la barra (los números de v7)
 */
export const TABLAS_DE_PA = Object.freeze({
  bom_psh: { nombre: 'Production Source Header', etiqueta: 'PSH', verbo: 'Descargando', pct: 2 },
  bom_psi: { nombre: 'Production Source Item', etiqueta: 'PSI', verbo: 'Descargando', pct: 12 },
  bom_psisub: { nombre: 'Production Source Item Sub', etiqueta: 'PSI Sub', verbo: 'Descargando', pct: 18 },
  bom_psr: { nombre: 'Production Source Resource', etiqueta: 'PSR', verbo: 'Descargando', pct: 22 },
  bom_prd: { nombre: 'Product', etiqueta: 'Product', verbo: 'Indexando', pct: 32 },
  bom_loc: { nombre: 'Location', etiqueta: 'Location', verbo: 'Indexando', pct: 44 },
  bom_res: { nombre: 'Resource', etiqueta: 'Resource', verbo: 'Indexando', pct: 54 },
  bom_resloc: { nombre: 'Resource Location', etiqueta: 'Resource Location', verbo: 'Indexando', pct: 60 },
  sn_loc_prod: { nombre: 'Location Product', etiqueta: 'Location Product', verbo: 'Descargando', pct: 64 },
  sn_loc: { nombre: 'Location Source', etiqueta: 'Location Source', verbo: 'Descargando', pct: 68 },
})

/** Las tablas del análisis, en el orden de v7. */
export const TABLAS_QUE_BAJA_PA = Object.freeze(Object.keys(TABLAS_DE_PA))

/**
 * Las que v7 exigía (`required: true` en `validateEntityFields`): la cabecera, los componentes, los
 * sustitutos y los arcos. Sin una de ellas no se corre.
 */
export const TABLAS_REQUERIDAS_PA = Object.freeze(['bom_psh', 'bom_psi', 'bom_psisub', 'sn_loc'])

/** La nota que v7 ponía junto a cada entidad en el bloque «ENTIDADES ODATA» del Resumen. */
const NOTAS = Object.freeze({
  bom_psh: 'Excluye PINVALID=X',
  bom_psi: 'Solo SOURCEIDs activos en PSH',
  bom_psisub: 'Solo SOURCEIDs activos en PSH',
  bom_psr: 'Solo SOURCEIDs activos en PSH',
  bom_loc: 'Excluye LOCVALID=X',
  sn_loc: 'Excluye TINVALID=X',
})

/** Con qué hoja se cruza el recuento de «analizados» de cada entidad (`statKey` de v7). */
const HOJA_DE = Object.freeze({
  bom_psh: 'Prod Source Header',
  bom_psi: 'Prod Source Item',
  bom_psr: 'Prod Source Resource',
  bom_prd: 'Product',
  bom_loc: 'Location',
  bom_res: 'Resource',
  bom_resloc: 'Resource Location',
})

/** Las que v7 anotaba como «retenidas»: las que pasan por un filtro automático. */
const CON_RETENIDAS = new Set(['bom_psh', 'bom_psi', 'bom_psisub', 'bom_psr', 'bom_loc', 'sn_loc'])

/**
 * Las entidades que se usaron, en la forma que lee el Resumen del Excel (`PA_EXEC_META.entities`).
 *
 * Solo entran las que se bajaron: v7 no anotaba las que no tenían entidad mapeada.
 */
export function entidadesDeLaEjecucion(hechos) {
  const salida = []
  for (const tabla of TABLAS_QUE_BAJA_PA) {
    const hecho = (hechos ?? []).find((uno) => uno.tabla === tabla)
    if (!hecho || hecho.omitido || hecho.error || hecho.cancelado) continue
    const entrada = {
      name: TABLAS_DE_PA[tabla].nombre,
      entityName: hecho.entidad,
      downloaded: hecho.bajadas,
    }
    if (CON_RETENIDAS.has(tabla)) entrada.retained = hecho.guardadas
    if (HOJA_DE[tabla]) entrada.statKey = HOJA_DE[tabla]
    if (NOTAS[tabla]) entrada.note = NOTAS[tabla]
    salida.push(entrada)
  }
  return salida
}

/** `[+1234ms]`, el prefijo con el que v7 escribía el tiempo transcurrido en cada línea. */
export const marca = (ms) => `[+${Math.max(0, Math.round(ms))}ms]`

/**
 * El formato de la descarga del Production Analyzer para `ExplorerExtract`.
 *
 * `leerSourceIds` cuenta los SOURCEIDs distintos de la cabecera; se inyecta para poder probar sin una
 * base local.
 */
export function formatoDeProduccion({ leerSourceIds = contarSourceIds } = {}) {
  return {
    /** «Descargando Production Source Header → IDB...» o «Indexando Product...». */
    estado(paso) {
      const suyo = TABLAS_DE_PA[paso.tabla]
      if (!suyo) return null
      return {
        texto: suyo.verbo === 'Descargando'
          ? `Descargando ${suyo.nombre} → IDB...`
          : `Indexando ${suyo.nombre}...`,
        pct: suyo.pct,
      }
    },

    /** Lo que v7 dice cuando falta lo imprescindible. */
    alFaltar(pasos) {
      if (pasos.some((uno) => uno.tabla === 'bom_psh')) {
        return 'Configura al menos la entidad Production Source Header antes de analizar'
      }
      return 'Hay correcciones pendientes. Resuélvelas en el paso de mapeo de entidades antes de ejecutar.'
    },

    /** El registro de la descarga, como el de v7: una línea por tabla y los avisos de «0 registros». */
    async lineas({ plan, salida, tiempos }) {
      const lineas = []
      const ms = (tabla) => tiempos?.get(tabla) ?? 0

      for (const paso of plan.pasos) {
        const hecho = salida.hechos.find((uno) => uno.tabla === paso.tabla)
        const suyo = TABLAS_DE_PA[paso.tabla]
        if (!suyo) continue

        if (!paso.sePuede) {
          lineas.push(linea('warn', `${suyo.etiqueta}: sin entidad configurada`))
          continue
        }
        // v7 solo escribía la línea de petición de la cabecera.
        if (paso.tabla === 'bom_psh') lineas.push(linea('info', `${marca(0)} [GET] ${paso.entidad}`))

        if (hecho?.error) {
          lineas.push(linea('err', `${marca(ms(paso.tabla))} ${suyo.etiqueta}: error — ${hecho.error}`))
          continue
        }
        if (hecho?.cancelado || hecho?.omitido) {
          lineas.push(linea('warn', `${marca(ms(paso.tabla))} ${suyo.etiqueta}: ${hecho.omitido ? `saltada — ${hecho.motivo ?? 'sin motivo'}` : 'cancelada'}`))
          continue
        }

        let texto = `${marca(ms(paso.tabla))} ${suyo.etiqueta}: ${hecho.bajadas} reg`
        if (paso.tabla === 'bom_psh') texto += ` (${await leerSourceIds()} SOURCEIDs)`
        lineas.push(linea('ok', texto))

        // Los campos que este tenant no tiene: el informe sale sin ellos.
        if (paso.omitidos?.length > 0) {
          lineas.push(linea(
            'warn',
            `${suyo.etiqueta}: este tenant no tiene ${paso.omitidos.join(', ')}. Se baja sin ${paso.omitidos.length === 1 ? 'ese campo' : 'esos campos'}.`,
          ))
        }
        // El único aviso que invalida lo que se analice después, así que va en rojo.
        if (hecho.faltan > 0) {
          lineas.push(linea('err', `✕ ${suyo.etiqueta}: incompleta — SAP dice ${numero(hecho.enSap)} filas y llegaron ${numero(hecho.bajadas)}`))
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

/** Cuántos SOURCEIDs distintos hay en la cabecera descargada. */
async function contarSourceIds() {
  const vistos = new Set()
  await porCursor('bom_psh', (fila) => {
    const sid = String(fila.SOURCEID ?? '').trim()
    if (sid) vistos.add(sid)
  })
  return vistos.size
}
