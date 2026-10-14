// Filas que se editan en pantalla pero que en el body se guardan como UN texto.
//
// Dos controles de CI Tools tienen ese problema: la tabla de campos (tres listas en el body) y el filtro (una
// cadena). La pantalla edita FILAS y el body guarda TEXTO, y entre los dos hay una diferencia que importa: una
// fila recién agregada y todavía vacía no se puede escribir en el texto (no dice nada), así que si las filas se
// recalcularan siempre desde el texto, la fila nueva desaparecería al instante, antes de poder escribir en ella.
//
// Por eso las filas viven en un estado local y se guarda junto a ellas EL TEXTO con el que coinciden:
//
//   - Al cambiar las filas, se calcula su texto y se avisa hacia arriba. Quien lo recibe lo guarda y lo vuelve
//     a pasar: llega igual al que el estado ya tenía, así que las filas se quedan como estaban (vacías incluidas).
//   - Si el texto cambia por OTRO lado (alguien editó la pestaña JSON, o pegó un body), no coincide con el del
//     estado: las filas se vuelven a leer de él.
//
// Es el patrón de «ajustar el estado al recibir props nuevas» de React: se hace al renderizar, sin efectos.

import { useState } from 'react'

/**
 * @param {string} externo   El texto que manda el body (cualquier valor comparable con `===`).
 * @param {(externo: string) => any[]} leer   De texto a filas.
 * @returns {[any[], (filas: any[], textoNuevo: string) => void]}
 */
export function useFilasLocales(externo, leer) {
  const [estado, setEstado] = useState(() => ({ externo, filas: leer(externo) }))

  let actual = estado
  if (estado.externo !== externo) {
    actual = { externo, filas: leer(externo) }
    setEstado(actual)
  }

  /** Pone las filas nuevas y recuerda el texto con el que coinciden, para no volver a leerlas al recibirlo. */
  const poner = (filas, textoNuevo) => setEstado({ externo: textoNuevo, filas })

  return [actual.filas, poner]
}
