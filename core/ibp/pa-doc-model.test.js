import { describe, it, expect } from 'vitest'

import {
  IDS_DE_SECCION,
  MODULOS,
  SECCIONES,
  aObjetos,
  areaDeArchivo,
  campo,
  ingerirCsv,
  leerCsv,
  limpiarEncabezado,
  loRecibido,
  resumirArea,
  seccionDeArchivo,
  seccionesQueFaltan,
} from './pa-doc-model.js'

describe('las secciones', () => {
  it('todas tienen identificador y título', () => {
    for (const una of SECCIONES) {
      expect(una.id).toBeTruthy()
      expect(una.titulo).toBeTruthy()
    }
  })

  it('las esenciales son las que hacen que el documento diga algo', () => {
    const esenciales = SECCIONES.filter((una) => una.esencial).map((una) => una.id)
    expect(esenciales).toContain('KEYFIGURES')
    expect(esenciales).toContain('MASTERDATATYPES')
    expect(esenciales).toContain('PLEVELS_ATTRS')
  })
})

describe('seccionDeArchivo', () => {
  it('reconoce el nombre que exporta SAP', () => {
    expect(seccionDeArchivo('ASIBPTS_KEYFIGURES.csv')).toBe('KEYFIGURES')
    expect(seccionDeArchivo('ASIBPTS_PLEVELS_ATTRS.csv')).toBe('PLEVELS_ATTRS')
  })

  // Con el orden al revés, PA_ATTRIBUTES se comería a ATTRIBUTES_AS_KEYFIGURE.
  it('el nombre más largo gana cuando dos se solapan', () => {
    expect(seccionDeArchivo('AS1_ATTRIBUTES_AS_KEYFIGURE.csv')).toBe('ATTRIBUTES_AS_KEYFIGURE')
    expect(seccionDeArchivo('AS1_PA_ATTRIBUTES.csv')).toBe('PA_ATTRIBUTES')
  })

  it('no distingue mayúsculas', () => {
    expect(seccionDeArchivo('asibpts_keyfigures.csv')).toBe('KEYFIGURES')
  })

  it('lo que no es una sección devuelve null', () => {
    expect(seccionDeArchivo('cualquier_cosa.csv')).toBe(null)
    expect(seccionDeArchivo('')).toBe(null)
    expect(seccionDeArchivo(undefined)).toBe(null)
  })

  it('todas las secciones se reconocen a sí mismas', () => {
    for (const id of IDS_DE_SECCION) {
      expect(seccionDeArchivo(`AREA_${id}.csv`), id).toBe(id)
    }
  })
})

describe('areaDeArchivo', () => {
  it('el área es lo que va antes del primer guion bajo', () => {
    expect(areaDeArchivo('ASIBPTS_KEYFIGURES.csv')).toBe('ASIBPTS')
  })

  it('sin guion bajo no adivina', () => {
    expect(areaDeArchivo('KEYFIGURES.csv')).toBe('')
  })
})

