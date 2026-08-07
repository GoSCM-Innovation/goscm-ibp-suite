// El portero de las llamadas salientes.
//
// Toda URL que la aplicación vaya a llamar pasa por aquí primero. El riesgo que cierra se
// llama SSRF: si un cliente pudiera hacernos llamar a una dirección interna, usaría nuestro
// servidor como puente hacia la red privada del propio proveedor de nube — incluidos los
// servicios de metadatos, que reparten credenciales a quien pregunte desde dentro.
//
// Son tres cercos, y hay que pasar los tres:
//   1. Solo https.
//   2. La dirección no puede ser interna. Se resuelve el nombre por DNS, porque un nombre de
//      aspecto inocente puede apuntar a una dirección privada. (De v9, que es el único de los
//      tres proyectos que cubre IPv6, CGNAT y link-local.)
//   3. El nombre tiene que encajar en el patrón de los tenants de SAP. (De v7, que es el
//      único que lo comprueba.) Aunque el cerco anterior deje pasar una dirección pública,
//      si no es de SAP no se llama.
//
// Queda una rendija conocida: entre resolver el nombre y conectar, el DNS podría cambiar de
// respuesta. Cerrarla exigiría fijar la dirección resuelta al abrir la conexión, y es
// desproporcionado aquí — el tercer cerco ya limita el daño a nombres de SAP.

import { lookup } from 'node:dns/promises'
import net from 'node:net'

// Los tenants de IBP siguen el patrón <tenant>-api.scmibp<n>.ondemand.com, donde el número
// del centro de datos es opcional. Anclado por los dos extremos: sin el ancla, un host como
// "malicioso.com/x-api.scmibp.ondemand.com" pasaría.
export const DEFAULT_IBP_HOST_PATTERN = /^[a-z0-9-]+-api\.scmibp\d*\.ondemand\.com$/i

// CI-DS vive en Kyma, en Neo o en HCS según la antigüedad del tenant.
export const DEFAULT_CIDS_HOST_PATTERN = /^([a-z0-9-]+\.)+(kyma\.ondemand\.com|hana\.ondemand\.com|hcs\.cloud\.sap)$/i

// Servicios de OData que la aplicación tiene permitido llamar. Es el equivalente del patrón
// de host, un nivel más abajo: aunque el tenant sea legítimo, no se llama a un servicio que
// no esté en esta lista.
export const DEFAULT_ALLOWED_SERVICES = Object.freeze([
  'MASTER_DATA_API_SRV',
  'PLANNING_DATA_API_SRV',
  'BC_EXT_APPJOB_MANAGEMENT',
])

function patternFrom(envVar, fallback) {
  const raw = process.env[envVar]
  if (!raw) return fallback
  try {
    return new RegExp(raw, 'i')
  } catch {
    console.error(`[transporte] ${envVar} no es una expresión válida; se usa el patrón por defecto.`)
    return fallback
  }
}

function allowedServices() {
  const raw = process.env.ALLOWED_SAP_SERVICES
  if (!raw) return DEFAULT_ALLOWED_SERVICES
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length > 0 ? list : DEFAULT_ALLOWED_SERVICES
}

function ipv4IsPrivate(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b, c] = parts
  if (a === 0) return true                            // 0.0.0.0/8
  if (a === 10) return true                           // red privada
  if (a === 127) return true                          // la propia máquina
  if (a === 169 && b === 254) return true             // link-local y metadatos de la nube
  if (a === 172 && b >= 16 && b <= 31) return true    // red privada
  if (a === 192 && b === 168) return true             // red privada
  if (a === 192 && b === 0 && c === 0) return true    // protocolos de asignación
  if (a === 100 && b >= 64 && b <= 127) return true   // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // pruebas de rendimiento
  if (a >= 224) return true                           // multicast y reservado
  return false
}

