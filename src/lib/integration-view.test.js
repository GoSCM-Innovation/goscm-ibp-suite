import { describe, it, expect } from 'vitest'

import {
  agruparParaLista,
  baseFiltrada,
  datastoreOptions,
  dimensionPorId,
  entradasDeDimension,
  etiquetaDeClave,
  filasPorIntegracion,
  filtrarIntegraciones,
  planAreaOptions,
  vecinos,
} from './integration-view.js'

const integracion = (idx, extra = {}) => ({
  _idx: idx,
  _zipName: 'proyecto.zip',
  jobName: `JOB_${idx}`,
  dataflowName: `DF_${idx}`,
  planArea: 'SAPIBP1',
  srcDSName: 'ERP',
  dstDSName: 'IBP',
  targetTable: 'PRODUCT',
  tipoIntegracion: 'MD',
  ...extra,
})

describe('etiquetaDeClave', () => {
  it('separa el datastore de la tabla', () => {
    expect(etiquetaDeClave('ERP::MARA')).toBe('ERP · MARA')
  })

  it('sin datastore muestra solo la tabla', () => {
    expect(etiquetaDeClave('::MARA')).toBe('MARA')
  })

  it('un campo se muestra tal cual', () => {
    expect(etiquetaDeClave('MATNR')).toBe('MATNR')
  })
})

describe('dimensionPorId', () => {
  it('encuentra la dimensión', () => {
    expect(dimensionPorId('src-field').indice).toBe('bySrcField')
  })

  it('una dimensión desconocida cae en la de integración', () => {
    expect(dimensionPorId('inventada').id).toBe('integracion')
  })
})

describe('planAreaOptions y datastoreOptions', () => {
  const integraciones = [
    integracion(0, { planArea: 'SAPIBP1', srcDSName: 'ERP', dstDSName: 'IBP' }),
    integracion(1, { planArea: 'DEMO', srcDSName: 'BW', dstDSName: 'IBP' }),
    integracion(2, { planArea: '', srcDSName: 'ERP', dstDSName: '' }),
  ]

  it('lista los valores distintos, ordenados y sin los vacíos', () => {
    expect(planAreaOptions(integraciones)).toEqual(['DEMO', 'SAPIBP1'])
    expect(datastoreOptions(integraciones)).toEqual({ origen: ['BW', 'ERP'], destino: ['IBP'] })
  })
})

describe('baseFiltrada', () => {
  const integraciones = [
    integracion(0, { planArea: 'SAPIBP1', srcDSName: 'ERP' }),
    integracion(1, { planArea: 'DEMO', srcDSName: 'BW' }),
  ]

  // Es lo que espera quien no tocó el filtro: no haber elegido nada no es haber excluido todo.
  it('sin nada elegido pasan todas', () => {
    expect(baseFiltrada(integraciones, {})).toHaveLength(2)
    expect(baseFiltrada(integraciones, { planAreas: new Set() })).toHaveLength(2)
  })

  it('filtra por área de planificación', () => {
    expect(baseFiltrada(integraciones, { planAreas: new Set(['DEMO']) }).map((una) => una._idx)).toEqual([1])
  })

  it('los filtros se acumulan', () => {
    const filtros = { planAreas: new Set(['DEMO', 'SAPIBP1']), srcDS: new Set(['ERP']) }
    expect(baseFiltrada(integraciones, filtros).map((una) => una._idx)).toEqual([0])
  })

  it('deja solo las que ya están en el productivo cuando se pide', () => {
    const filtros = { soloTransportadas: true, transportadas: new Set(['JOB_1']) }
    expect(baseFiltrada(integraciones, filtros).map((una) => una._idx)).toEqual([1])
  })
})

describe('filtrarIntegraciones', () => {
  const integraciones = [integracion(0), integracion(1)]
  const indices = {
    searchTokens: [
      { idx: 0, tokens: 'job_0 df_0 matnr' },
      { idx: 1, tokens: 'job_1 df_1 kunnr' },
    ],
  }

  it('busca en el texto aplanado del índice', () => {
    expect(filtrarIntegraciones(integraciones, indices, 'kunnr').map((una) => una._idx)).toEqual([1])
  })

  it('la búsqueda no distingue mayúsculas', () => {
    expect(filtrarIntegraciones(integraciones, indices, 'MATNR').map((una) => una._idx)).toEqual([0])
  })

  it('sin texto devuelve la base entera', () => {
    expect(filtrarIntegraciones(integraciones, indices, '   ')).toHaveLength(2)
  })

  it('la búsqueda se aplica sobre lo que dejaron los filtros', () => {
    const filtros = { srcDS: new Set(['BW']) }
    expect(filtrarIntegraciones(integraciones, indices, 'matnr', filtros)).toEqual([])
  })
})

