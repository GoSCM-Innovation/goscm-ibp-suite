// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  areaColor, loadTabs, saveTabs, sortTabs, tabLabel, tabLabelParts, tabsStorageKey, TAB_LIMIT,
} from './pestanas-de-visor.js'

beforeEach(() => { localStorage.clear() })

describe('tabLabelParts', () => {
  it('arriba la tabla y abajo la versión', () => {
    expect(tabLabelParts({ areaId: 'SAP4', versionId: 'ESC1', leafLabel: 'GIDPRODUCT' }))
      .toEqual({ primary: 'GIDPRODUCT', secondary: 'ESC1' })
  })

  it('la versión base se nombra «base», como en v8', () => {
    expect(tabLabelParts({ areaId: 'SAP4', versionId: '', leafLabel: 'GIDPRODUCT' }).secondary).toBe('base')
  })

  it('sin tabla elegida enseña el área', () => {
    expect(tabLabelParts({ areaId: 'SAP4', versionId: '' }).primary).toBe('SAP4')
  })

  it('una pestaña vacía es «Nueva pestaña», sin segunda línea', () => {
    expect(tabLabelParts(null)).toEqual({ primary: 'Nueva pestaña', secondary: '' })
  })
})

describe('tabLabel', () => {
  it('el texto completo lleva también el área', () => {
    expect(tabLabel({ areaId: 'SAP4', versionId: '', leafLabel: 'T' })).toBe('SAP4 · base · T')
  })
})

describe('sortTabs', () => {
  it('ordena por área, versión y tabla', () => {
    const tabs = [
      { id: 'c', meta: { areaId: 'B', versionId: '', leafLabel: 'X' } },
      { id: 'a', meta: { areaId: 'A', versionId: 'V2', leafLabel: 'X' } },
      { id: 'b', meta: { areaId: 'A', versionId: '', leafLabel: 'Z' } },
    ]
    expect(sortTabs(tabs).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })

  // Si saltaran de sitio mientras se configuran, se pierde de vista la que se está tocando.
  it('las que no tienen área van al final y en el orden en que se abrieron', () => {
    const tabs = [
      { id: 'n1', meta: null },
      { id: 'a', meta: { areaId: 'A' } },
      { id: 'n2', meta: null },
    ]
    expect(sortTabs(tabs).map((t) => t.id)).toEqual(['a', 'n1', 'n2'])
  })
})

describe('areaColor', () => {
  it('es estable para la misma área', () => {
    expect(areaColor('CTYTTS')).toBe(areaColor('CTYTTS'))
  })

  it('dos áreas casi iguales no comparten color', () => {
    expect(areaColor('AREA1')).not.toBe(areaColor('AREA2'))
  })

  it('sin área, el borde neutro', () => {
    expect(areaColor('')).toBe('var(--border2)')
  })
})

describe('loadTabs y saveTabs', () => {
  it('devuelve lo guardado, por visor y por conexión', () => {
    const estado = { activeId: 'a', tabs: [{ id: 'a', def: { pa: 'S' }, meta: { areaId: 'S' } }] }
    saveTabs('master', 'c1', estado)
    expect(loadTabs('master', 'c1')).toEqual(estado)
    expect(loadTabs('master', 'c2')).toBeNull()
    expect(loadTabs('trans', 'c1')).toBeNull()
  })

  it('lo ilegible o vacío es como no tener nada', () => {
    localStorage.setItem(tabsStorageKey('master', 'c1'), '{roto')
    expect(loadTabs('master', 'c1')).toBeNull()
    saveTabs('master', 'c1', { activeId: null, tabs: [] })
    expect(loadTabs('master', 'c1')).toBeNull()
  })

  it('el tope es el de v8', () => {
    expect(TAB_LIMIT).toBe(8)
  })
})
