// Completar la documentación con lo que solo IBP sabe: la etiqueta, el tipo y un valor de ejemplo.
//
// Portado de `enrichMappingsFromIbp` y `backfillFromCache` de `docs.js` de v9.
//
// Lo caro aquí no son las cuentas, son las consultas: una por entidad destino. Dos cachés evitan
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
  // Los campos a los que ya se les hizo la consulta dirigida: una sola vez por campo en toda la
  // corrida, haya salido o no. Sin esto, un campo vacío en todo el tenant se pediría en cada tabla.
  intentados: new Set(),
  avisos: [],
  // Lo que v9 escribe en su log durante el enriquecimiento: `{ texto, tipo }`, con `tipo` `ok`, `aviso`
  // o `linea`. El documentador lo muestra en «Log de procesamiento».
  registro: [],
})

/** Los tamaños de muestra, en orden: 50 y, si aún faltan campos, 200. Los de v9. */
const TAMANOS_DE_MUESTRA = [50, 200]

/**
 * Completa los mapeos de una integración.
 *
 * Devuelve la integración con sus mapeos enriquecidos, sin tocar la original: quien la llame decide
 * si se queda con el resultado.
 *
 * El ejemplo de cada campo sale así (portado de `enrichMappingsFromIbp` de v9):
 *   1. Una muestra de 50 filas de la entidad, de la que se toma por campo el primer valor no vacío.
 *   2. Si aún faltan campos, la misma con 200 filas.
 *   3. Solo en dato maestro, y solo para los campos de TEXTO que siguen vacíos: una consulta
 *      dirigida con `CAMPO ne ''` que trae un valor no vacío de ese campo.
 *   Lo que ninguno consigue queda en blanco.
 */
export async function enrichIntegration(
  integracion, catalogo, cache, pedirFila, planAreaElegida = '', pedirCampo = null,
) {
  const destino = resolveTargetEntity(integracion, catalogo.entitySets, planAreaElegida)
  const campos = [...new Set(integracion.mappings.map((uno) => uno.dstField).filter(Boolean))]

  let fila = null

  if (destino) {
    // Si ya se conoce el ejemplo de todos los campos, no hace falta preguntar nada.
    const faltan = campos.filter((uno) => !cache.porCampo.has(uno.toUpperCase()))

    if (faltan.length > 0) {
      const selectFields = selectFieldsFor(destino, campos, catalogo.entityProps)
      const puedeConsultar = destino.service !== 'PLANNING_DATA_API_SRV' || selectFields.length > 0

      const etiqueta = integracion.jobName || destino.entitySet

      if (!puedeConsultar) {
        cache.avisos.push(`${integracion.jobName}: ${destino.entitySet} no tiene ninguno de estos campos.`)
        cache.registro.push({
          tipo: 'aviso',
          texto: `⚠ Ejemplo IBP [${etiqueta}]: ${destino.entitySet} sin campos válidos para $select`,
        })
      } else {
        // Los campos que esta entidad tiene que cubrir: en planning, solo los que ella tiene.
        const necesarios = destino.service === 'PLANNING_DATA_API_SRV' ? selectFields : campos

        for (const top of TAMANOS_DE_MUESTRA) {
          const clave = `${destino.service}|${destino.entitySet}|${destino.planArea}|${selectFields.join(',')}|${top}`

          if (!cache.porEntidad.has(clave)) {
            const { row, detail } = await pedirFila({ ...destino, selectFields, top })
            cache.porEntidad.set(clave, row)

            if (row) {
              cache.registro.push({
                tipo: 'ok',
                texto: `✔ Ejemplo IBP [${etiqueta}]: ${destino.entitySet} (${Object.keys(row).length} campos, top ${top})`,
              })
              for (const [campo, valor] of Object.entries(row)) {
                const formateado = formatIbpExample(valor)
                if (formateado !== '' && !cache.porCampo.has(campo)) cache.porCampo.set(campo, formateado)
              }
            } else {
              cache.avisos.push(`${integracion.jobName}: ${destino.entitySet} — ${detail} (top ${top})`)
              cache.registro.push({
                tipo: 'aviso',
                texto: `⚠ Ejemplo IBP [${etiqueta}]: ${destino.entitySet} — ${detail} (top ${top})`,
              })
            }
          }

          // Lo ya visto tiene prioridad: la muestra de 200 solo completa lo que la de 50 no tenía.
          const muestra = cache.porEntidad.get(clave)
          if (muestra) fila = { ...muestra, ...(fila ?? {}) }

          // Si ya no falta ningún campo, no se escala.
          if (necesarios.every((uno) => cache.porCampo.has(uno.toUpperCase()))) break
        }
      }
    }

    // El respaldo dirigido, solo en dato maestro y solo para campos de texto.
    if (pedirCampo && destino.service === 'MASTER_DATA_API_SRV') {
      for (const campo of campos) {
        const clave = campo.toUpperCase()
        if (cache.porCampo.has(clave) || cache.intentados.has(clave)) continue
        if (!String(catalogo.types[clave] || '').startsWith('NVARCHAR')) continue

        cache.intentados.add(clave)
        const valor = await pedirCampo({ entitySet: destino.entitySet, planArea: destino.planArea, field: campo })
        const formateado = formatIbpExample(valor)
        if (formateado !== '') {
          cache.porCampo.set(clave, formateado)
          cache.registro.push({ tipo: 'linea', texto: `   ↳ ejemplo dirigido ${campo} = ${formateado}` })
        }
      }
    }
  } else if ((integracion.tipoIntegracion || '').toUpperCase() !== 'FILE') {
    const area = planAreaElegida || integracion.planArea || '(ninguna)'
    cache.avisos.push(
      `${integracion.jobName}: no se pudo resolver la entidad de IBP `
      + `(tabla ${integracion.targetTable || '?'}, área ${area}).`,
    )
    cache.registro.push({
      tipo: 'aviso',
      texto: `⚠ Ejemplo IBP [${integracion.jobName || integracion.targetTable}]: sin entidad resuelta `
        + `(tabla=${integracion.targetTable || '?'}, tipo=${integracion.tipoIntegracion || '?'}, PA=${area})`,
    })
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
export async function enrichAll(entradas, catalogo, pedirFila, planAreaElegida = '', pedirCampo = null) {
  const cache = nuevaCache(catalogo.descs)

  const enriquecidas = []
  for (const entrada of entradas) {
    enriquecidas.push({
      ...entrada,
      parsed: await enrichIntegration(entrada.parsed, catalogo, cache, pedirFila, planAreaElegida, pedirCampo),
    })
  }

  const relleno = backfillFromCache(enriquecidas, cache)
  cache.registro.push({
    tipo: 'ok',
    texto: `↺ Backfill desde cache: +${relleno.descripciones} descripciones, +${relleno.ejemplos} ejemplos`,
  })
  return { entradas: enriquecidas, avisos: cache.avisos, relleno, registro: cache.registro }
}
