// La red de UN producto, leída de SAP filtrada por ese producto.
//
// Es el hermano de `network-load.js`, que lee lo mismo de la base local. Existen los dos porque las
// dos pantallas de red tienen necesidades opuestas, y es así como lo resolvía v7:
//
//   - El ANALIZADOR recorre el grafo entero, así que necesita las tablas completas. Para eso está la
//     descarga, y en un tenant real son casi 3 millones de filas y cerca de una hora. v7 pagaba lo
//     mismo y no hay alternativa: no se puede recorrer un grafo que no se tiene.
//   - El VISUALIZADOR dibuja un producto. Sus arcos son unas decenas de filas, y pedírselas a SAP
//     filtradas cuesta unas pocas peticiones pequeñas. Exigir la descarga completa para eso convierte
//     algo inmediato en una hora de espera, que es lo que pasaba acá y no en v7.
//
// La secuencia es la de `visualizer.js` de v7, incluido el tope de componentes: los arcos de proveedor
// se piden con un `PRDID eq … or …` por cada componente, y sin tope la URL se pasa de largo y SAP la
// rechaza. v7 cortaba en 100 y acá se conserva el mismo número, porque el motivo sigue siendo el mismo.

import { descartarInvalidas } from '../../core/ibp/explorer-extract-plan.js'
import { normalizarFilas } from '../../core/ibp/explorer-fields.js'
import { indexarMaestro } from '../../core/ibp/bom-tree.js'
import { texto } from '../../core/ibp/production-analysis.js'
import { fetchMasterRows } from './ibp-master-data.js'

/** Filas por página. El costo de una petición a IBP es casi todo latencia fija. */
export const FILAS_POR_PAGINA = 5000

/**
 * Cuántos componentes entran en la consulta de arcos de proveedor.
 *
 * El tope es del largo de la URL, no del volumen: cada componente añade un `PRDID eq '…' or ` y SAP
 * rechaza la petición si se pasa. Es el mismo número que usaba v7 y por la misma razón.
 */
export const TOPE_DE_COMPONENTES = 100

/** Pide todas las páginas de una tabla con esas condiciones. */
async function pedir({ conexionId, destino, paso, mapa, condiciones, signal }) {
  if (!paso?.sePuede || condiciones.some((una) => una.value === '')) return []

  const filas = []
  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const pagina = await fetchMasterRows(conexionId, {
      entidad: paso.entidad,
      planningArea: destino.planningArea,
      versionId: destino.versionId,
      select: paso.select,
      condiciones,
      // El orden estable es obligatorio al paginar: sin él, dos ventanas sobre una tabla que alguien
      // está tocando se solapan y dejan huecos.
      orderby: paso.select.slice(0, 2),
      skip: desde,
      top: FILAS_POR_PAGINA,
      signal,
    })

    filas.push(...pagina)
    if (pagina.length < FILAS_POR_PAGINA) break
  }

  // Primero se traducen los nombres a los canónicos y DESPUÉS se descarta: la marca de invalidez puede
  // llamarse distinto en este tenant, y el filtro busca el nombre canónico.
  return descartarInvalidas(normalizarFilas(mapa, paso.entidad, filas), paso.descartarSi)
}

/** El paso del plan que baja esa tabla local. */
const pasoDe = (plan, tabla) => plan.pasos.find((uno) => uno.tabla === tabla) ?? null

/** Los valores distintos de un campo, sin vacíos, listos para un `eq … or …`. */
function valoresDe(filas, campo, tope = Infinity) {
  const vistos = new Set()
  for (const fila of filas ?? []) {
    const valor = texto(fila[campo])
    if (valor) vistos.add(valor)
    if (vistos.size >= tope) break
  }
  return [...vistos]
}

/**
 * Lee de SAP todo lo que hace falta para dibujar la red de un producto.
 *
 * Devuelve exactamente la misma forma que `cargarRed` de la base local, para que la pantalla no sepa
 * de dónde salió: quien dibuja no debería cambiar según de dónde vinieron las filas.
 */
