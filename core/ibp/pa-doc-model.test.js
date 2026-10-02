// El modelo del documentador. Los encabezados de los CSV de estas pruebas son los que LEE v7
// (`paDoc.js`): `ID`, `Name`, `Base Planning Level`, `Attribute ID`, `Operator Profile / Operator Type`…
// Nada de nombres inventados: si una prueba usara un encabezado que v7 no lee, comprobaría otra cosa.

import { describe, it, expect } from 'vitest'

import {
  IDS_DE_SECCION,
  MODULOS,
  agregarCsv,
  aObjetos,
  areaDeArchivo,
  categoriasDeOperador,
  clasificarCifras,
  estadoDeSecciones,
  estadoInicial,
  get,
  getLike,
  idsDeTiposDeDatoMaestro,
  ingerirCsv,
  leerCsv,
  limpiarEncabezado,
  modulosDetectados,
  nivelesDistintos,
  seccionDeArchivo,
  str,
  tiposDeDatoMaestro,
} from './pa-doc-model.js'

describe('las secciones', () => {
  it('son las 13 de v7', () => {
    expect(IDS_DE_SECCION).toHaveLength(13)
    expect(IDS_DE_SECCION).toContain('ATTRIBUTES_AS_KEYFIGURE')
    expect(IDS_DE_SECCION).toContain('GENERAL_INFO')
  })
})

