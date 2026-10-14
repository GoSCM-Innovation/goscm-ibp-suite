// @vitest-environment jsdom
//
// Las sugerencias de IBP en el editor de una integración, en la pantalla de verdad: elegir el área, la versión y la
// tabla de las que IBP tiene, elegir campos de la tabla, armar la tabla de una carga de cifras, sugerir valores del
// filtro y avisar de lo que no cuadra.
//
// Lo que se mira es lo que ninguna prueba de las piezas sueltas puede ver:
//   - que SIN IBP (sin vínculo, o caído) el formulario siga siendo el de siempre, escribible a mano;
//   - que elegir de IBP cambie el body y que lo que el body ya tenía no se pierda;
//   - que los avisos no impidan ejecutar;
//   - que no se pida a IBP lo que se está escribiendo a medias.

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = { get: vi.fn() }
vi.mock('../../lib/api.js', () => ({ api }))

const { default: EditorDeIntegracion } = await import('./EditorDeIntegracion.jsx')
const { useCatalogoIbp } = await import('./useCatalogoIbp.js')
const {
  asentar, boton, desmontar, dom, elegir, escribir, marcar, montar, porEtiqueta, pulsar, texto,
} = await import('./ayudas-de-prueba.js')

const CONEXION_CON_IBP = { id: 'ci-1', name: 'CPI dev', ibpConnectionId: 'ibp-1' }
const CONEXION_SIN_IBP = { id: 'ci-1', name: 'CPI dev', ibpConnectionId: null }
const IBP = { id: 'ibp-1', nombre: 'IBP QAS' }

const AREAS = [
  {
    id: 'AREA1',
    descripcion: 'Unified Planning Area',
    deCifras: true,
    prefijo: 'AB',
    versiones: [{ id: '', nombre: 'Versión base (vacío)' }, { id: 'PVSMD', nombre: 'Versión con maestro' }],
    tipos: { '': ['ABLOCATION', 'ABPRODUCT'], PVSMD: ['ABPRODUCT'] },
  },
  { id: 'AREA2', descripcion: '', deCifras: true, prefijo: 'CD', versiones: [{ id: '', nombre: 'Versión base (vacío)' }], tipos: { '': ['CDPRODUCT'] } },
]
const CAMPOS = [
  { campo: 'PRDID', etiqueta: 'Product ID', tipo: 'NVARCHAR(60)', sistema: false },
  { campo: 'MATTYPEID', etiqueta: 'Material Type', tipo: 'NVARCHAR(4)', sistema: false },
  { campo: 'PlanningAreaID', etiqueta: 'Planning Area ID', tipo: 'NVARCHAR(30)', sistema: true },
]
const CIFRAS = {
  area: 'AREA1',
  dims: [{ campo: 'PRDID', etiqueta: 'Product ID' }, { campo: 'LOCID', etiqueta: 'Location ID' }],
  cifras: [{ campo: 'ZFACTURAS', etiqueta: 'Facturas' }],
  niveles: ['PERIODID0_TSTAMP'],
}

const bloqueMaestro = (cambios = {}) => ({
  BatchCommand: 'INSERT_UPDATE',
  TypeOfData: 'MASTERDATA',
  MasterDataPrefix: 'AB',
  MasterDataType: 'PRODUCT',
  PlanningArea: 'AREA1',
  PlanningAreaVersion: '',
  SourceFieldsfromAddon: '',
  TargetFieldsInSAPIBP: '',
  FieldMapping: '',
  FilterForTheDataSource: '',
  ...cambios,
})
const cuerpo = (bloque, clave = 'PRODUCT') => JSON.stringify({ [clave]: bloque }, null, 2)

