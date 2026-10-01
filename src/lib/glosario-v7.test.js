// El glosario de v7 se porta tal cual: estas pruebas fijan su forma, no su redacción.
// Si alguien lo "mejora" cambiando títulos o secciones, es una desviación de la interfaz de origen.

import { describe, expect, it } from 'vitest'

import { PA_SECTIONS, SN_SECTIONS, section } from './glosario-v7.js'

describe('el glosario de v7', () => {
  it('Production Analyzer tiene las doce secciones de v7, con sus títulos', () => {
    expect(PA_SECTIONS.map((s) => s.title)).toEqual([
      'Introducción',
      'Hoja: Resumen',
      'Hoja: Product',
      'Hoja: Location',
      'Hoja: Resource',
      'Hoja: Resource Location',
      'Hoja: Prod Source Header',
      'Hoja: Prod Source Item',
      'Hoja: Prod Source Resource',
      'Hoja: Tipos Excluidos',
      'Hoja: Estadísticas',
      'Tipos de Material',
    ])
  })

  it('Network Analyzer tiene las nueve secciones de v7', () => {
    expect(SN_SECTIONS.map((s) => s.title)).toEqual([
      'Introducción',
      'Hoja: Resumen',
      'Hoja: Product',
      'Hoja: Location',
      'Hoja: Customer',
      'Hoja: Location Source',
      'Hoja: Customer Source',
      'Hoja: Estadísticas',
      'Tipos de Material',
    ])
  })

  it('cada sección genera su HTML y los ids no se repiten', () => {
    const todas = [...PA_SECTIONS, ...SN_SECTIONS]
    expect(new Set(todas.map((s) => s.id)).size).toBe(todas.length)
    for (const s of todas) {
      const html = section(s.id, s.icon, s.title, s.content())
      expect(html, s.id).toContain(`id="${s.id}"`)
      expect(html.length, s.id).toBeGreaterThan(200)
    }
  })
})
