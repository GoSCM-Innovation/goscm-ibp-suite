import { describe, it, expect } from 'vitest'

import {
  agrupar,
  intervaloDeAgrupacion,
  parseOdataDate,
  resumenDeRecursos,
  serieDesdeFilas,
} from './resource-series.js'

describe('parseOdataDate', () => {
  it('lee la forma que devuelve el servicio', () => {
    expect(parseOdataDate('/Date(1786227900000+0000)/')).toBe(1786227900000)
  })

  it('lo que no tiene esa forma no es una fecha', () => {
    expect(parseOdataDate('2026-08-08T22:25:00Z')).toBeNaN()
    expect(parseOdataDate(undefined)).toBeNaN()
  })
})

describe('intervaloDeAgrupacion', () => {
  // Con 24 puntos en cuatro horas, agrupar escondería el pico que se está buscando.
  it('los rangos cortos se dibujan enteros', () => {
    expect(intervaloDeAgrupacion(1)).toBe(0)
    expect(intervaloDeAgrupacion(24)).toBe(0)
  })

  it('a partir de una semana se promedia', () => {
    expect(intervaloDeAgrupacion(168)).toBe(600_000)
    expect(intervaloDeAgrupacion(720)).toBe(3_600_000)
  })
})

describe('serieDesdeFilas', () => {
  it('convierte y ordena cronológicamente', () => {
    const serie = serieDesdeFilas([
      { Timestamp: '/Date(2000+0000)/', CpuUsage: '5.00', MemoryUsage: '30.50' },
      { Timestamp: '/Date(1000+0000)/', CpuUsage: '2.00', MemoryUsage: '35.60' },
    ])
    expect(serie).toEqual([{ ts: 1000, cpu: 2, mem: 35.6 }, { ts: 2000, cpu: 5, mem: 30.5 }])
  })

  // Un punto sin marca legible se dibujaría en 1970 y arruinaría la escala del gráfico entero.
  it('descarta las filas que no se entienden', () => {
    expect(serieDesdeFilas([
      { Timestamp: 'raro', CpuUsage: '5', MemoryUsage: '5' },
      { Timestamp: '/Date(1000+0000)/', CpuUsage: '', MemoryUsage: '5' },
      { Timestamp: '/Date(1000+0000)/', CpuUsage: '5', MemoryUsage: '5' },
    ])).toHaveLength(1)
  })

  it('sin filas devuelve una serie vacía', () => {
    expect(serieDesdeFilas(undefined)).toEqual([])
  })
})

describe('agrupar', () => {
  const filas = [
    { ts: 0, cpu: 10, mem: 20 },
    { ts: 100, cpu: 20, mem: 40 },
    { ts: 1000, cpu: 30, mem: 60 },
  ]

  it('promedia dentro de cada tramo', () => {
    expect(agrupar(filas, 1000)).toEqual([{ ts: 0, cpu: 15, mem: 30 }, { ts: 1000, cpu: 30, mem: 60 }])
  })

  it('sin intervalo devuelve lo mismo', () => {
    expect(agrupar(filas, 0)).toBe(filas)
  })

  it('los tramos salen en orden aunque las filas no lo estén', () => {
    const desordenadas = [{ ts: 5000, cpu: 1, mem: 1 }, { ts: 0, cpu: 1, mem: 1 }]
    expect(agrupar(desordenadas, 1000).map((uno) => uno.ts)).toEqual([0, 5000])
  })
})

describe('resumenDeRecursos', () => {
  const serie = [
    { ts: 1000, cpu: 2, mem: 30 },
    { ts: 2000, cpu: 8, mem: 50 },
    { ts: 3000, cpu: 5, mem: 40 },
  ]

  // El KPI de arriba muestra cómo está AHORA, no el mayor de la ventana.
  it('el valor actual es el último, no el máximo', () => {
    expect(resumenDeRecursos(serie)).toMatchObject({ cpu: 5, mem: 40, cpuMax: 8, memMax: 50 })
  })

  it('promedia y cuenta', () => {
    expect(resumenDeRecursos(serie)).toMatchObject({ cpuMedia: 5, memMedia: 40, muestras: 3 })
  })

  // En los rangos cortos no se agrupa, así que el último valor llega tal como lo escribe SAP.
  it('el valor actual sale con la misma precisión que el pico', () => {
    expect(resumenDeRecursos([{ ts: 1, cpu: 2.04, mem: 35.61 }])).toMatchObject({ cpu: 2, mem: 35.6 })
  })

  it('guarda los extremos del periodo cubierto', () => {
    expect(resumenDeRecursos(serie)).toMatchObject({ desde: 1000, hasta: 3000 })
  })

  it('sin puntos no inventa ceros', () => {
    expect(resumenDeRecursos([])).toMatchObject({ muestras: 0, cpu: null, cpuMax: null, desde: null })
  })
})
