import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  TOPE, agrupar, anotarLlamada, limpiarLlamadas, llamadas, suscribir,
} from './tech-logs.js'

const llamada = (extra = {}) => ({ metodo: 'GET', ruta: '/api/x', estado: 200, ms: 12, ...extra })

beforeEach(() => { limpiarLlamadas() })

describe('anotarLlamada', () => {
  it('guarda la más reciente primero', () => {
    anotarLlamada(llamada({ ruta: '/api/a' }))
    anotarLlamada(llamada({ ruta: '/api/b' }))
    expect(llamadas().map((una) => una.ruta)).toEqual(['/api/b', '/api/a'])
  })

  it('le pone la hora', () => {
    anotarLlamada(llamada())
    expect(llamadas()[0].cuando).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  // Es para mirar lo que acaba de fallar, no un historial.
  it('no guarda más del tope', () => {
    for (let i = 0; i < TOPE + 30; i += 1) anotarLlamada(llamada({ ruta: `/api/${i}` }))
    expect(llamadas()).toHaveLength(TOPE)
    expect(llamadas()[0].ruta).toBe(`/api/${TOPE + 29}`)
  })

  it('sin detalle queda vacío, no undefined', () => {
    anotarLlamada(llamada())
    expect(llamadas()[0].detalle).toBe('')
  })

  it('limpiar deja el registro vacío', () => {
    anotarLlamada(llamada())
    limpiarLlamadas()
    expect(llamadas()).toEqual([])
  })
})

describe('suscribir', () => {
  it('avisa de cada llamada nueva', () => {
    const avisar = vi.fn()
    suscribir(avisar)

    anotarLlamada(llamada())
    expect(avisar).toHaveBeenCalledTimes(1)
  })

  it('avisa también al limpiar, para que el panel se vacíe', () => {
    const avisar = vi.fn()
    suscribir(avisar)
    limpiarLlamadas()
    expect(avisar).toHaveBeenCalled()
  })

  it('darse de baja deja de avisar', () => {
    const avisar = vi.fn()
    suscribir(avisar)()

    anotarLlamada(llamada())
    expect(avisar).not.toHaveBeenCalled()
  })
})

describe('agrupar', () => {
  // Un monitor que refresca cada treinta segundos llena el panel con la misma línea.
  it('colapsa las repetidas seguidas con un contador', () => {
    const grupos = agrupar([llamada(), llamada(), llamada({ ruta: '/api/otra' })])

    expect(grupos).toHaveLength(2)
    expect(grupos[0].veces).toBe(2)
    expect(grupos[1].veces).toBe(1)
  })

  // La primera de la tanda es la vieja; la interesante es la última.
  it('de un grupo conserva la más reciente', () => {
    const grupos = agrupar([llamada({ ms: 10 }), llamada({ ms: 999 })])
    expect(grupos[0].llamada.ms).toBe(999)
  })

  it('el estado forma parte de la clave: un fallo no se mezcla con un acierto', () => {
    expect(agrupar([llamada(), llamada({ estado: 500 })])).toHaveLength(2)
  })

  it('el método también', () => {
    expect(agrupar([llamada(), llamada({ metodo: 'POST' })])).toHaveLength(2)
  })

  // Dos tandas de lo mismo con otra llamada en medio son dos grupos, no uno.
  it('solo colapsa las que están seguidas', () => {
    const grupos = agrupar([llamada(), llamada({ ruta: '/api/otra' }), llamada()])
    expect(grupos).toHaveLength(3)
  })

  it('sin llamadas no hay grupos', () => {
    expect(agrupar([])).toEqual([])
    expect(agrupar(undefined)).toEqual([])
  })
})
