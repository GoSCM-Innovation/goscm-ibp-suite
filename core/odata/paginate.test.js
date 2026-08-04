import { describe, it, expect, vi } from 'vitest'
import {
  PLANNING_COUNT_TOP,
  countRows,
  extractInlineCount,
  extractNextLink,
  extractRows,
  readAllRows,
  readAllRowsConcurrently,
  readPages,
} from './paginate.js'
import { SERVICES } from './query.js'

const RAIZ = 'https://c-api.scmibp.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV'
const base = { serviceRoot: RAIZ, entity: 'Producto', service: SERVICES.MASTER }

const filas = (desde, cuantas) => Array.from({ length: cuantas }, (_, i) => ({ id: desde + i }))
const v2 = (rows, extra = {}) => ({ d: { results: rows, ...extra } })

describe('extractRows', () => {
  it('lee el formato viejo de SAP (una colección)', () => {
    expect(extractRows(v2([{ a: 1 }]))).toEqual([{ a: 1 }])
  })

  it('lee una sola entidad del formato viejo', () => {
    expect(extractRows({ d: { a: 1 } })).toEqual([{ a: 1 }])
  })

  it('lee el formato nuevo', () => {
    expect(extractRows({ value: [{ a: 1 }] })).toEqual([{ a: 1 }])
  })

  it.each([null, undefined, {}])('devuelve lista vacía con %s', (json) => {
    expect(extractRows(json)).toEqual([])
  })
})

describe('extractNextLink y extractInlineCount', () => {
  it('encuentra el enlace de continuación en los dos formatos', () => {
    expect(extractNextLink(v2([], { __next: 'Producto?$skip=100' }))).toBe('Producto?$skip=100')
    expect(extractNextLink({ '@odata.nextLink': 'x' })).toBe('x')
  })

  it('devuelve null si no hay continuación', () => {
    expect(extractNextLink(v2([]))).toBeNull()
  })

  it('lee el total, que SAP manda como texto', () => {
    expect(extractInlineCount(v2([], { __count: '4321' }))).toBe(4321)
    expect(extractInlineCount({ '@odata.count': 7 })).toBe(7)
  })

  it('devuelve null si SAP no informó el total', () => {
    expect(extractInlineCount(v2([]))).toBeNull()
  })
})

describe('countRows', () => {
  it('en dato maestro cuenta con $top=0, que ahí es seguro', async () => {
    const read = vi.fn(async () => v2([], { __count: '8005' }))
    await expect(countRows({ read, ...base })).resolves.toBe(8005)
    expect(read.mock.calls[0][0]).toContain('$top=0')
    expect(read.mock.calls[0][0]).toContain('$inlinecount=allpages')
  })

  it('en datos de planificación usa un $top pequeño, nunca cero', async () => {
    const read = vi.fn(async () => v2([], { __count: '10' }))
    await countRows({ read, serviceRoot: RAIZ, entity: 'AREA', service: SERVICES.PLANNING, select: 'PRDID,KF' })
    expect(read.mock.calls[0][0]).toContain(`$top=${PLANNING_COUNT_TOP}`)
    expect(read.mock.calls[0][0]).not.toContain('$top=0')
  })

  it('revienta si SAP no informa el total, en vez de devolver cero', async () => {
    const read = vi.fn(async () => v2([]))
    await expect(countRows({ read, ...base })).rejects.toThrow(/no informó el total/)
  })
})

