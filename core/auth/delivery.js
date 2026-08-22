// Entrega del código al usuario.
//
// Está aislada a propósito: conectar un proveedor de correo de verdad tiene que ser reemplazar esta
// pieza, no tocar el mecanismo de códigos ni el de sesión. El proveedor concreto —Resend— vive en
// `email.js`; acá solo está la decisión de a quién llamar.
//
// Hay tres caminos, en este orden:
//
//   1. Un proveedor inyectado con `setCodeSender`. Es lo que usan las pruebas y la puerta para
//      cambiar de proveedor sin tocar nada más.
//   2. Las variables de entorno del correo puestas: se manda de verdad.
//   3. Ninguna de las dos: en desarrollo el código se imprime en la consola, y en producción
//      REVIENTA. Imprimirlo ahí sería catastrófico —quedaría en los registros del servidor y
//      cualquiera con acceso a ellos podría entrar como cualquier usuario—.
//
// Las variables se leen en cada llamada y no al cargar el módulo: en Vercel cada petición puede
// levantar el proceso de nuevo, y leerlas arriba ataría el comportamiento al momento del arranque.

import { enviarPorResend, mensajeDeCodigo } from './email.js'

let sender = null

/** La configuración del correo, o `null` si no está puesta. */
export function configuracionDeCorreo(entorno = process.env) {
  const apiKey = entorno.RESEND_API_KEY?.trim()
  const from = entorno.MAIL_FROM?.trim()
  return apiKey && from ? { apiKey, from } : null
}

/** Conecta el proveedor real. Recibe `{ email, code, expiresInMinutes }`. */
export function setCodeSender(fn) {
  sender = fn
}

/** Vuelve a la entrega por consola. Para los tests. */
export function resetCodeSender() {
  sender = null
}

export async function deliverCode({ email, code, expiresInMinutes }) {
  if (sender) {
    await sender({ email, code, expiresInMinutes })
    return
  }

  const correo = configuracionDeCorreo()
  if (correo) {
    const { asunto, texto, html } = mensajeDeCodigo({ code, expiresInMinutes })
    await enviarPorResend({ ...correo, to: email, asunto, texto, html })
    return
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No hay proveedor de correo configurado y no se va a imprimir un código de acceso ' +
      'en los registros de producción. Faltan RESEND_API_KEY y MAIL_FROM.',
    )
  }

  console.log(`\n  [ingreso] código para ${email}: ${code} — válido ${expiresInMinutes} minutos\n`)
}
