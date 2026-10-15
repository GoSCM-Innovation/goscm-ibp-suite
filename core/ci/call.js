// La llamada al endpoint de un iFlow de Cloud Integration.
//
// Es el equivalente de pulsar «Send» en Postman: un POST con el body y Basic Auth, que CPI contesta cuando
// termina de procesar. No hay segunda llamada para preguntar cómo salió: la respuesta ES el resultado. Por
// eso este archivo decide, con lo que llegó, en cuál de cuatro estados queda lo que se envió:
//
//   success      CPI contestó 200 (OK).
//   warning      CPI contestó algo distinto de OK pero el iFlow SÍ procesó la carga: lo que pasó puede ser que IBP rechazara
//                algún registro, y eso no es necesariamente un error. Es una respuesta que trae el MPL ID de un mensaje
//                (CPI lo da al reportar un mensaje fallido, p. ej. un 500) o un 2xx que no es 200. El usuario lo pidió el
//                2026-10-15: en el historial real, 3 de 5 cargas terminaron así y se marcaban «Error».
//   error        CPI no llegó a procesar la carga: rechazó las credenciales o el permiso (401, 403), no encontró el
//                endpoint (404), contestó un error sin MPL ID, una redirección, o la llamada ni siquiera salió (el host
//                no responde, la dirección no pasó el portero). Está claro qué pasó.
//   unconfirmed  Se envió y NO se sabe cómo terminó: se agotó el tiempo, o se cortó la conexión a mitad. La carga
//                pudo haber entrado, entera o a medias. No se da por buena ni por mala, y quien llama NO debe
//                reintentarla sola: repetir una carga que sí entró es de los errores más caros que hay aquí.
//
// Lo que NO hace, a propósito:
//   - No sigue redirecciones: la dirección de destino ya no habría pasado por el portero (SSRF).
//   - No registra el body ni las credenciales. El mensaje que devuelve es el texto de la respuesta, recortado.
//   - No reintenta nada.
//
// `credentials` entra por parámetro y no sale de aquí. Viven cifradas en la base y solo el servidor las descifra.

import { assertSapUrl } from '../transport/ssrf.js'
import { extraerMplId } from './body.js'

/**
 * Cuánto se espera la respuesta de CPI.
 *
 * Las funciones de la API tienen 300 s (ver `vercel.json`). Se espera menos, para poder anotar el resultado
 * antes de que Vercel corte la función: si se agotara el tiempo de la función y no el de esta llamada, no
 * quedaría constancia de nada.
 */
export const CI_TIMEOUT_MS = 270_000

/** Cuánto del texto de la respuesta se conserva. Basta para leer un error y su MPL ID. */
export const MENSAJE_MAX = 1500

/**
 * Los errores de conexión que ocurren ANTES de que el body salga: no se envió nada, así que no hay duda de
 * cómo terminó. Cualquier otro corte (reinicio de la conexión, tiempo agotado) deja la duda.
 */
const CODIGOS_SIN_ENVIAR = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ERR_INVALID_URL'])

/**
 * Qué quiere decir, para quien ejecuta, un error de HTTP que se repite mucho. Sin esto, un 401 se leía «CPI
 * respondió 401 sin mensaje» y no decía que lo que hay que mirar es la contraseña de la conexión.
 * El 401 se midió contra un tenant real (credenciales de prueba); el 403 y el 404 son lo que esos códigos
 * significan en HTTP, sin suponer nada de cómo CPI configura sus roles.
 */
const MOTIVO_DE_ERROR = Object.freeze({
  401: 'CPI rechazó el usuario o la contraseña de la conexión.',
  403: 'CPI rechazó el acceso: el usuario de la conexión no tiene permiso para llamar a este endpoint.',
  404: 'CPI no encontró el endpoint: revisa la dirección de la conexión.',
})

/** Deja el texto de la respuesta en una línea legible y de tamaño razonable. */
export function recortar(texto) {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim()
  return limpio.length > MENSAJE_MAX ? `${limpio.slice(0, MENSAJE_MAX)}…` : limpio
}

