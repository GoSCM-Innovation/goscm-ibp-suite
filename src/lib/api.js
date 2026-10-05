// Llamadas a nuestra propia API.
//
// La sesión viaja en una cookie que el navegador manda sola, así que aquí no hay ningún
// token ni nada que guardar. Es la diferencia con v9, que llevaba una clave incrustada en el
// código del navegador y por tanto visible para cualquiera.

import { anotarLlamada } from './tech-logs.js'

/** El evento que avisa a la aplicación de que la sesión ya no vale. Lo escucha `App.jsx`. */
export const SESION_VENCIDA = 'goscm:sesion-vencida'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Toda petición queda anotada para el panel de diagnóstico, salga bien o mal.
 *
 * Se hace aquí y no en cada pantalla —como en v8 y v9— porque así el panel ve TODO el tráfico sin que
 * nadie tenga que acordarse de registrarlo, y una pantalla nueva no empieza muda.
 */
async function request(path, { method = 'GET', body, params, signal } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  const arranque = Date.now()
  // Las operaciones de CI-DS y de IBP viajan todas por la misma ruta con la operación en el cuerpo.
  // Sin ella en el panel, `getProjects`, `runTask` y `getTaskLogs` serían la misma línea.
  const etiqueta = typeof body?.operation === 'string' ? `${path} · ${body.operation}` : path

  let response
  try {
    response = await fetch(`${path}${query}`, {
      method,
      credentials: 'same-origin',
      signal,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
  } catch (fallo) {
    // Sin respuesta: se cortó la red, el servidor no está, o alguien canceló. Los tres se anotan,
    // pero una cancelación no es un fallo y el panel no debería leerse como si lo fuera.
    const cancelada = fallo.name === 'AbortError'
    anotarLlamada({
      metodo: method,
      ruta: etiqueta,
      estado: 0,
      ms: Date.now() - arranque,
      detalle: cancelada ? 'cancelada' : fallo.message,
    })
    throw fallo
  }

  const text = await response.text()
  const anotar = (detalle) => anotarLlamada({
    metodo: method, ruta: etiqueta, estado: response.status, ms: Date.now() - arranque, detalle,
  })

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    anotar('respuesta ilegible')
    throw new ApiError('El servidor devolvió una respuesta ilegible.', response.status)
  }

  anotar(response.ok ? '' : (data.error ?? ''))

  // Una sesión vencida a mitad de trabajo (un monitor que refresca solo, por ejemplo) devolvería el
  // mismo error una y otra vez sin salida. Se avisa UNA vez a la aplicación para que lleve a la
  // pantalla de acceso. Las rutas de `/api/auth/` quedan fuera: allí un 401 es «código incorrecto»
  // o «no hay sesión todavía», y las maneja quien las llamó.
  if (response.status === 401 && !path.startsWith('/api/auth/') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESION_VENCIDA))
  }

  if (!response.ok) throw new ApiError(data.error || `Error ${response.status}`, response.status)
  return data
}

export const api = {
  get: (path, params, opciones) => request(path, { params, ...opciones }),
  // `opciones` lleva la `signal` de quien necesita poder cortar una petición en vuelo.
  post: (path, body, opciones) => request(path, { method: 'POST', body, ...opciones }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path, body) => request(path, { method: 'DELETE', body }),
}