describe('seccionDeArchivo', () => {
  it('reconoce el nombre que exporta SAP', () => {
    expect(seccionDeArchivo('ASIBPTS_KEYFIGURES.csv')).toBe('KEYFIGURES')
    expect(seccionDeArchivo('ASIBPTS_PLEVELS_ATTRS.csv')).toBe('PLEVELS_ATTRS')
  })

  // `PA_ATTRIBUTES` y `ATTRIBUTES_AS_KEYFIGURE` comparten un trozo: no se pueden comer entre sí.
  it('dos nombres que se solapan se reconocen cada uno', () => {
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

  it('el nombre tiene que ir entre separadores: un trozo suelto no cuenta', () => {
    expect(seccionDeArchivo('MIKEYFIGURES.csv')).toBe(null)
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
    expect(limpiarEncabezado('﻿ID')).toBe('ID')
  })

  it('convierte filas en objetos por su encabezado', () => {
    expect(aObjetos(['a', 'b'], [['1', '2']])).toEqual([{ a: '1', b: '2' }])
  })

  it('una fila corta deja los campos que faltan vacíos', () => {
    expect(aObjetos(['a', 'b'], [['1']])).toEqual([{ a: '1', b: '' }])
  })
})

describe('str, get y getLike', () => {
  it('str recorta y convierte lo que no hay en cadena vacía', () => {
    expect(str('  x ')).toBe('x')
    expect(str(null)).toBe('')
    expect(str(undefined)).toBe('')
    expect(str(0)).toBe('0')
  })

  it('get busca el nombre EXACTO', () => {
    expect(get({ Type: ' Simple ' }, 'Type')).toBe('Simple')
    expect(get({ type: 'x' }, 'Type')).toBe('')
  })

  it('getLike prefiere la igualdad sin distinguir mayúsculas', () => {
    expect(getLike({ 'Key Figure ID': 'largo', id: 'corto' }, 'ID')).toBe('corto')
  })

  // La rareza de v7 que hace falta conservar: sin igualdad, gana la PRIMERA columna que contiene el texto.
  it('si no hay igualdad, gana la primera columna que lo contiene', () => {
    expect(getLike({ 'Planning Area ID': 'PA', 'Key Figure ID': 'KF' }, 'ID')).toBe('PA')
  })

  it('lo que no está es cadena vacía', () => {
    expect(getLike({ a: '1' }, 'zzz')).toBe('')
    expect(getLike(undefined, 'a')).toBe('')
  })
})

describe('ingerirCsv', () => {
  const texto = 'ID;Name;Base Planning Level\nKF1;Una cifra;PL1\nKF2;Otra;PL2\n\n'

  it('reconoce la sección y arma las filas', () => {
    const leido = ingerirCsv('ASIBPTS_KEYFIGURES.csv', texto)
    expect(leido.seccion).toBe('KEYFIGURES')
    expect(leido.encabezado).toEqual(['ID', 'Name', 'Base Planning Level'])
    expect(leido.objetos).toHaveLength(2)
  })

  // Los exports de SAP acaban con una línea en blanco: contarla diría 43 donde hay 42.
  it('descarta las filas vacías del final', () => {
    expect(ingerirCsv('AS1_KEYFIGURES.csv', texto).filas).toHaveLength(2)
  })

  it('una fila de solo espacios y separadores también es vacía', () => {
    expect(ingerirCsv('AS1_KEYFIGURES.csv', 'ID;Name\nA;B\n ; \n').filas).toHaveLength(1)
  })

  it('un archivo que no es de ninguna sección se rechaza', () => {
    expect(ingerirCsv('otra_cosa.csv', texto)).toBe(null)
  })

  it('un archivo reconocido pero vacío se reconoce y no aporta nada', () => {
    expect(ingerirCsv('AS1_KEYFIGURES.csv', '')).toMatchObject({ seccion: 'KEYFIGURES', vacio: true })
  })
})

describe('agregarCsv: el estado y el área', () => {
  it('suma la sección al estado sin tocar el anterior', () => {
    const inicial = estadoInicial()
    const { estado, seccion } = agregarCsv(inicial, 'AS1_VERSIONS.csv', 'ID;Name\nV1;Uno')
    expect(seccion).toBe('VERSIONS')
    expect(estado.datos.VERSIONS.filas).toHaveLength(1)
    expect(inicial.datos).toEqual({})
  })

  it('un archivo desconocido deja el estado como estaba', () => {
    const inicial = estadoInicial()
    const salida = agregarCsv(inicial, 'foto.csv', 'a;b\n1;2')
    expect(salida.seccion).toBe(null)
    expect(salida.estado).toBe(inicial)
  })

  it('un archivo vacío se reconoce pero no se registra', () => {
    const salida = agregarCsv(estadoInicial(), 'AS1_VERSIONS.csv', '')
    expect(salida.seccion).toBe('VERSIONS')
    expect(salida.estado.datos.VERSIONS).toBeUndefined()
  })

  it('un archivo solo con encabezado se registra con cero filas', () => {
    const { estado } = agregarCsv(estadoInicial(), 'AS1_VERSIONS.csv', 'ID;Name\n')
    expect(estado.datos.VERSIONS.filas).toHaveLength(0)
  })

  it('el área sale del prefijo del nombre del archivo', () => {
    expect(agregarCsv(estadoInicial(), 'ASIBPTS_VERSIONS.csv', 'ID\nV1').estado.paId).toBe('ASIBPTS')
  })

  it('el área de GENERAL_INFO es la primera columna de su primera fila', () => {
    const { estado } = agregarCsv(estadoInicial(), 'X_GENERAL_INFO.csv', 'Planning Area;Description\nMIAREA;Hola')
    expect(estado.paId).toBe('MIAREA')
  })

  // El orden de v7: el primer archivo que permite fijar el área la fija, y no se vuelve a tocar.
  it('el área se fija una vez, con el primer archivo que lo permite', () => {
    let { estado } = agregarCsv(estadoInicial(), 'UNO_VERSIONS.csv', 'ID\nV1')
    ;({ estado } = agregarCsv(estado, 'DOS_GENERAL_INFO.csv', 'Planning Area\nOTRA'))
    expect(estado.paId).toBe('UNO')
  })

  it('un GENERAL_INFO sin filas deja que el área salga del nombre', () => {
    expect(agregarCsv(estadoInicial(), 'AREA1_GENERAL_INFO.csv', 'Planning Area\n').estado.paId).toBe('AREA1')
  })

  it('volver a soltar la misma sección la reemplaza', () => {
    let { estado } = agregarCsv(estadoInicial(), 'A_VERSIONS.csv', 'ID\nV1\nV2')
    ;({ estado } = agregarCsv(estado, 'A_VERSIONS.csv', 'ID\nV1'))
    expect(estado.datos.VERSIONS.filas).toHaveLength(1)
  })
})

describe('los análisis', () => {
  const datos = {
    KEYFIGURES: {
      filas: [1, 2, 3, 4],
      objetos: [
        { ID: 'A', 'Stored Key Figure': 'X', Hashtags: '#DP #IO' },
        { ID: 'B', 'Calculated Key Figure': 'X', Hashtags: '#DP' },
        { ID: 'C', 'Calculated Key Figure': 'X', 'Helper Key Figure': 'X', Hashtags: '' },
        { ID: 'D', 'Stored Key Figure': 'X', 'Alert Key Figure': 'X', Hashtags: '#XX' },
      ],
    },
    MASTERDATATYPES: {
      objetos: [
        { 'Master Data Type ID': 'PRODUCT' },
        { 'Master Data Type ID': 'PRODUCT' },
        { 'Master Data Type ID': 'LOCATION' },
      ],
    },
    PLEVELS_ATTRS: {
      objetos: [{ 'Planning Level': 'PL1' }, { 'Planning Level': 'PL1' }, { 'Planning Level': 'PL2' }],
    },
    OPERATORS: {
      objetos: [
        { 'Operator Profile / Operator Type': 'COPY' },
        { 'Operator Profile / Operator Type': 'COPY' },
        { 'Operator Profile / Operator Type': 'FORECAST' },
      ],
    },
  }

  it('clasifica las cifras: guardadas, calculadas, auxiliares y de alerta', () => {
    expect(clasificarCifras(datos)).toEqual({ stored: 2, calc: 2, helper: 1, alert: 1 })
  })

  // Un tipo con tres atributos son un tipo y tres atributos, no cuatro cosas.
  it('cuenta los tipos de dato maestro sin repetir, y sus atributos aparte', () => {
    expect(tiposDeDatoMaestro(datos)).toEqual({ count: 2, attrs: 3 })
  })

  it('cuenta los niveles de planificación distintos', () => {
    expect(nivelesDistintos(datos)).toBe(2)
  })

  it('una sección que no vino da null, no cero', () => {
    expect(nivelesDistintos({})).toBeNull()
    expect(tiposDeDatoMaestro({})).toBeNull()
  })

  it('las categorías de operador no se repiten', () => {
    expect(categoriasDeOperador(datos)).toEqual(['COPY', 'FORECAST'])
  })

  // Los módulos no tienen ningún campo que los diga: salen de las etiquetas de las cifras.
  it('deduce los módulos de las etiquetas y descarta las que no conoce', () => {
    expect(modulosDetectados(datos)).toEqual([MODULOS.DP, MODULOS.IO])
  })

  it('los identificadores de tipo van sin repetir', () => {
    expect(idsDeTiposDeDatoMaestro(datos)).toEqual(['PRODUCT', 'LOCATION'])
  })

  it('sin datos no revienta', () => {
    expect(clasificarCifras()).toEqual({ stored: 0, calc: 0, helper: 0, alert: 0 })
    expect(modulosDetectados()).toEqual([])
    expect(idsDeTiposDeDatoMaestro()).toEqual([])
  })
})

describe('estadoDeSecciones', () => {
  it('lista las 13 en orden alfabético', () => {
    const lista = estadoDeSecciones({})
    expect(lista).toHaveLength(13)
    expect(lista.map((una) => una.id)).toEqual([...IDS_DE_SECCION].sort())
  })

  it('dice «N filas» o «no provisto»', () => {
    const lista = estadoDeSecciones({ KEYFIGURES: { filas: [1, 2, 3] } })
    expect(lista.find((una) => una.id === 'KEYFIGURES')).toMatchObject({ presente: true, texto: '3 filas' })
    expect(lista.find((una) => una.id === 'VERSIONS')).toMatchObject({ presente: false, texto: 'no provisto' })
  })

  it('una sección con cero filas está presente', () => {
    const lista = estadoDeSecciones({ VERSIONS: { filas: [] } })
    expect(lista.find((una) => una.id === 'VERSIONS')).toMatchObject({ presente: true, texto: '0 filas' })
  })
})
