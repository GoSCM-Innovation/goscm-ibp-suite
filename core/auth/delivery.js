// Entrega del código al usuario.
//
// Está aislada a propósito: conectar un proveedor de correo de verdad (Resend o similar)
// tiene que ser reemplazar esta pieza, no tocar el mecanismo de códigos ni el de sesión.
//
// Mientras se construye, el código se imprime en la consola del servidor. En producción eso
// sería catastrófico —el código quedaría en los registros del servidor y cualquiera con
// acceso a ellos podría entrar como cualquier usuario—, así que ahí revienta en vez de
// imprimirlo.

let sender = null

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

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No hay proveedor de correo configurado y no se va a imprimir un código de acceso ' +
      'en los registros de producción.',
    )
  }

  console.log(`\n  [ingreso] código para ${email}: ${code} — válido ${expiresInMinutes} minutos\n`)
}