export async function cargarRedDeSap({
  conexionId, destino, plan, mapa = {}, prdid, onAvance, signal,
}) {
  const producto = texto(prdid)
  const comun = { conexionId, destino, mapa, signal }
  const paso = (tabla) => pasoDe(plan, tabla)
  const soloEsteProducto = [{ field: 'PRDID', op: 'eq', value: producto }]

  // 1. Las recetas del producto, sus arcos entre ubicaciones y sus arcos a cliente. Tres tablas
  //    filtradas por el mismo producto, así que van juntas.
  onAvance?.({ paso: 'arcos' })
  const [plantas, arcos, clientes] = await Promise.all([
    pedir({ ...comun, paso: paso('sn_plant'), condiciones: soloEsteProducto }),
    pedir({ ...comun, paso: paso('sn_loc'), condiciones: soloEsteProducto }),
    pedir({ ...comun, paso: paso('sn_cust'), condiciones: soloEsteProducto }),
  ])

  // 2. Los componentes, por las recetas que salieron. No por producto: una receta se identifica por
  //    su `SOURCEID`, y es lo único que ata un componente a la receta que lo lleva.
  onAvance?.({ paso: 'componentes' })
  const recetas = valoresDe(plantas, 'SOURCEID')
  const componentes = recetas.length === 0 ? [] : await pedir({
    ...comun,
    paso: paso('sn_psi'),
    condiciones: [{ field: 'SOURCEID', op: 'eq', value: recetas.join(',') }],
  })

  // 3. Los arcos que traen esos componentes: de ahí salen los proveedores. Topado por el largo de la
  //    URL, no por volumen.
  onAvance?.({ paso: 'proveedores' })
  const materiales = valoresDe(componentes, 'PRDID', TOPE_DE_COMPONENTES)
  const arcosDeComponentes = materiales.length === 0 ? [] : await pedir({
    ...comun,
    paso: paso('sn_loc'),
    condiciones: [{ field: 'PRDID', op: 'eq', value: materiales.join(',') }],
  })

  // 4. Los maestros, solo de los códigos que de verdad salieron. Pedir los 478 de ubicaciones y los
  //    9.082 de clientes para dibujar una red de veinte nodos es traer el tenant para nada.
  onAvance?.({ paso: 'maestros' })
  const codigosDeUbicacion = valoresDe(
    [...plantas, ...arcos, ...arcosDeComponentes, ...clientes],
    'LOCID',
  ).concat(valoresDe([...arcos, ...arcosDeComponentes], 'LOCFR'))
  const codigosDeCliente = valoresDe(clientes, 'CUSTID')

  const [filasDeUbicacion, filasDeCliente, filasDeProducto] = await Promise.all([
    codigosDeUbicacion.length === 0 ? [] : pedir({
      ...comun,
      paso: paso('bom_loc'),
      condiciones: [{ field: 'LOCID', op: 'eq', value: [...new Set(codigosDeUbicacion)].join(',') }],
    }),
    codigosDeCliente.length === 0 ? [] : pedir({
      ...comun,
      paso: paso('sn_cust_master'),
      condiciones: [{ field: 'CUSTID', op: 'eq', value: codigosDeCliente.join(',') }],
    }),
    pedir({ ...comun, paso: paso('bom_prd'), condiciones: soloEsteProducto }),
  ])

  // El plazo de fabricación de cada planta, que viene en la fila de la receta.
  const plazoDePlanta = {}
  for (const fila of plantas) {
    const loc = texto(fila.LOCID)
    if (loc && !plazoDePlanta[loc]) plazoDePlanta[loc] = texto(fila.PLEADTIME)
  }

  const ubicaciones = {}
  indexarMaestro(ubicaciones, filasDeUbicacion, 'LOCID')
  const maestroDeClientes = {}
  indexarMaestro(maestroDeClientes, filasDeCliente, 'CUSTID')

  return {
    producto: filasDeProducto[0] ?? { PRDID: producto },
    plantas,
    arcos,
    arcosDeComponentes,
    clientes,
    componentes,
    plazoDePlanta,
    ubicaciones,
    maestroDeClientes,
  }
}
