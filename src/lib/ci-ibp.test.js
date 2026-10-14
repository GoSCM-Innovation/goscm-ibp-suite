import { describe, expect, it } from 'vitest'
import {
  aplicarCamposDeMaestro,
  camposPreseleccionados,
  conValorActual,
  esFaltaDeVinculo,
  esVariable,
  filasDeCifra,
  infoDeDestino,
  leerCifraDeFilas,
  opcionesDeAreas,
  opcionesDeTablas,
  opcionesDeVersiones,
  revisarContraIbp,
  tablasDeVersion,
  valoresParaFiltro,
} from './ci-ibp.js'

const AREAS = [
  {
    id: 'AREA1',
    descripcion: 'Unified Planning Area',
    prefijo: 'AB',
    versiones: [
      { id: '', nombre: 'Versión base (vacío)' },
      { id: 'PVSMD', nombre: 'Versión con maestro' },
      { id: 'SIN', nombre: 'SIN' },
    ],
    tipos: { '': ['ABLOCATION', 'ABPRODUCT'], PVSMD: ['ABPRODUCT'], SIN: ['ABLOCATION', 'ABPRODUCT'] },
  },
  { id: 'AREA2', descripcion: '', prefijo: '', versiones: [{ id: '', nombre: 'Versión base (vacío)' }], tipos: { '': [] } },
]

const CAMPOS = [
  { campo: 'PRDID', etiqueta: 'Product ID', tipo: 'NVARCHAR(60)', sistema: false },
  { campo: 'MATTYPEID', etiqueta: 'Material Type', tipo: 'NVARCHAR(4)', sistema: false },
  { campo: 'PlanningAreaID', etiqueta: 'Planning Area ID', tipo: 'NVARCHAR(30)', sistema: true },
]
const CIFRAS = {
  dims: [{ campo: 'PRDID', etiqueta: 'Product ID' }, { campo: 'LOCID', etiqueta: 'Location ID' }],
  cifras: [{ campo: 'ZFACTURAS', etiqueta: 'Facturas' }],
  niveles: ['PERIODID0_TSTAMP'],
}
const fila = (origen, destino) => ({ id: `${origen}-${destino}`, origen, destino })

describe('las opciones de los selectores', () => {
  it('las áreas llevan su descripción y una opción vacía de «sin elegir»', () => {
    expect(opcionesDeAreas(AREAS)).toEqual([
      { value: '', label: '— Elige un área —' },
      { value: 'AREA1', label: 'AREA1 — Unified Planning Area' },
      { value: 'AREA2', label: 'AREA2' },
    ])
  })

  it('las versiones: la base se dice como va en el body, y el nombre se omite si es igual al id', () => {
    expect(opcionesDeVersiones(AREAS[0])).toEqual([
      { value: '', label: 'Versión base (vacío)' },
      { value: 'PVSMD', label: 'PVSMD — Versión con maestro' },
      { value: 'SIN', label: 'SIN' },
    ])
    expect(opcionesDeVersiones(null)).toEqual([])
  })

  it('las tablas son las de la versión; la base y las desconocidas usan las de la base', () => {
    expect(tablasDeVersion(AREAS[0], 'PVSMD')).toEqual(['ABPRODUCT'])
    expect(tablasDeVersion(AREAS[0], '')).toEqual(['ABLOCATION', 'ABPRODUCT'])
    expect(tablasDeVersion(AREAS[0], '__BASELINE')).toEqual(['ABLOCATION', 'ABPRODUCT'])
    expect(tablasDeVersion(AREAS[0], 'NOEXISTE')).toEqual(['ABLOCATION', 'ABPRODUCT'])
    expect(tablasDeVersion(null, '')).toEqual([])
  })

  // Un nombre de versión como `constructor` no debe leerse de la cadena de prototipos.
  it('una versión con nombre de propiedad de objeto no rompe', () => {
    expect(tablasDeVersion(AREAS[0], 'constructor')).toEqual(['ABLOCATION', 'ABPRODUCT'])
    expect(tablasDeVersion(AREAS[0], '__proto__')).toEqual(['ABLOCATION', 'ABPRODUCT'])
  })

  it('las tablas llevan «sin elegir» primero', () => {
    expect(opcionesDeTablas(['A', 'B']).map((una) => una.value)).toEqual(['', 'A', 'B'])
  })

  it('un valor que IBP no conoce se agrega, marcado, para no esconderlo', () => {
    const base = opcionesDeAreas(AREAS)
    expect(conValorActual(base, 'AREA1')).toBe(base)
    expect(conValorActual(base, '')).toBe(base)
    expect(conValorActual(base, 'VIEJA').at(-1)).toEqual({ value: 'VIEJA', label: 'VIEJA (no está en IBP)' })
  })

  it('reconoce las variables y el 409 de «sin IBP de destino»', () => {
    expect(esVariable('{{AREA}}')).toBe(true)
    expect(esVariable('AREA1')).toBe(false)
    expect(esFaltaDeVinculo({ status: 409 })).toBe(true)
    expect(esFaltaDeVinculo({ status: 400 })).toBe(false)
    expect(esFaltaDeVinculo(null)).toBe(false)
  })
})

