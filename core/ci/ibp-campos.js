// Los campos de una tabla de dato maestro de IBP, con su etiqueta y su tipo, sacados del `$metadata`.
//
// Sirve para el selector de campos de CI Tools: elegir qué campos de `SBPRODUCT` se cargan, y de ahí armar el
// mapeo. Se lee con expresiones sobre el texto y no con un analizador de XML por el mismo motivo que
// `core/ibp/catalog.js`: el `$metadata` de dato maestro pesa varios megas y Node no trae analizador de serie.
//
// A diferencia de `parseCatalog`, aquí los nombres de campo conservan sus MAYÚSCULAS Y MINÚSCULAS tal como los
// publica SAP: el body se escribe con ese nombre exacto, y `entityProps` los pasa a mayúsculas para comparar.

import { formatEdmType } from '../ibp/catalog.js'
import { esCampoDeSistema } from './ibp-nombres.js'

/** Un atributo de una etiqueta XML. */
const atributo = (etiqueta, nombre) => etiqueta.match(new RegExp(`\\b${nombre}="([^"]*)"`))?.[1]

/**
 * Los campos de una tabla: `[{ campo, etiqueta, tipo, sistema }]`, o `null` si el `$metadata` no la declara.
 *
 * `etiqueta` es la descripción de SAP (vacía si no la tiene), `tipo` el tipo de dato como lo dicen los proyectos
 * de IBP (`NVARCHAR(40)`) y `sistema` marca los que SAP rellena solo.
 */
export function parseCamposDeEntidad(xml, entidad) {
  const texto = String(xml ?? '')
  const pedida = String(entidad ?? '').toUpperCase()

  let tipoDeLaEntidad = null
  for (const coincidencia of texto.matchAll(/<EntitySet\b[^>]*>/g)) {
    if ((atributo(coincidencia[0], 'Name') ?? '').toUpperCase() === pedida) {
      tipoDeLaEntidad = (atributo(coincidencia[0], 'EntityType') ?? '').split('.').pop()
      break
    }
  }
  if (!tipoDeLaEntidad) return null

  for (const bloque of texto.matchAll(/<EntityType\b[^>]*>[\s\S]*?<\/EntityType>/g)) {
    const abre = bloque[0].match(/<EntityType\b[^>]*>/)[0]
    if (atributo(abre, 'Name') !== tipoDeLaEntidad) continue

    const campos = []
    for (const propiedad of bloque[0].matchAll(/<Property\b[^>]*>/g)) {
      const etiquetaXml = propiedad[0]
      const campo = atributo(etiquetaXml, 'Name')
      if (!campo) continue
      campos.push({
        campo,
        etiqueta: atributo(etiquetaXml, 'sap:label') ?? '',
        tipo: formatEdmType(
          atributo(etiquetaXml, 'Type'),
          atributo(etiquetaXml, 'MaxLength'),
          atributo(etiquetaXml, 'Precision'),
          atributo(etiquetaXml, 'Scale'),
        ),
        sistema: esCampoDeSistema(campo),
      })
    }
    return campos
  }
  return null
}
