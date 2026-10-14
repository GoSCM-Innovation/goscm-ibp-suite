// @vitest-environment jsdom
//
// El formulario de una integración, en la pantalla de verdad: el filtro como filas, la tabla de campos y los
// campos del body. Lo que se mira es lo que ninguna prueba de `core/ci` puede ver y que rompe en silencio:
//
//   - que una fila recién agregada (todavía vacía) NO desaparezca antes de poder escribir en ella;
//   - que editar un campo no reordene ni pierda los demás;
//   - que lo que el body trae y el formulario no conoce se conserve.

import { createElement, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leerBody } from '../../../core/ci/body.js'
import ConstructorDeFiltro from './ConstructorDeFiltro.jsx'
import FormularioDeBloque from './FormularioDeBloque.jsx'
import TablaDeMapeo from './TablaDeMapeo.jsx'
import {
  boton, desmontar, dom, elegir, escribir, montar, porEtiqueta, pulsar, teclear, texto, todosPorEtiqueta,
} from './ayudas-de-prueba.js'

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(async () => {
  await desmontar()
  vi.restoreAllMocks()
})

/** Un padre con estado, como el editor: guarda el texto que le mandan y lo vuelve a pasar. */
function ConFiltro({ inicial, alCambiar }) {
  const [valor, setValor] = useState(inicial)
  return createElement(ConstructorDeFiltro, { valor, onCambiar: (nuevo) => { setValor(nuevo); alCambiar?.(nuevo) } })
}

function ConFormulario({ inicial, alCambiar }) {
  const [texto, setTexto] = useState(inicial)
  return createElement(FormularioDeBloque, { texto, onCambiar: (nuevo) => { setTexto(nuevo); alCambiar?.(nuevo) } })
}

const BODY = JSON.stringify({
  KEYFIGURE: {
    BatchCommand: 'REPLACE',
    BatchName: 'FACTURAS_Z',
    FieldMapping: 'PRDID:PRDID,KFVALUE:ZFACTURAS',
    SourceFieldsfromAddon: 'PRDID,KFVALUE',
    TargetFieldsInSAPIBP: 'PRDID,ZFACTURAS',
    TypeOfData: 'KEYFIGURES',
    PlanningArea: 'AREA_DEMO',
    CampoRaro: 'valor raro',
    FilterForTheDataSource: "MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',KEYFIGUREDATE BT '20261005' '20270412'",
  },
}, null, 2)