/** Lo que contesta `/api/ci/ibp`, por acción. */
function servidor(cambios = {}) {
  api.get.mockImplementation(async (ruta, params) => {
    if (ruta !== '/api/ci/ibp') throw new Error(`Ruta inesperada: ${ruta}`)
    const propia = cambios[params.accion]
    if (propia) return propia(params)
    switch (params.accion) {
      case 'resumen': return { ibp: IBP, areas: AREAS, avisos: [] }
      case 'campos-maestro': return { ibp: IBP, entidad: params.entidad, campos: CAMPOS }
      case 'cifras': return { ibp: IBP, ...CIFRAS, area: params.area }
      case 'valores': return { ibp: IBP, tabla: params.entidad ?? 'ABPRODUCT', valores: ['ZFER', 'ZHAW'], truncado: false }
      default: throw new Error(`Acción inesperada: ${params.accion}`)
    }
  })
}

const pedidos = (accion) => api.get.mock.calls.filter(([, params]) => params.accion === accion).map(([, params]) => params)

/** El editor con el catálogo de la conexión, como lo monta la biblioteca. */
function ConEditor({ conexion = CONEXION_CON_IBP, body, nivelesDeTiempo, onEjecutar = () => {} }) {
  const catalogo = useCatalogoIbp(conexion)
  return createElement(EditorDeIntegracion, {
    integracion: { id: 'i-1', name: 'PRODUCTOS', folder: '', body },
    carpetas: [],
    catalogo,
    nivelesDeTiempo,
    onGuardar: () => {},
    onDuplicar: () => {},
    onBorrar: () => {},
    onEjecutar,
  })
}

const esperar = async () => { for (let i = 0; i < 6; i += 1) await asentar() }
const abrir = async (props) => { await montar(ConEditor, props); await esperar() }

const campo = (id) => dom().querySelector(`#${id}`)
const bloqueActual = async () => {
  await pulsar(boton('JSON'))
  const [bloque] = Object.values(JSON.parse(porEtiqueta('Body en JSON').value))
  await pulsar(boton('Formulario'))
  return bloque
}

beforeEach(() => {
  vi.clearAllMocks()
  servidor()
})
afterEach(desmontar)

describe('sin IBP el formulario es el de siempre', () => {
  it('sin IBP de destino lo dice, no pide nada y deja escribir a mano', async () => {
    await abrir({ conexion: CONEXION_SIN_IBP, body: cuerpo(bloqueMaestro({ PlanningArea: '' })) })

    expect(texto()).toContain('no tiene un IBP de destino')
    expect(api.get).not.toHaveBeenCalled()
    expect(campo('ci-PlanningArea').tagName).toBe('INPUT')
    await escribir(campo('ci-PlanningArea'), 'AREA_A_MANO')
    expect((await bloqueActual()).PlanningArea).toBe('AREA_A_MANO')
  })

  it('si el servidor dice 409 (sin IBP de destino) se ve igual, sin error', async () => {
    servidor({ resumen: async () => { throw Object.assign(new Error('«CPI dev» no tiene un IBP de destino.'), { status: 409 }) } })
    await abrir({ body: cuerpo(bloqueMaestro()) })

    expect(texto()).toContain('no tiene un IBP de destino')
    expect(dom().querySelector('[role="alert"]')).toBeNull()
  })

  it('si IBP no contesta lo dice, deja escribir a mano y se puede reintentar', async () => {
    servidor({ resumen: async () => { throw new Error('SAP devolvió 403') } })
    await abrir({ body: cuerpo(bloqueMaestro()) })

    expect(dom().querySelector('[role="alert"]').textContent).toContain('No se pudo leer IBP: SAP devolvió 403')
    expect(campo('ci-PlanningArea').tagName).toBe('INPUT')

    servidor()
    await pulsar(boton('Reintentar'))
    await esperar()
    expect(texto()).toContain('Sugerencias de IBP: IBP QAS')
  })

  it('mientras lee, lo dice', async () => {
    api.get.mockReturnValue(new Promise(() => {}))
    await abrir({ body: cuerpo(bloqueMaestro()) })
    expect(texto()).toContain('Leyendo IBP')
  })
})

