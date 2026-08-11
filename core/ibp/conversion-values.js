// Qué unidades y qué monedas tiene un tenant, para no escribirlas a mano.
//
// Portado de `fetchConversionValues` de `services/planningDataApi.js` de v8.
//
// Hay cifras clave que SAP no deja leer sin decirle a qué unidad o a qué moneda convertirlas, y el
// mensaje de error nombra el atributo pero no dice qué valores acepta. Escribirlo a mano funciona
// —«KG»— pero adivinar el que hay en ESTE tenant no: en el de pruebas «KG» tiene datos y «EA» no, y
// eso no se sabe hasta que la consulta vuelve vacía.
//
// Los valores no están en el servicio de cifras, sino en el de dato maestro: en una tabla cuyo nombre
// acaba en `UOMTO` o en `CURRENCYTO`. El prefijo es del tenant —`AS1UOMTO`, `GIDUOMTO`—, así que se
// busca por el sufijo y no por un nombre fijo. Es la misma idea que resolver las entidades del
// Explorer por su papel y no por cómo se llaman.

import { catalogoDesdeVsmt } from './master-data-model.js'
import { readEntityPage, readVsmt } from './master-data.js'

/**
 * Los dos atributos de conversión, con la tabla donde viven sus valores.
 *
 * `CURRENCYTO` y no `CURRTO`: el atributo se llama `CURRTOID` pero la tabla es `…CURRENCYTO`. No es
 * un error de transcripción, es de SAP.
 */
export const CONVERSIONES = Object.freeze({
  UOMTOID: Object.freeze({ sufijo: 'UOMTO', id: 'UOMTOID', descripcion: 'UOMTODESCR', etiqueta: 'unidad' }),
  CURRTOID: Object.freeze({ sufijo: 'CURRENCYTO', id: 'CURRTOID', descripcion: 'CURRTODESCR', etiqueta: 'moneda' }),
})

/** Cuántos valores se traen. Un tenant tiene decenas de unidades, no miles. */
export const MAX_VALORES = 5000

/**
 * La tabla de este tenant que guarda los valores de una conversión.
 *
 * Se busca por sufijo entre las tablas del área. `UOMTO` acabaría casando también con algo como
 * `ZUOMTO`, y eso es lo que se quiere: lo que no se puede es fijar el prefijo.
 */
export function tablaDeConversion(mdts, sufijo) {
  const sube = String(sufijo ?? '').toUpperCase()
  if (!sube) return null
  return (mdts ?? []).find((uno) => String(uno ?? '').toUpperCase().endsWith(sube)) ?? null
}

/** Todas las tablas de un área, de todas sus versiones. */
export function mdtsDelArea(catalogo, area) {
  const versiones = catalogo?.[area]?.versions ?? []
  return [...new Set(versiones.flatMap((una) => una.mdts ?? []))]
}

/**
 * Los valores de una conversión en un tenant: `[{ id, descripcion }]`.
 *
 * Devuelve una lista vacía —y no un error— cuando el tenant no tiene esa tabla. Ofrecer los valores
 * es una comodidad: si no se pueden traer, el campo sigue aceptando lo que se escriba, y romper la
 * pantalla por no poder rellenar un desplegable sería peor que no tenerlo.
 */
export async function readConversionValues({ baseUrl, credentials, area, atributo }) {
  const cual = CONVERSIONES[atributo]
  if (!cual) return []

  const catalogo = catalogoDesdeVsmt(await readVsmt({ baseUrl, credentials }))
  const tabla = tablaDeConversion(mdtsDelArea(catalogo, area), cual.sufijo)
  if (!tabla) return []

  let filas
  try {
    filas = await readEntityPage({
      baseUrl,
      credentials,
      entidad: tabla,
      planningArea: area,
      select: [cual.id, cual.descripcion],
      top: MAX_VALORES,
    })
  } catch {
    return []
  }

  // La tabla es específica de versión: el mismo valor sale una vez por cada versión del área.
  const vistos = new Map()
  for (const fila of filas) {
    const id = fila?.[cual.id]
    if (!id || vistos.has(id)) continue
    vistos.set(id, fila[cual.descripcion] || id)
  }

  return [...vistos.entries()]
    .map(([id, descripcion]) => ({ id, descripcion }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}
