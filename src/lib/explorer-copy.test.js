import { describe, it, expect } from 'vitest'

import { dimensionATsv, tareasATsv } from './explorer-copy.js'

const integracion = (extra = {}) => ({
  _zipName: 'PROYECTO.zip',
  jobName: 'IBP_001_MD_PRODUCT',
  dataflowName: 'DF_PRODUCTO',
  srcDSName: 'SAP_ECC',
  dstDSName: 'IBP',
  targetTable: 'SOPMD_STAG_BNTPRODUCT',
  ...extra,
})

const filas = (texto) => texto.split('\n').map((una) => una.split('\t'))

describe('tareasATsv', () => {
  it('lleva cabecera y una fila por integración', () => {
    const tabla = filas(tareasATsv([integracion()]))

    expect(tabla[0]).toEqual(['Proyecto', 'Tarea', 'Dataflow', 'Sistema origen', 'Sistema destino', 'Tabla destino'])
    expect(tabla[1]).toEqual(['PROYECTO', 'IBP_001_MD_PRODUCT', 'DF_PRODUCTO', 'SAP_ECC', 'IBP', 'SOPMD_STAG_BNTPRODUCT'])
  })

  // Dos dataflows de la misma tarea pueden escribir a tablas distintas; juntarlos lo escondería.
  it('no agrupa por tarea', () => {
    const tabla = filas(tareasATsv([
      integracion({ dataflowName: 'DF_A', targetTable: 'TABLA_A' }),
      integracion({ dataflowName: 'DF_B', targetTable: 'TABLA_B' }),
    ]))
    expect(tabla).toHaveLength(3)
  })

  // Un tabulador dentro de un dato correría la columna sin que nadie lo note.
  it('un dato con tabuladores no rompe la tabla', () => {
    const tabla = filas(tareasATsv([integracion({ jobName: 'CON\tTAB\nY SALTO' })]))
    expect(tabla).toHaveLength(2)
    expect(tabla[1][1]).toBe('CON TAB Y SALTO')
  })

  it('sin integraciones queda solo la cabecera', () => {
    expect(filas(tareasATsv([]))).toHaveLength(1)
  })
})

describe('dimensionATsv', () => {
  const entradas = [
    { clave: 'SAP_ECC::MARA', filas: [{ intIdx: 0, mIdx: 0 }, { intIdx: 0, mIdx: 1 }, { intIdx: 3, mIdx: 0 }] },
  ]

  it('una dimensión de tabla separa el datastore', () => {
    const tabla = filas(dimensionATsv('src-table', entradas))
    expect(tabla[0]).toEqual(['Datastore', 'Tabla', 'Integraciones', 'Usos'])
    expect(tabla[1]).toEqual(['SAP_ECC', 'MARA', '2', '3'])
  })

  it('una dimensión de campo no tiene datastore', () => {
    const tabla = filas(dimensionATsv('dst-field', [{ clave: 'PRDID', filas: [{ intIdx: 1, mIdx: 0 }] }]))
    expect(tabla[0]).toEqual(['Campo', 'Integraciones', 'Usos'])
    expect(tabla[1]).toEqual(['PRDID', '1', '1'])
  })

  // En las dimensiones de filtro lo que se cuenta son filtros, no mapeos.
  it('las dimensiones de filtro cuentan filtros', () => {
    expect(filas(dimensionATsv('filter-field', [{ clave: 'MTART', filas: [{ intIdx: 0, fIdx: 0 }] }]))[0])
      .toEqual(['Campo', 'Integraciones', 'Filtros'])
    expect(filas(dimensionATsv('filter-table', entradas))[0][3]).toBe('Filtros')
  })

  it('una tabla sin datastore deja la columna vacía', () => {
    expect(filas(dimensionATsv('filter-table', [{ clave: '::MARA', filas: [] }]))[1]).toEqual(['', 'MARA', '0', '0'])
  })
})
