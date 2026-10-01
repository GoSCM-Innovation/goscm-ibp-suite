import { describe, it, expect } from 'vitest'

import {
  compararCampos,
  emparejarTabla,
  emparejarTablas,
  raicesDe,
  BASE_VERSION_ID,
  ESPERA_DE_PROCESO_MS,
  FILAS_POR_SEGMENTO,
  esFalloTransitorio,
  esRechazo,
  esperaAntesDeReintentar,
  estadoDeCorrida,
  estadoDeTabla,
  filasPorSegmento,
  iniciosDeSegmento,
  paralelismo,
  partirPorBytes,
} from './migration-plan.js'

describe('raicesDe', () => {
  it('devuelve el nombre entero y lo que queda al quitar prefijos', () => {
    expect(raicesDe('AS1PRODUCT')).toEqual(['AS1PRODUCT', 'S1PRODUCT', '1PRODUCT', 'PRODUCT', 'RODUCT'])
  })

  // Sin un mínimo, cualquier par de nombres compartiría una letra y todo emparejaría con todo.
  it('no baja de cuatro caracteres', () => {
    expect(raicesDe('GIDLAG')).toEqual(['GIDLAG', 'IDLAG', 'DLAG'])
  })

  it('un nombre corto es su única raíz', () => {
    expect(raicesDe('ABCD')).toEqual(['ABCD'])
    expect(raicesDe('AB')).toEqual([])
  })
})

describe('emparejarTabla', () => {
  const destino = ['AS1PRODUCT', 'AS1LOCATION', 'AS1CUSTOMER']

  // Cada tenant le pone su prefijo al mismo tipo: emparejar por nombre exacto no encontraría nada.
  it('empareja por la raíz compartida más larga', () => {
    expect(emparejarTabla('GIDPRODUCT', destino)).toBe('AS1PRODUCT')
    expect(emparejarTabla('GIDLOCATION', destino)).toBe('AS1LOCATION')
  })

  it('el nombre idéntico gana', () => {
    expect(emparejarTabla('AS1PRODUCT', ['ZPRODUCT', 'AS1PRODUCT'])).toBe('AS1PRODUCT')
  })

  it('sin nada parecido devuelve null', () => {
    expect(emparejarTabla('GIDSHELFLIFE', destino)).toBeNull()
  })

  it('sin candidatas no revienta', () => {
    expect(emparejarTabla('GIDPRODUCT', undefined)).toBeNull()
  })

  // `PRODUCTTO` comparte `PRODUCT` con `AS1PRODUCT`, pero su pareja de verdad comparte más.
  it('elige la raíz más larga cuando hay varias parecidas', () => {
    expect(emparejarTabla('GIDPRODUCTTO', ['AS1PRODUCT', 'AS1PRODUCTTO'])).toBe('AS1PRODUCTTO')
  })
})

describe('emparejarTablas', () => {
  it('empareja todas y deja en null las que no encuentran', () => {
    expect(emparejarTablas(['GIDPRODUCT', 'GIDRARO'], ['AS1PRODUCT'])).toEqual([
      { origen: 'GIDPRODUCT', destino: 'AS1PRODUCT' },
      { origen: 'GIDRARO', destino: null },
    ])
  })
})

describe('compararCampos', () => {
  it('separa lo común de lo que sobra a cada lado', () => {
    expect(compararCampos(['A', 'B', 'C'], ['B', 'C', 'D'])).toEqual({
      verificable: true,
      comunes: ['B', 'C'],
      soloEnOrigen: ['A'],
      soloEnDestino: ['D'],
    })
  })

  it('ignora los campos que se le digan', () => {
    expect(compararCampos(['A', 'PlanningAreaID'], ['A'], { ignorar: ['PlanningAreaID'] }))
      .toMatchObject({ comunes: ['A'], soloEnOrigen: [] })
  })

  // Una tabla vacía no tiene fila de muestra de la que deducir columnas.
  it('sin esquema de un lado, la comparación no es verificable', () => {
    expect(compararCampos(null, ['A'])).toMatchObject({ verificable: false, comunes: null })
    expect(compararCampos(['A'], null)).toMatchObject({ verificable: false, comunes: null })
  })
})

