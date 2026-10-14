// @vitest-environment jsdom
//
// El formulario de una integración, en la pantalla de verdad: el filtro como filas, la tabla de campos y los
// campos del body. Lo que se mira es lo que ninguna prueba de `core/ci` puede ver y que rompe en silencio:
//
//   - que una fila recién agregada (todavía vacía) NO desaparezca antes de poder escribir en ella;
//   - que editar un campo no reordene ni pierda los demás;
//   - que lo que el body trae y el formulario no conoce se conserve.

import { createElement, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { leerBody } from '../../../core/ci/body.js'
import ConstructorDeFiltro from './ConstructorDeFiltro.jsx'
import FormularioDeBloque from './FormularioDeBloque.jsx'
import TablaDeMapeo from './TablaDeMapeo.jsx'
import {
  boton, desmontar, dom, escribir, montar, porEtiqueta, pulsar, teclear, todosPorEtiqueta,
} from './ayudas-de-prueba.js'

afterEach(desmontar)

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
    await escribir(dom().querySelector('#ci-tipo'), 'MASTERDATA')

    expect(dom().querySelector('#ci-MasterDataType')).not.toBeNull()
    expect(dom().querySelector('#ci-FileName')).toBeNull()
    expect(leerBody(cambios.at(-1)).bloque.TypeOfData).toBe('MASTERDATA')
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
