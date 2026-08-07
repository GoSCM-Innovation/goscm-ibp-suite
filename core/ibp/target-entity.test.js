import { describe, it, expect } from 'vitest'

import { resolveTargetEntity, selectFieldsFor } from './target-entity.js'

const md = (name) => ({ name, nameUC: name.toUpperCase(), service: 'MASTER_DATA_API_SRV' })
const pd = (name) => ({ name, nameUC: name.toUpperCase(), service: 'PLANNING_DATA_API_SRV' })

const integracion = (extra = {}) => ({
  tipoIntegracion: 'MD',
  targetTable: 'SOPMD_STAG_AS1PRODUCT',
  planArea: 'SAPIBP1',
  ...extra,
})

describe('resolveTargetEntity', () => {
  const conjuntos = [md('AS1PRODUCT'), md('AS1PRODUCTTrans'), md('AS1CUSTOMER'), pd('SAPIBP1')]

  it('quita el prefijo de staging de CI-DS y encuentra la entidad', () => {
    expect(resolveTargetEntity(integracion(), conjuntos))
      .toEqual({ service: 'MASTER_DATA_API_SRV', entitySet: 'AS1PRODUCT', planArea: 'SAPIBP1' })
  })

  it('para key figures la entidad es el área de planificación', () => {
    expect(resolveTargetEntity(integracion({ tipoIntegracion: 'KF' }), conjuntos))
      .toEqual({ service: 'PLANNING_DATA_API_SRV', entitySet: 'SAPIBP1', planArea: 'SAPIBP1' })
  })

  // Caer a dato maestro desde un key figure da un 404 de segmento, que es puro ruido.
  it('un key figure sin su área no cae a dato maestro', () => {
    expect(resolveTargetEntity(integracion({ tipoIntegracion: 'KF', planArea: 'OTRA' }), conjuntos)).toBeNull()
  })

  it('los conjuntos Trans y Message no son candidatos', () => {
    const solo = [md('AS1PRODUCTTrans'), md('AS1PRODUCTMessage')]
    expect(resolveTargetEntity(integracion(), solo)).toBeNull()
  })

  it('una integración de archivo no tiene entidad', () => {
    expect(resolveTargetEntity(integracion({ tipoIntegracion: 'FILE' }), conjuntos)).toBeNull()
  })

  it('sin área de planificación no se puede consultar nada', () => {
    expect(resolveTargetEntity(integracion({ planArea: '' }), conjuntos)).toBeNull()
  })

  it('el área elegida a mano pisa a la del export', () => {
    expect(resolveTargetEntity(integracion({ tipoIntegracion: 'KF' }), [pd('OTRA')], 'OTRA').entitySet).toBe('OTRA')
  })

  it('la entidad que termina con el núcleo también vale', () => {
    expect(resolveTargetEntity(integracion({ targetTable: 'SOPMD_STAG_PRODUCT' }), [md('AS1PRODUCT')]).entitySet)
      .toBe('AS1PRODUCT')
  })

  // Un ejemplo de la tabla equivocada es peor que un ejemplo en blanco.
  it('con dos candidatas igual de buenas no elige ninguna', () => {
    const ambiguas = [md('AS1PRODUCT'), md('AS2PRODUCT')]
    expect(resolveTargetEntity(integracion({ targetTable: 'SOPMD_STAG_PRODUCT' }), ambiguas)).toBeNull()
  })

  it('con dos candidatas desempata la que lleva el área', () => {
    const ambiguas = [md('SAPIBP1PRODUCT'), md('OTRAPRODUCT')]
    expect(resolveTargetEntity(integracion({ targetTable: 'SOPMD_STAG_PRODUCT' }), ambiguas).entitySet)
      .toBe('SAPIBP1PRODUCT')
  })

  it('sin conjuntos no hay nada que resolver', () => {
    expect(resolveTargetEntity(integracion(), [])).toBeNull()
  })
})

describe('selectFieldsFor', () => {
  const props = { SAPIBP1: new Set(['PRDID', 'LOCID']) }

  // Pedir KEYFIGUREDATE, que es de la tabla de staging, hace que SAP devuelva un error.
  it('en planificación descarta los campos que la entidad no tiene', () => {
    const destino = { service: 'PLANNING_DATA_API_SRV', entitySet: 'SAPIBP1' }
    expect(selectFieldsFor(destino, ['PRDID', 'KEYFIGUREDATE', 'LOCID'], props)).toEqual(['PRDID', 'LOCID'])
  })

  it('en dato maestro no se manda $select y se trae la fila entera', () => {
    const destino = { service: 'MASTER_DATA_API_SRV', entitySet: 'AS1PRODUCT' }
    expect(selectFieldsFor(destino, ['PRDID'], props)).toEqual([])
  })

  it('sin propiedades conocidas se piden todas y que SAP decida', () => {
    const destino = { service: 'PLANNING_DATA_API_SRV', entitySet: 'DESCONOCIDA' }
    expect(selectFieldsFor(destino, ['PRDID'], props)).toEqual(['PRDID'])
  })
})