describe('readPages', () => {
  it('sigue el enlace de continuación cuando SAP lo manda', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(v2(filas(1, 2), { __next: 'Producto?$skip=2&$top=2' }))
      .mockResolvedValueOnce(v2(filas(3, 2), { __next: `${RAIZ}/Producto?$skip=4&$top=2` }))
      .mockResolvedValueOnce(v2([]))

    const paginas = []
    for await (const pagina of readPages({ read, ...base, pageSize: 2 })) paginas.push(pagina)

    expect(paginas.flat().map((f) => f.id)).toEqual([1, 2, 3, 4])
    // La segunda petición usa el enlace relativo, resuelto contra la raíz del servicio.
    expect(read.mock.calls[1][0]).toBe(`${RAIZ}/Producto?$skip=2&$top=2`)
    // La tercera venía como URL absoluta y se usa tal cual.
    expect(read.mock.calls[2][0]).toBe(`${RAIZ}/Producto?$skip=4&$top=2`)
  })

  it('si no hay enlace, avanza por posición', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(v2(filas(1, 2)))
      .mockResolvedValueOnce(v2(filas(3, 2)))
      .mockResolvedValueOnce(v2(filas(5, 1)))

    const todo = await readAllRows({ read, ...base, pageSize: 2 })

    expect(todo).toHaveLength(5)
    expect(read.mock.calls[1][0]).toContain('$skip=2')
    expect(read.mock.calls[2][0]).toContain('$skip=4')
  })

  it('se detiene en la primera página incompleta', async () => {
    const read = vi.fn().mockResolvedValueOnce(v2(filas(1, 3)))
    await readAllRows({ read, ...base, pageSize: 10 })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('se detiene con la primera página vacía', async () => {
    const read = vi.fn().mockResolvedValueOnce(v2([]))
    await expect(readAllRows({ read, ...base })).resolves.toEqual([])
  })

  it('respeta el tope de filas pedido', async () => {
    const read = vi.fn(async () => v2(filas(1, 100)))
    const todo = await readAllRows({ read, ...base, pageSize: 100, maxRows: 150 })
    expect(todo).toHaveLength(200) // dos páginas completas: no corta a media página
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('pasa el orden a cada página', async () => {
    const read = vi.fn(async () => v2([]))
    await readAllRows({ read, ...base, orderby: ['PRDID'] })
    expect(read.mock.calls[0][0]).toContain('$orderby=PRDID')
  })
})

describe('readAllRowsConcurrently', () => {
  it('se niega a leer en paralelo sin un orden estable', async () => {
    const read = vi.fn()
    await expect(readAllRowsConcurrently({ read, ...base, total: 10 }))
      .rejects.toThrow(/orderby estable/)
    expect(read).not.toHaveBeenCalled()
  })

  it('se niega si no sabe el total', async () => {
    await expect(readAllRowsConcurrently({ read: vi.fn(), ...base, orderby: ['PRDID'] }))
      .rejects.toThrow(/total de filas/)
  })

  it('devuelve las filas en el orden de las ventanas, no en el de llegada', async () => {
    // La primera ventana tarda más que la segunda: si se devolviera por orden de llegada,
    // las filas saldrían al revés.
    const read = vi.fn(async (url) => {
      const skip = Number(url.match(/\$skip=(\d+)/)?.[1] ?? 0)
      if (skip === 0) await new Promise((r) => { setTimeout(r, 20) })
      return v2(filas(skip + 1, 2))
    })

    const todo = await readAllRowsConcurrently({ read, ...base, orderby: ['PRDID'], total: 4, pageSize: 2 })

    expect(todo.map((f) => f.id)).toEqual([1, 2, 3, 4])
  })

  it('reparte el trabajo en ventanas de tamaño de página', async () => {
    const read = vi.fn(async () => v2(filas(1, 2)))
    await readAllRowsConcurrently({ read, ...base, orderby: ['PRDID'], total: 7, pageSize: 2 })
    expect(read).toHaveBeenCalledTimes(4) // 0, 2, 4, 6
  })

  it('no lanza más lecturas simultáneas de las permitidas', async () => {
    let simultaneas = 0
    let maximo = 0
    const read = vi.fn(async () => {
      simultaneas += 1
      maximo = Math.max(maximo, simultaneas)
      await new Promise((r) => { setTimeout(r, 5) })
      simultaneas -= 1
      return v2(filas(1, 1))
    })

    await readAllRowsConcurrently({ read, ...base, orderby: ['PRDID'], total: 20, pageSize: 1, parallel: 3 })

    expect(maximo).toBeLessThanOrEqual(3)
  })
})
