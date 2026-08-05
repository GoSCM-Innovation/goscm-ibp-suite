// Llamadas a nuestra propia API.
//
// La sesión viaja en una cookie que el navegador manda sola, así que aquí no hay ningún
// token ni nada que guardar. Es la diferencia con v9, que llevaba una clave incrustada en el
// código del navegador y por tanto visible para cualquiera.

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : ''

  const response = await fetch(`${path}${query}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })

  const text = await response.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError('El servidor devolvió una respuesta ilegible.', response.status)
  }

  if (!response.ok) throw new ApiError(data.error || `Error ${response.status}`, response.status)
  return data
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path, body) => request(path, { method: 'DELETE', body }),
}
