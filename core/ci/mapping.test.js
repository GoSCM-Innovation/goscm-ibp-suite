import { describe, expect, it } from 'vitest'
import { escribirMapeo, leerMapeo, leerPegado } from './mapping.js'

const COHERENTE = {
  SourceFieldsfromAddon: 'PRDID,LOCID,CUSTID,KEYFIGUREDATE,KFVALUE',
  TargetFieldsInSAPIBP: 'PRDID,LOCID,CUSTID,KEYFIGUREDATE,ZFACTURASPOS',
  FieldMapping: 'PRDID:PRDID,LOCID:LOCID,CUSTID:CUSTID,KEYFIGUREDATE:KEYFIGUREDATE,KFVALUE:ZFACTURASPOS',
}

describe('leerMapeo', () => {
  it('arma la tabla desde FieldMapping y dice que las tres listas coinciden', () => {
    const { filas, coherente, avisos } = leerMapeo(COHERENTE)
    expect(filas.map(({ origen, destino }) => [origen, destino])).toEqual([
      ['PRDID', 'PRDID'], ['LOCID', 'LOCID'], ['CUSTID', 'CUSTID'], ['KEYFIGUREDATE', 'KEYFIGUREDATE'], ['KFVALUE', 'ZFACTURASPOS'],
    ])
    expect(coherente).toBe(true)
    expect(avisos).toEqual([])
  })

  // Un descuido en una de las tres listas es una carga que falla o que mapea mal.
  it('avisa si TargetFields no coincide con FieldMapping', () => {
    const { coherente, avisos } = leerMapeo({ ...COHERENTE, TargetFieldsInSAPIBP: 'PRDID,LOCID,CUSTID,KEYFIGUREDATE,OTRO' })
    expect(coherente).toBe(false)
    expect(avisos.join(' ')).toMatch(/TargetFieldsInSAPIBP no coincide/)
  })

  it('avisa si SourceFields tiene otro orden', () => {
    const { coherente, avisos } = leerMapeo({ ...COHERENTE, SourceFieldsfromAddon: 'LOCID,PRDID,CUSTID,KEYFIGUREDATE,KFVALUE' })
    expect(coherente).toBe(false)
    expect(avisos.join(' ')).toMatch(/SourceFieldsfromAddon no coincide/)
  })

  it('sin FieldMapping, arma la tabla con las dos listas', () => {
    const { filas } = leerMapeo({ SourceFieldsfromAddon: 'A,B', TargetFieldsInSAPIBP: 'X,Y' })
    expect(filas.map(({ origen, destino }) => [origen, destino])).toEqual([['A', 'X'], ['B', 'Y']])
  })

  it('un par sin destino se avisa', () => {
    const { avisos } = leerMapeo({ FieldMapping: 'A:B,C' })
    expect(avisos.join(' ')).toMatch(/C no dice a qué campo va/)
  })

  it('un bloque sin nada da una tabla vacía y coherente', () => {
    expect(leerMapeo({})).toMatchObject({ filas: [], coherente: true })
  })

  it('tolera espacios alrededor de las comas', () => {
    expect(leerMapeo({ FieldMapping: ' A:B , C:D ' }).filas.map((f) => f.origen)).toEqual(['A', 'C'])
  })
})

describe('escribirMapeo', () => {
  it('genera las tres listas, alineadas', () => {
    const { filas } = leerMapeo(COHERENTE)
    expect(escribirMapeo(filas)).toEqual(COHERENTE)
  })

  it('no escribe las filas incompletas', () => {
    expect(escribirMapeo([
      { origen: 'A', destino: 'B' }, { origen: 'C', destino: '' }, { origen: '', destino: 'D' },
    ])).toEqual({ SourceFieldsfromAddon: 'A', TargetFieldsInSAPIBP: 'B', FieldMapping: 'A:B' })
  })

  it('una tabla vacía da tres listas vacías', () => {
    expect(escribirMapeo([])).toEqual({ SourceFieldsfromAddon: '', TargetFieldsInSAPIBP: '', FieldMapping: '' })
  })

  it('leer y escribir de vuelta deja coherente lo que no lo era', () => {
    const roto = { ...COHERENTE, SourceFieldsfromAddon: 'X' }
    const arreglado = escribirMapeo(leerMapeo(roto).filas)
    expect(leerMapeo(arreglado).coherente).toBe(true)
  })
})

describe('leerPegado', () => {
  const pares = (filas) => filas.map(({ origen, destino }) => [origen, destino])

  it('una lista con comas: cada campo va a uno del mismo nombre', () => {
    expect(pares(leerPegado('PRDID,LOCID'))).toEqual([['PRDID', 'PRDID'], ['LOCID', 'LOCID']])
  })

  it('pares con dos puntos', () => {
    expect(pares(leerPegado('KFVALUE:ZFACTURASPOS,PRDID:PRDID'))).toEqual([['KFVALUE', 'ZFACTURASPOS'], ['PRDID', 'PRDID']])
  })

  it('columnas de Excel, con una o dos columnas', () => {
    expect(pares(leerPegado('PRDID\tPRDID\nKFVALUE\tZFACTURASPOS\nLOCID\n'))).toEqual([
      ['PRDID', 'PRDID'], ['KFVALUE', 'ZFACTURASPOS'], ['LOCID', 'LOCID'],
    ])
  })

  it('un campo por línea', () => {
    expect(pares(leerPegado('A\r\nB'))).toEqual([['A', 'A'], ['B', 'B']])
  })

  it('lo vacío no da nada', () => {
    expect(leerPegado('')).toEqual([])
    expect(leerPegado(' \n \n')).toEqual([])
  })
})
