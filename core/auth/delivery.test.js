// La decisión de a quién llamar para entregar un código.
//
// Lo que se prueba acá no es el correo —eso está en `email.test.js`— sino el árbol de decisión, que es
// donde está el riesgo: si en producción se cae al camino de la consola, el código de acceso queda en
// los registros del servidor y cualquiera que los pueda leer entra como cualquier usuario.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configuracionDeCorreo,
  deliverCode,
  desvioDeCorreo,
  resetCodeSender,
  setCodeSender,
} from './delivery.js'
import { enviarPorResend } from './email.js'

vi.mock('./email.js', async () => {
  const real = await vi.importActual('./email.js')
  return { ...real, enviarPorResend: vi.fn() }
})

const ENTORNO = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  resetCodeSender()
  delete process.env.RESEND_API_KEY
  delete process.env.MAIL_FROM
  delete process.env.MAIL_REDIRECT_TO
  delete process.env.NODE_ENV
})

afterEach(() => {
  resetCodeSender()
  process.env = { ...ENTORNO }
})

describe('cuándo hay correo configurado', () => {
  it('hacen falta las DOS variables, no una', () => {
    expect(configuracionDeCorreo({})).toBeNull()
    expect(configuracionDeCorreo({ RESEND_API_KEY: 'k' })).toBeNull()
    expect(configuracionDeCorreo({ MAIL_FROM: 'a@b.com' })).toBeNull()
    expect(configuracionDeCorreo({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.com' }))
      .toEqual({ apiKey: 'k', from: 'a@b.com' })
  })

  // Una variable puesta con espacios en el panel de Vercel es un caso real, y una clave con espacios
  // alrededor da un 401 que no se parece a «está mal copiada».
  it('los espacios alrededor no cuentan como valor', () => {
    expect(configuracionDeCorreo({ RESEND_API_KEY: '   ', MAIL_FROM: 'a@b.com' })).toBeNull()
    expect(configuracionDeCorreo({ RESEND_API_KEY: ' k ', MAIL_FROM: ' a@b.com ' }))
      .toEqual({ apiKey: 'k', from: 'a@b.com' })
  })
})

describe('a quién se llama', () => {
  it('el proveedor inyectado gana sobre todo lo demás', async () => {
    process.env.RESEND_API_KEY = 'k'
    process.env.MAIL_FROM = 'acceso@ejemplo.com'
    const inyectado = vi.fn()
    setCodeSender(inyectado)

    await deliverCode({ email: 'p@c.com', code: '111111', expiresInMinutes: 10 })

    expect(inyectado).toHaveBeenCalledWith({
      email: 'p@c.com', code: '111111', expiresInMinutes: 10,
    })
    expect(enviarPorResend).not.toHaveBeenCalled()
  })

  it('con las variables puestas se manda de verdad, con el mensaje armado', async () => {
    process.env.RESEND_API_KEY = 'clave'
    process.env.MAIL_FROM = 'acceso@ejemplo.com'

    await deliverCode({ email: 'p@c.com', code: '482913', expiresInMinutes: 10 })

    expect(enviarPorResend).toHaveBeenCalledTimes(1)
    const suyo = enviarPorResend.mock.calls[0][0]
    expect(suyo).toMatchObject({ apiKey: 'clave', from: 'acceso@ejemplo.com', to: 'p@c.com' })
    expect(suyo.asunto).toContain('482913')
    expect(suyo.texto).toContain('482913')
    expect(suyo.html).toContain('482913')
  })

  it('si el proveedor falla, el fallo sube: no se dice que se entregó', async () => {
    process.env.RESEND_API_KEY = 'clave'
    process.env.MAIL_FROM = 'acceso@ejemplo.com'
    enviarPorResend.mockRejectedValueOnce(new Error('dominio sin verificar'))

    await expect(deliverCode({ email: 'p@c.com', code: '1', expiresInMinutes: 10 }))
      .rejects.toThrow('dominio sin verificar')
  })
})

// El desvío temporal: todos los códigos a un solo buzón, para poder trabajar entre varias personas
// antes de tener un dominio de correo verificado.
describe('el desvío temporal', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'clave'
    process.env.MAIL_FROM = 'onboarding@resend.dev'
  })

  it('sin la variable, no hay desvío', () => {
    expect(desvioDeCorreo({})).toBeNull()
    expect(desvioDeCorreo({ MAIL_REDIRECT_TO: '  ' })).toBeNull()
    expect(desvioDeCorreo({ MAIL_REDIRECT_TO: ' jefe@go-scm.com ' })).toBe('jefe@go-scm.com')
  })

  it('entrega al buzón del desvío y no al de quien pidió entrar', async () => {
    process.env.MAIL_REDIRECT_TO = 'jefe@go-scm.com'

    await deliverCode({ email: 'colega@go-scm.com', code: '482913', expiresInMinutes: 10 })

    const suyo = enviarPorResend.mock.calls[0][0]
    expect(suyo.to).toBe('jefe@go-scm.com')
  })

  // Con tres personas trabajando llegan varios códigos seguidos. Sin la dirección en el asunto son
  // todos idénticos y se aplica el código equivocado.
  it('el asunto dice para quién es el código', async () => {
    process.env.MAIL_REDIRECT_TO = 'jefe@go-scm.com'

    await deliverCode({ email: 'colega@go-scm.com', code: '482913', expiresInMinutes: 10 })

    const suyo = enviarPorResend.mock.calls[0][0]
    expect(suyo.asunto).toBe('Código para colega@go-scm.com: 482913')
    expect(suyo.texto).toContain('Este código es para colega@go-scm.com, no para ti')
    expect(suyo.html).toContain('colega@go-scm.com')
    expect(suyo.texto).toContain('482913')
  })

  // La vuelta atrás tiene que ser borrar la variable y nada más. Si al quitarla quedara cualquier
  // rastro del desvío, «temporal» sería mentira.
  it('sin la variable, todo vuelve al comportamiento normal', async () => {
    await deliverCode({ email: 'colega@go-scm.com', code: '482913', expiresInMinutes: 10 })

    const suyo = enviarPorResend.mock.calls[0][0]
    expect(suyo.to).toBe('colega@go-scm.com')
    expect(suyo.asunto).toBe('Tu código de acceso: 482913')
    expect(suyo.texto).not.toContain('desvío')
    expect(suyo.html).not.toContain('desvío')
  })

  // Si el destino se pudiera influir desde fuera, cualquiera pediría el código de otro y se lo
  // mandaría a sí mismo.
  it('el destino del desvío sale de la configuración, nunca de quien pide entrar', async () => {
    process.env.MAIL_REDIRECT_TO = 'jefe@go-scm.com'

    await deliverCode({
      email: 'atacante@ajeno.com, jefe@go-scm.com',
      code: '1',
      expiresInMinutes: 10,
    })

    expect(enviarPorResend.mock.calls[0][0].to).toBe('jefe@go-scm.com')
  })

  it('un proveedor inyectado no se ve afectado por el desvío', async () => {
    process.env.MAIL_REDIRECT_TO = 'jefe@go-scm.com'
    const inyectado = vi.fn()
    setCodeSender(inyectado)

    await deliverCode({ email: 'colega@go-scm.com', code: '1', expiresInMinutes: 10 })

    expect(inyectado).toHaveBeenCalledWith({
      email: 'colega@go-scm.com', code: '1', expiresInMinutes: 10,
    })
    expect(enviarPorResend).not.toHaveBeenCalled()
  })
})