describe('con IBP: área, versión y tabla', () => {
  it('dice contra qué IBP sugiere y pide el resumen una vez', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ PlanningArea: '' })) })
    expect(texto()).toContain('Sugerencias de IBP: IBP QAS')
    expect(pedidos('resumen')).toEqual([{ connectionId: 'ci-1', accion: 'resumen' }])
  })

  it('el área se elige de las de IBP y queda en el body', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ PlanningArea: '', MasterDataPrefix: '', MasterDataType: '' })) })

    const area = campo('ci-PlanningArea')
    expect(area.tagName).toBe('SELECT')
    expect([...area.options].map((o) => o.value)).toEqual(['', 'AREA1', 'AREA2'])

    await elegir(area, 'AREA1')
    expect((await bloqueActual()).PlanningArea).toBe('AREA1')
  })

  it('la versión sale de las del área; la base se ve como «Versión base (vacío)» y vale vacío', async () => {
    await abrir({ body: cuerpo(bloqueMaestro()) })

    const version = campo('ci-PlanningAreaVersion')
    expect([...version.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Versión base (vacío)'],
      ['PVSMD', 'PVSMD — Versión con maestro'],
    ])
    await elegir(version, 'PVSMD')
    expect((await bloqueActual()).PlanningAreaVersion).toBe('PVSMD')
  })

  it('sin un área que IBP tenga no hay versiones que ofrecer: es el cuadro de texto', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ PlanningArea: '' })) })
    expect(campo('ci-PlanningAreaVersion').tagName).toBe('INPUT')
  })

  it('elegir la tabla rellena el prefijo y el tipo, y solo ofrece las de esa versión', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ MasterDataPrefix: '', MasterDataType: '', PlanningAreaVersion: 'PVSMD' })) })

    const tabla = campo('ci-tabla-ibp')
    expect([...tabla.options].map((o) => o.value)).toEqual(['', 'ABPRODUCT'])

    await elegir(tabla, 'ABPRODUCT')
    const bloque = await bloqueActual()
    expect(bloque.MasterDataPrefix).toBe('AB')
    expect(bloque.MasterDataType).toBe('PRODUCT')
  })

  it('un valor que el body ya tenía y IBP no conoce se conserva, escribible, con el aviso', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ PlanningArea: 'VIEJA' })) })

    const area = campo('ci-PlanningArea')
    expect(area.tagName).toBe('INPUT')
    expect(area.value).toBe('VIEJA')
    expect(texto()).toContain('No está en IBP.')
    expect((await bloqueActual()).PlanningArea).toBe('VIEJA')
  })

  it('una variable no se marca como desconocida', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ PlanningArea: '{{AREA}}' })) })
    expect(campo('ci-PlanningArea').value).toBe('{{AREA}}')
    expect(texto()).not.toContain('No está en IBP.')
  })

  it('«A mano» cambia el selector por el cuadro de texto, y «Elegir de IBP» lo devuelve', async () => {
    await abrir({ body: cuerpo(bloqueMaestro()) })
    expect(campo('ci-PlanningArea').tagName).toBe('SELECT')
    await pulsar(dom().querySelector('#ci-PlanningArea').parentElement.querySelector('button'))
    expect(campo('ci-PlanningArea').tagName).toBe('INPUT')
  })

  it('«Actualizar» vuelve a leer saltándose lo guardado', async () => {
    await abrir({ body: cuerpo(bloqueMaestro()) })
    await pulsar(boton('↺ Actualizar'))
    await esperar()
    expect(pedidos('resumen')).toEqual([
      { connectionId: 'ci-1', accion: 'resumen' },
      { connectionId: 'ci-1', accion: 'resumen', actualizar: '1' },
    ])
  })

  it('los avisos del servidor (un servicio que no contestó) se ven', async () => {
    servidor({ resumen: async () => ({ ibp: IBP, areas: AREAS, avisos: ['No se pudo leer el catálogo de dato maestro: SAP devolvió 403'] }) })
    await abrir({ body: cuerpo(bloqueMaestro()) })
    expect(texto()).toContain('No se pudo leer el catálogo de dato maestro')
  })

  it('el nivel de tiempo sugiere los que ya usan otras integraciones', async () => {
    const cifras = { TypeOfData: 'KEYFIGURES', TargetTimeProfileLevelinSAPIBP: '', PlanningArea: 'AREA1', PlanningAreaVersion: '' }
    await abrir({ body: cuerpo(cifras, 'KEYFIGURE'), nivelesDeTiempo: ['0000000002', '0000000003'] })

    const opciones = [...dom().querySelectorAll('#ci-sug-TargetTimeProfileLevelinSAPIBP option')].map((o) => o.value)
    expect(opciones).toEqual(['0000000002', '0000000003'])
  })
})