describe('infoDeDestino', () => {
  const maestro = { tipo: 'MASTERDATA', campos: CAMPOS }
  const cifras = { tipo: 'KEYFIGURES', cifras: CIFRAS }

  it('dato maestro: existe con su etiqueta, es de sistema o no existe; sin distinguir mayúsculas', () => {
    expect(infoDeDestino('PRDID', maestro)).toEqual({ estado: 'ok', etiqueta: 'Product ID' })
    expect(infoDeDestino('prdid', maestro)).toEqual({ estado: 'ok', etiqueta: 'Product ID' })
    expect(infoDeDestino('PLANNINGAREAID', maestro)).toEqual({ estado: 'sistema', etiqueta: 'Planning Area ID' })
    expect(infoDeDestino('ZNOEXISTE', maestro)).toEqual({ estado: 'falta', etiqueta: '' })
  })

  it('cifras: dimensiones y cifras existen; la fecha del periodo es un campo de la carga', () => {
    expect(infoDeDestino('LOCID', cifras)).toEqual({ estado: 'ok', etiqueta: 'Location ID' })
    expect(infoDeDestino('ZFACTURAS', cifras)).toEqual({ estado: 'ok', etiqueta: 'Facturas' })
    expect(infoDeDestino('KEYFIGUREDATE', cifras)).toEqual({ estado: 'carga', etiqueta: '' })
    expect(infoDeDestino('ZOTRA', cifras)).toEqual({ estado: 'falta', etiqueta: '' })
  })

  it('no se sabe: sin lectura, sin campo escrito o de otro tipo', () => {
    expect(infoDeDestino('PRDID', null)).toBeNull()
    expect(infoDeDestino('', maestro)).toBeNull()
    expect(infoDeDestino('PRDID', { tipo: 'MASTERDATA', campos: null })).toBeNull()
    expect(infoDeDestino('PRDID', { tipo: 'KEYFIGURES', cifras: null })).toBeNull()
  })
})