describe('sin correo configurado', () => {
  it('en desarrollo lo imprime, que es lo que permite trabajar sin proveedor', async () => {
    const consola = vi.spyOn(console, 'log').mockImplementation(() => {})

    await deliverCode({ email: 'p@c.com', code: '482913', expiresInMinutes: 10 })

    expect(consola).toHaveBeenCalledTimes(1)
    expect(consola.mock.calls[0][0]).toContain('482913')
    consola.mockRestore()
  })

  // La prueba que importa de este archivo.
  it('en PRODUCCIÓN revienta, y NO imprime el código', async () => {
    process.env.NODE_ENV = 'production'
    const consola = vi.spyOn(console, 'log').mockImplementation(() => {})

    const fallo = await deliverCode({ email: 'p@c.com', code: '482913', expiresInMinutes: 10 })
      .then(() => null, (error) => error)

    expect(fallo).toBeInstanceOf(Error)
    expect(fallo.message).toContain('RESEND_API_KEY')
    expect(fallo.message).not.toContain('482913')
    expect(consola).not.toHaveBeenCalled()

    consola.mockRestore()
  })

  it('en producción con solo una de las dos variables, también revienta', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RESEND_API_KEY = 'clave'
    const consola = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(deliverCode({ email: 'p@c.com', code: '1', expiresInMinutes: 10 }))
      .rejects.toThrow('MAIL_FROM')
    expect(consola).not.toHaveBeenCalled()
    expect(enviarPorResend).not.toHaveBeenCalled()

    consola.mockRestore()
  })
})
