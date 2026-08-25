// @vitest-environment jsdom
//
// El aviso del navegador al terminar una orquestación. Portado de v9, donde el hueco pasó dos
// revisiones de paridad sin que nadie lo viera: el documento decía «huecos abiertos: ninguno».

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { avisarFinDeCorrida, pedirPermisoDeAviso } from './aviso-de-corrida.js'

/** Pone un `Notification` de mentira con el permiso que se le diga. */
function conNotificaciones(permission) {
  const creadas = []
  class Falso {
    constructor(titulo, opciones) { creadas.push({ titulo, opciones }) }
  }
  Falso.permission = permission
  Falso.requestPermission = vi.fn()

  window.Notification = Falso
  return { creadas, pedido: Falso.requestPermission }
}

beforeEach(() => { delete window.Notification })
afterEach(() => { delete window.Notification })

describe('pedirPermisoDeAviso', () => {
  // Pedirlo sin que la persona haya hecho nada es lo que hace que lo niegue de entrada, y una vez
  // negado la página no puede volver a preguntar. Por eso se pide al arrancar, no al montar.
  it('lo pide cuando todavía no se decidió', () => {
    const { pedido } = conNotificaciones('default')
    pedirPermisoDeAviso()
    expect(pedido).toHaveBeenCalledTimes(1)
  })

  it('no vuelve a pedirlo si ya está concedido o negado', () => {
    const concedido = conNotificaciones('granted')
    pedirPermisoDeAviso()
    expect(concedido.pedido).not.toHaveBeenCalled()

    const negado = conNotificaciones('denied')
    pedirPermisoDeAviso()
    expect(negado.pedido).not.toHaveBeenCalled()
  })

  it('en un navegador sin notificaciones no revienta', () => {
    expect(() => pedirPermisoDeAviso()).not.toThrow()
  })
})

describe('avisarFinDeCorrida', () => {
  it('avisa con el nombre y el motivo de cada estado terminal', () => {
    const { creadas } = conNotificaciones('granted')

    avisarFinDeCorrida('Carga nocturna', 'success')
    avisarFinDeCorrida('Carga nocturna', 'error')
    avisarFinDeCorrida('Carga nocturna', 'cancelled')

    expect(creadas.map((una) => una.opciones.body)).toEqual([
      'Completada correctamente',
      'Finalizó con error',
      'Cancelada',
    ])
    expect(creadas[0].titulo).toBe('Carga nocturna')
  })

  // Un estado que el motor no conocía se dice tal cual, en vez de callarse: es más útil un aviso raro
  // que ningún aviso.
  it('un estado desconocido se dice tal cual', () => {
    const { creadas } = conNotificaciones('granted')
    avisarFinDeCorrida('X', 'algo-nuevo')
    expect(creadas[0].opciones.body).toBe('algo-nuevo')
  })

  it('sin nombre pone uno genérico', () => {
    const { creadas } = conNotificaciones('granted')
    avisarFinDeCorrida('', 'success')
    expect(creadas[0].titulo).toBe('Orquestación')
  })

  // El aviso es una comodidad, no la forma de saber el resultado: el estado siempre está en pantalla.
  it('sin permiso no avisa, y no falla', () => {
    const { creadas } = conNotificaciones('denied')
    expect(() => avisarFinDeCorrida('X', 'success')).not.toThrow()
    expect(creadas).toEqual([])
  })

  it('en un navegador sin notificaciones no revienta', () => {
    expect(() => avisarFinDeCorrida('X', 'success')).not.toThrow()
  })
})