describe('con IBP: elegir campos de la tabla', () => {
  it('lee los campos de la tabla que IBP tiene, una vez', async () => {
    await abrir({ body: cuerpo(bloqueMaestro()) })
    expect(pedidos('campos-maestro')).toEqual([{ connectionId: 'ci-1', accion: 'campos-maestro', entidad: 'ABPRODUCT' }])
  })

  // Pedir los campos de lo que se escribe a medias bajaría el `$metadata` de dato maestro (varios megas) en cada tecla.
  it('NO pide los campos de una tabla que IBP no tiene (lo que se escribe a medias)', async () => {
    await abrir({ body: cuerpo(bloqueMaestro({ MasterDataType: 'PROD' })) })
    expect(pedidos('campos-maestro')).toEqual([])
    expect(boton('Elegir campos de IBP').disabled).toBe(true)
  })

  it('con la tabla vacía marca todos los campos menos los de sistema, y al aplicar arma la tabla', async () => {
    await abrir({ body: cuerpo(bloqueMaestro()) })
    await pulsar(boton('Elegir campos de IBP'))

    expect(dom().textContent).toContain('Campos de ABPRODUCT')
    expect(dom().textContent).toContain('2 campo(s) seleccionado(s)')
    await pulsar(boton('Aplicar'))

    expect(porEtiqueta('Campo de origen 1').value).toBe('PRDID')
    expect(porEtiqueta('Campo en SAP IBP 2').value).toBe('MATTYPEID')
    expect(dom().querySelector('[aria-label="Campo de origen 3"]')).toBeNull()

    const bloque = await bloqueActual()
    expect(bloque.FieldMapping).toBe('PRDID:PRDID,MATTYPEID:MATTYPEID')
    expect(bloque.SourceFieldsfromAddon).toBe('PRDID,MATTYPEID')
    expect(bloque.TargetFieldsInSAPIBP).toBe('PRDID,MATTYPEID')
  })

  it('cada fila dice qué es su destino en IBP, y avisa de lo que no existe', async () => {
    const mapeo = { FieldMapping: 'MATNR:PRDID,X:ZNOEXISTE', SourceFieldsfromAddon: 'MATNR,X', TargetFieldsInSAPIBP: 'PRDID,ZNOEXISTE' }
    await abrir({ body: cuerpo(bloqueMaestro(mapeo)) })

    expect(texto()).toContain('Product ID')
    expect(texto()).toContain('No existe en IBP')
    // Es un aviso en la revisión, y no impide nada.
    expect(texto()).toContain('Revisión contra IBP')
    expect(texto()).toContain('El campo «ZNOEXISTE» no existe en la tabla ABPRODUCT en «IBP QAS».')
  })

  it('un campo de sistema se señala: lo rellena SAP', async () => {
    const mapeo = { FieldMapping: 'A:PlanningAreaID', SourceFieldsfromAddon: 'A', TargetFieldsInSAPIBP: 'PlanningAreaID' }
    await abrir({ body: cuerpo(bloqueMaestro(mapeo)) })
    expect(texto()).toContain('«PlanningAreaID» lo rellena SAP: no se carga.')
  })

  it('aplicar conserva el origen de lo que ya estaba y lo propio del origen', async () => {
    const mapeo = { FieldMapping: 'MATNR:PRDID,X:ZPROPIO', SourceFieldsfromAddon: 'MATNR,X', TargetFieldsInSAPIBP: 'PRDID,ZPROPIO' }
    await abrir({ body: cuerpo(bloqueMaestro(mapeo)) })

    await pulsar(boton('Elegir campos de IBP'))
    // Ya marcado: PRDID (es un campo de la tabla). Se agrega MATTYPEID.
    const casilla = [...dom().querySelectorAll('dialog .ef-field-item')].find((una) => una.textContent.includes('MATTYPEID')).querySelector('input')
    await marcar(casilla)
    await pulsar(boton('Aplicar'))

    expect((await bloqueActual()).FieldMapping).toBe('MATNR:PRDID,X:ZPROPIO,MATTYPEID:MATTYPEID')
  })
})

