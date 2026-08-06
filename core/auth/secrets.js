// Comparar secretos sin filtrar cuánto acertaste.
//
// Regla del proyecto: las comparaciones de secretos son siempre resistentes a temporización. El
// motivo no es teórico: `===` sobre textos corta en el primer carácter distinto, así que el tiempo
// que tarda en decir "no" depende de cuántos caracteres acertaste. Con suficientes intentos, eso
// permite adivinar un secreto carácter a carácter sin haberlo visto nunca.
//
// Está aquí y no dentro de quien lo usa porque ya hacía falta en dos sitios —el código de ingreso y
// el secreto del reloj— y la forma de que una regla se cumpla es que haya una sola manera de
// cumplirla, no que cada uno se acuerde.

import { timingSafeEqual } from 'node:crypto'

/**
 * ¿Son el mismo secreto? Tarda lo mismo acierte o no.
 *
 * La diferencia de longitud sí se nota, y es inevitable: `timingSafeEqual` exige que los dos lados
 * midan igual. No es un problema —la longitud de un secreto no es lo que lo protege— pero conviene
 * saberlo en vez de creer que esto esconde todo.
 */
export function sameSecret(a, b) {
  const izquierda = Buffer.from(String(a ?? ''), 'utf8')
  const derecha = Buffer.from(String(b ?? ''), 'utf8')

  // Vacío nunca es igual a vacío. Dos cadenas vacías SON iguales, pero esta función existe para
  // comparar secretos, y el caso "los dos vacíos" es siempre un secreto sin configurar comparado
  // contra otro sin configurar. Devolver verdadero ahí abriría la puerta justo cuando no hay llave.
  if (izquierda.length === 0 || derecha.length === 0) return false

  if (izquierda.length !== derecha.length) return false
  return timingSafeEqual(izquierda, derecha)
}

/**
 * Lee el secreto de una cabecera `Authorization: Bearer …` y lo compara.
 *
 * Devuelve falso si no hay secreto configurado: sin secreto, la puerta queda cerrada en vez de
 * abierta. Un endpoint de reloj sin proteger lo puede llamar cualquiera.
 */
export function bearerMatches(authorizationHeader, secret) {
  if (!secret) return false
  const recibido = String(authorizationHeader ?? '')
  if (!recibido.startsWith('Bearer ')) return false
  return sameSecret(recibido.slice('Bearer '.length), secret)
}
