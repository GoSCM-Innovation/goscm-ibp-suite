// Editar key figures a mano desde «Ver Dato Transaccional»: qué se manda a SAP.
//
// Portado de `doSave` de `DataViewer/TransactionalDataViewer.jsx` de v8. Aquí solo lo que se puede
// probar sin SAP; la escritura vive en `planning-data-edit-run.js`, por lo mismo que en dato maestro:
// si de aquí saliera una cadena de imports hasta el transporte, el bundle del navegador arrastraría
// `node:dns`.
//
// Lo que se edita son SOLO key figures. El nivel —las dimensiones y el tiempo— es la identidad de la
// fila y no se toca: cambiarlo no sería editar un valor, sería escribirlo en otra celda.

import { periodoIso } from './planning-data-model.js'

/**
 * Las key figures que de verdad cambiaron, en el orden en que se aplicaron.
 *
 * Solo las que el nivel aplicado tiene como key figure: un cambio sobre otra columna —una dimensión,
 * el tiempo— no se manda nunca, aunque llegue.
 */
export function cifrasCambiadas(edits, cifras = []) {
  const tocadas = new Set()
  for (const { cambios } of Object.values(edits ?? {})) {
    for (const campo of Object.keys(cambios ?? {})) tocadas.add(campo)
  }
  return (cifras ?? []).filter((cifra) => tocadas.has(cifra))
}

/**
 * Lo que se manda: la lista ordenada de columnas del nivel y una fila por registro editado.
 *
 * `edits` es `{ [clave]: { fila, cambios } }`, como lo junta la pantalla.
 *
 *   - `campos` es `AggregationLevelFieldsString`: dimensiones, key figures cambiadas y tiempo, en ese
 *     orden, que es el de la migración de key figures de v8.
 *   - Cada fila lleva su identidad de nivel, el periodo como ISO —el formato del cuerpo de la
 *     importación— y las key figures. La que cambió en esa fila va con el valor nuevo; la que cambió
 *     en OTRA fila del lote va con su valor original, que escribirlo de nuevo no cambia nada. Así
 *     todas las filas tienen las mismas columnas, como exige SAP.
 */
export function filasDeEdicionDeCifras({ edits, atributos = [], tiempo, cifras = [] }) {
  const cambiadas = cifrasCambiadas(edits, cifras)
  if (cambiadas.length === 0 || !tiempo) return { campos: [], cifras: [], filas: [] }

  const filas = Object.values(edits ?? {}).map(({ fila, cambios }) => {
    const salida = {}
    for (const atributo of atributos ?? []) salida[atributo] = fila?.[atributo] ?? ''
    salida[tiempo] = periodoIso(fila?.[tiempo])
    for (const cifra of cambiadas) {
      salida[cifra] = Object.prototype.hasOwnProperty.call(cambios ?? {}, cifra) ? cambios[cifra] : (fila?.[cifra] ?? '0')
    }
    return salida
  })

  return { campos: [...(atributos ?? []), ...cambiadas, tiempo], cifras: cambiadas, filas }
}

/**
 * Lo que devolvió SAP, con los criterios de v8: un mensaje de gravedad E o A es un registro
 * rechazado —se envió, pero no entró—; una transacción marcada con error es un fallo.
 */
export function resultadoDeEdicion(salida, cuantas) {
  const errors = (salida?.mensajes ?? []).filter((mensaje) => ['E', 'A'].includes(mensaje?.Severity))
  const conError = salida?.estado === 'CON_ERROR'
  return {
    status: errors.length ? 'warning' : (conError ? 'error' : 'ok'),
    count: cuantas,
    errors,
    message: conError ? 'SAP marcó la transacción con error al procesar.' : '',
  }
}
