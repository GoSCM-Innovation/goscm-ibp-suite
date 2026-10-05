// La muestra de IBP para el ejemplo de la documentación: varias filas juntadas en una, y la consulta
// dirigida de respaldo. Portado de `fetchIbpSampleRow` y `fetchFieldExampleMD` de v9.
//
// Antes se pedía UNA fila (`$top=1`) y el ejemplo de cada campo que esa fila tuviera vacío salía en
// blanco, aunque el campo tuviera valor en el resto de la entidad.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sapFetch = vi.fn()
vi.mock('../transport/sap-fetch.js', () => ({ sapFetch }))

const { readFieldExample, readSampleRow } = await import('./sample-row.js')

const BASE = { baseUrl: 'https://t-api.scmibp1.ondemand.com', credentials: {}, planArea: 'SAP1' }
const urlLlamada = () => sapFetch.mock.calls.at(-1)[0].url

beforeEach(() => { sapFetch.mockReset() })

describe('readSampleRow: la muestra', () => {
  it('pide 50 filas por omisión, nunca cero', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ A: '1' }] } } })
    await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT' })
    expect(urlLlamada()).toContain('$top=50')
  })

  it('respeta el tamaño pedido, con tope de 200', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ A: '1' }] } } })

    await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT', top: 200 })
    expect(urlLlamada()).toContain('$top=200')

    await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT', top: 5000 })
    expect(urlLlamada()).toContain('$top=200')
  })

  it('un tamaño absurdo (0, negativo, texto) cae al de omisión y no a $top=0', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ A: '1' }] } } })
    for (const top of [0, -3, 'x', null]) {
      await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT', top })
      expect(urlLlamada()).toContain('$top=50')
    }
  })

  it('por campo toma el PRIMER valor no vacío entre todas las filas', async () => {
    sapFetch.mockResolvedValue({
      json: { d: { results: [
        { PRDID: 'P1', PRDDESCR: '', BRAND: null },
        { PRDID: 'P2', PRDDESCR: 'Leche', BRAND: 'MARCA' },
        { PRDID: 'P3', PRDDESCR: 'Otra', BRAND: 'X' },
      ] } },
    })

    const { row } = await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT' })
    expect(row).toEqual({ PRDID: 'P1', PRDDESCR: 'Leche', BRAND: 'MARCA' })
  })

  it('un campo vacío en todas las filas no aparece: es un hueco, no un valor', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ A: '', B: '1' }, { A: null, B: '2' }] } } })
    const { row } = await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT' })
    expect(row).toEqual({ B: '1' })
  })

  it('los nombres salen en mayúsculas y sin la envoltura de OData', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ __metadata: { uri: 'x' }, prdid: 'P1' }] } } })
    const { row } = await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT' })
    expect(row).toEqual({ PRDID: 'P1' })
  })

  it('sin filas dice por qué, con el texto de v9', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [] } } })
    const salida = await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT' })
    expect(salida).toEqual({ row: null, detail: 'respuesta sin filas' })
  })

  it('si SAP falla no lanza: devuelve el motivo', async () => {
    sapFetch.mockRejectedValue(Object.assign(new Error('SAP devolvió 400'), { detail: 'falta el área' }))
    const salida = await readSampleRow({ ...BASE, service: 'MASTER_DATA_API_SRV', entitySet: 'PRODUCT' })
    expect(salida).toEqual({ row: null, detail: 'falta el área' })
  })

  it('manda el $select cuando se le da', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ A: '1' }] } } })
    await readSampleRow({ ...BASE, service: 'PLANNING_DATA_API_SRV', entitySet: 'SAP1', selectFields: ['PRDID', 'LOCID'] })
    expect(urlLlamada()).toContain('$select=PRDID,LOCID')
  })
})

describe('readFieldExample: la consulta dirigida', () => {
  it('pide UNA fila de ese campo filtrando lo vacío, en dato maestro', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ BRAND: 'MARCA' }] } } })

    const { value } = await readFieldExample({ ...BASE, entitySet: 'PRODUCT', field: 'BRAND' })

    expect(value).toBe('MARCA')
    const url = urlLlamada()
    expect(url).toContain('/MASTER_DATA_API_SRV/PRODUCT?')
    expect(url).toContain('$top=1')
    expect(url).toContain('$select=BRAND')
    expect(decodeURIComponent(url)).toContain("$filter=BRAND ne ''")
  })

  it('sin fila devuelve null', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [] } } })
    await expect(readFieldExample({ ...BASE, entitySet: 'PRODUCT', field: 'BRAND' })).resolves.toEqual({ value: null })
  })

  it('un valor que resulta vacío (objeto, nulo) devuelve null', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ BRAND: { __deferred: {} } }] } } })
    await expect(readFieldExample({ ...BASE, entitySet: 'PRODUCT', field: 'BRAND' })).resolves.toEqual({ value: null })
  })

  it('encuentra el campo aunque SAP lo devuelva con otra capitalización', async () => {
    sapFetch.mockResolvedValue({ json: { d: { results: [{ Brand: 'MARCA' }] } } })
    await expect(readFieldExample({ ...BASE, entitySet: 'PRODUCT', field: 'BRAND' })).resolves.toEqual({ value: 'MARCA' })
  })

  it('nunca lanza: si SAP falla, null', async () => {
    sapFetch.mockRejectedValue(new Error('boom'))
    await expect(readFieldExample({ ...BASE, entitySet: 'PRODUCT', field: 'BRAND' })).resolves.toEqual({ value: null })
  })

  // El nombre del campo viaja dentro de la URL y del $filter: no puede armar otra consulta.
  it.each(["BRAND' or 1 eq 1 or X ne '", 'A B', 'A;B', '', 'A/../B'])('no consulta con un nombre raro: %s', async (field) => {
    await expect(readFieldExample({ ...BASE, entitySet: 'PRODUCT', field })).resolves.toEqual({ value: null })
    expect(sapFetch).not.toHaveBeenCalled()
  })

  it('tampoco con una entidad rara', async () => {
    await expect(readFieldExample({ ...BASE, entitySet: 'PRODUCT?x=1', field: 'BRAND' })).resolves.toEqual({ value: null })
    expect(sapFetch).not.toHaveBeenCalled()
  })
})
