import { describe, it, expect } from 'vitest'

import { contarEjecuciones, masEjecutados, porDia, porEstado, ultimasFalladas } from './ibp-summary.js'

/** Una ejecución con lo mínimo que miran las cuentas. */
const run = (JobStatus, extra = {}) => ({
  JobStatus,
  JobText: 'Carga nocturna',
  JobPlannedStartDateTime: '20260806120000',
  ...extra,
})

describe('contarEjecuciones', () => {
  it('cuenta cada grupo por separado', () => {
    const cuentas = contarEjecuciones([run('F'), run('W'), run('A'), run('R'), run('S')])

    expect(cuentas).toMatchObject({ total: 5, correctas: 2, falladas: 1, corriendo: 1, enCola: 1 })
  })

  // Terminar con avisos cuenta como correcta, y lo que sigue corriendo no entra en la tasa.
  it('la tasa mira solo lo que acabó', () => {
    expect(contarEjecuciones([run('F'), run('W'), run('A'), run('R')]).tasa).toBe(67)
  })

  it('sin nada acabado no da tasa', () => {
    expect(contarEjecuciones([run('R'), run('S')]).tasa).toBeNull()
    expect(contarEjecuciones([]).tasa).toBeNull()
  })
})

describe('porEstado', () => {
  it('ordena de mayor a menor y trae color y etiqueta', () => {
    const porciones = porEstado([run('F'), run('F'), run('A')])

    expect(porciones.map((una) => [una.code, una.value])).toEqual([['F', 2], ['A', 1]])
    expect(porciones[0].name).toBe('Terminado')
    expect(porciones[0].color).toMatch(/^#/)
  })

  // Las etiquetas del tenant ganan a las nuestras: son las que el usuario ve en IBP.
  it('usa la etiqueta que manda SAP cuando la hay', () => {
    expect(porEstado([run('F')], { F: 'Finished' })[0].name).toBe('Finished')
  })

  it('sin ejecuciones no hay porciones', () => {
    expect(porEstado([])).toEqual([])
  })
})

describe('porDia', () => {
  it('agrupa por día y separa correctas de falladas', () => {
    const dias = porDia([
      run('F', { JobPlannedStartDateTime: '20260806120000' }),
      run('A', { JobPlannedStartDateTime: '20260806180000' }),
      run('R', { JobPlannedStartDateTime: '20260806190000' }),
      run('F', { JobPlannedStartDateTime: '20260807120000' }),
    ], 'utc')

    expect(dias).toHaveLength(2)
    expect(dias[0]).toMatchObject({ Correctas: 1, Falladas: 1, Otras: 1 })
    expect(dias[1]).toMatchObject({ Correctas: 1, Falladas: 0, Otras: 0 })
  })

  it('va en orden cronológico, no alfabético', () => {
    const dias = porDia([
      run('F', { JobPlannedStartDateTime: '20261101120000' }),
      run('F', { JobPlannedStartDateTime: '20260201120000' }),
    ], 'utc')
    expect(dias[0].orden).toBeLessThan(dias[1].orden)
  })

  it('una fecha ilegible no rompe el gráfico', () => {
    expect(porDia([run('F', { JobPlannedStartDateTime: '' })], 'utc')).toEqual([])
  })
})

describe('masEjecutados', () => {
  it('cuenta las veces de cada trabajo y sus fallos', () => {
    const top = masEjecutados([
      run('F', { JobText: 'Maestros' }),
      run('A', { JobText: 'Maestros' }),
      run('F', { JobText: 'Ventas' }),
    ])

    expect(top[0]).toEqual({ nombre: 'Maestros', veces: 2, falladas: 1 })
    expect(top[1]).toEqual({ nombre: 'Ventas', veces: 1, falladas: 0 })
  })

  it('recorta al tope pedido', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => run('F', { JobText: `T${i}` }))
    expect(masEjecutados(muchos, 3)).toHaveLength(3)
  })
})

describe('ultimasFalladas', () => {
  it('solo las falladas, de la más reciente a la más antigua', () => {
    const falladas = ultimasFalladas([
      run('A', { JobPlannedStartDateTime: '20260801120000' }),
      run('F', { JobPlannedStartDateTime: '20260809120000' }),
      run('U', { JobPlannedStartDateTime: '20260808120000' }),
    ])

    expect(falladas).toHaveLength(2)
    expect(falladas[0].JobPlannedStartDateTime).toBe('20260808120000')
  })

  it('sin fallos devuelve una lista vacía', () => {
    expect(ultimasFalladas([run('F'), run('W')])).toEqual([])
  })
})
