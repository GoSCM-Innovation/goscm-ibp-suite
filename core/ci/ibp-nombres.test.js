import { describe, expect, it } from 'vitest'
import {
  CAMPO_DE_PERIODO,
  CAMPO_DE_VALOR,
  NOMBRE_DE_VERSION_BASE,
  VERSION_BASE,
  componerTipo,
  descomponerTipo,
  esCampoDeSistema,
  esCampoDeTiempo,
  versionDelBody,
} from './ibp-nombres.js'

describe('descomponerTipo', () => {
  it('parte el identificador de la tabla en prefijo y tipo, como los pide el body', () => {
    expect(descomponerTipo('SBPRODUCT', 'SB')).toEqual({ prefijo: 'SB', tipo: 'PRODUCT' })
    expect(descomponerTipo('SBRESOURCELOCATIONPRODUCT', 'SB')).toEqual({ prefijo: 'SB', tipo: 'RESOURCELOCATIONPRODUCT' })
  })

  it('conserva las mayúsculas del identificador y no distingue al comparar', () => {
    expect(descomponerTipo('SbProduct', 'SB')).toEqual({ prefijo: 'Sb', tipo: 'Product' })
  })

  it('sin prefijo, o si el identificador no empieza por él, el identificador entero es el tipo', () => {
    expect(descomponerTipo('PRODUCT', '')).toEqual({ prefijo: '', tipo: 'PRODUCT' })
    expect(descomponerTipo('XXPRODUCT', 'SB')).toEqual({ prefijo: '', tipo: 'XXPRODUCT' })
    expect(descomponerTipo('SB', 'SB')).toEqual({ prefijo: '', tipo: 'SB' })
  })

  it('tolera lo que no es texto', () => {
    expect(descomponerTipo(undefined, 'SB')).toEqual({ prefijo: '', tipo: '' })
  })

  it('componer es la inversa', () => {
    const { prefijo, tipo } = descomponerTipo('SBLOCATION', 'SB')
    expect(componerTipo(prefijo, tipo)).toBe('SBLOCATION')
    expect(componerTipo('', 'PRODUCT')).toBe('PRODUCT')
    expect(componerTipo(undefined, undefined)).toBe('')
  })
})

describe('versionDelBody', () => {
  it('la base es cadena vacía, la llame como la llame cada servicio', () => {
    expect(versionDelBody('__BASELINE')).toBe(VERSION_BASE)
    expect(versionDelBody('')).toBe('')
    expect(versionDelBody(null)).toBe('')
    expect(versionDelBody(undefined)).toBe('')
  })

  it('las demás se dejan como están', () => {
    expect(versionDelBody('PVSMD')).toBe('PVSMD')
  })

  it('la base se enseña con un nombre que dice cómo va en el body', () => {
    expect(NOMBRE_DE_VERSION_BASE).toMatch(/base/i)
    expect(NOMBRE_DE_VERSION_BASE).toMatch(/vacío/)
  })
})

describe('los campos', () => {
  it('KEYFIGUREDATE y KFVALUE son los de staging que el iFlow espera', () => {
    expect(CAMPO_DE_PERIODO).toBe('KEYFIGUREDATE')
    expect(CAMPO_DE_VALOR).toBe('KFVALUE')
  })

  it('los de sistema se reconocen sin importar las mayúsculas', () => {
    for (const campo of ['PLANNINGAREAID', 'PlanningAreaID', 'VERSIONID', 'CREATEDDATE', 'lastmodifieddate']) {
      expect(esCampoDeSistema(campo), campo).toBe(true)
    }
    for (const campo of ['PRDID', 'MATTYPEID', '', undefined]) expect(esCampoDeSistema(campo), String(campo)).toBe(false)
  })

  it('los de periodo son PERIODIDn_TSTAMP y nada más', () => {
    for (const campo of ['PERIODID0_TSTAMP', 'PERIODID5_TSTAMP', 'periodid2_tstamp']) expect(esCampoDeTiempo(campo), campo).toBe(true)
    for (const campo of ['PERIODID0_END_TSTAMP', 'PERIODID0_REL', 'PRDID', undefined]) expect(esCampoDeTiempo(campo), String(campo)).toBe(false)
  })
})
