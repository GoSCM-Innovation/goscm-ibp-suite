// Completar la documentación con lo que solo IBP sabe: la etiqueta, el tipo y un valor de ejemplo.
//
// Portado de `enrichMappingsFromIbp` y `backfillFromCache` de `docs.js` de v9.
//
// Lo caro acá no son las cuentas, son las consultas: una por entidad destino. Dos cachés evitan
// casi todas. El de entidades no vuelve a preguntar por la misma tabla, y el de campos aprovecha que
// un campo que se llama igual vale lo mismo en cualquier tabla —`PRDID` es `PRDID` en todas—, así
// que una integración cuyos campos ya se vieron no genera ninguna consulta.

// Se importa de `core/` a propósito: la regla de a qué entidad preguntarle es una sola y ya está
// probada ahí. `target-entity.js` no depende de nada, así que traerla no arrastra código de servidor
// al paquete del navegador.
import { resolveTargetEntity, selectFieldsFor } from '../../core/ibp/target-entity.js'

/** Un valor de SAP, listo para una celda. Las fechas de OData V2 vienen como `/Date(…)/`. */
export function formatIbpExample(valor) {
  if (valor === null || valor === undefined) return ''
  // Una propiedad de navegación viene como objeto y no es un dato que mostrar.
  if (typeof valor === 'object') return ''

  if (typeof valor === 'string') {
    const fecha = valor.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/)
    return fecha ? new Date(Number(fecha[1])).toISOString().slice(0, 10) : valor
  }

  return String(valor)
}

/** Los cachés que comparten todas las integraciones de una misma corrida. */
export const nuevaCache = (descs = {}) => ({
  porEntidad: new Map(),
  porCampo: new Map(),
  // Se siembra con las etiquetas del catálogo: son la mejor descripción que hay para un campo
  // que el export de CI-DS dejó sin describir.
  descripciones: new Map(Object.entries(descs).map(([campo, valor]) => [campo.toUpperCase(), valor])),
  avisos: [],
})

/**
 * Completa los mapeos de una integración.
 *
 * Devuelve la integración con sus mapeos enriquecidos, sin tocar la original: quien la llame decide
 * si se queda con el resultado.
 */
export async function enrichIntegration(integracion, catalogo, cache, pedirFila, planAreaElegida = '') {
  const destino = resolveTargetEntity(integracion, catalogo.entitySets, planAreaElegida)
  const campos = [...new Set(integracion.mappings.map((uno) => uno.dstField).filter(Boolean))]

  let fila = null

  if (destino) {
    // Si ya se conoce el ejemplo de todos los campos, no hace falta preguntar nada.
    const faltan = campos.filter((uno) => !cache.porCampo.has(uno.toUpperCase()))

    if (faltan.length > 0) {
      const selectFields = selectFieldsFor(destino, campos, catalogo.entityProps)
      const puedeConsultar = destino.service !== 'PLANNING_DATA_API_SRV' || selectFields.length > 0
      const clave = `${destino.service}|${destino.entitySet}|${destino.planArea}|${selectFields.join(',')}`

      if (!puedeConsultar) {
        cache.avisos.push(`${integracion.jobName}: ${destino.entitySet} no tiene ninguno de estos campos.`)
      } else if (!cache.porEntidad.has(clave)) {
        const { row, detail } = await pedirFila({ ...destino, selectFields })
        cache.porEntidad.set(clave, row)

        if (row) {
          for (const [campo, valor] of Object.entries(row)) {
            const formateado = formatIbpExample(valor)
            if (formateado !== '' && !cache.porCampo.has(campo)) cache.porCampo.set(campo, formateado)
          }
        } else {
          cache.avisos.push(`${integracion.jobName}: ${destino.entitySet} — ${detail}`)
        }
      }

      if (puedeConsultar) fila = cache.porEntidad.get(clave) ?? null
    }
  } else if ((integracion.tipoIntegracion || '').toUpperCase() !== 'FILE') {
    const area = planAreaElegida || integracion.planArea || '(ninguna)'
    cache.avisos.push(
      `${integracion.jobName}: no se pudo resolver la entidad de IBP `
      + `(tabla ${integracion.targetTable || '?'}, área ${area}).`,
    )
  }

  const mappings = integracion.mappings.map((mapeo) => {
    const campo = (mapeo.dstField || '').toUpperCase()

    // La descripción del XML alimenta el caché; si falta, se toma de lo que ya se sabe.
    if (mapeo.dstDesc && campo && !cache.descripciones.has(campo)) cache.descripciones.set(campo, mapeo.dstDesc)
    const dstDesc = mapeo.dstDesc || cache.descripciones.get(campo) || ''

    const propio = fila ? formatIbpExample(fila[campo]) : ''

    return {
      ...mapeo,
      dstDesc,
      ibpType: catalogo.types[campo] || '',
      ibpExample: propio || cache.porCampo.get(campo) || '',
    }
  })

  return { ...integracion, mappings }
}

/**
 * Una pasada final con los cachés ya calientes.
 *
 * Las primeras integraciones se procesaron cuando todavía no se sabía casi nada. Esta pasada las
 * completa con lo que se aprendió después, y por eso tiene que ir al final y no en el medio.
 */
export function backfillFromCache(entradas, cache) {
  let descripciones = 0
  let ejemplos = 0

  for (const entrada of entradas) {
    for (const mapeo of entrada.parsed.mappings) {
      const campo = (mapeo.dstField || '').toUpperCase()
      if (!campo) continue

      if (!mapeo.dstDesc && cache.descripciones.has(campo)) {
        mapeo.dstDesc = cache.descripciones.get(campo)
        descripciones += 1
      }
      if (!mapeo.ibpExample && cache.porCampo.has(campo)) {
        mapeo.ibpExample = cache.porCampo.get(campo)
        ejemplos += 1
      }
    }
  }

  return { descripciones, ejemplos }
}

/**
 * Enriquece todas las integraciones elegidas, en dos pasadas.
 *
 * Las consultas van una tras otra a propósito: cada una calienta el caché para la siguiente, y
 * lanzarlas a la vez haría que varias preguntaran por lo mismo antes de que ninguna respondiera.
 */
export async function enrichAll(entradas, catalogo, pedirFila, planAreaElegida = '') {
  const cache = nuevaCache(catalogo.descs)

  const enriquecidas = []
  for (const entrada of entradas) {
    enriquecidas.push({
      ...entrada,
      parsed: await enrichIntegration(entrada.parsed, catalogo, cache, pedirFila, planAreaElegida),
    })
  }

  const relleno = backfillFromCache(enriquecidas, cache)
  return { entradas: enriquecidas, avisos: cache.avisos, relleno }
}