describe('ConstructorDeFiltro', () => {
  it('muestra una fila por campo con sus valores como fichas, y el rango con desde y hasta', async () => {
    await montar(ConFiltro, { inicial: "MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',KEYFIGUREDATE BT '20261005' '20270412'" })

    expect(todosPorEtiqueta('Campo').map((c) => c.value)).toEqual(['MATTYPEID', 'KEYFIGUREDATE'])
    expect(dom().querySelectorAll('.ci-ficha')).toHaveLength(2)
    expect(porEtiqueta('Desde').value).toBe('20261005')
    expect(porEtiqueta('Hasta').value).toBe('20270412')
  })

  it('quitar una ficha cambia el texto que se envía', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: "MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW'", alCambiar: (t) => cambios.push(t) })
    await pulsar(porEtiqueta('Quitar ZFER'))
    expect(cambios.at(-1)).toBe("MATTYPEID EQ 'ZHAW'")
  })

  it('agregar un valor con Enter lo suma a su fila', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: "MATTYPEID EQ 'ZFER'", alCambiar: (t) => cambios.push(t) })
    const nuevo = porEtiqueta('Agregar un valor')
    await escribir(nuevo, 'ZLEE')
    await teclear(nuevo, 'Enter')
    expect(cambios.at(-1)).toBe("MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZLEE'")
  })

  it('pegar varios valores separados por comas, espacios o saltos de línea los agrega todos', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: "MATTYPEID EQ 'ZFER'", alCambiar: (t) => cambios.push(t) })
    const nuevo = porEtiqueta('Agregar un valor')
    await escribir(nuevo, 'ZHAW ZLEE')
    await teclear(nuevo, 'Enter')
    expect(cambios.at(-1)).toBe("MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',MATTYPEID EQ 'ZLEE'")
  })

  // Una comilla cerraría el valor y abriría otra condición dentro del filtro.
  it('un valor con comillas no entra y se dice por qué', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: "A EQ '1'", alCambiar: (t) => cambios.push(t) })
    const nuevo = porEtiqueta('Agregar un valor')
    await escribir(nuevo, "x'y")
    await teclear(nuevo, 'Enter')
    expect(cambios).toEqual([])
    expect(dom().textContent).toContain('No puede llevar comillas simples')
  })

  // El fallo que se quiere evitar: la fila nueva no se puede escribir en el texto (está vacía), y si las filas
  // se recalcularan desde el texto, desaparecería antes de poder escribir en ella.
  it('una fila nueva vacía NO desaparece, y se puede escribir en ella', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: "A EQ '1'", alCambiar: (t) => cambios.push(t) })
    await pulsar(boton('+ Campo = valores'))

    expect(todosPorEtiqueta('Campo')).toHaveLength(2)
    await escribir(todosPorEtiqueta('Campo')[1], 'ZVIGENTE')
    expect(todosPorEtiqueta('Campo')).toHaveLength(2)
    expect(todosPorEtiqueta('Campo')[1].value).toBe('ZVIGENTE')

    const fichas = dom().querySelectorAll('input[aria-label="Agregar un valor"]')
    await escribir(fichas[1], 'S')
    await teclear(fichas[1], 'Enter')
    expect(cambios.at(-1)).toBe("A EQ '1',ZVIGENTE EQ 'S'")
  })

  it('un rango nuevo se completa con desde y hasta', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: '', alCambiar: (t) => cambios.push(t) })
    await pulsar(boton('+ Rango (BT)'))
    await escribir(porEtiqueta('Campo'), 'KEYFIGUREDATE')
    await escribir(porEtiqueta('Desde'), '20260101')
    await escribir(porEtiqueta('Hasta'), '20261231')
    expect(cambios.at(-1)).toBe("KEYFIGUREDATE BT '20260101' '20261231'")
  })

  it('lo que no entiende queda como texto y se envía tal cual', async () => {
    const cambios = []
    await montar(ConFiltro, { inicial: "A EQ '1',B NE '2'", alCambiar: (t) => cambios.push(t) })
    expect(porEtiqueta('Condición escrita a mano').value).toBe("B NE '2'")
    expect(dom().textContent).toContain('se envía tal cual')

    await pulsar(todosPorEtiqueta('Quitar la fila')[0])
    expect(cambios.at(-1)).toBe("B NE '2'")
  })

  it('«Ver como texto» permite editar la cadena entera, y al volver a las filas se ven los cambios', async () => {
    await montar(ConFiltro, { inicial: "A EQ '1'" })
    await pulsar(boton('Ver como texto'))
    await escribir(porEtiqueta('Filtro como texto'), "A EQ '1',B EQ '2'")
    await pulsar(boton('Ver como filas'))
    expect(todosPorEtiqueta('Campo').map((c) => c.value)).toEqual(['A', 'B'])
  })

  it('sin filtro lo dice, para que nadie crea que falta algo', async () => {
    await montar(ConFiltro, { inicial: '' })
    expect(dom().textContent).toContain('Sin filtro')
  })

  it('deshabilitado no deja editar ni agregar', async () => {
    await montar(ConstructorDeFiltro, { valor: "A EQ '1'", onCambiar: () => {}, deshabilitado: true })
    expect(boton('+ Campo = valores')).toBeUndefined()
    expect(porEtiqueta('Campo').disabled).toBe(true)
  })
})

