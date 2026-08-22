import { describe, expect, it } from 'vitest'

import {
  VERSION_BASE,
  versionEfectiva,
  versionParaSap,
  versionesElegibles,
} from './version-elegida.js'

const SEIS = [
  { id: 'ASIBPTSIRR' }, { id: 'BACKUPVSEM' }, { id: 'PVSMD' },
  { id: 'UPSIDE' }, { id: 'ZPRUEBA' }, { id: 'ZPRUEBARED' },
]

describe('lo que se le manda a SAP', () => {
  // Es la regla de la que dependía todo: en SAP, pedir la versión base es NO mandar `VersionID`.
  it('la base va vacía', () => {
    expect(versionParaSap(VERSION_BASE)).toBe('')
  })

  it('una versión con nombre va tal cual', () => {
    expect(versionParaSap('ZPRUEBA')).toBe('ZPRUEBA')
  })

  it('la ausencia de elección también va vacía, y por eso no puede ser la única señal', () => {
    expect(versionParaSap('')).toBe('')
    expect(versionParaSap(null)).toBe('')
    expect(versionParaSap(undefined)).toBe('')
  })

  // Si la base fuera la cadena vacía, «base» y «todavía no elegí» serían indistinguibles, y la
  // pantalla —que exige haber elegido— dejaría la base fuera de alcance.
  it('el identificador de la base NO es la cadena vacía', () => {
    expect(VERSION_BASE).not.toBe('')
    expect(VERSION_BASE.length).toBeGreaterThan(0)
  })
})

describe('las versiones que se pueden elegir', () => {
  it('la base va primero: es la del área y es el caso normal', () => {
    expect(versionesElegibles(SEIS)[0]).toBe(VERSION_BASE)
    expect(versionesElegibles(SEIS)).toHaveLength(7)
  })

  it('un área sin versiones con nombre deja solo la base', () => {
    expect(versionesElegibles([])).toEqual([VERSION_BASE])
    expect(versionesElegibles(null)).toEqual([VERSION_BASE])
  })

  it('descarta las entradas sin identificador en vez de ofrecer un hueco', () => {
    expect(versionesElegibles([{ id: 'A' }, {}, { id: '' }, null])).toEqual([VERSION_BASE, 'A'])
  })
})

describe('la versión que de verdad está en juego', () => {
  it('respeta la elegida si existe en el área', () => {
    expect(versionEfectiva('ZPRUEBA', SEIS)).toBe('ZPRUEBA')
    expect(versionEfectiva(VERSION_BASE, SEIS)).toBe(VERSION_BASE)
  })

  // Arrastrar la versión del área anterior haría que la pantalla dijera una y consultara otra.
  it('descarta una versión que no existe en esta área', () => {
    expect(versionEfectiva('DE_OTRA_AREA', SEIS)).toBe('')
  })

  it('se auto-elige solo si hay una sola posibilidad', () => {
    expect(versionEfectiva('', [])).toBe(VERSION_BASE)
    expect(versionEfectiva('', [{ id: 'UNICA' }])).toBe('')
  })

  // Con seis versiones y la base, elegir por el consultor es lo más caro que puede hacer esta
  // aplicación: un análisis leído contra la versión equivocada parece correcto.
  it('con varias no adivina', () => {
    expect(versionEfectiva('', SEIS)).toBe('')
  })

  it('la base es elegible aunque el área tenga versiones con nombre', () => {
    // Es el caso que estaba roto: se podía elegir cualquiera de las seis, pero no la base.
    expect(versionesElegibles(SEIS)).toContain(VERSION_BASE)
    expect(versionEfectiva(VERSION_BASE, SEIS)).toBe(VERSION_BASE)
    expect(versionParaSap(versionEfectiva(VERSION_BASE, SEIS))).toBe('')
  })
})