describe('leerCsv', () => {
  it('separa por punto y coma, que es como los exporta SAP', () => {
    expect(leerCsv('a;b;c')).toEqual([['a', 'b', 'c']])
  })

  it('parte las filas por salto de línea y aguanta el retorno de carro', () => {
    expect(leerCsv('a;b\r\nc;d')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('un campo entrecomillado con punto y coma dentro no se parte', () => {
    expect(leerCsv('"uno;dos";tres')).toEqual([['uno;dos', 'tres']])
  })

  it('una comilla dentro va doblada', () => {
    expect(leerCsv('"el ""grande""";x')).toEqual([['el "grande"', 'x']])
  })

  // Las definiciones de cálculo de una cifra clave llevan saltos de línea dentro.
  it('un salto de línea dentro de comillas es parte del campo', () => {
    expect(leerCsv('"linea1\nlinea2";x')).toEqual([['linea1\nlinea2', 'x']])
  })

  it('sin texto no devuelve nada', () => {
    expect(leerCsv('')).toEqual([])
    expect(leerCsv(undefined)).toEqual([])
  })
})

describe('limpiarEncabezado y aObjetos', () => {
  it('quita la marca de bytes que deja Excel', () => {
    expect(limpiarEncabezado('﻿Key Figure')).toBe('Key Figure')
  })

  it('convierte filas en objetos por su encabezado', () => {
    expect(aObjetos(['a', 'b'], [['1', '2']])).toEqual([{ a: '1', b: '2' }])
  })

  it('una fila corta deja los campos que faltan vacíos', () => {
    expect(aObjetos(['a', 'b'], [['1']])).toEqual([{ a: '1', b: '' }])
  })
})

describe('ingerirCsv', () => {
  const texto = 'Key Figure;Key Figure Description;Stored Key Figure\nKF1;Una cifra;X\nKF2;Otra;\n\n'

  it('reconoce la sección y arma las filas', () => {
    const leido = ingerirCsv('ASIBPTS_KEYFIGURES.csv', texto)
    expect(leido.seccion).toBe('KEYFIGURES')
    expect(leido.encabezado).toEqual(['Key Figure', 'Key Figure Description', 'Stored Key Figure'])
    expect(leido.objetos).toHaveLength(2)
  })

  // Los exports de SAP acaban con una línea en blanco: contarla diría 43 donde hay 42.
  it('descarta las filas vacías del final', () => {
    expect(ingerirCsv('AS1_KEYFIGURES.csv', texto).filas).toHaveLength(2)
  })

  it('un archivo que no es de ninguna sección se rechaza', () => {
    expect(ingerirCsv('otra_cosa.csv', texto)).toBe(null)
  })

  it('un archivo reconocido pero vacío devuelve la sección sin filas', () => {
    expect(ingerirCsv('AS1_KEYFIGURES.csv', '')).toMatchObject({ seccion: 'KEYFIGURES', filas: [] })
  })
})

describe('campo', () => {
  const objeto = { 'Key Figure': 'KF1', 'Aggregation Mode ': 'SUM' }

  it('encuentra el campo exacto', () => {
    expect(campo(objeto, 'Key Figure')).toBe('KF1')
  })

  // Los encabezados de SAP llegan con espacios y variaciones: buscar exacto perdería la mitad.
  it('encuentra por parecido cuando el nombre no coincide exactamente', () => {
    expect(campo(objeto, 'Aggregation Mode')).toBe('SUM')
  })

  it('lo que no está devuelve cadena vacía, no undefined', () => {
    expect(campo(objeto, 'No existe')).toBe('')
    expect(campo(undefined, 'x')).toBe('')
  })
})

describe('resumirArea', () => {
  const datos = {
    GENERAL_INFO: {
      archivo: 'ASIBPTS_GENERAL_INFO.csv',
      objetos: [{ 'Planning Area': 'ASIBPTS' }],
      filas: [['ASIBPTS']],
    },
    KEYFIGURES: {
      archivo: 'ASIBPTS_KEYFIGURES.csv',
      filas: [1, 2, 3, 4],
      objetos: [
        { 'Key Figure': 'A', 'Stored Key Figure': 'X', Hashtags: '#DP #IO' },
        { 'Key Figure': 'B', 'Calculated Key Figure': 'X', Hashtags: '#DP' },
        { 'Key Figure': 'C', 'Calculated Key Figure': 'X', 'Helper Key Figure': 'X', Hashtags: '' },
        { 'Key Figure': 'D', 'Stored Key Figure': 'X', 'Alert Key Figure': 'X', Hashtags: '#XX' },
      ],
    },
    MASTERDATATYPES: {
      archivo: 'ASIBPTS_MASTERDATATYPES.csv',
      filas: [1, 2, 3],
      objetos: [
        { 'Master Data Type ID': 'PRODUCT', 'Attribute ID': 'PRDID' },
        { 'Master Data Type ID': 'PRODUCT', 'Attribute ID': 'PRDDESCR' },
        { 'Master Data Type ID': 'LOCATION', 'Attribute ID': 'LOCID' },
      ],
    },
    PLEVELS_ATTRS: {
      archivo: 'ASIBPTS_PLEVELS_ATTRS.csv',
      filas: [1, 2, 3],
      objetos: [
        { 'Planning Level': 'PL1' }, { 'Planning Level': 'PL1' }, { 'Planning Level': 'PL2' },
      ],
    },
    VERSIONS: { archivo: 'v.csv', filas: [1, 2], objetos: [{}, {}] },
    OPERATORS: { archivo: 'o.csv', filas: [1], objetos: [{}] },
    SNAPSHOTS: { archivo: 's.csv', filas: [], objetos: [] },
  }
  const resumen = resumirArea(datos)

  it('el área sale de la información general', () => {
    expect(resumen.area).toBe('ASIBPTS')
  })

  it('clasifica las cifras clave', () => {
    expect(resumen).toMatchObject({ cifras: 4, guardadas: 2, calculadas: 2, auxiliares: 1, deAlerta: 1 })
  })

  // Un tipo de dato maestro con tres atributos son un tipo y tres atributos, no cuatro cosas.
  it('cuenta los tipos de dato maestro sin repetir, y sus atributos aparte', () => {
    expect(resumen.tiposDeDatoMaestro).toBe(2)
    expect(resumen.atributosDeMaestro).toBe(3)
  })

  it('cuenta los niveles de planificación distintos', () => {
    expect(resumen.nivelesDePlanificacion).toBe(2)
  })

  // Los módulos no tienen ningún campo que los diga: salen de las etiquetas de las cifras.
  it('deduce los módulos de las etiquetas, y descarta las que no conoce', () => {
    expect(resumen.modulos).toEqual([MODULOS.DP, MODULOS.IO].sort())
  })

  it('cuenta versiones, operadores y snapshots', () => {
    expect(resumen).toMatchObject({ versiones: 2, operadores: 1, snapshots: 0 })
  })

  it('sin datos no revienta', () => {
    expect(resumirArea()).toMatchObject({ cifras: 0, modulos: [] })
  })

  it('sin información general, el área sale del nombre de un archivo', () => {
    const sinGeneral = { ...datos, GENERAL_INFO: undefined }
    expect(resumirArea(sinGeneral).area).toBe('ASIBPTS')
  })
})

describe('seccionesQueFaltan y loRecibido', () => {
  it('dice qué esenciales faltan', () => {
    const faltan = seccionesQueFaltan({ KEYFIGURES: { filas: [1] } })
    expect(faltan).toContain('MASTERDATATYPES')
    expect(faltan).not.toContain('KEYFIGURES')
  })

  it('una sección presente pero vacía cuenta como que falta', () => {
    expect(seccionesQueFaltan({ KEYFIGURES: { filas: [] } })).toContain('KEYFIGURES')
  })

  it('lo recibido lista todas las secciones, con cuántas filas trajo cada una', () => {
    const recibido = loRecibido({ KEYFIGURES: { filas: [1, 2], archivo: 'k.csv' } })
    expect(recibido).toHaveLength(SECCIONES.length)
    expect(recibido.find((una) => una.id === 'KEYFIGURES')).toMatchObject({ filas: 2, archivo: 'k.csv' })
    expect(recibido.find((una) => una.id === 'VERSIONS')).toMatchObject({ filas: 0 })
  })
})
