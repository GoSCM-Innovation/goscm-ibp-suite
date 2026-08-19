import { describe, expect, it } from 'vitest'

import {
  COLUMNAS,
  ESTADOS,
  analizarRecurso,
  filaDeRecurso,
  resumirRecursos,
} from './resource-analysis.js'

describe('las tres comprobaciones de un recurso', () => {
  it('estar en las dos tablas es lo correcto', () => {
    const salida = analizarRecurso({ resid: 'MAQ1', recetas: ['R1'], plantas: ['P1'] })
    expect(salida.severidad).toBe('ok')
    expect(salida.problemas).toEqual([])
  })

  it('no estar en ninguna de las dos es un recurso huérfano', () => {
    const salida = analizarRecurso({ resid: 'MAQ9' })
    expect(salida.severidad).toBe('red')
    expect(salida.problemas[0].texto).toBe(ESTADOS.huerfano)
  })

  // Es aviso y no error porque una máquina asignada y sin usar puede ser capacidad que se está
  // montando para un producto que todavía no arrancó.
  it('asignado a una planta y sin usar en ninguna receta es aviso', () => {
    const salida = analizarRecurso({ resid: 'MAQ2', plantas: ['P1'] })
    expect(salida.severidad).toBe('yel')
    expect(salida.problemas[0].texto).toBe(ESTADOS.sinUso)
  })

  // Este sí es error: la receta lo usa, así que SAP va a intentar cargar una máquina que no está en
  // ninguna planta, y la restricción de capacidad se pierde sin avisar.
  it('usado en recetas y sin planta asignada es error', () => {
    const salida = analizarRecurso({ resid: 'MAQ3', recetas: ['R1', 'R2'] })
    expect(salida.severidad).toBe('red')
    expect(salida.problemas[0].texto).toBe(ESTADOS.sinPlanta)
  })

  it('un recurso huérfano se cuenta como UN problema, no como dos', () => {
    expect(analizarRecurso({ resid: 'MAQ9' }).problemas).toHaveLength(1)
  })

  it('aguanta que no venga nada', () => {
    expect(analizarRecurso(null).severidad).toBe('red')
    expect(analizarRecurso({}).severidad).toBe('red')
  })
})

describe('la fila del informe de recursos', () => {
  it('lleva el estado, los códigos y el número de recetas', () => {
    const hechos = {
      resid: 'MAQ1',
      descripcion: 'Línea de envasado 1',
      tipo: 'CAPACITY',
      plantas: ['P1', 'P2'],
      recetas: ['R1', 'R2', 'R3'],
      productos: ['A', 'B'],
    }
    const fila = filaDeRecurso(hechos, analizarRecurso(hechos))

    expect(fila.s).toBe('ok')
    expect(fila.c).toHaveLength(COLUMNAS.length)
    expect(fila.c[2]).toBe('MAQ1')
    expect(fila.c[3]).toBe('Línea de envasado 1')
    expect(fila.c[5]).toBe('P1, P2')
    expect(fila.c[6]).toBe('3')
    expect(fila.c[7]).toBe('A, B')
  })

  it('la lista se corta y dice cuántos quedaron fuera', () => {
    const hechos = { resid: 'MAQ1', recetas: ['R1'], plantas: ['P1'], productos: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }
    const fila = filaDeRecurso(hechos, analizarRecurso(hechos))
    expect(fila.c[7]).toContain('+1')
  })

  it('aguanta que falten datos sin romperse', () => {
    const fila = filaDeRecurso({}, analizarRecurso({}))
    expect(fila.c).toHaveLength(COLUMNAS.length)
    expect(fila.c.every((celda) => typeof celda === 'string')).toBe(true)
  })
})

describe('el resumen de recursos', () => {
  it('cuenta severidades y ordena los problemas por frecuencia', () => {
    const hechos = [
      { resid: 'A', recetas: ['R1'], plantas: ['P1'] },
      { resid: 'B', recetas: ['R2'] },
      { resid: 'C', recetas: ['R3'] },
      { resid: 'D', plantas: ['P1'] },
      { resid: 'E' },
    ]
    const resumen = resumirRecursos(hechos.map(analizarRecurso))

    expect(resumen.total).toBe(5)
    expect(resumen.porSeveridad).toEqual({ red: 3, yel: 1, info: 0, ok: 1 })
    expect(resumen.masFrecuentes[0]).toEqual({ texto: ESTADOS.sinPlanta, cuantos: 2 })
  })

  it('aguanta una lista vacía', () => {
    expect(resumirRecursos([]).total).toBe(0)
    expect(resumirRecursos(null).total).toBe(0)
  })
})