describe('TablaDeMapeo', () => {
  function ConMapeo({ bloque, alCambiar }) {
    const [actual, setActual] = useState(bloque)
    return createElement(TablaDeMapeo, {
      bloque: actual,
      onCambiar: (listas) => { setActual({ ...actual, ...listas }); alCambiar?.(listas) },
    })
  }

  const COHERENTE = {
    SourceFieldsfromAddon: 'PRDID,KFVALUE',
    TargetFieldsInSAPIBP: 'PRDID,ZFACTURAS',
    FieldMapping: 'PRDID:PRDID,KFVALUE:ZFACTURAS',
  }

  it('muestra la tabla origen → destino', async () => {
    await montar(ConMapeo, { bloque: COHERENTE })
    expect(porEtiqueta('Campo de origen 2').value).toBe('KFVALUE')
    expect(porEtiqueta('Campo en SAP IBP 2').value).toBe('ZFACTURAS')
    expect(dom().textContent).toContain('2 campos')
    expect(dom().textContent).not.toContain('no coinciden')
  })

  it('editar un destino regenera las TRES listas, alineadas', async () => {
    const cambios = []
    await montar(ConMapeo, { bloque: COHERENTE, alCambiar: (l) => cambios.push(l) })
    await escribir(porEtiqueta('Campo en SAP IBP 2'), 'ZVENTAS')
    expect(cambios.at(-1)).toEqual({
      SourceFieldsfromAddon: 'PRDID,KFVALUE',
      TargetFieldsInSAPIBP: 'PRDID,ZVENTAS',
      FieldMapping: 'PRDID:PRDID,KFVALUE:ZVENTAS',
    })
  })

  it('una fila nueva incompleta NO desaparece, y no se envía hasta completarla', async () => {
    const cambios = []
    await montar(ConMapeo, { bloque: COHERENTE, alCambiar: (l) => cambios.push(l) })
    await pulsar(boton('+ Campo'))

    expect(porEtiqueta('Campo de origen 3')).not.toBeNull()
    expect(dom().textContent).toContain('1 sin completar')
    expect(cambios.at(-1).FieldMapping).toBe('PRDID:PRDID,KFVALUE:ZFACTURAS')

    await escribir(porEtiqueta('Campo de origen 3'), 'LOCID')
    await escribir(porEtiqueta('Campo en SAP IBP 3'), 'LOCID')
    expect(cambios.at(-1).FieldMapping).toBe('PRDID:PRDID,KFVALUE:ZFACTURAS,LOCID:LOCID')
    expect(cambios.at(-1).SourceFieldsfromAddon).toBe('PRDID,KFVALUE,LOCID')
  })

  it('quitar una fila la saca de las tres listas', async () => {
    const cambios = []
    await montar(ConMapeo, { bloque: COHERENTE, alCambiar: (l) => cambios.push(l) })
    await pulsar(porEtiqueta('Quitar el campo 1'))
    expect(cambios.at(-1)).toEqual({ SourceFieldsfromAddon: 'KFVALUE', TargetFieldsInSAPIBP: 'ZFACTURAS', FieldMapping: 'KFVALUE:ZFACTURAS' })
  })

  // El descuido que hace fallar una carga: no se arregla solo, se avisa y se ofrece alinear.
  it('si las tres listas no coinciden, lo avisa y ofrece alinearlas', async () => {
    const cambios = []
    await montar(ConMapeo, { bloque: { ...COHERENTE, TargetFieldsInSAPIBP: 'PRDID,OTRO' }, alCambiar: (l) => cambios.push(l) })
    expect(dom().textContent).toContain('no coinciden entre sí')
    expect(cambios).toEqual([])

    await pulsar(boton('Alinear las tres listas con esta tabla'))
    expect(cambios.at(-1).TargetFieldsInSAPIBP).toBe('PRDID,ZFACTURAS')
    expect(dom().textContent).not.toContain('no coinciden entre sí')
  })

  it('pegar una lista reemplaza la tabla', async () => {
    const cambios = []
    await montar(ConMapeo, { bloque: COHERENTE, alCambiar: (l) => cambios.push(l) })
    await pulsar(boton('Pegar lista'))
    await escribir(porEtiqueta('Lista de campos a pegar'), 'A,B,C')
    await pulsar(boton('Reemplazar la tabla'))
    expect(cambios.at(-1)).toEqual({ SourceFieldsfromAddon: 'A,B,C', TargetFieldsInSAPIBP: 'A,B,C', FieldMapping: 'A:A,B:B,C:C' })
  })
})

