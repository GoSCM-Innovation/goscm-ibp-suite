// Llevarse lo que hay en la lista del explorador a una hoja de cálculo.
//
// Portado de `_tasksToTSV` y `_dimEntriesToTSV` de `explorer.js` de v9. Es lo que permite pasarle a
// alguien el inventario de integraciones de un proyecto sin generar el documento entero.
//
// Se copia exactamente lo que se está viendo, con los filtros y la búsqueda ya aplicados: si la
// lista muestra doce, se copian esas doce.

import { dimensionPorId } from './integration-view.js'
import { toTsv } from './tsv.js'

/**
 * El inventario de integraciones: una fila por dataflow.
 *
 * Sin agrupar por tarea, a propósito: dos dataflows de la misma tarea pueden escribir a tablas
 * distintas, y juntarlos escondería justamente eso.
 */
export function tareasATsv(lista) {
  return toTsv([
    ['Proyecto', 'Tarea', 'Dataflow', 'Sistema origen', 'Sistema destino', 'Tabla destino'],
    ...lista.map((una) => [
      (una._zipName || '').replace(/\.zip$/i, ''),
      una.jobName,
      una.dataflowName,
      una.srcDSName,
      una.dstDSName,
      una.targetTable,
    ]),
  ])
}

/**
 * El listado de una dimensión: qué tabla o campo, en cuántas integraciones y con cuántos usos.
 *
 * Las columnas cambian con la dimensión porque una tabla lleva su datastore delante y un campo no,
 * y porque en las dimensiones de filtro lo que se cuenta son filtros, no mapeos.
 */
export function dimensionATsv(dim, entradas) {
  const definicion = dimensionPorId(dim)
  const esCampo = dim.endsWith('-field')
  const columnaDeUsos = definicion.fila === 'fIdx' ? 'Filtros' : 'Usos'

  const integracionesDe = (filas) => new Set(filas.map((una) => una.intIdx)).size

  if (esCampo) {
    return toTsv([
      ['Campo', 'Integraciones', columnaDeUsos],
      ...entradas.map((una) => [una.clave, integracionesDe(una.filas), una.filas.length]),
    ])
  }

  return toTsv([
    ['Datastore', 'Tabla', 'Integraciones', columnaDeUsos],
    ...entradas.map((una) => {
      const [datastore, tabla] = una.clave.split('::')
      return [datastore || '', tabla || una.clave, integracionesDe(una.filas), una.filas.length]
    }),
  ])
}