describe('el selector de campos de dato maestro', () => {
  it('con la tabla vacía marca todos menos los de sistema', () => {
    expect(camposPreseleccionados([], CAMPOS)).toEqual(['PRDID', 'MATTYPEID'])
  })

  it('con la tabla vacía de contenido (filas en blanco) también', () => {
    expect(camposPreseleccionados([fila('', '')], CAMPOS)).toEqual(['PRDID', 'MATTYPEID'])
  })

  it('con filas marca solo las que ya son destino de un campo de la tabla', () => {
    expect(camposPreseleccionados([fila('MATNR', 'PRDID'), fila('X', 'ZPROPIO')], CAMPOS)).toEqual(['PRDID'])
  })

  it('con filas que no coinciden con nada, no marca nada: no inventa', () => {
    expect(camposPreseleccionados([fila('X', 'ZPROPIO')], CAMPOS)).toEqual([])
  })

  it('aplicar conserva el origen de lo que ya estaba, conserva lo propio y agrega lo nuevo al final', () => {
    const filas = [fila('MATNR', 'PRDID'), fila('X', 'ZPROPIO')]
    const nuevas = aplicarCamposDeMaestro(filas, CAMPOS, ['MATTYPEID', 'PRDID'])
    expect(nuevas.map((una) => [una.origen, una.destino])).toEqual([
      ['MATNR', 'PRDID'], ['X', 'ZPROPIO'], ['MATTYPEID', 'MATTYPEID'],
    ])
  })

  it('aplicar quita las filas de campos de IBP que se desmarcaron, y solo esas', () => {
    const filas = [fila('MATNR', 'PRDID'), fila('X', 'ZPROPIO'), fila('T', 'MATTYPEID')]
    const nuevas = aplicarCamposDeMaestro(filas, CAMPOS, ['MATTYPEID'])
    expect(nuevas.map((una) => una.destino)).toEqual(['ZPROPIO', 'MATTYPEID'])
  })

  it('aplicar no duplica un campo ya presente aunque venga en otras mayúsculas', () => {
    const nuevas = aplicarCamposDeMaestro([fila('p', 'prdid')], CAMPOS, ['PRDID'])
    expect(nuevas).toHaveLength(1)
  })

  it('una fila incompleta no se pierde', () => {
    const nuevas = aplicarCamposDeMaestro([fila('', '')], CAMPOS, ['PRDID'])
    expect(nuevas.map((una) => una.destino)).toEqual(['', 'PRDID'])
  })
})

describe('el constructor de cifras', () => {
  it('arma dimensiones, fecha del periodo y valor de la cifra', () => {
    const filas = filasDeCifra({ dimensiones: ['PRDID', 'LOCID'], cifra: 'ZFACTURAS' })
    expect(filas.map((una) => `${una.origen}:${una.destino}`)).toEqual([
      'PRDID:PRDID', 'LOCID:LOCID', 'KEYFIGUREDATE:KEYFIGUREDATE', 'KFVALUE:ZFACTURAS',
    ])
  })

  it('lee de la tabla qué cifra y qué dimensiones tiene ya', () => {
    const filas = [fila('MATNR', 'PRDID'), fila('KEYFIGUREDATE', 'KEYFIGUREDATE'), fila('KFVALUE', 'ZFACTURAS')]
    expect(leerCifraDeFilas(filas, CIFRAS)).toEqual({ cifra: 'ZFACTURAS', dimensiones: ['PRDID'] })
  })

  it('una cifra que IBP no conoce no se propone', () => {
    expect(leerCifraDeFilas([fila('KFVALUE', 'ZNOEXISTE')], CIFRAS)).toEqual({ cifra: '', dimensiones: [] })
    expect(leerCifraDeFilas([], CIFRAS)).toEqual({ cifra: '', dimensiones: [] })
  })
})

describe('valoresParaFiltro', () => {
  it('descarta, y cuenta, los valores que cortarían el filtro', () => {
    expect(valoresParaFiltro(['ZFER', "O'BRIEN", 'A,B', 'CON ESPACIO'])).toEqual({ usables: ['ZFER', 'CON ESPACIO'], descartados: 2 })
    expect(valoresParaFiltro(undefined)).toEqual({ usables: [], descartados: 0 })
  })
})