describe('con IBP: cifras clave', () => {
  const BLOQUE_CIFRAS = { TypeOfData: 'KEYFIGURES', PlanningArea: 'AREA1', PlanningAreaVersion: '', FieldMapping: '', SourceFieldsfromAddon: '', TargetFieldsInSAPIBP: '', FilterForTheDataSource: '' }

  it('lee las dimensiones y cifras del área que IBP tiene', async () => {
    await abrir({ body: cuerpo(BLOQUE_CIFRAS, 'KEYFIGURE') })
    expect(pedidos('cifras')).toEqual([{ connectionId: 'ci-1', accion: 'cifras', area: 'AREA1' }])
  })

  it('el constructor arma dimensiones, fecha del periodo y valor de la cifra', async () => {
    await abrir({ body: cuerpo(BLOQUE_CIFRAS, 'KEYFIGURE') })
    await pulsar(boton('Armar desde IBP'))

    expect(boton('Reemplazar la tabla').disabled).toBe(true)
    await elegir(campo('ci-cifra'), 'ZFACTURAS')
    const casillas = [...dom().querySelectorAll('.ci-dimensiones input')]
    await marcar(casillas[0])
    await marcar(casillas[1])
    await pulsar(boton('Reemplazar la tabla'))

    const bloque = await bloqueActual()
    expect(bloque.FieldMapping).toBe('PRDID:PRDID,LOCID:LOCID,KEYFIGUREDATE:KEYFIGUREDATE,KFVALUE:ZFACTURAS')
    // Todos conocidos: la fecha del periodo se reconoce como campo de la carga y no se marca.
    expect(texto()).not.toContain('No existe en IBP')
    expect(texto()).toContain('Campo de la carga, no de IBP')
    expect(texto()).not.toContain('Revisión contra IBP')
  })

  it('una cifra que IBP no tiene se avisa', async () => {
    const mapeo = { FieldMapping: 'KFVALUE:ZNOEXISTE', SourceFieldsfromAddon: 'KFVALUE', TargetFieldsInSAPIBP: 'ZNOEXISTE' }
    await abrir({ body: cuerpo({ ...BLOQUE_CIFRAS, ...mapeo }, 'KEYFIGURE') })
    expect(texto()).toContain('«ZNOEXISTE» no es una dimensión ni una cifra clave del área «AREA1» en «IBP QAS».')
  })
})