describe('FormularioDeBloque', () => {
  it('muestra el nombre del bloque, el tipo y los campos que corresponden al tipo', async () => {
    await montar(ConFormulario, { inicial: BODY })
    expect(dom().querySelector('#ci-clave').value).toBe('KEYFIGURE')
    expect(dom().querySelector('#ci-tipo').value).toBe('KEYFIGURES')
    expect(dom().querySelector('#ci-BatchCommand').value).toBe('REPLACE')
    // `FileName` es de cifras clave y `MasterDataType` de maestros.
    expect(dom().querySelector('#ci-FileName')).not.toBeNull()
    expect(dom().querySelector('#ci-MasterDataType')).toBeNull()
  })

  it('editar un campo lo cambia en su sitio y conserva el orden y todo lo demás', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    await escribir(dom().querySelector('#ci-PlanningArea'), 'OTRA_AREA')

    const bloque = leerBody(cambios.at(-1)).bloque
    expect(bloque.PlanningArea).toBe('OTRA_AREA')
    expect(Object.keys(bloque)).toEqual(Object.keys(leerBody(BODY).bloque))
    expect(bloque.CampoRaro).toBe('valor raro')
    expect(bloque.FilterForTheDataSource).toContain('MATTYPEID')
  })

  it('un campo que no tenía se agrega al final', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    await escribir(dom().querySelector('#ci-FileName'), 'FACTURAS')
    const claves = Object.keys(leerBody(cambios.at(-1)).bloque)
    expect(claves.at(-1)).toBe('FileName')
  })

  it('cambiar el tipo cambia los campos que se ofrecen, sin perder los que ya tenía', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'MASTERDATA')

    expect(dom().querySelector('#ci-MasterDataType')).not.toBeNull()
    expect(dom().querySelector('#ci-FileName')).toBeNull()
    expect(leerBody(cambios.at(-1)).bloque.TypeOfData).toBe('MASTERDATA')
    // Lo que no depende del tipo se queda.
    expect(leerBody(cambios.at(-1)).bloque.CampoRaro).toBe('valor raro')
    expect(leerBody(cambios.at(-1)).bloque.PlanningArea).toBe('AREA_DEMO')
  })

  // El iFlow puede aceptar campos que esta lista no conoce: no se pierden ni se bloquean.
  it('lo que el formulario no conoce sale en «Otros campos» y se puede editar y quitar', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    const raro = porEtiqueta('CampoRaro')
    expect(raro.value).toBe('valor raro')

    await escribir(raro, 'otro valor')
    expect(leerBody(cambios.at(-1)).bloque.CampoRaro).toBe('otro valor')

    await pulsar(porEtiqueta('Quitar CampoRaro'))
    expect(leerBody(cambios.at(-1)).bloque).not.toHaveProperty('CampoRaro')
  })

  it('un valor que no es texto se muestra pero no se edita aquí', async () => {
    const cuerpo = JSON.stringify({ A: { TypeOfData: 'MASTERDATA', Numero: 5 } })
    await montar(ConFormulario, { inicial: cuerpo })
    expect(dom().textContent).toContain('Numero')
    expect(porEtiqueta('Numero')).toBeNull()
  })

  it('renombrar el bloque conserva los campos', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    await escribir(dom().querySelector('#ci-clave'), 'KEYFIGURE2')
    const leido = leerBody(cambios.at(-1))
    expect(leido.clave).toBe('KEYFIGURE2')
    expect(leido.bloque.PlanningArea).toBe('AREA_DEMO')
  })

  it('un nombre de bloque vacío se ignora: dejaría el body inválido', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    await escribir(dom().querySelector('#ci-clave'), '  ')
    expect(cambios).toEqual([])
  })

  it('un body que no se puede leer dice por qué y manda a la pestaña JSON', async () => {
    await montar(ConFormulario, { inicial: '{ roto' })
    expect(dom().textContent).toContain('no se puede mostrar como formulario')
    expect(dom().textContent).toContain('JSON')
  })
})

