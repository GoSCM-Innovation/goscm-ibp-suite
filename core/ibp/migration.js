// Armar el plan de una migración de dato maestro entre dos tenants.
//
// Lee de los DOS lados —cada uno con sus credenciales— y devuelve, tabla por tabla, con qué se
// emparejó, qué columnas se copiarían, cuáles se perderían y cuántas filas hay.
//
// Solo lee. La carga en sí es otra cosa y va aparte.

import { CAMPOS_DE_SOLO_LECTURA } from './master-data-model.js'
import { countEntity, readSchema } from './master-data.js'
import { compararCampos, emparejarTabla, resumirPlan } from './migration-plan.js'

/** Cuántas tablas se analizan a la vez. */
const A_LA_VEZ = 4

/**
 * El esquema de una tabla, sin que un fallo tumbe el plan entero.
 *
 * Se lee SIN filtro de versión a propósito: las columnas no dependen de la versión, y una lectura
 * filtrada por versión puede ser patológicamente lenta en algunos tenants —se midieron más de
 * sesenta segundos— y agotaría el tiempo justo en la parte que solo quiere saber qué columnas hay.
 */
async function esquemaDe({ baseUrl, credentials, entidad, planningArea }) {
  try {
    const leido = await readSchema({ baseUrl, credentials, entidad, planningArea })
    return leido.vacia ? null : leido.columnas
  } catch {
    return null
  }
}

/**
 * El plan de migración: qué se copiaría de dónde a dónde.
 *
 * `tablas` son las del origen. `destinoDe` permite forzar una pareja concreta cuando el emparejado
 * automático no acierta —los nombres los pone cada cliente y no siempre siguen el mismo patrón—.
 */
export async function planificarMigracion({
  origen, destino, tablas, tablasDelDestino, destinoDe = {}, condiciones = [],
}) {
  const pendientes = [...(tablas ?? [])]
  const entradas = []

  while (pendientes.length > 0) {
    const lote = pendientes.splice(0, A_LA_VEZ)

    const leidas = await Promise.all(lote.map(async (entidad) => {
      const pareja = destinoDe[entidad] ?? emparejarTabla(entidad, tablasDelDestino)

      // La cuenta lleva el filtro de la migración; los esquemas no, porque son de la tabla y no de
      // lo que se vaya a copiar.
      const [camposOrigen, camposDestino, filas] = await Promise.all([
        esquemaDe({ ...origen, entidad, planningArea: origen.planningArea }),
        pareja ? esquemaDe({ ...destino, entidad: pareja, planningArea: destino.planningArea }) : Promise.resolve(null),
        countEntity({
          ...origen,
          entidad,
          planningArea: origen.planningArea,
          versionId: origen.versionId,
          extraFilter: condiciones,
        }).catch(() => null),
      ])

      return {
        origen: entidad,
        destino: pareja,
        emparejadaAMano: Boolean(destinoDe[entidad]),
        filas,
        ...compararCampos(camposOrigen, camposDestino, { ignorar: CAMPOS_DE_SOLO_LECTURA }),
      }
    }))

    entradas.push(...leidas)
  }

  return { entradas, resumen: resumirPlan(entradas) }
}