function ipv6IsPrivate(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  // IPv4 disfrazada de IPv6 (::ffff:10.0.0.1 y similares).
  const mapped = lower.match(/(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/)
  if (mapped) return ipv4IsPrivate(mapped[1])
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // red privada
  if (/^fe[89ab]/.test(lower)) return true                          // link-local
  return false
}

export function isPrivateAddress(ip) {
  const family = net.isIP(ip)
  if (family === 4) return ipv4IsPrivate(ip)
  if (family === 6) return ipv6IsPrivate(ip)
  return true // si no se reconoce como dirección, se trata como insegura
}

/**
 * Comprueba el servicio de OData que se está llamando, para URLs de IBP.
 * Devuelve un motivo si no se permite, o `null` si está bien.
 *
 * El nombre del servicio puede llevar versión pegada con punto y coma
 * (`BC_EXT_APPJOB_MANAGEMENT;v=0002`): así los publica SAP y así hay que llamarlos. La versión no
 * entra en la comparación con la lista permitida — lo que se autoriza es el servicio, no una
 * versión suya.
 */
export function checkOdataService(pathname) {
  const match = pathname.match(/^\/sap\/opu\/odata\/(?:IBP|sap)\/([A-Za-z0-9_]+)(?:;[A-Za-z0-9_=,.-]+)?\//)
  if (!match) return 'La ruta no es un servicio de OData de IBP'
  if (!allowedServices().includes(match[1])) return `Servicio no permitido: ${match[1]}`
  return null
}

/**
 * Valida el destino de una URL: protocolo, patrón de host y que no resuelva a una dirección
 * interna. NO mira la ruta, así que sirve para comprobar la dirección base de una conexión
 * antes de guardarla, cuando todavía no hay ningún servicio en la ruta.
 */
export async function validateSapHost(rawUrl, { kind } = {}) {
  if (kind !== 'ibp' && kind !== 'cids') {
    throw new Error(`Destino desconocido: "${kind}". Debe ser 'ibp' o 'cids'.`)
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'URL inválida'
  }

  if (parsed.protocol !== 'https:') return 'Solo se permite HTTPS'

  const host = parsed.hostname.replace(/^\[|\]$/g, '')

  if (net.isIP(host)) {
    // Una dirección numérica nunca encaja en el patrón de un tenant de SAP, así que se
    // rechaza siempre: pública o privada, no es un destino legítimo.
    return 'Host no permitido: hay que llamar al tenant por su nombre, no por su dirección'
  }

  const pattern = kind === 'ibp'
    ? patternFrom('ALLOWED_IBP_HOST_REGEX', DEFAULT_IBP_HOST_PATTERN)
    : patternFrom('ALLOWED_CIDS_HOST_REGEX', DEFAULT_CIDS_HOST_PATTERN)

  if (!pattern.test(host)) return 'Host no permitido'

  let addresses
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    return 'No se pudo resolver el host'
  }
  if (addresses.length === 0) return 'No se pudo resolver el host'
  for (const address of addresses) {
    if (isPrivateAddress(address.address)) return 'Host no permitido: resuelve a una dirección interna'
  }

  return null
}

/**
 * Valida una URL que se va a llamar: todo lo del destino, más el servicio de OData de la ruta
 * cuando el destino es IBP. Es la que usa el transporte antes de cada llamada.
 *
 * `kind` es 'ibp' o 'cids'. Se exige explícitamente para que nadie valide una URL "en
 * general": cada destino tiene su propio patrón de host.
 */
export async function validateSapUrl(rawUrl, { kind } = {}) {
  if (kind === 'ibp') {
    // El servicio se comprueba ANTES de resolver el nombre: es gratis y descarta la mayoría
    // de los intentos sin gastar una consulta de DNS.
    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      return 'URL inválida'
    }
    const serviceError = checkOdataService(parsed.pathname)
    if (serviceError) return serviceError
  }
  return validateSapHost(rawUrl, { kind })
}

/** Igual que `validateSapUrl`, pero revienta en vez de devolver el motivo. */
export async function assertSapUrl(rawUrl, options) {
  const reason = await validateSapUrl(rawUrl, options)
  if (reason) throw new Error(`URL rechazada (${reason}): ${rawUrl}`)
}

/** Igual que `validateSapHost`, pero revienta en vez de devolver el motivo. */
export async function assertSapHost(rawUrl, options) {
  const reason = await validateSapHost(rawUrl, options)
  if (reason) throw new Error(`Dirección rechazada (${reason}): ${rawUrl}`)
}