function cabeceraBasica({ user, password }) {
  if (!user || !password) throw new Error('Faltan el usuario y la contraseña de la conexión.')
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

/**
 * Envía el body al endpoint y devuelve qué pasó.
 *
 * Nunca lanza por un problema de la llamada: los devuelve como `error` o `unconfirmed`. Lanza solo si quien
 * llama se equivocó (sin credenciales).
 *
 * `esperar` y `ahora` se inyectan para las pruebas.
 */
export async function llamarEndpoint({
  url, credentials, cuerpo, timeoutMs = CI_TIMEOUT_MS, fetchImpl = fetch, ahora = Date.now,
}) {
  const autorizacion = cabeceraBasica(credentials)
  const inicio = ahora()
  const duracion = () => ahora() - inicio

  try {
    await assertSapUrl(url, { kind: 'ci' })
  } catch (fallo) {
    return { resultado: 'error', enviado: false, httpStatus: null, duracionMs: duracion(), mplId: null, mensaje: fallo.message }
  }

  let respuesta
  try {
    respuesta = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: autorizacion,
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: cuerpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (fallo) {
    const codigo = fallo?.cause?.code ?? fallo?.code
    if (CODIGOS_SIN_ENVIAR.has(codigo)) {
      return {
        resultado: 'error', enviado: false, httpStatus: null, duracionMs: duracion(), mplId: null,
        mensaje: `No se pudo conectar con el endpoint de CPI (${codigo}). No se envió nada.`,
      }
    }
    const agotado = fallo?.name === 'TimeoutError' || fallo?.name === 'AbortError'
    return {
      resultado: 'unconfirmed', enviado: true, httpStatus: null, duracionMs: duracion(), mplId: null,
      mensaje: agotado
        ? `CPI no contestó en ${Math.round(timeoutMs / 1000)} s. La carga pudo haber entrado: revísala en Cloud Integration antes de repetirla.`
        : `Se cortó la conexión con CPI antes de recibir la respuesta (${fallo?.message ?? 'sin detalle'}). La carga pudo haber entrado: revísala en Cloud Integration antes de repetirla.`,
    }
  }

  const httpStatus = respuesta.status

  // El texto puede cortarse a mitad (la respuesta ya llegó con su código, así que ese es el resultado).
  let texto = ''
  try {
    texto = await respuesta.text()
  } catch {
    texto = ''
  }
  const mensaje = recortar(texto)
  const mplId = extraerMplId(texto)

  if (httpStatus >= 300 && httpStatus < 400) {
    return {
      resultado: 'error', enviado: true, httpStatus, duracionMs: duracion(), mplId,
      mensaje: 'CPI respondió con una redirección y no se siguen redirecciones.',
    }
  }

  if (httpStatus === 200) {
    return { resultado: 'success', enviado: true, httpStatus, duracionMs: duracion(), mplId, mensaje }
  }

  // Un 2xx que no es 200, o cualquier respuesta con el MPL ID de un mensaje (menos 401, 403 y 404, que dicen que la llamada
  // ni siquiera se procesó): el iFlow trabajó, y lo que haya que revisar está en el monitor de CPI.
  const motivo = MOTIVO_DE_ERROR[httpStatus]
  if ((httpStatus > 200 && httpStatus < 300) || (!motivo && mplId)) {
    return {
      resultado: 'warning', enviado: true, httpStatus, duracionMs: duracion(), mplId,
      mensaje: mensaje || `CPI respondió ${httpStatus} sin mensaje.`,
    }
  }

  return {
    resultado: 'error', enviado: true, httpStatus, duracionMs: duracion(), mplId,
    mensaje: motivo
      ? `${motivo}${mensaje ? ` Respuesta: ${mensaje}` : ''}`
      : (mensaje || `CPI respondió ${httpStatus} sin mensaje.`),
  }
}
