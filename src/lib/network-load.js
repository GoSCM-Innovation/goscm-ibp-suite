// Leer del navegador lo que hace falta para la red de UN producto.
//
// Todas las tablas de la red están indexadas por producto, así que esto son seis lecturas acotadas y
// no un recorrido: la diferencia con el árbol de materiales, que sí tiene que ir bajando nivel a
// nivel. Aquí la red es plana por definición —de dónde entra, por dónde pasa, a quién sale—.
//
// El maestro de ubicaciones se lee ENTERO por cursor: son cientos, no cientos de miles, y hace falta
// completo para poder decir de cada una si es proveedor (`LOCTYPE = V`) sin tener que adivinarlo.

import { indexarMaestro, texto } from '../../core/ibp/bom-tree.js'
import { leerPorIndice, leerUno, porCursor } from './explorer-db.js'

/** Los productos que tienen algo en la red, para el buscador. */
export async function productosConRed() {
  const vistos = new Map()

  const anotar = (prd, donde) => {
    const id = texto(prd)
    if (!id) return
    const suyo = vistos.get(id) ?? { prdid: id, plantas: 0, arcos: 0, clientes: 0 }
    suyo[donde] += 1
    vistos.set(id, suyo)
  }

  await porCursor('sn_plant', (fila) => anotar(fila.PRDID, 'plantas'))
  await porCursor('sn_loc', (fila) => anotar(fila.PRDID, 'arcos'))
  await porCursor('sn_cust', (fila) => anotar(fila.PRDID, 'clientes'))

  return [...vistos.values()].sort((a, b) => a.prdid.localeCompare(b.prdid))
}

/**
 * Todo lo que la red de `prdid` necesita.
 *
 * Los arcos se leen DOS veces, y es la parte que importa: la tabla de arcos está indexada por el
 * producto que viaja, así que los arcos del producto terminado y los de sus materiales son consultas
 * distintas. Sin la segunda no hay proveedores en la red, que es media red.
 *
 * v7 hacía lo mismo, pero armaba un `$filter` de OData con los componentes y lo cortaba a los 100
 * primeros para no pasarse del largo de una URL. Aquí se lee de la base local: no hay tope, y una
 * receta con doscientos materiales no pierde la mitad de sus proveedores en silencio.
 */
export async function cargarRed(prdid) {
  const producto = texto(prdid)

  const [plantas, arcos, clientes] = await Promise.all([
    leerPorIndice('sn_plant', 'by_prdid', producto),
    leerPorIndice('sn_loc', 'by_prdid', producto),
    leerPorIndice('sn_cust', 'by_prdid', producto),
  ])

  // Los componentes de las recetas que fabrican este producto.
  const recetas = [...new Set(plantas.map((una) => texto(una.SOURCEID)).filter(Boolean))]
  const componentes = (await Promise.all(
    recetas.map((sid) => leerPorIndice('sn_psi', 'by_sourceid', sid).catch(() => [])),
  )).flat()

  // Y los arcos de esos materiales: de ahí salen los proveedores.
  const materiales = [...new Set(componentes.map((una) => texto(una.PRDID)).filter(Boolean))]
  const arcosDeComponentes = (await Promise.all(
    materiales.map((prd) => leerPorIndice('sn_loc', 'by_prdid', prd).catch(() => [])),
  )).flat()

  // El plazo de fabricación de cada planta, que viene en la fila de la receta.
  const plazoDePlanta = {}
  for (const fila of plantas) {
    const loc = texto(fila.LOCID)
    if (loc && !plazoDePlanta[loc]) plazoDePlanta[loc] = texto(fila.PLEADTIME)
  }

  const ubicaciones = {}
  const filasDeUbicacion = []
  await porCursor('bom_loc', (fila) => { filasDeUbicacion.push(fila) })
  indexarMaestro(ubicaciones, filasDeUbicacion, 'LOCID')

  // Los clientes que salen en la red, uno a uno por su clave: son los de este producto, no los 631
  // del tenant.
  const maestroDeClientes = {}
  const cuales = [...new Set(clientes.map((una) => texto(una.CUSTID)).filter(Boolean))]
  const filasDeCliente = await Promise.all(
    cuales.map((id) => leerUno('sn_cust_master', id).catch(() => null)),
  )
  indexarMaestro(maestroDeClientes, filasDeCliente.filter(Boolean), 'CUSTID')

  const fila = await leerUno('bom_prd', producto).catch(() => null)

  return {
    producto: fila ?? { PRDID: producto },
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
