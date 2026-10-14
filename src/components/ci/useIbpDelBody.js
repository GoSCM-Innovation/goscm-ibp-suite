// Lo que IBP dice de ESTE body: su área, su tabla o sus cifras, y qué no cuadra.
//
// Junta en un solo lugar las lecturas que dependen del body (los campos de la tabla de dato maestro, las
// dimensiones y cifras del área), para que el formulario, la pestaña JSON y el diálogo de ejecución vean lo mismo y
// no se pida dos veces.
//
// Una tabla o un área solo se leen si IBP las tiene: leer los campos de lo que se está escribiendo a medias
// (`S`, `SB`, `SBP`…) pediría el `$metadata` de dato maestro, de varios megas, en cada tecla.

import { leerBody } from '../../../core/ci/body.js'
import { componerTipo } from '../../../core/ci/ibp-nombres.js'
import { leerMapeo } from '../../../core/ci/mapping.js'
import { areaDelCatalogo, esVariable, revisarContraIbp, tablasDeVersion } from '../../lib/ci-ibp.js'
import { useLecturaIbp } from './useCatalogoIbp.js'

/**
 * @param {ReturnType<import('./useCatalogoIbp.js').useCatalogoIbp> | null} catalogo
 * @param {string} texto  El body tal cual está escrito.
 * @returns {null | {
 *   tipo: string, area: object | null, tabla: string, campos: Array | null, cifras: object | null,
 *   cargando: boolean, error: string, avisos: string[], ibpNombre: string, areas: Array,
 *   leer: Function,
 * }} `null` mientras no hay catálogo listo.
 */
export function useIbpDelBody(catalogo, texto) {
  const listo = catalogo?.fase === 'listo'
  const leido = leerBody(texto)
  const bloque = leido.ok ? leido.bloque : {}
  const textoDe = (campo) => (typeof bloque[campo] === 'string' ? bloque[campo].trim() : '')

  const tipo = textoDe('TypeOfData')
  const idArea = textoDe('PlanningArea')
  const version = textoDe('PlanningAreaVersion')
  const area = listo && idArea && !esVariable(idArea) ? areaDelCatalogo(catalogo.areas, idArea) : null

  // La tabla, con las mayúsculas con que IBP la escribe, y solo si IBP la tiene en esa versión del área.
  const tablaEscrita = componerTipo(textoDe('MasterDataPrefix'), textoDe('MasterDataType'))
  const tabla = tipo === 'MASTERDATA' && area && tablaEscrita
    ? (tablasDeVersion(area, esVariable(version) ? '' : version).find((una) => una.toUpperCase() === tablaEscrita.toUpperCase()) ?? '')
    : ''

  const lecturaCampos = useLecturaIbp(catalogo, 'campos-maestro', tabla ? { entidad: tabla } : null)
  const lecturaCifras = useLecturaIbp(catalogo, 'cifras', tipo === 'KEYFIGURES' && area ? { area: area.id } : null)

  if (!listo) return null

  const campos = lecturaCampos.datos?.campos ?? null
  const cifras = lecturaCifras.datos ?? null
  const detalle = tipo === 'MASTERDATA' ? { tipo, campos } : tipo === 'KEYFIGURES' ? { tipo, cifras } : null

  return {
    tipo,
    area,
    tabla,
    campos,
    cifras,
    cargando: lecturaCampos.cargando || lecturaCifras.cargando,
    error: lecturaCampos.error || lecturaCifras.error,
    avisos: leido.ok
      ? revisarContraIbp({ bloque, areas: catalogo.areas, ibpNombre: catalogo.ibp?.nombre, filas: leerMapeo(bloque).filas, detalle })
      : [],
    ibpNombre: catalogo.ibp?.nombre ?? '',
    areas: catalogo.areas,
    leer: catalogo.leer,
  }
}
