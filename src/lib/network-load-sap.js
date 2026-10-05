// La red de UN producto, leída de SAP filtrada por ese producto.
//
// El VISUALIZADOR dibuja un producto. Sus arcos son unas decenas de filas, y pedírselas a SAP filtradas
// cuesta unas pocas peticiones pequeñas. Exigir la descarga completa para eso —casi 3 millones de filas
// y cerca de una hora en un tenant real— convertía en una espera algo que en v7 era inmediato. El
// ANALIZADOR, en cambio, recorre el grafo entero y sí necesita las tablas completas: para eso está la
// descarga.
//
// La secuencia es la de `visualizer.js` de v7, incluido el tope de componentes: los arcos de proveedor
// se piden con un `PRDID eq … or …` por cada componente, y sin tope la URL se pasa de largo y SAP la
// rechaza. v7 cortaba en 100 y aquí se conserva el mismo número, porque el motivo sigue siendo el mismo.
//
// SIEMPRE SE LEE DE SAP, como v7 (decisión del usuario, 2026-10-01: «Data Tools tiene que ser idéntico
// a v7»). Antes se leía primero de lo descargado en el navegador; pero reutilizar lo guardado no
// captura los cambios hechos en el tenant desde la última vez, que es justo por lo que los analizadores
// repiten la descarga siempre. Y se escribe en un registro las mismas líneas que v7 —`[GET] …` antes de
// cada petición y `✓ Location Source: N registros` después—, que es lo que se ve tras «Ver logs técnicos».

import { descartarInvalidas, planificarExtraccion } from '../../core/ibp/explorer-extract-plan.js'
import { normalizarFilas } from '../../core/ibp/explorer-fields.js'
import { indexarMaestro } from '../../core/ibp/bom-tree.js'
import { fetchMasterRows } from './ibp-master-data.js'

/** Un valor de SAP como texto limpio. */
const texto = (valor) => String(valor ?? '').trim()

/** Filas por página. El costo de una petición a IBP es casi todo latencia fija. */
export const FILAS_POR_PAGINA = 5000

/**
 * Cuántos componentes entran en la consulta de arcos de proveedor.
 *
 * El tope es del largo de la URL, no del volumen: cada componente añade un `PRDID eq '…' or ` y SAP
 * rechaza la petición si se pasa. Es el mismo número que usaba v7 y por la misma razón.
 */
export const TOPE_DE_COMPONENTES = 100

/** Cuántas ubicaciones se preguntan a la vez al buscar las plantas de un insumo (el tope de v7). */
export const TOPE_DE_DESTINOS = 80

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

/** El paso del plan que lee esa tabla. */
const pasoDe = (plan, tabla) => plan.pasos.find((uno) => uno.tabla === tabla) ?? null

/**
 * El plan de lectura con lo que se eligió en las tarjetas del Network Visualizer.
 *
 * El maestro de productos y el de ubicaciones están en DOS grupos de la detección —el árbol y la
 * red—, y el plan los lee del árbol. Pero las tarjetas «Product» y «Location» de esta pantalla editan
 * los de la RED, así que sin este paso lo que se elige ahí no se usaría: el plan seguiría pidiendo la
 * tabla que detectó el árbol. Aquí gana lo de la red, y el árbol solo es el respaldo.
 */
export function planDeLaRed(efectivo = {}, mapa = {}) {
  return planificarExtraccion({
    efectivo: efectivoDeLaRed(efectivo),
    mapa,
    grupos: ['arbol', 'red'],
  })
}

/**
 * Lo que se resolvió en el mapeo, con el maestro de productos y el de ubicaciones de la RED en el lugar
 * donde el plan los busca (el árbol). Lo usan también los analizadores de la red.
 */
export function efectivoDeLaRed(efectivo = {}) {
  const deLaRed = efectivo.red ?? {}
  const arbol = efectivo.arbol ?? {}
  return {
    ...efectivo,
    arbol: {
      ...arbol,
      product: deLaRed.product ?? arbol.product,
      locMaster: deLaRed.locMaster ?? arbol.locMaster,
    },
  }
}

