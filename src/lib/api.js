// Llamadas a nuestra propia API.
//
// La sesión viaja en una cookie que el navegador manda sola, así que aquí no hay ningún
// token ni nada que guardar. Es la diferencia con v9, que llevaba una clave incrustada en el
// código del navegador y por tanto visible para cualquiera.

import { anotarLlamada } from './tech-logs.js'

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
      ruta: path,
      estado: 0,
      ms: Date.now() - arranque,
      detalle: cancelada ? 'cancelada' : fallo.message,
    })
    throw fallo
  }

  const text = await response.text()
  const anotar = (detalle) => anotarLlamada({
    metodo: method, ruta: path, estado: response.status, ms: Date.now() - arranque, detalle,
  })

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    anotar('respuesta ilegible')
    throw new ApiError('El servidor devolvió una respuesta ilegible.', response.status)
  }

  anotar(response.ok ? '' : (data.error ?? ''))

  if (!response.ok) throw new ApiError(data.error || `Error ${response.status}`, response.status)
  return data
}

export const api = {
  get: (path, params, opciones) => request(path, { params, ...opciones }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path, body) => request(path, { method: 'DELETE', body }),
}
