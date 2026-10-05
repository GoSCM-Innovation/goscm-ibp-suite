// Llevarse lo que hay en la lista del explorador a una hoja de cálculo.
//
// Portado de `_tasksToTSV` y `_dimEntriesToTSV` de `explorer.js` de v9, con SUS cabeceras y SUS
// columnas: «ZIP · Tarea · Datastore Origen · Datastore Destino · Tabla Destino». Es lo que permite
// pasarle a alguien el inventario de integraciones de un proyecto sin generar el documento entero.
//
// Se copia exactamente lo que se está viendo, con los filtros y la búsqueda ya aplicados: si la
// lista muestra doce, se copian esas doce.

import { dimensionPorId } from './integration-view.js'
import { toTsv } from './tsv.js'

/** El inventario de integraciones: una fila por integración, sin el `.zip` del nombre del proyecto. */
export function tareasATsv(lista) {
  return toTsv([
    ['ZIP', 'Tarea', 'Datastore Origen', 'Datastore Destino', 'Tabla Destino'],
    ...lista.map((una) => [
      (una._zipName || '').replace(/\.zip$/i, ''),
      una.jobName,
      una.srcDSName,
      una.dstDSName,
      una.targetTable,
    ]),
  ])
}

/**
 * El listado de una dimensión: qué tabla o campo, en cuántas integraciones y con cuántos usos.
 *
 * Las columnas cambian con la dimensión: una tabla lleva su datastore delante y un campo no, y lo que
 * se cuenta es «Filtros» en las dimensiones de filtro, «Usos» en las de campo y «Mapeos» en las de tabla.
 */
export function dimensionATsv(dim, entradas) {
  const definicion = dimensionPorId(dim)
  const esCampo = dim.endsWith('-field')
  const esFiltro = definicion.fila === 'fIdx'
  let columnaDeConteo = 'Mapeos'
  if (esFiltro) columnaDeConteo = 'Filtros'
  else if (esCampo) columnaDeConteo = 'Usos'

  const integracionesDe = (filas) => new Set(filas.map((una) => una.intIdx)).size

  if (esCampo) {
    return toTsv([
      ['Campo', 'Integraciones', columnaDeConteo],
      ...entradas.map((una) => [una.clave, integracionesDe(una.filas), una.filas.length]),
    ])
  }

  return toTsv([
    ['Datastore', 'Tabla', 'Integraciones', columnaDeConteo],
    ...entradas.map((una) => {
      const [datastore, tabla] = una.clave.split('::')
      return [datastore || '', tabla || una.clave, integracionesDe(una.filas), una.filas.length]
    }),
  ])
}

/** Las tareas distintas que tocan una clave de dimensión, para el «Copiar» del detalle (`copyDimDetailList`). */
export function integracionesDeLaEntrada(entrada, integraciones) {
  const vistas = new Set()
  const lista = []
  for (const fila of entrada?.filas ?? []) {
    if (vistas.has(fila.intIdx)) continue
    vistas.add(fila.intIdx)
    if (integraciones[fila.intIdx]) lista.push(integraciones[fila.intIdx])
  }
  return lista
}
