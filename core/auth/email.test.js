import { describe, expect, it, vi } from 'vitest'

import {
  RESEND_URL,
  enviarPorResend,
  mensajeDeCodigo,
} from './email.js'

/** Una respuesta de `fetch` de mentira. */
const respuesta = (status, cuerpo) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (cuerpo === undefined) throw new Error('sin cuerpo')
    return cuerpo
  },
})

describe('el mensaje', () => {
  it('lleva el código y cuánto dura, en texto y en HTML', () => {
    const { asunto, texto, html } = mensajeDeCodigo({ code: '482913', expiresInMinutes: 10 })

    expect(asunto).toContain('482913')
    expect(texto).toContain('482913')
    expect(texto).toContain('10 minutos')
    expect(html).toContain('482913')
    expect(html).toContain('10 minutos')
  })

  // Un correo con solo HTML lo marcan varios filtros, y un código que cae en correo no deseado es un
  // usuario que no puede entrar.
  it('va con las dos versiones, no solo HTML', () => {
    const { texto, html } = mensajeDeCodigo({ code: '1', expiresInMinutes: 5 })
    expect(texto.length).toBeGreaterThan(0)
    expect(html.length).toBeGreaterThan(0)
    expect(texto).not.toContain('<')
  })

  it('dice «1 minuto» y no «1 minutos»', () => {
    expect(mensajeDeCodigo({ code: '1', expiresInMinutes: 1 }).texto).toContain('1 minuto y')
  })

  it('aguanta que la duración no venga', () => {
    expect(() => mensajeDeCodigo({ code: '1' })).not.toThrow()
    expect(mensajeDeCodigo({ code: '1', expiresInMinutes: null }).texto).toContain('0 minutos')
  })

  // Un código son dígitos, pero el correo no es el sitio donde se confía en la forma de un dato.
  it('escapa lo que va dentro del HTML', () => {
    const { html } = mensajeDeCodigo({ code: '<script>x</script>', expiresInMinutes: 5 })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('le dice a quien no pidió entrar que no tiene que hacer nada', () => {
    expect(mensajeDeCodigo({ code: '1', expiresInMinutes: 5 }).texto).toContain('no pediste entrar')
  })
})

describe('el envío', () => {
  const base = {
    apiKey: 'clave-de-prueba',
    from: 'acceso@ejemplo.com',
    to: 'persona@cliente.com',
    asunto: 'asunto',
    texto: 'texto',
    html: '<p>html</p>',
  }

  it('llama a la dirección de Resend con la clave y el cuerpo esperados', async () => {
    const falso = vi.fn().mockResolvedValue(respuesta(200, { id: 'abc' }))
    await enviarPorResend({ ...base, fetchImpl: falso })

    expect(falso).toHaveBeenCalledTimes(1)
    const [url, opciones] = falso.mock.calls[0]

    expect(url).toBe(RESEND_URL)
    expect(opciones.method).toBe('POST')
    expect(opciones.headers.Authorization).toBe('Bearer clave-de-prueba')
    // Sin seguir redirecciones, como todo lo que sale de esta aplicación.
    expect(opciones.redirect).toBe('manual')

    expect(JSON.parse(opciones.body)).toEqual({
      from: 'acceso@ejemplo.com',
      to: ['persona@cliente.com'],
      subject: 'asunto',
      text: 'texto',
      html: '<p>html</p>',
    })
  })

  it('avisa de lo que falta antes de llamar a nadie', async () => {
    const falso = vi.fn()

    await expect(enviarPorResend({ ...base, apiKey: '', fetchImpl: falso }))
      .rejects.toThrow('RESEND_API_KEY')
    await expect(enviarPorResend({ ...base, from: '', fetchImpl: falso }))
      .rejects.toThrow('MAIL_FROM')
    await expect(enviarPorResend({ ...base, to: '', fetchImpl: falso }))
      .rejects.toThrow('destino')

    expect(falso).not.toHaveBeenCalled()
  })

  // «El correo no salió» a secas obliga a abrir los registros de Resend para saber si falta verificar
  // el dominio o si la clave venció.
  it('un rechazo del proveedor llega con su motivo', async () => {
    const falso = vi.fn().mockResolvedValue(respuesta(403, { message: 'domain is not verified' }))

    await expect(enviarPorResend({ ...base, fetchImpl: falso }))
      .rejects.toThrow('(403): domain is not verified')
  })

  it('un rechazo sin cuerpo legible sigue siendo un error con su código', async () => {
    const falso = vi.fn().mockResolvedValue(respuesta(500))
    await expect(enviarPorResend({ ...base, fetchImpl: falso })).rejects.toThrow('(500)')
  })

  it('el tiempo máximo se distingue de un fallo del proveedor', async () => {
    const falso = vi.fn().mockImplementation(() => {
      const fallo = new Error('abortado')
      fallo.name = 'AbortError'
      return Promise.reject(fallo)
    })

    await expect(enviarPorResend({ ...base, fetchImpl: falso, timeoutMs: 3000 }))
      .rejects.toThrow('no contestó en 3 s')
  })

  it('no llegar al proveedor se dice como tal', async () => {
    const falso = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    await expect(enviarPorResend({ ...base, fetchImpl: falso }))
      .rejects.toThrow('No se pudo llegar al proveedor de correo: getaddrinfo ENOTFOUND')
  })

  // Es la regla que más importa de todo este archivo: un código en los registros del servidor es una
  // puerta abierta para cualquiera que los pueda leer.
  it('NINGÚN mensaje de error lleva el código', async () => {
    const { asunto, texto, html } = mensajeDeCodigo({ code: '482913', expiresInMinutes: 10 })
    const casos = [
      vi.fn().mockResolvedValue(respuesta(403, { message: 'nope' })),
      vi.fn().mockResolvedValue(respuesta(500)),
      vi.fn().mockRejectedValue(new Error('red caída')),
    ]

    for (const falso of casos) {
      const fallo = await enviarPorResend({ ...base, asunto, texto, html, fetchImpl: falso })
        .then(() => null, (error) => error)

      expect(fallo).toBeInstanceOf(Error)
      expect(fallo.message).not.toContain('482913')
    }
  })
})
