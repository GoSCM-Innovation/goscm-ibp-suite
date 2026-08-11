import { describe, it, expect } from 'vitest'

import {
  MARCA_DE_CODIFICACION, SEPARADOR, TOPES,
  celdaCsv, filasACsv, nombreDeArchivo, revisarVolumen,
} from './export-csv.js'

describe('celdaCsv', () => {
  it('deja el texto tal cual cuando no hay nada que escapar', () => {
    expect(celdaCsv('ACME')).toBe('ACME')
  })

  // Si el CSV no coincide con lo que se ve en la pantalla, no sirve para comprobar nada.
  it('escribe la fecha como se lee, no como la manda SAP', () => {
    expect(celdaCsv('/Date(1753734272000+0000)/')).not.toContain('/Date(')
    expect(celdaCsv('/Date(1753734272000+0000)/')).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })

  // Sin esto una descripción con punto y coma parte la fila en dos columnas.
  it('entrecomilla si lleva el separador', () => {
    expect(celdaCsv('uno;dos')).toBe('"uno;dos"')
  })

  it('duplica las comillas de dentro', () => {
    expect(celdaCsv('el "grande"')).toBe('"el ""grande"""')
  })

  it('entrecomilla si lleva un salto de línea', () => {
    expect(celdaCsv('dos\nlineas')).toBe('"dos\nlineas"')
  })

  it('lo vacío queda vacío, no "null"', () => {
    expect(celdaCsv(null)).toBe('')
    expect(celdaCsv(undefined)).toBe('')
  })

  // Un número no se toca: cambiar el punto decimal aquí lo dejaría distinto de la pantalla.
  it('un número pasa como está', () => {
    expect(celdaCsv(1250.5)).toBe('1250.5')
  })
})

describe('filasACsv', () => {
  const columnas = ['PRDID', 'BRAND']
  const filas = [{ PRDID: 'P1', BRAND: 'ACME', OTRO: 'no va' }, { PRDID: 'P2' }]

  it('la primera línea son los encabezados', () => {
    expect(filasACsv(columnas, filas).split('\r\n')[0]).toBe('PRDID;BRAND')
  })

  // Las columnas manda la pantalla: lo que no se está mirando no se vuelca.
  it('vuelca SOLO las columnas pedidas y en ese orden', () => {
    const csv = filasACsv(['BRAND', 'PRDID'], filas)
    expect(csv.split('\r\n')[1]).toBe('ACME;P1')
    expect(csv).not.toContain('no va')
  })

  it('un campo que la fila no trae queda vacío', () => {
    expect(filasACsv(columnas, filas).split('\r\n')[2]).toBe('P2;')
  })

  it('separa las líneas con CRLF, que es lo que espera Excel en Windows', () => {
    expect(filasACsv(columnas, filas)).toContain('\r\n')
  })

  // Cada visor escribe distinto: si el archivo no dice lo mismo que la pantalla, no vale para
  // comprobar nada.
  it('usa el formateador de quien llama, y le pasa la columna', () => {
    const comoSeLee = (valor, columna) => (columna === 'BRAND' ? `<${valor}>` : String(valor ?? ''))
    expect(filasACsv(columnas, filas, comoSeLee).split('\r\n')[1]).toBe('P1;<ACME>')
  })

  it('los encabezados NO pasan por el formateador: son nombres, no valores', () => {
    expect(filasACsv(columnas, filas, () => 'X').split('\r\n')[0]).toBe('PRDID;BRAND')
  })

  it('sin filas queda solo el encabezado', () => {
    expect(filasACsv(columnas, [])).toBe('PRDID;BRAND')
    expect(filasACsv(columnas, undefined)).toBe('PRDID;BRAND')
  })

  it('el separador es el que espera Excel en español', () => {
    expect(SEPARADOR).toBe(';')
    expect(MARCA_DE_CODIFICACION).toBe('﻿')
  })
})

describe('revisarVolumen', () => {
  it('por debajo del aviso se hace sin preguntar', () => {
    expect(revisarVolumen(5000, TOPES.maestro)).toEqual({ estado: 'ok', mensaje: '' })
  })

  it('pasado el aviso lo pregunta, y lo dice con el número', () => {
    const salida = revisarVolumen(150_000, TOPES.maestro)
    expect(salida.estado).toBe('aviso')
    expect(salida.mensaje).toContain('150.000')
  })

  // Medio millón de filas no es una espera larga: es una función que se corta y un archivo
  // incompleto que parece completo.
  it('pasado el máximo no se hace, y dice cuál es el tope', () => {
    const salida = revisarVolumen(500_000, TOPES.maestro)
    expect(salida.estado).toBe('bloqueado')
    expect(salida.mensaje).toContain('200.000')
  })

  it('justo en el tope todavía se hace', () => {
    expect(revisarVolumen(200_000, TOPES.maestro).estado).toBe('aviso')
    expect(revisarVolumen(120_000, TOPES.maestro).estado).toBe('ok')
  })

  // Una cifra clave son muchas más filas que un dato maestro: el mismo tope sobraría en una y
  // estorbaría en la otra.
  it('las cifras clave tienen su propio tope, más alto', () => {
    expect(revisarVolumen(150_000, TOPES.cifras).estado).toBe('ok')
    expect(revisarVolumen(150_000, TOPES.maestro).estado).toBe('aviso')
  })

  it('sin total no bloquea nada', () => {
    expect(revisarVolumen(undefined, TOPES.maestro).estado).toBe('ok')
  })
})

describe('nombreDeArchivo', () => {
  it('junta las partes y acaba en .csv', () => {
    expect(nombreDeArchivo(['GIDPRODUCT', 'ZPRUEBA', 1235])).toBe('GIDPRODUCT_ZPRUEBA_1235.csv')
  })

  // La versión base no tiene identificador: dejaría un guion suelto.
  it('descarta las partes vacías', () => {
    expect(nombreDeArchivo(['GIDPRODUCT', '', 15])).toBe('GIDPRODUCT_15.csv')
  })

  it('cambia lo que no vale en un nombre de archivo', () => {
    expect(nombreDeArchivo(['area/con:barra'])).toBe('area_con_barra.csv')
  })

  it('sin nada usable no devuelve un nombre vacío', () => {
    expect(nombreDeArchivo([])).toBe('volcado.csv')
    expect(nombreDeArchivo(['//'])).toBe('volcado.csv')
  })
})
