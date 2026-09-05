// El registro de la descarga, que es donde vive lo que antes decía la tabla «Qué se baja».
//
// La tabla se quitó porque no era de v7 —v7 tenía barra, línea de estado y logs técnicos, y nada
// más—. Estas pruebas son la garantía de que quitarla no se llevó por delante lo que sí avisaba: la
// tabla del tenant contra la que resolvió cada papel, las filas descartadas, los campos que faltan
// en este tenant y, sobre todo, que a una tabla le falten filas.

import { describe, expect, it } from 'vitest'

import { EXTRACCIONES, NOMBRES_DE_V7 } from '../../core/ibp/explorer-extract-plan.js'
import {
  descargando,
  estadoAlTerminar,
  lineaDePeticion,
  lineasDeTabla,
  resumenDelArbol,
} from './registro-de-descarga.js'

/** Un paso del plan ya resuelto contra un tenant. */
const paso = (extra = {}) => ({
  tabla: 'bom_psh',
  etiqueta: 'Cabecera de receta',
  entidad: 'GIDSOURCEPRODUCTION',
  omitidos: [],
  esencial: true,
  sePuede: true,
  ...extra,
})

const textos = (lineas) => lineas.map((una) => una.texto)
const clases = (lineas) => lineas.map((una) => una.clase)

describe('los nombres de v7', () => {
  // Una tabla nueva sin nombre no rompe nada —se cae a la etiqueta— pero deja el registro en español
  // en medio de líneas en inglés. Esta prueba es lo que evita que la lista se quede atrás.
  it('están los de todas las tablas del plan', () => {
    for (const una of EXTRACCIONES) {
      expect(NOMBRES_DE_V7[una.tabla], `falta el nombre de v7 para ${una.tabla}`).toBeTruthy()
    }
  })
})

describe('la línea de estado', () => {
  it('usa el nombre largo, como v7', () => {
    expect(descargando(paso())).toBe('Descargando Production Source Header...')
  })
})

describe('lineaDePeticion', () => {
  it('dice qué tabla del tenant se pidió', () => {
    expect(lineaDePeticion(paso(), { planningArea: 'SAP4' }).texto)
      .toBe('GET → GIDSOURCEPRODUCTION [filtro PA/Ver]')
  })

  it('sin área no marca el filtro', () => {
    expect(lineaDePeticion(paso(), {}).texto).toBe('GET → GIDSOURCEPRODUCTION')
  })
})

describe('lineasDeTabla', () => {
  // Los números van con el separador del español, que NO agrupa las cifras de cuatro: 2437 se
  // escribe sin punto y 98.956 con él. Es la regla de la locale y aquí se comprueban las dos.
  it('una tabla que salió bien, con el formato de v7', () => {
    const salida = lineasDeTabla(paso(), { guardadas: 2437, bajadas: 2437 })
    expect(textos(salida)).toEqual(['Header: 2437 registros → IDB'])
    expect(clases(salida)).toEqual(['ok'])
  })

  it('agrupa a partir de cinco cifras', () => {
    expect(lineasDeTabla(paso(), { guardadas: 37855, bajadas: 37855 })[0].texto)
      .toBe('Header: 37.855 registros → IDB')
  })

  it('dice cuántas descartó SAP por inválidas', () => {
    const salida = lineasDeTabla(paso(), { guardadas: 2437, bajadas: 2500 })
    expect(salida[0].texto).toBe('Header: 2437 registros → IDB (63 descartadas: SAP las marca inválidas)')
  })

  // El aviso que justifica todo este módulo: una tabla a la que le faltan filas se lee igual que una
  // completa, y todo lo que se analice después sale de menos datos sin poder notarlo.
  it('avisa en rojo cuando SAP dice que hay más filas de las que llegaron', () => {
    const salida = lineasDeTabla(paso(), {
      guardadas: 2437, bajadas: 2437, enSap: 30000, faltan: 27563,
    })
    expect(clases(salida)).toEqual(['ok', 'err'])
    expect(salida[1].texto).toBe('✕ Header: incompleta — SAP dice 30.000 filas y llegaron 2437')
  })

  it('avisa de los campos que este tenant no tiene', () => {
    const salida = lineasDeTabla(paso({ omitidos: ['PINVALID'] }), { guardadas: 10, bajadas: 10 })
    expect(salida[1].texto).toBe('Header: este tenant no tiene PINVALID. Se baja sin ese campo.')
    expect(salida[1].clase).toBe('warn')
  })

  it('un papel sin tabla en este tenant lo dice como v7', () => {
    const salida = lineasDeTabla(
      paso({ tabla: 'bom_psi_validity', sePuede: false, entidad: null }),
      null,
    )
    expect(textos(salida)).toEqual(['Item Validity: sin entidad configurada'])
    expect(clases(salida)).toEqual(['warn'])
  })

  it('una accesoria vacía dice que vino sin datos', () => {
    const salida = lineasDeTabla(
      paso({ tabla: 'bom_psisub', esencial: false }),
      { guardadas: 0, bajadas: 0 },
    )
    expect(salida[0].texto).toBe('Item Sub: 0 registros → IDB (sin datos)')
  })

  it('un error de tabla sale en rojo y no dice nada más', () => {
    const salida = lineasDeTabla(paso(), { error: 'HTTP 403' })
    expect(textos(salida)).toEqual(['Header: error — HTTP 403'])
    expect(clases(salida)).toEqual(['err'])
  })

  // Una tabla saltada por depender de otra incompleta tiene que decir POR QUÉ. Si solo dijera que no
  // trajo filas se leería como que no había ninguna.
  it('una saltada dice su motivo', () => {
    const salida = lineasDeTabla(paso(), { omitido: true, motivo: 'su cabecera vino a medias' })
    expect(textos(salida)).toEqual(['Header: saltada — su cabecera vino a medias'])
    expect(clases(salida)).toEqual(['warn'])
  })

  it('una cancelada lo dice', () => {
    expect(textos(lineasDeTabla(paso(), { cancelado: true }))).toEqual(['Header: cancelada'])
  })
})

describe('estadoAlTerminar', () => {
  it('todo bien: cuántas filas quedaron', () => {
    expect(estadoAlTerminar({ guardadas: 98956, conError: 0, incompletas: 0 }))
      .toEqual({ tipo: 'ok', texto: '98.956 filas guardadas.' })
  })

  // Faltar filas NO puede salir en verde: es lo que antes pasaba por «descarga terminada».
  it('faltando filas no se presenta como terminada', () => {
    const salida = estadoAlTerminar({ guardadas: 10, conError: 0, incompletas: 2 })
    expect(salida.tipo).toBe('err')
    expect(salida.texto).toContain('no conviene analizar')
  })

  it('con tablas caídas manda al registro', () => {
    const salida = estadoAlTerminar({ guardadas: 10, conError: 1, incompletas: 0 })
    expect(salida).toEqual({ tipo: 'err', texto: 'Una tabla falló. Mira los logs técnicos.' })
  })
})

describe('resumenDelArbol', () => {
  it('es el texto de v7, literal', () => {
    expect(resumenDelArbol(15914))
      .toBe('✓ 15.914 productos en caché local. Selecciona uno para ver su BOM.')
  })
})
