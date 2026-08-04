// El único punto de toda la aplicación que llama a SAP.
//
// Que sea uno solo es el motivo de existir de esta capa: v7, v8 y v9 tenían tres proxies
// distintos, cada uno con sus propios olvidos. Todo lo aprendido a base de golpes vive aquí
// y se aplica siempre, no cuando alguien se acuerda.
//
// Lo que hace, y por qué:
//   • Usuario y contraseña se reciben como parámetro y no salen de aquí. En v8 los mandaba el
//     navegador en cada llamada; en esta aplicación viven cifrados en la base de datos y solo
//     el servidor los descifra.
//   • No sigue redirecciones. Si SAP contestara con una, la dirección de destino no habría
//     pasado por el portero — y ese es exactamente el hueco por el que se cuela un ataque de
//     SSRF. Mejor fallar.
//   • Reutiliza el token de escritura (CSRF) entre los varios envíos de una misma operación.
//     v8 ya lo hacía; v7 y v9 pedían uno nuevo cada vez, que es lento y frágil.
//   • Vigila que la respuesta no llegue cortada. Con respuestas grandes se observó que el
//     relevo entre SAP y el navegador entregaba cuerpos incompletos bajo carga: el texto
//     terminaba a media palabra. Se compara el tamaño anunciado con el recibido y se
//     comprueba que el contenido esté completo antes de darlo por bueno. Si no lo está, se
//     avisa de que se puede repetir la lectura — leer dos veces no rompe nada.

import { assertSapUrl } from './ssrf.js'

export const DEFAULT_TIMEOUT_MS = 30_000

// Hay tenants que tardan más de un minuto en dar el token de escritura cuando vienen de una
// operación pesada. Es un tiempo medido, no una precaución teórica.
export const CSRF_TIMEOUT_MS = 90_000

const JSON_ACCEPT = 'application/json, application/xml, */*'
const XML_ACCEPT = 'application/xml, text/xml, */*'

export class SapError extends Error {
  constructor(message, { status = 0, detail = '', retryable = false } = {}) {
    super(message)
    this.name = 'SapError'
    this.status = status
    this.detail = detail
    /** `true` cuando repetir la misma llamada tiene sentido (respuesta cortada, corte de red). */
    this.retryable = retryable
  }
}

function authHeader({ user, password }) {
  if (!user || !password) throw new SapError('Faltan las credenciales del usuario de comunicación de SAP.')
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

function headersFor(credentials, accept) {
  return {
    Authorization: authHeader(credentials),
    Accept: accept,
    'Content-Type': 'application/json',
  }
}

/**
 * Saca un mensaje legible del cuerpo de un error de SAP. Llega en JSON o en XML según el
 * humor del servicio, y en JSON el mensaje puede ser un texto suelto o un objeto con idioma.
 */
export function extractSapError(text) {
  const fallback = text.slice(0, 800)
  try {
    const parsed = JSON.parse(text)
    const raw = parsed?.error?.message
    const message = typeof raw === 'string' ? raw : raw?.value
    const code = parsed?.error?.code
    if (message != null) return String(code ? `[${code}] ${message}` : message)
    return fallback
  } catch {
    const code = text.match(/<code>([^<]*)<\/code>/)?.[1]
    const message = text.match(/<message[^>]*>([^<]*)<\/message>/)?.[1]
    if (message) return code ? `[${code}] ${message}` : message
    return fallback
  }
}

/**
 * Pide el token de escritura y las cookies de sesión. Se piden UNA vez por operación y se
 * reutilizan en todos sus envíos.
 */
export async function fetchCsrf({ serviceRoot, credentials, kind = 'ibp' }) {
  await assertSapUrl(serviceRoot, { kind })

  const response = await fetch(serviceRoot, {
    method: 'GET',
    headers: { ...headersFor(credentials, JSON_ACCEPT), 'X-CSRF-Token': 'Fetch' },
    redirect: 'manual',
    signal: AbortSignal.timeout(CSRF_TIMEOUT_MS),
  })

  if (response.status >= 300 && response.status < 400) {
    throw new SapError('SAP respondió con una redirección al pedir el token de escritura.', { status: response.status })
  }

  const token = response.headers.get('x-csrf-token')
  const cookies = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

  if (!token) {
    throw new SapError('SAP no entregó el token de escritura.', { status: response.status })
  }

  return { token, cookies }
}

/**
 * Una llamada a SAP. Devuelve `{ status, contentType, text, json }`; lanza `SapError` en
 * cualquier fallo, con `retryable` puesto cuando repetir tiene sentido.
 *
 * Para escrituras: si no se le pasa un token en `csrf`, lo pide él mismo desde `serviceRoot`.
 * Conviene pasárselo — es lo que evita pedir un token por cada envío de una misma operación.
 */
export async function sapFetch({
  url,
  method = 'GET',
  body,
  credentials,
  kind = 'ibp',
  csrf = null,
  serviceRoot = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  expect = 'json',
}) {
  await assertSapUrl(url, { kind })

  let token = csrf?.token ?? null
  let cookies = csrf?.cookies ?? ''

  if (method !== 'GET' && !token) {
    const root = serviceRoot || url.split('?')[0]
    const fresh = await fetchCsrf({ serviceRoot: root, credentials, kind })
    token = fresh.token
    cookies = fresh.cookies
  }

  const headers = {
    ...headersFor(credentials, expect === 'xml' ? XML_ACCEPT : JSON_ACCEPT),
    ...(token ? { 'X-CSRF-Token': token } : {}),
    ...(cookies ? { Cookie: cookies } : {}),
  }

  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    // Tiempo agotado o corte de red: repetir tiene sentido.
    throw new SapError(`No se pudo completar la llamada a SAP: ${error.message}`, { retryable: true })
  }

  if (response.status >= 300 && response.status < 400) {
    throw new SapError('SAP respondió con una redirección y no se siguen redirecciones.', {
      status: response.status,
      detail: response.headers.get('location') ?? '',
    })
  }

  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()

  if (!response.ok) {
    throw new SapError(`SAP devolvió ${response.status}`, {
      status: response.status,
      detail: extractSapError(text),
      // 429 y 5xx son transitorios; un 400 o un 403 no lo son.
      retryable: response.status === 429 || response.status >= 500,
    })
  }

  // Primer control de respuesta cortada: lo anunciado frente a lo recibido. Cuando SAP
  // comprime, lo recibido es mayor que lo anunciado, así que esto nunca da falsos positivos.
  const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
  const received = Buffer.byteLength(text)
  if (declared && received < declared) {
    throw new SapError('Respuesta incompleta de SAP', {
      status: 502,
      detail: `Cuerpo cortado: llegaron ${received} de ${declared} bytes`,
      retryable: true,
    })
  }

  if (expect === 'xml' || contentType.includes('xml')) {
    return { status: response.status, contentType, text, json: null }
  }

  // Un cuerpo vacío en una respuesta correcta es legítimo (una confirmación de escritura no
  // devuelve nada). No hay que confundirlo con una respuesta cortada.
  if (text.length === 0) {
    return { status: response.status, contentType, text: '', json: {} }
  }

  // Segundo control: el contenido tiene que estar completo. Antes, un cuerpo a medias
  // reventaba más adelante con un error incomprensible y se perdía la tabla entera.
  let json
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new SapError('Respuesta incompleta de SAP', {
      status: 502,
      detail: `Contenido inválido o cortado: ${error.message}`,
      retryable: true,
    })
  }

  return { status: response.status, contentType, text, json }
}
