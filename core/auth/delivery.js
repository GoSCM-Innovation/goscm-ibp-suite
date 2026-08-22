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

/**
 * El desvío TEMPORAL: a qué único buzón se entregan todos los códigos, o `null` si no hay desvío.
 *
 * Existe para poder trabajar entre varias personas antes de tener un dominio de correo verificado:
 * cada uno entra con SU dirección —su identidad, su sesión, su rastro— y lo único que se desvía es a
 * qué buzón llega el mensaje.
 *
 * Es una dirección FIJA de la configuración, nunca una que venga de lo que alguien escriba en la
 * pantalla: si el destino se pudiera influir desde fuera, cualquiera pediría un código de otro y se lo
 * mandaría a sí mismo.
 *
 * MIENTRAS ESTÉ PUESTO, quien pueda leer ese buzón puede entrar como cualquier usuario de la
 * plataforma. Se quita borrando la variable: no hay nada más que revertir.
 */
export function desvioDeCorreo(entorno = process.env) {
  return entorno.MAIL_REDIRECT_TO?.trim() || null
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
    const desvio = desvioDeCorreo()
    // Con desvío, el mensaje tiene que decir para quién es: quien lo abre no es quien pidió entrar.
    const { asunto, texto, html } = mensajeDeCodigo({
      code,
      expiresInMinutes,
      paraQuien: desvio ? email : '',
    })
    await enviarPorResend({ ...correo, to: desvio ?? email, asunto, texto, html })
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
