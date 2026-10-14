// El filtro de la fuente de datos (`FilterForTheDataSource`): una cadena de condiciones separadas por comas.
//
//     MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',ZVIGENTE EQ 'S',KEYFIGUREDATE BT '20261005' '20270412'
//
// Se vieron dos operadores: `EQ` (un valor) y `BT` (dos valores, desde y hasta). Se desconoce si el iFlow
// admite más, así que lo que no se reconoce NO se descarta ni se interpreta: queda como texto, y se escribe
// de vuelta igual que entró. Esa es la garantía de este archivo: leer un filtro y volver a escribirlo no
// cambia lo que se envía.
//
// Tampoco se afirma cómo se combinan las condiciones (si varias del mismo campo son «o» y de campos
// distintos «y»): el constructor las muestra y no lo explica, porque nadie lo ha confirmado.
//
// Pura, sin dependencias: la usan el servidor y la pantalla.

export const OPERADORES_CONOCIDOS = Object.freeze(['EQ', 'BT'])

/** Cuántos valores lleva cada operador conocido. */
const ARIDAD = Object.freeze({ EQ: 1, BT: 2 })

/** Parte una cadena por comas que NO estén dentro de comillas simples. */
function partirPorComas(texto) {
  const partes = []
  let actual = ''
  let dentro = false
  for (const caracter of texto) {
    if (caracter === "'") dentro = !dentro
    if (caracter === ',' && !dentro) {
      partes.push(actual)
      actual = ''
    } else {
      actual += caracter
    }
  }
  partes.push(actual)
  return partes
}

/**
 * Lee una condición suelta. Devuelve `{ campo, operador, valores }` si es `CAMPO OP 'v' ['v2']` con un
 * operador conocido y la cantidad de valores que le toca, y `null` si no.
 */
function leerCondicion(texto) {
  const coincidencia = texto.trim().match(/^([A-Za-z0-9_/]+)\s+([A-Za-z]{2})\s+(.+)$/)
  if (!coincidencia) return null
  const [, campo, op, resto] = coincidencia
  // Sin pasar a mayúsculas: un `eq` en minúscula no se sabe si el iFlow lo acepta, así que no se
  // reescribe como `EQ`; queda como texto, tal cual.
  if (!OPERADORES_CONOCIDOS.includes(op)) return null

  // Los valores: `'a'` o `'a' 'b'`, nada más. Un valor con una comilla dentro no se entiende: se conserva.
  const valores = []
  let pendiente = resto.trim()
  while (pendiente !== '') {
    const valor = pendiente.match(/^'([^']*)'\s*/)
    if (!valor) return null
    valores.push(valor[1])
    pendiente = pendiente.slice(valor[0].length)
  }
  if (valores.length !== ARIDAD[op]) return null

  return { campo, operador: op, valores }
}

let contador = 0
const nuevoId = () => { contador += 1; return `f${contador}` }

/**
 * Lee un filtro y devuelve sus FILAS, en orden:
 *
 *   { id, tipo: 'igual', campo, valores: [..] }   uno o varios `CAMPO EQ 'v'` seguidos del mismo campo
 *   { id, tipo: 'entre', campo, desde, hasta }    `CAMPO BT 'a' 'b'`
 *   { id, tipo: 'texto', texto }                  lo que no se entendió, tal cual
 *
 * Solo se juntan en una fila las condiciones `EQ` del mismo campo que están SEGUIDAS: juntar las que están
 * separadas reordenaría el filtro, y el orden es lo que la persona escribió.
 */
export function leerFiltro(texto) {
  const crudo = String(texto ?? '')
  if (crudo.trim() === '') return []

  const filas = []
  for (const parte of partirPorComas(crudo)) {
    const condicion = leerCondicion(parte)

    if (!condicion) {
      // Un pedazo vacío (coma doble o final) no aporta nada; el resto se conserva tal cual.
      if (parte.trim() !== '') filas.push({ id: nuevoId(), tipo: 'texto', texto: parte.trim() })
      continue
    }

    if (condicion.operador === 'BT') {
      filas.push({ id: nuevoId(), tipo: 'entre', campo: condicion.campo, desde: condicion.valores[0], hasta: condicion.valores[1] })
      continue
    }

    const anterior = filas.at(-1)
    if (anterior?.tipo === 'igual' && anterior.campo === condicion.campo) {
      anterior.valores.push(condicion.valores[0])
    } else {
      filas.push({ id: nuevoId(), tipo: 'igual', campo: condicion.campo, valores: [condicion.valores[0]] })
    }
  }
  return filas
}

/** Escribe las filas de vuelta como cadena. Una fila sin campo o sin valores no se escribe. */
export function escribirFiltro(filas) {
  const condiciones = []
  for (const fila of filas ?? []) {
    if (fila.tipo === 'texto') {
      if (String(fila.texto ?? '').trim() !== '') condiciones.push(String(fila.texto).trim())
    } else if (fila.tipo === 'entre') {
      const campo = String(fila.campo ?? '').trim()
      if (campo && fila.desde !== '' && fila.hasta !== '' && fila.desde != null && fila.hasta != null) {
        condiciones.push(`${campo} BT '${fila.desde}' '${fila.hasta}'`)
      }
    } else {
      const campo = String(fila.campo ?? '').trim()
      if (!campo) continue
      for (const valor of fila.valores ?? []) {
        if (valor !== '' && valor != null) condiciones.push(`${campo} EQ '${valor}'`)
      }
    }
  }
  return condiciones.join(',')
}

/**
 * ¿Se puede escribir este valor dentro de comillas simples? Una comilla lo cortaría y abriría otra condición.
 * Devuelve el motivo si no.
 */
export function motivoDeValorDeFiltroInvalido(valor) {
  const texto = String(valor ?? '')
  if (/'/.test(texto)) return 'No puede llevar comillas simples.'
  if (/,/.test(texto)) return 'No puede llevar comas: separan condiciones.'
  return null
}
