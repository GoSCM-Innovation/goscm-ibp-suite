// Modificar y borrar dato maestro: lo que se manda y qué se revisa antes.
//
// Portado de `EditReviewModal.jsx` y `DeleteConfirmModal.jsx` de v8, con la parte que se puede probar
// separada de la que dibuja.
//
// Estas dos operaciones son las únicas de la aplicación que TOCAN filas que ya existen. La migración
// escribe, pero escribe lo que trajo de otro sitio; aquí alguien cambia un valor a mano. Por eso lo
// que importa no es el ciclo de transacción —es el mismo de siempre— sino lo que se muestra ANTES:
//
//   - Al modificar: cada cambio con su valor de antes y el de después. No "hay 14 cambios", sino
//     cuáles. Un valor mal tipeado en una celda es invisible hasta que alguien lo lee escrito.
//   - Al borrar: los registros por su clave de negocio, y que en SAP IBP borrar es IRREVERSIBLE. No
//     hay papelera ni deshacer.
//
// Aquí no hay NADA que hable con SAP: la pantalla importa estas funciones, y si de aquí saliera una
// cadena de imports hasta el transporte, el bundle del navegador acabaría arrastrando `node:dns`. La
// escritura vive en `master-data-edit-run.js`.

import { CAMPOS_DE_SOLO_LECTURA } from './master-data-model.js'

/** Cuántos cambios se listan antes de resumir el resto. Doscientos ya no se leen de un tirón. */
export const MAX_CAMBIOS_LISTADOS = 200

/**
 * La identidad de una fila: sus claves de negocio juntas. Es lo que SAP entiende por «esta fila».
 *
 * Sirve de índice de los cambios pendientes, y por eso se arma con las claves y no con la posición:
 * la fila 3 de la página 2 no es nada una vez que se pasa de página, pero `00AA` sigue siendo `00AA`.
 */
export const claveDeFila = (fila, claves = []) =>
  claves.map((clave) => fila?.[clave] ?? '').join('|')

/**
 * Anota que alguien escribió `valor` en un campo de una fila, y devuelve los cambios pendientes.
 *
 * Guarda la fila ORIGINAL junto a lo cambiado. Es lo que permite enseñar «antes → después» al
 * revisar y, sobre todo, saber cuándo un cambio dejó de serlo.
 */
export function anotarCambio(edits, { fila, campo, valor, claves = [] }) {
  const clave = claveDeFila(fila, claves)
  const anterior = edits?.[clave] ?? { fila, cambios: {} }
  const cambios = { ...anterior.cambios }

  // Volver a escribir el valor que ya estaba NO es un cambio. Dejarlo en la lista haría que SAP
  // reescriba lo mismo y que la revisión enseñe «ACME → ACME», que es ruido en la única pantalla
  // donde hay que leer con atención.
  if (valor === String(fila?.[campo] ?? '')) delete cambios[campo]
  else cambios[campo] = valor

  if (Object.keys(cambios).length === 0) {
    const { [clave]: _fuera, ...resto } = edits ?? {}
    return resto
  }
  return { ...edits, [clave]: { fila: anterior.fila, cambios } }
}

/**
 * Los cambios pendientes, uno por campo, con el antes y el después.
 *
 * `edits` es `{ [claveDeFila]: { fila, cambios } }`, que es como lo junta la pantalla mientras alguien
 * escribe. Se aplana a una lista por CAMPO porque es la unidad que se revisa: una fila con tres
 * campos cambiados son tres cosas que comprobar, no una.
 */
export function cambiosParaRevisar(edits, claves = []) {
  const filas = []

  for (const { fila, cambios } of Object.values(edits ?? {})) {
    const identidad = (claves.length > 0 ? claves : Object.keys(fila ?? {}))
      .map((clave) => fila?.[clave] ?? '')
      .filter((valor) => valor !== '')
      .join(' · ') || '—'

    for (const [campo, despues] of Object.entries(cambios ?? {})) {
      filas.push({ identidad, campo, antes: fila?.[campo] ?? '', despues })
    }
  }

  return filas
}

/** Cuántas filas y cuántos campos se van a tocar. */
export function resumirCambios(edits) {
  const entradas = Object.values(edits ?? {})
  return {
    filas: entradas.length,
    campos: entradas.reduce((suma, una) => suma + Object.keys(una.cambios ?? {}).length, 0),
  }
}

/**
 * Las filas listas para mandar: la clave de negocio más lo cambiado.
 *
 * La clave va SIEMPRE, aunque no se haya tocado: es lo que le dice a SAP qué registro actualizar. Sin
 * ella, un cambio de un campo se leería como un registro nuevo con casi todo vacío.
 */
export function filasParaModificar(edits, claves = []) {
  return Object.values(edits ?? {}).map(({ fila, cambios }) => {
    const salida = {}
    for (const clave of claves) {
      if (fila?.[clave] !== undefined) salida[clave] = fila[clave]
    }
    for (const [campo, valor] of Object.entries(cambios ?? {})) {
      // Un campo de solo lectura no se manda ni aunque alguien lo haya tocado: SAP rechazaría el
      // envío entero por una celda.
      if (!CAMPOS_DE_SOLO_LECTURA.includes(campo)) salida[campo] = valor
    }
    return salida
  })
}

/**
 * Las filas listas para borrar: SOLO las claves de negocio.
 *
 * Mandar el resto de los campos en un borrado no sirve de nada y hace el envío más grande; SAP borra
 * por clave.
 */
export function filasParaBorrar(filas, claves = []) {
  return (filas ?? []).map((fila) => {
    const salida = {}
    for (const clave of claves) {
      if (fila?.[clave] !== undefined) salida[clave] = fila[clave]
    }
    return salida
  })
}