describe('el tipo de dato y el comando son desplegables con todas las opciones', () => {
  // Un cuadro de texto con sugerencias del navegador filtra por lo escrito: con «MASTERDATA» puesto solo ofrecería
  // ese, y no había cómo llegar a «KEYFIGURES».
  it('el tipo de dato ofrece los dos tipos aunque ya tenga uno', async () => {
    await montar(ConFormulario, { inicial: BODY })
    const tipo = dom().querySelector('#ci-tipo')
    expect(tipo.tagName).toBe('SELECT')
    expect([...tipo.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', '— Elige un tipo —'],
      ['MASTERDATA', 'Dato maestro (MASTERDATA)'],
      ['KEYFIGURES', 'Cifras clave (KEYFIGURES)'],
    ])
    expect(tipo.value).toBe('KEYFIGURES')
  })

  it('el comando ofrece INSERT_UPDATE y REPLACE aunque ya tenga uno, y elegir cambia solo el comando', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    const comando = dom().querySelector('#ci-BatchCommand')
    expect(comando.tagName).toBe('SELECT')
    expect([...comando.options].map((o) => o.value)).toEqual(['', 'INSERT_UPDATE', 'REPLACE'])
    expect(comando.value).toBe('REPLACE')

    await elegir(comando, 'INSERT_UPDATE')
    const bloque = leerBody(cambios.at(-1)).bloque
    expect(bloque.BatchCommand).toBe('INSERT_UPDATE')
    expect(bloque.TypeOfData).toBe('KEYFIGURES')
  })

  it('un comando que no es de la lista se conserva, escribible, con el aviso', async () => {
    const cuerpo = JSON.stringify({ A: { TypeOfData: 'MASTERDATA', BatchCommand: 'DELETE' } })
    await montar(ConFormulario, { inicial: cuerpo })
    const comando = dom().querySelector('#ci-BatchCommand')
    expect(comando.tagName).toBe('INPUT')
    expect(comando.value).toBe('DELETE')
    expect(texto()).toContain('No es uno de los comandos conocidos.')
  })

  it('«A mano» deja escribir otro comando', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: BODY, alCambiar: (t) => cambios.push(t) })
    await pulsar(dom().querySelector('#ci-BatchCommand').parentElement.querySelector('button'))
    await escribir(dom().querySelector('#ci-BatchCommand'), 'OTRO')
    expect(leerBody(cambios.at(-1)).bloque.BatchCommand).toBe('OTRO')
  })
})

describe('cambiar el tipo de dato cambia el formulario', () => {
  const MAESTRO = (cambios = {}) => JSON.stringify({
    PRODUCT: {
      BatchCommand: 'INSERT_UPDATE', BatchName: 'PRODUCTOS', TypeOfData: 'MASTERDATA', MasterDataPrefix: '', MasterDataType: '',
      PlanningArea: 'AREA_DEMO', FieldMapping: 'A:A', CampoRaro: 'x', ...cambios,
    },
  }, null, 2)
  const CIFRAS = (cambios = {}) => JSON.stringify({
    KEYFIGURE: {
      BatchCommand: 'REPLACE', BatchName: 'FACTURAS', TypeOfData: 'KEYFIGURES', TargetTimeProfileLevelinSAPIBP: '',
      PlanningArea: 'AREA_DEMO', FileName: '', FieldMapping: 'A:A', ...cambios,
    },
  }, null, 2)

  it('de dato maestro a cifras clave: se quitan los campos del maestro y aparecen vacíos los de cifras', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO(), alCambiar: (t) => cambios.push(t) })
    expect(dom().querySelector('#ci-MasterDataType')).not.toBeNull()
    expect(dom().querySelector('#ci-TargetTimeProfileLevelinSAPIBP')).toBeNull()

    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')

    const bloque = leerBody(cambios.at(-1)).bloque
    expect(bloque).not.toHaveProperty('MasterDataPrefix')
    expect(bloque).not.toHaveProperty('MasterDataType')
    expect(bloque).toMatchObject({ TypeOfData: 'KEYFIGURES', TargetTimeProfileLevelinSAPIBP: '', FileName: '' })
    expect(dom().querySelector('#ci-MasterDataType')).toBeNull()
    expect(dom().querySelector('#ci-TargetTimeProfileLevelinSAPIBP')).not.toBeNull()
    expect(dom().querySelector('#ci-FileName')).not.toBeNull()
    // Sin valores que perder no se pregunta nada.
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('los campos nuevos aparecen justo después de TypeOfData, y lo demás se queda en su sitio', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO(), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')

    const bloque = leerBody(cambios.at(-1)).bloque
    expect(Object.keys(bloque)).toEqual([
      'BatchCommand', 'BatchName', 'TypeOfData', 'TargetTimeProfileLevelinSAPIBP', 'FileName', 'PlanningArea', 'FieldMapping', 'CampoRaro',
    ])
    expect(bloque.BatchName).toBe('PRODUCTOS')
    expect(bloque.FieldMapping).toBe('A:A')
  })

  it('de cifras clave a dato maestro, al revés', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: CIFRAS(), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'MASTERDATA')

    const bloque = leerBody(cambios.at(-1)).bloque
    expect(bloque).not.toHaveProperty('TargetTimeProfileLevelinSAPIBP')
    expect(bloque).not.toHaveProperty('FileName')
    expect(bloque).toMatchObject({ TypeOfData: 'MASTERDATA', MasterDataPrefix: '', MasterDataType: '' })
  })

  it('no cambia el comando por su cuenta', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO(), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')
    expect(leerBody(cambios.at(-1)).bloque.BatchCommand).toBe('INSERT_UPDATE')
  })

  it('si lo que se quita tiene valor, pregunta con los nombres; si se acepta, se quita', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO({ MasterDataPrefix: 'SB', MasterDataType: 'PRODUCT' }), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm.mock.calls[0][0]).toContain('Cifras clave')
    expect(window.confirm.mock.calls[0][0]).toContain('MasterDataPrefix, MasterDataType')
    expect(leerBody(cambios.at(-1)).bloque).not.toHaveProperty('MasterDataType')
  })

  it('si se rechaza, no cambia nada', async () => {
    window.confirm.mockReturnValue(false)
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO({ MasterDataType: 'PRODUCT' }), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')

    expect(cambios).toEqual([])
    expect(dom().querySelector('#ci-MasterDataType').value).toBe('PRODUCT')
  })

  it('solo pregunta por los campos que tienen valor, no por los vacíos', async () => {
    await montar(ConFormulario, { inicial: MAESTRO({ MasterDataPrefix: '', MasterDataType: 'PRODUCT' }) })
    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')
    const pregunta = window.confirm.mock.calls[0][0]
    expect(pregunta).toContain('MasterDataType')
    expect(pregunta).not.toContain('MasterDataPrefix')
  })

  it('elegir el mismo tipo, o «sin elegir», no hace nada', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO(), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'MASTERDATA')
    await elegir(dom().querySelector('#ci-tipo'), '')
    expect(cambios).toEqual([])
  })

  it('un campo que no es de ningún tipo (uno extra) no se toca al cambiar de tipo', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: MAESTRO({ CampoRaro: 'se queda' }), alCambiar: (t) => cambios.push(t) })
    await elegir(dom().querySelector('#ci-tipo'), 'KEYFIGURES')
    expect(leerBody(cambios.at(-1)).bloque.CampoRaro).toBe('se queda')
  })
})

