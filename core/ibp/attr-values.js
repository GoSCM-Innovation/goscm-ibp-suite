// Los valores reales de un atributo, para ofrecerlos en el filtro del visor de cifras clave.
//
// Portado de `fetchAttrDistinctValues` de `services/masterDataApi.js` de v8.
//
// El servicio de cifras NO sirve para esto: una lectura que proyecta solo atributos la rechaza con
// "This service cannot be used to extract master data". Los valores viven en el dato maestro, en la
// tabla del área que tenga ese atributo — y cuál es no se sabe de antemano: `PRDID` está en la de
// productos, `CUSTID` en la de clientes, y el prefijo de las tablas es del tenant. v8 lo resolvía
// probando las tablas del área, de cuatro en cuatro, hasta dar con una que devolviera el campo con
// al menos una fila. Una prueba fallida es un 4xx barato.
//
// Y en esa tabla sí sale barato: el servicio de dato maestro deduplica del lado del servidor cuando
// el `$select` proyecta un campo que no es clave.

import { readDistinctValues, readEntityPage, readVsmt } from './master-data.js'
import { esNombreDeCampo } from './planning-data-model.js'

/** Cuántas tablas se prueban a la vez. */
export const PRUEBAS_EN_PARALELO = 4

/**
 * La tabla de dato maestro del área que tiene el atributo con datos, o `null`.
 *
 * Se prueban en orden alfabético y gana la primera que devuelve una fila: es el criterio de v8, y lo
 * que lo hace estable entre una vez y la siguiente.
 */
export async function tablaDelAtributo({ baseUrl, credentials, area, campo }) {
  const vsmt = await readVsmt({ baseUrl, credentials })
  const candidatas = [...new Set(vsmt
    .filter((fila) => !area || fila.PlanningAreaID === area)
    .map((fila) => fila.MasterDataTypeID)
    .filter(Boolean))].sort()

  for (let desde = 0; desde < candidatas.length; desde += PRUEBAS_EN_PARALELO) {
    const tanda = candidatas.slice(desde, desde + PRUEBAS_EN_PARALELO)
    const aciertos = await Promise.all(tanda.map(async (tabla) => {
      try {
        const filas = await readEntityPage({ baseUrl, credentials, entidad: tabla, select: [campo], top: 1 })
        return filas.length > 0 ? tabla : null
      } catch {
        // Esa tabla no tiene el campo: SAP contesta 400 y se sigue con la próxima.
        return null
      }
    }))
    const hallada = aciertos.find(Boolean)
    if (hallada) return hallada
  }

  return null
}

/**
 * Los valores distintos de un atributo del área: `{ tabla, valores }`.
 *
 * `tabla` es la que se usó, para que quien llama la recuerde y la próxima vez no haya que volver a
 * probar —v8 la guardaba un día en el navegador—. Si llega una ya conocida se usa directamente.
 * Sin tabla que tenga el campo, `{ tabla: null, valores: [] }`: el filtro sigue aceptando lo que se
 * escriba a mano.
 */
export async function readAttrDistinctValues({ baseUrl, credentials, area, campo, tabla }) {
  if (!esNombreDeCampo(campo)) throw new Error('El nombre del atributo no es válido.')

  const suya = esNombreDeCampo(tabla) ? tabla : await tablaDelAtributo({ baseUrl, credentials, area, campo })
  if (!suya) return { tabla: null, valores: [] }

  return { tabla: suya, valores: await readDistinctValues({ baseUrl, credentials, entidad: suya, campo }) }
}
