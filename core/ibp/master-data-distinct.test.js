import { describe, it, expect, vi } from 'vitest'

import { contarDistintas, consultaDistinct, distinctSinEfecto } from './master-data-distinct.js'

describe('consultaDistinct', () => {
  it('pide solo las columnas elegidas y ordena por ellas, sin añadir claves', () => {
    expect(consultaDistinct(['LOCID', 'PRDID'])).toEqual({
      select: ['LOCID', 'PRDID'],
      orderby: ['LOCID', 'PRDID'],
    })
  })

  // Ordenar por algo que no está en el $select es un 500 de SAP.
  it('nunca ordena por una columna que no se pide', () => {
    const { select, orderby } = consultaDistinct(['A', 'B'], { field: 'Z', dir: 'asc' })
    expect(orderby.every((c) => select.includes(c.replace(' desc', '')))).toBe(true)
  })

  it('pone la columna elegida primero y deja las demás detrás', () => {
    expect(consultaDistinct(['A', 'B', 'C'], { field: 'B', dir: 'desc' }).orderby).toEqual(['B desc', 'A', 'C'])
    expect(consultaDistinct(['A', 'B', 'C'], { field: 'C', dir: 'asc' }).orderby).toEqual(['C', 'A', 'B'])
  })

  it('no repite columnas', () => {
    expect(consultaDistinct(['A', 'A', 'B']).select).toEqual(['A', 'B'])
  })
})

describe('distinctSinEfecto', () => {
  it('es cierto cuando están todas las claves', () => {
    expect(distinctSinEfecto(['LOCID', 'PRDID', 'SOURCEID', 'X'], ['LOCID', 'PRDID', 'SOURCEID'])).toBe(true)
  })

  it('es falso si falta una clave', () => {
    expect(distinctSinEfecto(['LOCID', 'PRDID'], ['LOCID', 'PRDID', 'SOURCEID'])).toBe(false)
  })

  // Sin claves conocidas no se puede afirmar que no deduplique.
  it('es falso si no se conocen las claves', () => {
    expect(distinctSinEfecto(['A'], [])).toBe(false)
    expect(distinctSinEfecto(['A'], undefined)).toBe(false)
  })
})

describe('contarDistintas', () => {
  const ventana = (n) => Array.from({ length: n }, (_, i) => ({ i }))

  it('termina con la primera ventana incompleta y suma lo leído', async () => {
    const leerPagina = vi.fn()
      .mockResolvedValueOnce(ventana(5000))
      .mockResolvedValueOnce(ventana(618))
    const r = await contarDistintas({ leerPagina })
    expect(r).toEqual({ total: 5618, truncado: false })
    expect(leerPagina.mock.calls.map(([a]) => a.skip)).toEqual([0, 5000])
    expect(leerPagina.mock.calls[0][0].top).toBe(5000)
  })

  it('con menos de una ventana lee una sola vez', async () => {
    const leerPagina = vi.fn().mockResolvedValue(ventana(6))
    expect(await contarDistintas({ leerPagina })).toEqual({ total: 6, truncado: false })
    expect(leerPagina).toHaveBeenCalledTimes(1)
  })

  it('una ventana exacta obliga a mirar la siguiente, que viene vacía', async () => {
    const leerPagina = vi.fn().mockResolvedValueOnce(ventana(5000)).mockResolvedValueOnce([])
    expect(await contarDistintas({ leerPagina })).toEqual({ total: 5000, truncado: false })
  })

  it('una tabla vacía cuenta cero', async () => {
    expect(await contarDistintas({ leerPagina: async () => [] })).toEqual({ total: 0, truncado: false })
  })

  it('corta en el tope y lo dice, sin fingir que ese es el total', async () => {
    const leerPagina = vi.fn().mockResolvedValue(ventana(5000))
    const r = await contarDistintas({ leerPagina, tope: 10000 })
    expect(r).toEqual({ total: 10000, truncado: true })
    expect(leerPagina).toHaveBeenCalledTimes(2)
  })

  it('devuelve null si se cancela', async () => {
    const ac = new AbortController()
    ac.abort()
    const leerPagina = vi.fn()
    expect(await contarDistintas({ leerPagina, signal: ac.signal })).toBeNull()
    expect(leerPagina).not.toHaveBeenCalled()
  })

  it('devuelve null si se cancela durante la lectura', async () => {
    const ac = new AbortController()
    const leerPagina = vi.fn(async () => { ac.abort(); return ventana(5000) })
    expect(await contarDistintas({ leerPagina, signal: ac.signal })).toBeNull()
  })
})