describe('con IBP: valores del filtro', () => {
  const conFiltro = (filtro, cambios = {}) => cuerpo(bloqueMaestro({ FilterForTheDataSource: filtro, ...cambios }))

  it('ofrece los valores de IBP de un campo de la tabla y suma los elegidos a los que había', async () => {
    await abrir({ body: conFiltro("MATTYPEID EQ 'ZFER'") })

    await pulsar(porEtiqueta('Valores de IBP de MATTYPEID'))
    await esperar()
    expect(pedidos('valores')).toEqual([{ connectionId: 'ci-1', accion: 'valores', entidad: 'ABPRODUCT', campo: 'MATTYPEID' }])
    expect(dom().textContent).toContain('Valores de MATTYPEID')

    const casilla = [...dom().querySelectorAll('dialog .ef-field-item')].find((una) => una.textContent.includes('ZHAW')).querySelector('input')
    await marcar(casilla)
    await pulsar(boton('Aplicar'))

    expect(dom().querySelector('.ci-filtro-vista').textContent).toBe("MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW'")
  })

  it('un campo que la tabla no tiene no ofrece valores: es del sistema de origen', async () => {
    await abrir({ body: conFiltro("AUTYP EQ '40'") })
    expect(porEtiqueta('Campo').value).toBe('AUTYP')
    expect(porEtiqueta('Valores de IBP de AUTYP')).toBeNull()
  })

  it('la fecha del periodo nunca ofrece valores', async () => {
    await abrir({ body: conFiltro("KEYFIGUREDATE EQ '20261005'") })
    expect(porEtiqueta('Campo').value).toBe('KEYFIGUREDATE')
    expect(porEtiqueta('Valores de IBP de KEYFIGUREDATE')).toBeNull()
  })

  it('los valores que cortarían el filtro no se ofrecen, y se dice', async () => {
    servidor({ valores: async () => ({ ibp: IBP, tabla: 'ABPRODUCT', valores: ['ZFER', "O'BRIEN", 'A,B'], truncado: false }) })
    await abrir({ body: conFiltro("MATTYPEID EQ 'ZFER'") })
    await pulsar(porEtiqueta('Valores de IBP de MATTYPEID'))
    await esperar()

    expect(dom().textContent).not.toContain("O'BRIEN")
    expect(dom().textContent).toContain('2 valores no se ofrecen')
  })

  it('si IBP falla al leer los valores se dice en la ventana y se puede cerrar', async () => {
    servidor({ valores: async () => { throw new Error('SAP devolvió 500') } })
    await abrir({ body: conFiltro("MATTYPEID EQ 'ZFER'") })
    await pulsar(porEtiqueta('Valores de IBP de MATTYPEID'))
    await esperar()
    expect(dom().textContent).toContain('SAP devolvió 500')
  })

  it('los valores no se recuerdan: cada vez que se abre se vuelve a pedir', async () => {
    await abrir({ body: conFiltro("MATTYPEID EQ 'ZFER'") })
    for (let i = 0; i < 2; i += 1) {
      await pulsar(porEtiqueta('Valores de IBP de MATTYPEID'))
      await esperar()
      await pulsar(boton('Cancelar'))
    }
    expect(pedidos('valores')).toHaveLength(2)
  })
})

describe('la revisión no impide nada', () => {
  it('con un área que IBP no tiene avisa, y «Ejecutar» sigue disponible y entrega los avisos', async () => {
    const alEjecutar = vi.fn()
    await abrir({ body: cuerpo(bloqueMaestro({ PlanningArea: 'VIEJA' })), onEjecutar: alEjecutar })

    expect(texto()).toContain('Revisión contra IBP')
    expect(texto()).toContain('El área «VIEJA» no existe en «IBP QAS».')

    const ejecutar = boton('▶ Ejecutar')
    expect(ejecutar.disabled).toBe(false)
    await pulsar(ejecutar)
    expect(alEjecutar).toHaveBeenCalledWith(['El área «VIEJA» no existe en «IBP QAS».'])
  })

  it('con todo en orden no hay panel', async () => {
    await abrir({ body: cuerpo(bloqueMaestro()) })
    expect(texto()).not.toContain('Revisión contra IBP')
  })
})