describe('la forma de la corrida, como en v8', () => {
  it('conserva los números de v8', () => {
    expect(FILAS_POR_SEGMENTO).toBe(20_000)
    expect(BASE_VERSION_ID).toBe('__BASELINE')
    expect(ESPERA_DE_PROCESO_MS).toBe(120_000)
    expect(esperaAntesDeReintentar(1)).toBe(1500)
    expect(esperaAntesDeReintentar(3)).toBe(4500)
  })

  // Con páginas normales el segmento es el de v8; con páginas pequeñas se achica para caber en una
  // llamada de la función.
  it('el segmento es el de v8 salvo que no quepa en una llamada', () => {
    expect(filasPorSegmento(5000)).toBe(20_000)
    expect(filasPorSegmento(1500)).toBe(20_000)
    expect(filasPorSegmento(250)).toBe(250 * 6 * 3)
    expect(filasPorSegmento(250, { paralelo: 1 })).toBe(750)
  })

  it('un tamaño de página raro no deja el segmento en cero', () => {
    expect(filasPorSegmento(0)).toBeGreaterThan(0)
    expect(filasPorSegmento(undefined)).toBeGreaterThan(0)
  })

  // Sin un orden estable, dos ventanas leídas a la vez se solapan o dejan huecos.
  it('sin claves lee en serie: una página y un segmento', () => {
    expect(paralelismo(['PRDID'])).toEqual({ paginas: 6, segmentos: 6 })
    expect(paralelismo([])).toEqual({ paginas: 1, segmentos: 1 })
    expect(paralelismo(undefined)).toEqual({ paginas: 1, segmentos: 1 })
  })

  it('reparte la tabla en segmentos', () => {
    expect(iniciosDeSegmento(45_000, 20_000)).toEqual([0, 20_000, 40_000])
    expect(iniciosDeSegmento(0, 20_000)).toEqual([])
    expect(iniciosDeSegmento(20_000, 20_000)).toEqual([0])
  })

  it('solo repite lo que puede salir distinto la segunda vez', () => {
    expect(esFalloTransitorio({ status: 503 })).toBe(true)
    expect(esFalloTransitorio({ status: 403 })).toBe(true)
    expect(esFalloTransitorio({ status: 0 })).toBe(true)
    expect(esFalloTransitorio(new TypeError('Failed to fetch'))).toBe(true)
    expect(esFalloTransitorio({ status: 400 })).toBe(false)
    expect(esFalloTransitorio({ status: 404 })).toBe(false)
  })

  // Un aviso informativo de SAP no es una fila rechazada.
  it('solo la gravedad E y la A son filas rechazadas', () => {
    expect(esRechazo({ Severity: 'E' })).toBe(true)
    expect(esRechazo({ Severity: 'A' })).toBe(true)
    expect(esRechazo({ Severity: 'W' })).toBe(false)
    expect(esRechazo({ Severity: 'I' })).toBe(false)
    expect(esRechazo(null)).toBe(false)
  })

  it('el estado de una tabla sigue el orden de v8', () => {
    expect(estadoDeTabla({ conError: true, rechazadas: 3, sinConfirmar: true })).toBe('error')
    expect(estadoDeTabla({ rechazadas: 3, sinConfirmar: true })).toBe('warning')
    expect(estadoDeTabla({ sinConfirmar: true })).toBe('processing')
    expect(estadoDeTabla({})).toBe('ok')
  })

  it('el estado de la corrida es el peor de sus tablas', () => {
    expect(estadoDeCorrida([{ status: 'ok' }, { status: 'warning' }])).toBe('warning')
    expect(estadoDeCorrida([{ status: 'processing' }, { status: 'error' }])).toBe('error')
    expect(estadoDeCorrida([{ status: 'error' }, { status: 'cancelled' }])).toBe('cancelled')
    expect(estadoDeCorrida([{ status: 'skipped' }])).toBe('ok')
    expect(estadoDeCorrida([])).toBe('ok')
  })

  // La foto de claves del borrado viaja en el cuerpo de una petición, que tiene límite.
  it('parte por filas y por bytes', () => {
    const filas = Array.from({ length: 10 }, (_, i) => ({ K: String(i).padStart(10, '0') }))
    expect(partirPorBytes(filas, { maxFilas: 4 }).map((uno) => uno.length)).toEqual([4, 4, 2])
    const porBytes = partirPorBytes(filas, { maxBytes: 40 })
    expect(porBytes.every((uno) => JSON.stringify(uno).length <= 60)).toBe(true)
    expect(porBytes.flat()).toHaveLength(10)
    expect(partirPorBytes([])).toEqual([])
  })
})