/**
 * El `$filter` como lo escribía v7 en el registro: el área y la versión, y después las condiciones.
 *
 * Es lo que se le pide a SAP, dicho en voz alta. El navegador no sabe la dirección del tenant —vive
 * cifrada en el servidor—, así que la línea no lleva la URL, pero sí la entidad, el filtro y los campos.
 */
export function filtroLegible(destino, condiciones = []) {
  const partes = []
  if (destino?.planningArea) {
    partes.push(`PlanningAreaID eq '${destino.planningArea}'`)
    if (destino.versionId) partes.push(`VersionID eq '${destino.versionId}'`)
  }
  for (const una of condiciones) {
    const valores = String(una.value).split(',')
    const cuerpo = valores.map((valor) => `${una.field} eq '${valor}'`).join(' or ')
    partes.push(valores.length > 1 ? `(${cuerpo})` : cuerpo)
  }
  return partes.join(' and ')
}

/** La línea `[GET] …` de v7 para una petición. */
export function lineaGet(paso, destino, condiciones) {
  const filtro = filtroLegible(destino, condiciones)
  return `[GET] ${paso.entidad}${filtro ? ` | $filter=${filtro}` : ''} | $select=${paso.select.join(',')}`
}

/**
 * Los productos que se pueden mirar, leídos del maestro.
 *
 * Es el «Descargando catálogo de productos…» de v7: el maestro de productos filtrado por área, para
 * alimentar el buscador de material. Son dos páginas —8.134 filas en el tenant de pruebas— y se leen
 * una vez, al confirmar el mapeo.
 *
 * No dice cuántos arcos tiene cada uno: saberlo exigiría una consulta por producto.
 */
export async function productosDeSap({
  conexionId, destino, plan, mapa = {}, onRegistro, signal,
}) {
  const paso = pasoDe(plan, 'bom_prd')
  if (!paso?.sePuede) {
    throw new Error('No hay una entidad de Product en el mapeo: elige una antes de confirmar.')
  }

  onRegistro?.('info', lineaGet(paso, destino, []))
  const filas = await pedir({
    conexionId,
    destino,
    mapa,
    paso,
    // Sin condiciones: es el maestro del área, y el área ya va en el filtro que arma el servidor.
    condiciones: [],
    signal,
  })

  const productos = filas
    .map((fila) => ({ prdid: texto(fila.PRDID), descripcion: texto(fila.PRDDESCR) }))
    .filter((uno) => uno.prdid)
    .sort((a, b) => a.prdid.localeCompare(b.prdid))

  onRegistro?.('ok', `✓ ${productos.length} productos cargados`)
  return productos
}

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
 * Devuelve las filas tal como las espera `armarRed`. `onRegistro(clase, texto)` recibe las líneas del
 * registro técnico, con las mismas palabras que v7.
 */
