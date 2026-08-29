// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  claveDePestanas,
  guardarPestanas,
  leerPestanas,
  nombreDePestana,
  nuevaPestana,
  TOPE_DE_PESTANAS,
} from './pestanas-de-visor.js'

beforeEach(() => { localStorage.clear() })

describe('nombreDePestana', () => {
  it('junta área, versión y tabla', () => {
    expect(nombreDePestana({ area: 'SAP4', version: 'ESC1', tabla: 'GIDPRODUCT' }))
      .toBe('SAP4 · ESC1 · GIDPRODUCT')
  })

  it('sin versión —la base— no deja el separador suelto', () => {
    expect(nombreDePestana({ area: 'SAP4', version: '', tabla: 'GIDPRODUCT' }))
      .toBe('SAP4 · GIDPRODUCT')
  })

  it('una pestaña sin tabla todavía no tiene nombre', () => {
    // Quien la pinta pone «Pestaña n»: una pestaña vacía con el nombre del área engañaría.
    expect(nombreDePestana({ area: 'SAP4', version: 'ESC1' })).toBe('')
    expect(nombreDePestana(null)).toBe('')
  })
})

describe('nuevaPestana', () => {
  it('nace vacía y con identificador propio', () => {
    const una = nuevaPestana()
    expect(una.def).toBeNull()
    expect(una.id).toBeTruthy()
    expect(nuevaPestana().id).not.toBe(una.id)
  })

  it('duplicar COPIA la definición, no la comparte', () => {
    // Compartida, cambiar de tabla en una cambiaría el nombre de la otra.
    const def = { area: 'SAP4', version: '', tabla: 'T' }
    const copia = nuevaPestana(def)
    def.tabla = 'OTRA'
    expect(copia.def.tabla).toBe('T')
  })
})

describe('leerPestanas y guardarPestanas', () => {
  it('devuelve lo guardado', () => {
    guardarPestanas('master', 'c1', [{ id: 'a', def: { area: 'S', version: '', tabla: 'T' } }])
    expect(leerPestanas('master', 'c1')).toEqual([{ id: 'a', def: { area: 'S', version: '', tabla: 'T' } }])
  })

  it('sin nada guardado devuelve UNA pestaña vacía: un visor sin pestañas no enseña nada', () => {
    const leidas = leerPestanas('master', 'c1')
    expect(leidas).toHaveLength(1)
    expect(leidas[0].def).toBeNull()
  })

  it('con basura guardada tampoco deja el visor sin pestañas', () => {
    localStorage.setItem(claveDePestanas('master', 'c1'), '{roto')
    expect(leerPestanas('master', 'c1')).toHaveLength(1)
  })

  it('descarta las entradas sin identificador', () => {
    localStorage.setItem(claveDePestanas('master', 'c1'), JSON.stringify([{ def: null }, { id: 'b' }]))
    expect(leerPestanas('master', 'c1').map((una) => una.id)).toEqual(['b'])
  })

  it('recorta al tope aunque se hubieran guardado más', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, def: null }))
    localStorage.setItem(claveDePestanas('master', 'c1'), JSON.stringify(muchas))
    expect(leerPestanas('master', 'c1')).toHaveLength(TOPE_DE_PESTANAS)
  })

  it('cada visor y cada conexión tienen las suyas', () => {
    guardarPestanas('master', 'c1', [{ id: 'm', def: null }])
    guardarPestanas('trans', 'c1', [{ id: 't', def: null }])
    guardarPestanas('master', 'c2', [{ id: 'o', def: null }])
    expect(leerPestanas('master', 'c1')[0].id).toBe('m')
    expect(leerPestanas('trans', 'c1')[0].id).toBe('t')
    expect(leerPestanas('master', 'c2')[0].id).toBe('o')
  })

  it('guarda SOLO la definición, nunca las filas', () => {
    // Es lo que hace que volver con ocho pestañas no dispare ocho consultas a SAP.
    guardarPestanas('master', 'c1', [{ id: 'a', def: { area: 'S', tabla: 'T' }, filas: [1, 2, 3] }])
    const crudo = localStorage.getItem(claveDePestanas('master', 'c1'))
    expect(crudo).not.toContain('filas')
  })
})
