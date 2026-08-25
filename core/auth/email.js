// El correo con el código de acceso: cómo se escribe y cómo se manda.
//
// Está separado de `delivery.js` a propósito: ahí está la DECISIÓN de qué proveedor usar, y aquí el
// proveedor concreto. Cambiar de Resend a otro es escribir un archivo hermano de este, no tocar el
// mecanismo de códigos.
//
// Dos cosas que este archivo tiene que hacer bien porque nadie más las va a mirar:
//
//   - EL CÓDIGO NO SE REGISTRA NUNCA. Ni al fallar. Un código en los registros del servidor es una
//     puerta abierta para cualquiera que los pueda leer, así que los mensajes de error de aquí dicen
//     qué falló y a qué dirección, y nunca el código.
//   - La dirección del proveedor es una CONSTANTE de este archivo, no un dato de entrada. Por eso no
//     pasa por el portero anti-SSRF de `core/transport`, que además es específico de SAP: no hay
//     ninguna URL que un usuario pueda influir. Lo que sí lleva es tiempo máximo y no seguir
//     redirecciones, igual que todo lo que sale de esta aplicación.

/** La dirección de la API de Resend. Constante: nada de lo que entra por HTTP la puede cambiar. */
export const RESEND_URL = 'https://api.resend.com/emails'

/** Cuánto se espera al proveedor. Si tarda más, la persona ya volvió a pedir el código. */
export const TIEMPO_MAXIMO_MS = 10_000

/** Escapa lo que va dentro del HTML. Un código son dígitos, pero el correo no es donde se confía. */
const escapar = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * El mensaje, en texto y en HTML.
 *
 * Va con las dos versiones porque un correo con solo HTML lo marcan como sospechoso varios filtros, y
 * un código de acceso que cae en la carpeta de correo no deseado es un usuario que no puede entrar.
 *
 * El texto es corto a propósito: lo único que la persona necesita es el código y cuánto le dura. Todo
 * lo demás es ruido en una notificación que se lee en el teléfono en diez segundos.
 *
 * `paraQuien` solo viene puesto cuando el desvío temporal está activo, y entonces el correo cambia de
 * destinatario real: quien lo abre NO es la persona que pidió entrar. El asunto lleva por eso la
 * dirección de verdad. Con tres personas trabajando llegan varios códigos seguidos, y sin eso el
 * asunto es idéntico en todos y se aplica el código equivocado.
 */
export function mensajeDeCodigo({ code, expiresInMinutes, paraQuien = '' }) {
  const minutos = Number(expiresInMinutes) || 0
  const duracion = minutos === 1 ? '1 minuto' : `${minutos} minutos`
  const desviado = String(paraQuien ?? '').trim()

  const asunto = desviado
    ? `Código para ${desviado}: ${code}`
    : `Tu código de acceso: ${code}`

  const encabezadoTexto = desviado
    ? [
      `Este código es para ${desviado}, no para ti.`,
      'Te llega porque el desvío temporal de correo está activo.',
      '',
      `El código es: ${code}`,
    ]
    : [`Tu código de acceso a GoSCM Suite es: ${code}`]

  const texto = [
    ...encabezadoTexto,
    '',
    `El código vale ${duracion} y sirve una sola vez.`,
    '',
    desviado
      ? 'Cuando el correo esté configurado con un dominio propio, cada persona recibirá el suyo.'
      : 'Si no pediste entrar, no hace falta que hagas nada: sin el código nadie puede usar tu cuenta.',
  ].join('\n')

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
      + 'font-size:15px;line-height:1.5;color:#1a1a1a">',
    desviado
      ? `<p style="background:#fff4d6;border-left:3px solid #d9a200;padding:10px 12px;margin:0 0 16px">`
        + `Este código es para <b>${escapar(desviado)}</b>, no para ti. Te llega porque el desvío `
        + 'temporal de correo está activo.</p>'
      : '<p>Tu código de acceso a GoSCM Suite es:</p>',
    `<p style="font-size:30px;font-weight:700;letter-spacing:4px;margin:20px 0">${escapar(code)}</p>`,
    `<p>El código vale <b>${escapar(duracion)}</b> y sirve una sola vez.</p>`,
    desviado
      ? '<p style="color:#666;font-size:13px">Cuando el correo esté configurado con un dominio propio, '
        + 'cada persona recibirá el suyo.</p>'
      : '<p style="color:#666;font-size:13px">Si no pediste entrar, no hace falta que hagas nada: sin el '
        + 'código nadie puede usar tu cuenta.</p>',
    '</div>',
  ].join('')

  return { asunto, texto, html }
}

/**
 * Manda el correo por Resend.
 *
 * `fetchImpl` existe para las pruebas; en producción es el `fetch` de la plataforma.
 *
 * Si el proveedor contesta un error, se lanza con SU mensaje: «el correo no salió» a secas obliga a
 * abrir los registros de Resend para saber si es que falta verificar el dominio o que la clave venció.
 */
export async function enviarPorResend({
  apiKey,
  from,
  to,
  asunto,
  texto,
  html,
  fetchImpl = globalThis.fetch,
  timeoutMs = TIEMPO_MAXIMO_MS,
}) {
  if (!apiKey) throw new Error('Falta la clave de Resend (RESEND_API_KEY).')
  if (!from) throw new Error('Falta la dirección remitente (MAIL_FROM).')
  if (!to) throw new Error('Falta la dirección de destino.')

  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), timeoutMs)

  let respuesta
  try {
    respuesta = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject: asunto, text: texto, html }),
      redirect: 'manual',
      signal: control.signal,
    })
  } catch (fallo) {
    // Un aborto es el tiempo máximo, no un fallo del proveedor, y conviene distinguirlos: uno se
    // reintenta y el otro hay que ir a arreglarlo.
    if (fallo?.name === 'AbortError') {
      throw new Error(`El proveedor de correo no contestó en ${timeoutMs / 1000} s.`)
    }
    throw new Error(`No se pudo llegar al proveedor de correo: ${fallo?.message ?? fallo}`)
  } finally {
    clearTimeout(reloj)
  }

  if (!respuesta.ok) {
    const detalle = await leerElError(respuesta)
    throw new Error(`El proveedor de correo rechazó el envío (${respuesta.status})${detalle}`)
  }

  return respuesta
}

/** El motivo que da el proveedor, si lo da. Que el cuerpo no se pueda leer no debe tapar el error. */
async function leerElError(respuesta) {
  try {
    const cuerpo = await respuesta.json()
    const motivo = cuerpo?.message ?? cuerpo?.error ?? ''
    return motivo ? `: ${motivo}` : ''
  } catch {
    return ''
  }
}
