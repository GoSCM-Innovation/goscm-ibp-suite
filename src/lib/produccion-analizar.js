// Production Analyzer: leer lo descargado, juzgarlo con el algoritmo de v7 y devolver el informe.
//
// Es la fase 2 de `doProductionAnalysis` de v7 (indexar lo descargado) más la llamada a
// `paAnalyzeAndExport`. El juicio está en `core/ibp/production-analyzer.js`; aquí solo se lee la base
// local y se arman los índices de entrada con la MISMA forma y las MISMAS reglas de descarte que v7
// (las cabeceras inválidas ya vienen descartadas de la descarga; los componentes, recursos y sustitutos
// se atan a las cabeceras vivas).
//
// Se lee TODO a memoria, como v7 (`idbGetAll`): el algoritmo indexa los arcos de Location Source por
// producto, origen y destino a la vez, y recorrerlos por cursor tantas veces no ahorraría memoria.

import { actualizarTipos, desdeClasificacion } from '../../core/ibp/mattype-config.js'
import { analizarProduccion } from '../../core/ibp/production-analyzer.js'
import { porCursor } from './explorer-db.js'
import { entidadesDeLaEjecucion } from './registro-pa.js'

/** Un valor de SAP como texto limpio (`str` de `utils.js` de v7). */
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

/** Un objeto sin prototipo: un identificador llamado «constructor» no tiene que pisar nada. */
const dict = () => Object.create(null)

/** Lee una tabla entera a una lista, solo si hace falta. */
async function todo(tabla, hace) {
  const filas = []
  if (hace) await porCursor(tabla, (fila) => { filas.push(fila) })
  return filas
}

/**
 * Lee la base local y arma las entradas del algoritmo.
 *
 * `ent` dice qué entidades están mapeadas (cada hoja de v7 se omite si falta la suya) y `extras` los
 * campos adicionales del paso ④ (`{ product: ['CAMPO'], … }`), que viajan en los registros que los
 * llevan: la cabecera, la ubicación del recurso y las demás se leen del propio registro.
 */
export async function leerDatosDeProduccion({ ent, extras = {} }) {
  const pshBySid = dict()
  const pshPrdSet = dict()
  const pshExtra = extras.psh ?? []
  if (ent.psh) {
    await porCursor('bom_psh', (r) => {
      const sid = str(r.SOURCEID)
      if (!sid) return
      if (!pshBySid[sid]) pshBySid[sid] = []
      const entry = {
        PRDID: str(r.PRDID),
        LOCID: str(r.LOCID),
        SOURCETYPE: str(r.SOURCETYPE),
        PLEADTIME: r.PLEADTIME != null ? str(r.PLEADTIME) : '',
        OUTPUTCOEFFICIENT: r.OUTPUTCOEFFICIENT != null ? str(r.OUTPUTCOEFFICIENT) : '',
        PRATIO: r.PRATIO != null ? str(r.PRATIO) : '',
      }
      pshExtra.forEach((f) => { if (r[f] != null) entry[f] = str(r[f]) })
      pshBySid[sid].push(entry)
      const p = str(r.PRDID)
      if (p) pshPrdSet[p] = true
    })
  }

  const psi = await todo('bom_psi', ent.psi)

  // Los sustitutos se atan a las cabeceras vivas, como en v7 (`pshBySid[SOURCEID]`). La descarga no
  // ata esta tabla porque el árbol de materiales la usa tal cual; aquí sí hace falta.
  const psiSub = (await todo('bom_psisub', ent.psiSub)).filter((r) => !!pshBySid[str(r.SOURCEID)])
  const psr = await todo('bom_psr', ent.psr)

  const prd = dict()
  if (ent.prd) {
    await porCursor('bom_prd', (r) => { const k = str(r.PRDID); if (k) prd[k] = r })
  }

  const loc = dict()
  if (ent.loc) {
    await porCursor('bom_loc', (r) => { const k = str(r.LOCID); if (k) loc[k] = r })
  }

  const res = dict()
  if (ent.res) {
    await porCursor('bom_res', (r) => { const k = str(r.RESID); if (k) res[k] = r })
  }

  const resLoc = dict()
  const rlExtra = extras.resourceLocation ?? []
  if (ent.resLoc) {
    await porCursor('bom_resloc', (r) => {
      const k = str(r.RESID)
      if (!k) return
      if (!resLoc[k]) resLoc[k] = []
      const entry = { LOCID: str(r.LOCID || '') }
      rlExtra.forEach((f) => { if (r[f] != null) entry[f] = str(r[f]) })
      resLoc[k].push(entry)
    })
  }

  const locProd = await todo('sn_loc_prod', ent.locPrd)
  const locSrc = await todo('sn_loc', ent.locSrc)

  return { pshBySid, pshPrdSet, psi, psiSub, psr, prd, loc, res, resLoc, locProd, locSrc }
}

/** La condición de `$filter` que v7 anotaba en el Resumen (`paFilter`). */
export function filtroDeV7(destino) {
  if (!destino?.planningArea) return ''
  return destino.versionId
    ? `PlanningAreaID eq '${destino.planningArea}' and VersionID eq '${destino.versionId}'`
    : `PlanningAreaID eq '${destino.planningArea}'`
}

/** Qué entidades están mapeadas, según lo que dejó la descarga (`ent` de v7). */
export function entidadesMapeadas(hechos) {
  const entidad = (tabla) => (hechos ?? []).find((uno) => uno.tabla === tabla)?.entidad ?? null
  return {
    psh: entidad('bom_psh'),
    psi: entidad('bom_psi'),
    psiSub: entidad('bom_psisub'),
    psr: entidad('bom_psr'),
    prd: entidad('bom_prd'),
    loc: entidad('bom_loc'),
    res: entidad('bom_res'),
    resLoc: entidad('bom_resloc'),
    locPrd: entidad('sn_loc_prod'),
    locSrc: entidad('sn_loc'),
  }
}

/**
 * Corre el análisis completo sobre lo que acaba de bajar la descarga.
 *
 * `clasificacion` es la que guarda la pantalla (`{ tipo: { excluido, categorias } }`); aquí se
 * convierte a la forma de v7 y se pone al día con el maestro de productos que acaba de leerse, como hacía
 * `mattyeInit(PA_PRD)` al terminar de bajar.
 */
export async function analizarProduccionDescargada({
  hechos, destino, conexion = {}, clasificacion, cuenta = {}, extras = {}, hoy,
  alAvanzar, registrar, ceder,
}) {
  const ent = entidadesMapeadas(hechos)
  const datos = await leerDatosDeProduccion({ ent, extras })

  let tipos = desdeClasificacion(clasificacion, cuenta)
  if (Object.keys(datos.prd).length) tipos = actualizarTipos(tipos, datos.prd)

  return analizarProduccion({
    ent,
    ...datos,
    tipos,
    extras,
    conexion,
    ejecucion: {
      generadoEl: new Date(),
      filtro: filtroDeV7(destino),
      entidades: entidadesDeLaEjecucion(hechos),
    },
    hoy,
    alAvanzar,
    registrar,
    ceder,
  })
}