describe('revisarContraIbp', () => {
  const maestro = (cambios = {}) => ({
    TypeOfData: 'MASTERDATA', PlanningArea: 'AREA1', PlanningAreaVersion: '', MasterDataPrefix: 'AB', MasterDataType: 'PRODUCT', ...cambios,
  })
  const revisar = (bloque, extra = {}) => revisarContraIbp({ bloque, areas: AREAS, ibpNombre: 'IBP QAS', ...extra })

  it('todo bien: sin avisos', () => {
    expect(revisar(maestro(), { filas: [fila('MATNR', 'PRDID')], detalle: { tipo: 'MASTERDATA', campos: CAMPOS } })).toEqual([])
  })

  it('un área que IBP no tiene', () => {
    expect(revisar(maestro({ PlanningArea: 'VIEJA' }))).toEqual(['El área «VIEJA» no existe en «IBP QAS».'])
  })

  it('una versión que el área no tiene', () => {
    expect(revisar(maestro({ PlanningAreaVersion: 'XYZ' }))).toEqual(['La versión «XYZ» no existe en el área «AREA1».'])
  })

  it('la versión base escrita con el nombre de IBP', () => {
    expect(revisar(maestro({ PlanningAreaVersion: '__BASELINE' }))[0]).toMatch(/__BASELINE.*en el body va vacía/)
  })

  it('una tabla que no se puede cargar en esa versión', () => {
    const avisos = revisar(maestro({ PlanningAreaVersion: 'PVSMD', MasterDataType: 'LOCATION' }))
    expect(avisos).toEqual(['La tabla «ABLOCATION» no está entre las que se pueden cargar en esa versión del área.'])
  })

  it('un campo que la tabla no tiene, y uno que rellena SAP', () => {
    const avisos = revisar(maestro(), {
      filas: [fila('A', 'ZNOEXISTE'), fila('B', 'PlanningAreaID'), fila('C', 'PRDID')],
      detalle: { tipo: 'MASTERDATA', campos: CAMPOS },
    })
    expect(avisos).toEqual([
      'El campo «ZNOEXISTE» no existe en la tabla ABPRODUCT en «IBP QAS».',
      '«PlanningAreaID» lo rellena SAP: no se carga.',
    ])
  })

  it('cifras: lo que no es dimensión ni cifra del área; la fecha del periodo no se señala', () => {
    const avisos = revisar(
      { TypeOfData: 'KEYFIGURES', PlanningArea: 'AREA1', PlanningAreaVersion: '' },
      {
        filas: [fila('A', 'PRDID'), fila('KEYFIGUREDATE', 'KEYFIGUREDATE'), fila('KFVALUE', 'ZNOEXISTE')],
        detalle: { tipo: 'KEYFIGURES', cifras: CIFRAS },
      },
    )
    expect(avisos).toEqual(['«ZNOEXISTE» no es una dimensión ni una cifra clave del área «AREA1» en «IBP QAS».'])
  })

  // Las variables se piden al ejecutar: compararlas con IBP daría un aviso falso en cada integración que las usa.
  it('una variable no se compara con IBP', () => {
    expect(revisar(maestro({ PlanningArea: '{{AREA}}', PlanningAreaVersion: '{{VERSION}}' }))).toEqual([])
    expect(revisar(maestro({ MasterDataType: '{{TABLA}}' }))).toEqual([])
  })

  it('las filas incompletas y repetidas no generan avisos de más', () => {
    const avisos = revisar(maestro(), {
      filas: [fila('', 'ZX'), fila('A', ''), fila('A', 'ZY'), fila('B', 'zy')],
      detalle: { tipo: 'MASTERDATA', campos: CAMPOS },
    })
    expect(avisos).toEqual(['El campo «ZY» no existe en la tabla ABPRODUCT en «IBP QAS».'])
  })

  it('sin catálogo no hay con qué comparar: sin avisos', () => {
    expect(revisarContraIbp({ bloque: maestro({ PlanningArea: 'VIEJA' }), areas: [] })).toEqual([])
  })

  it('un body que no tiene los campos no rompe', () => {
    expect(revisar({})).toEqual([])
    expect(revisarContraIbp({ bloque: undefined, areas: AREAS })).toEqual([])
  })
})
