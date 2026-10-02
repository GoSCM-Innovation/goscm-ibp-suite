// Los tipos de material de un tenant, leídos de SAP con una consulta ligera.
//
// Portado de `paFetchMattypes` de `prodAnalyzer.js` de v7. Al confirmar el mapeo (paso ①), v7 NO
// miraba lo ya descargado: pedía a SAP solo `PRDID,MATTYPEID` del maestro de productos mientras el
// paso ② enseñaba «⏳ Cargando tipos de material desde SAP IBP…». Es lo que permite excluir y
// categorizar ANTES de la primera descarga: en la primera corrida de un tenant no hay nada descargado,
// y sin esto los pasos ② y ③ estarían vacíos justo cuando más hacen falta.
//
// Solo cuenta: no guarda filas. El maestro de productos tiene decenas de miles de líneas y aquí
// interesa cuántas hay de cada tipo, no cuáles.

import { armarSelect } from '../../core/ibp/explorer-fields.js'
import { FILAS_POR_PAGINA } from './explorer-extract.js'
import { fetchMasterPage } from './ibp-master-data.js'

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim())

/**
 * Cuenta los productos por tipo de material (`MATTYPEID`).
 *
 * Como v7, un producto que aparezca dos veces cuenta una (gana el último) y los que no tienen tipo no
 * cuentan. El orden estable es obligatorio al paginar: sin él, dos ventanas sobre una tabla que alguien
 * está tocando se solapan y dejan huecos.
 *
 * `entidad` es la tabla del maestro de productos de ESTE tenant (la del paso ①) y `mapa` el mapa de
 * campos, para pedir los nombres reales de `PRDID` y `MATTYPEID`.
 */
export async function leerTiposDeMaterial({ destino, entidad, mapa = {} }) {
  if (!entidad) return { cuenta: {}, productos: 0 }

  const select = armarSelect(mapa, entidad, ['PRDID', 'MATTYPEID'])
  const real = (canonico) => mapa?.[entidad]?.[canonico] || canonico
  const idReal = real('PRDID')
  const tipoReal = real('MATTYPEID')

  const tipoDe = new Map()
  let desde = 0
  let enSap = null

  for (;;) {
    const { filas, total } = await fetchMasterPage(destino.connectionId, {
      entidad,
      planningArea: destino.planningArea,
      versionId: destino.versionId,
      select,
      orderby: select.slice(0, 1),
      skip: desde,
      top: FILAS_POR_PAGINA,
      conTotal: desde === 0,
    })
    if (desde === 0 && Number.isFinite(total)) enSap = total

    for (const fila of filas) {
      const id = texto(fila[idReal] ?? fila.PRDID)
      if (id) tipoDe.set(id, texto(fila[tipoReal] ?? fila.MATTYPEID))
    }

    if (filas.length === 0) break
    desde += filas.length
    if (Number.isFinite(enSap) ? desde >= enSap : filas.length < FILAS_POR_PAGINA) break
  }

  const cuenta = {}
  for (const tipo of tipoDe.values()) {
    if (tipo) cuenta[tipo] = (cuenta[tipo] || 0) + 1
  }
  return { cuenta, productos: tipoDe.size }
}