export async function cargarRedDeSap({
  conexionId, destino, plan, mapa = {}, prdid, onRegistro, signal,
}) {
  const producto = texto(prdid)
  const comun = { conexionId, destino, mapa, signal }
  const paso = (tabla) => pasoDe(plan, tabla)
  const soloEsteProducto = [{ field: 'PRDID', op: 'eq', value: producto }]

  /** Pide una tabla anotando la petición y, al volver, cuántos registros trajo. */
  async function leer(tabla, condiciones, etiqueta, { peticion, resultado } = {}) {
    const este = paso(tabla)
    if (!este?.sePuede || condiciones.some((una) => una.value === '')) return []
    onRegistro?.('info', peticion ?? lineaGet(este, destino, condiciones))
    const filas = await pedir({ ...comun, paso: este, condiciones })
    onRegistro?.('ok', resultado?.(filas) ?? `✓ ${etiqueta}: ${filas.length} registros`)
    return filas
  }

  // 1. Las recetas del producto, sus arcos entre ubicaciones y sus arcos a cliente. Tres tablas
  //    filtradas por el mismo producto, así que van juntas.
  const [plantas, arcos, clientes] = await Promise.all([
    leer('sn_plant', soloEsteProducto, 'Production Source Header'),
    leer('sn_loc', soloEsteProducto, 'Location Source'),
    leer('sn_cust', soloEsteProducto, 'Customer Source'),
  ])

  // 2. Los componentes, por las recetas que salieron. No por producto: una receta se identifica por
  //    su `SOURCEID`, y es lo único que ata un componente a la receta que lo lleva.
  const recetas = valoresDe(plantas, 'SOURCEID')
  const componentes = recetas.length === 0 ? [] : await leer(
    'sn_psi',
    [{ field: 'SOURCEID', op: 'eq', value: recetas.join(',') }],
    'PSI',
    {
      peticion: `[GET] ${paso('sn_psi')?.entidad} | PSI para ${recetas.length} fuentes`,
      resultado: (filas) => `✓ PSI: ${filas.length} componentes`,
    },
  )

  // 3. Los arcos que traen esos componentes: de ahí salen los proveedores. Topado por el largo de la
  //    URL, no por volumen.
  const materiales = valoresDe(componentes, 'PRDID', TOPE_DE_COMPONENTES)
  const arcosDeComponentes = materiales.length === 0 ? [] : await leer(
    'sn_loc',
    [{ field: 'PRDID', op: 'eq', value: materiales.join(',') }],
    'Arcos de proveedor',
    {
      peticion: `[GET] ${paso('sn_loc')?.entidad} | Arcos de proveedor para ${materiales.length} componentes`,
    },
  )

  // 4. Los maestros, solo de los códigos que de verdad salieron. Pedir los 478 de ubicaciones y los
  //    9.082 de clientes para dibujar una red de veinte nodos es traer el tenant para nada.
  const codigosDeUbicacion = [...new Set(valoresDe(
    [...plantas, ...arcos, ...arcosDeComponentes, ...clientes],
    'LOCID',
  ).concat(valoresDe([...arcos, ...arcosDeComponentes], 'LOCFR')))]
  const codigosDeCliente = valoresDe(clientes, 'CUSTID')

  const [filasDeUbicacion, filasDeCliente] = await Promise.all([
    codigosDeUbicacion.length === 0 ? [] : leer(
      'bom_loc',
      [{ field: 'LOCID', op: 'eq', value: codigosDeUbicacion.join(',') }],
      'Location Master',
    ),
    codigosDeCliente.length === 0 ? [] : leer(
      'sn_cust_master',
      [{ field: 'CUSTID', op: 'eq', value: codigosDeCliente.join(',') }],
      'Customer Master',
    ),
  ])

  // 5. Si el producto no tiene recetas propias —es un insumo—, qué plantas hay en los destinos de sus
  //    arcos. Sin esto, un insumo que llega a una planta la pintaría como una ubicación cualquiera.
  let plantasGlobales = []
  if (plantas.length === 0) {
    const destinos = valoresDe([...arcos, ...arcosDeComponentes], 'LOCID', TOPE_DE_DESTINOS)
    if (destinos.length > 0) {
      const globales = await leer(
        'sn_plant',
        [{ field: 'LOCID', op: 'eq', value: destinos.join(',') }],
        'Plantas globales',
        {
          peticion: `[GET] PSH global por LOCID para detectar plantas (${destinos.length} ubicaciones)`,
          resultado: (filas) => `✓ Plantas globales detectadas: ${valoresDe(filas, 'LOCID').length}`,
        },
      )
      plantasGlobales = valoresDe(globales, 'LOCID')
    }
  }

  const ubicaciones = {}
  indexarMaestro(ubicaciones, filasDeUbicacion, 'LOCID')
  const maestroDeClientes = {}
  indexarMaestro(maestroDeClientes, filasDeCliente, 'CUSTID')

  return {
    plantas,
    arcos,
    arcosDeComponentes,
    clientes,
    componentes,
    plantasGlobales,
    ubicaciones,
    maestroDeClientes,
  }
}
