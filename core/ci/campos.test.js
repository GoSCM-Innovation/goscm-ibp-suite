import { describe, expect, it } from 'vitest'
import { BLOQUE_POR_TIPO, CAMPOS_CONOCIDOS, NOMBRES_CON_CONTROL, camposDe, plantillaDeBody } from './campos.js'
import { leerBody } from './body.js'

describe('plantillaDeBody', () => {
  it.each(['MASTERDATA', 'KEYFIGURES'])('la de %s es un body que se puede guardar', (tipo) => {
    const leido = leerBody(plantillaDeBody(tipo))
    expect(leido.ok).toBe(true)
    expect(leido.clave).toBe(BLOQUE_POR_TIPO[tipo])
    expect(leido.bloque.TypeOfData).toBe(tipo)
  })

  it('el dato maestro lleva prefijo y tipo de maestro, y las cifras clave su perfil de tiempo y archivo', () => {
    const maestro = leerBody(plantillaDeBody('MASTERDATA')).bloque
    const cifras = leerBody(plantillaDeBody('KEYFIGURES')).bloque
    expect(maestro).toHaveProperty('MasterDataPrefix')
    expect(maestro).not.toHaveProperty('FileName')
    expect(cifras).toHaveProperty('TargetTimeProfileLevelinSAPIBP')
    expect(cifras).toHaveProperty('FileName')
    expect(cifras).not.toHaveProperty('MasterDataType')
  })

  it('trae los valores que se repiten en todos los ejemplos', () => {
    const { bloque } = leerBody(plantillaDeBody('KEYFIGURES'))
    expect(bloque).toMatchObject({ DestinationforAddon: 'PRD', DestinationforSAPIBP: 'IBP', MaxPackageSize: '104857600' })
  })
})

describe('camposDe', () => {
  it('filtra por familia y conserva el orden', () => {
    const maestro = camposDe('MASTERDATA').map((una) => una.campo)
    expect(maestro).toContain('MasterDataType')
    expect(maestro).not.toContain('FileName')
    expect(camposDe('KEYFIGURES').map((una) => una.campo)).toContain('FileName')
  })

  it('sin una familia reconocida, los que valen para todas', () => {
    const comunes = camposDe('OTRA').map((una) => una.campo)
    expect(comunes).toContain('BatchCommand')
    expect(comunes).not.toContain('MasterDataType')
    expect(comunes).not.toContain('FileName')
  })
})

describe('NOMBRES_CON_CONTROL', () => {
  it('incluye los cuatro con editor propio, para que no se repitan en «Otros campos»', () => {
    for (const campo of ['SourceFieldsfromAddon', 'TargetFieldsInSAPIBP', 'FieldMapping', 'FilterForTheDataSource']) {
      expect(NOMBRES_CON_CONTROL.has(campo)).toBe(true)
    }
    expect(CAMPOS_CONOCIDOS.every((una) => NOMBRES_CON_CONTROL.has(una.campo))).toBe(true)
  })
})