describe('«Otros campos»', () => {
  const SIN_EXTRAS = JSON.stringify({ A: { TypeOfData: 'MASTERDATA', BatchCommand: 'INSERT_UPDATE' } })

  it('sin campos extra no hay sección: solo el enlace para agregar uno', async () => {
    await montar(ConFormulario, { inicial: SIN_EXTRAS })
    expect(texto()).not.toContain('Otros campos')
    expect(boton('+ Agregar un campo que no está en el formulario')).toBeDefined()
    expect(porEtiqueta('Nombre del campo nuevo')).toBeNull()
  })

  it('el enlace abre el formulario del campo extra, y al agregarlo aparece la sección con él', async () => {
    const cambios = []
    await montar(ConFormulario, { inicial: SIN_EXTRAS, alCambiar: (t) => cambios.push(t) })
    await pulsar(boton('+ Agregar un campo que no está en el formulario'))

    await escribir(porEtiqueta('Nombre del campo nuevo'), 'NuevoCampo')
    await pulsar(boton('+ Agregar campo'))

    expect(leerBody(cambios.at(-1)).bloque.NuevoCampo).toBe('')
    expect(texto()).toContain('Otros campos')
    expect(porEtiqueta('NuevoCampo')).not.toBeNull()
  })

  // Pegar un JSON con un campo que el formulario no tiene: aparece solo, sin hacer nada.
  it('un campo que viene en el body y el formulario no conoce aparece solo, con la explicación', async () => {
    const cuerpo = JSON.stringify({ A: { TypeOfData: 'MASTERDATA', CampoDelIflow: 'valor' } })
    await montar(ConFormulario, { inicial: cuerpo })

    expect(texto()).toContain('Otros campos')
    expect(texto()).toContain('Campos del body que este formulario no conoce. Se conservan y se envían tal cual.')
    expect(porEtiqueta('CampoDelIflow').value).toBe('valor')
    expect(texto()).not.toContain('+ Agregar un campo que no está en el formulario')
  })
})