describe('agruparParaLista', () => {
  it('agrupa por proyecto y dentro por tarea', () => {
    const grupos = agruparParaLista([
      integracion(0, { _zipName: 'uno.zip', jobName: 'JOB_A' }),
      integracion(1, { _zipName: 'uno.zip', jobName: 'JOB_A' }),
      integracion(2, { _zipName: 'dos.zip', jobName: 'JOB_B' }),
    ])

    expect(grupos.map((uno) => uno.nombre)).toEqual(['uno', 'dos'])
    expect(grupos[0].total).toBe(2)
    expect(grupos[0].tareas).toHaveLength(1)
    expect(grupos[0].tareas[0].dataflows.map((una) => una._idx)).toEqual([0, 1])
  })

  it('conserva el orden en el que vienen', () => {
    const grupos = agruparParaLista([
      integracion(0, { jobName: 'B' }),
      integracion(1, { jobName: 'A' }),
    ])
    expect(grupos[0].tareas.map((una) => una.jobName)).toEqual(['B', 'A'])
  })

  it('sin nada no devuelve grupos', () => {
    expect(agruparParaLista([])).toEqual([])
  })
})

describe('entradasDeDimension', () => {
  const indices = {
    byDstField: {
      PRDID: [{ intIdx: 0, mIdx: 0 }, { intIdx: 1, mIdx: 0 }],
      CUSTID: [{ intIdx: 1, mIdx: 1 }],
    },
  }

  it('ordena por uso y desempata por nombre', () => {
    expect(entradasDeDimension(indices, 'dst-field', '').map((una) => una.clave)).toEqual(['PRDID', 'CUSTID'])
  })

  it('busca dentro de la clave', () => {
    expect(entradasDeDimension(indices, 'dst-field', 'cust').map((una) => una.clave)).toEqual(['CUSTID'])
  })

  // Una tabla que solo usan integraciones escondidas no tiene por qué aparecer.
  it('recorta a las integraciones visibles y descarta las claves que quedan vacías', () => {
    const entradas = entradasDeDimension(indices, 'dst-field', '', new Set([0]))
    expect(entradas.map((una) => una.clave)).toEqual(['PRDID'])
    expect(entradas[0].filas).toHaveLength(1)
  })

  it('la dimensión de integración no tiene claves propias', () => {
    expect(entradasDeDimension(indices, 'integracion', '')).toEqual([])
  })
})

describe('filasPorIntegracion', () => {
  it('junta las filas de cada integración', () => {
    expect(filasPorIntegracion([
      { intIdx: 0, mIdx: 1 },
      { intIdx: 0, mIdx: 2 },
      { intIdx: 3, mIdx: 0 },
    ], 'mIdx')).toEqual([{ intIdx: 0, indices: [1, 2] }, { intIdx: 3, indices: [0] }])
  })

  // Una expresión de filtro coincide por cada campo que menciona, y sería la misma fila repetida.
  it('no repite una fila que coincidió por varios campos', () => {
    expect(filasPorIntegracion([{ intIdx: 0, fIdx: 0 }, { intIdx: 0, fIdx: 0 }], 'fIdx'))
      .toEqual([{ intIdx: 0, indices: [0] }])
  })
})

describe('vecinos', () => {
  const cadenas = [
    { from: 0, to: 1, via: 'table', label: 'T' },
    { from: 1, to: 2, via: 'file', label: 'F' },
  ]

  it('separa quién la alimenta de a quién alimenta', () => {
    expect(vecinos(cadenas, 1)).toEqual({ entrantes: [cadenas[0]], salientes: [cadenas[1]] })
  })

  it('una integración suelta no tiene vecinos', () => {
    expect(vecinos(cadenas, 9)).toEqual({ entrantes: [], salientes: [] })
  })
})
