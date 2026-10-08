import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../core/auth/sessions.js', () => ({ destroySession: vi.fn() }))

const { destroySession } = await import('../../core/auth/sessions.js')
const { default: handler } = await import('./logout.js')
const { SESSION_COOKIE } = await import('../../core/auth/cookies.js')

function respuesta() {
  const res = {
    codigo: null,
    cuerpo: null,
    cabeceras: {},
    setHeader(nombre, valor) { res.cabeceras[nombre] = valor },
    status(codigo) { res.codigo = codigo; return res },
    json(cuerpo) { res.cuerpo = cuerpo; return res },
  }
  return res
}

const conSesion = { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=abc` } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/auth/logout', () => {
  it('cierra la sesión en el servidor y vence la cookie', async () => {
    destroySession.mockResolvedValue(undefined)
    const res = respuesta()
    await handler(conSesion, res)
    expect(destroySession).toHaveBeenCalledWith('abc')
    expect(res.codigo).toBe(200)
    expect(res.cabeceras['Set-Cookie']).toContain('Max-Age=0')
  })

  it('sin sesión responde igual, para no distinguir los dos casos', async () => {
    const res = respuesta()
    await handler({ method: 'POST', headers: {} }, res)
    expect(destroySession).not.toHaveBeenCalled()
    expect(res.codigo).toBe(200)
  })

  // Decir «Sesión cerrada» cuando la sesión sigue viva en el servidor sería mentir sobre algo de seguridad.
  it('si el servidor no pudo cerrarla, no dice que se cerró (pero la cookie se vence igual)', async () => {
    destroySession.mockRejectedValue(new Error('Redis caído'))
    const res = respuesta()
    await handler(conSesion, res)
    expect(res.codigo).toBe(500)
    expect(res.cuerpo.error).toMatch(/No se pudo cerrar/)
    expect(res.cabeceras['Set-Cookie']).toContain('Max-Age=0')
  })
})
