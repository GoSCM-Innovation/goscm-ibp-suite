import { describe, it, expect } from 'vitest'

import {
  FILAS_POR_SEGMENTO, NIVELES_DE_TIEMPO,
  camposDeEscritura, cifrasPegadas, definicionDeLaCifra, duracionLegible, esFalloTransitorio,
  esMensajeDeRechazo, esPeriodoIso, estadoDeCifra, estadoDeCorrida, filasParaEscribir, filtroDePeriodo,
  lecturaDeLaCifra, mensajeBreve, nombreDelInforme, siguienteTramo, tiemposDeLaCorrida, totalEscrito,
} from './kf-migration-plan.js'
import { periodoIso } from './planning-data-model.js'

const definicion = {
  nivel: [{ destino: 'PRDID', origen: 'PRDID' }, { destino: 'CUSTID', origen: 'ATRIBUTOZ' }],
  cifra: { origen: 'ZSRC', destino: 'ZDST' },
  campoDeTiempo: 'PERIODID4_TSTAMP',
  conversiones: {},
}

describe('niveles de tiempo', () => {
  it('semana es el primero, como en v8', () => {
    expect(NIVELES_DE_TIEMPO[0].campo).toBe('PERIODID4_TSTAMP')
    expect(NIVELES_DE_TIEMPO.map((uno) => uno.clave)).toEqual(['week', 'month', 'quarter', 'year', 'day', 'techweek'])
  })
})

describe('lecturaDeLaCifra', () => {
  it('lee con los nombres del origen, la key figure y SIEMPRE el tiempo', () => {
    expect(lecturaDeLaCifra(definicion)).toEqual({
      select: ['PRDID', 'ATRIBUTOZ', 'ZSRC', 'PERIODID4_TSTAMP'],
      orderby: ['PRDID', 'ATRIBUTOZ', 'PERIODID4_TSTAMP'],
    })
  })

  it('las conversiones van en el select y en el orden, después del nivel', () => {
    const { select, orderby } = lecturaDeLaCifra({ ...definicion, conversiones: { CURRTOID: 'USD', UOMTOID: 'EA' } })
    expect(select).toEqual(['PRDID', 'ATRIBUTOZ', 'UOMTOID', 'CURRTOID', 'ZSRC', 'PERIODID4_TSTAMP'])
    expect(orderby).toEqual(['PRDID', 'ATRIBUTOZ', 'UOMTOID', 'CURRTOID', 'PERIODID4_TSTAMP'])
  })

  it('una conversión sin valor no se pide', () => {
    expect(lecturaDeLaCifra({ ...definicion, conversiones: { UOMTOID: '' } }).select).not.toContain('UOMTOID')
  })
})

describe('camposDeEscritura', () => {
  it('es el nivel del DESTINO, la key figure y el tiempo, sin conversiones', () => {
    expect(camposDeEscritura({ ...definicion, conversiones: { UOMTOID: 'EA' } }))
      .toEqual(['PRDID', 'CUSTID', 'ZDST', 'PERIODID4_TSTAMP'])
  })
})

describe('filtroDePeriodo', () => {
  it('añade el periodo al filtro', () => {
    expect(filtroDePeriodo("VERSIONID eq 'V1'", 'PERIODID4_TSTAMP', '2026-01-05T00:00:00'))
      .toBe("VERSIONID eq 'V1' and PERIODID4_TSTAMP eq datetime'2026-01-05T00:00:00'")
  })
  it('sin periodo deja el filtro como estaba', () => {
    expect(filtroDePeriodo('X', 'PERIODID4_TSTAMP', null)).toBe('X')
    expect(filtroDePeriodo('', 'PERIODID4_TSTAMP', '2026-01-05T00:00:00')).toBe("PERIODID4_TSTAMP eq datetime'2026-01-05T00:00:00'")
  })
  it('reconoce un periodo ISO', () => {
    expect(esPeriodoIso('2026-01-05T00:00:00')).toBe(true)
    expect(esPeriodoIso("2026-01-05' or 1 eq 1")).toBe(false)
  })
})

describe('filasParaEscribir', () => {
  const filas = [
    { PRDID: 'P1', ATRIBUTOZ: 'C1', ZSRC: '5.000000', PERIODID4_TSTAMP: '/Date(1767225600000)/', VERSIONID: 'V' },
    { PRDID: 'P2', ATRIBUTOZ: 'C2', ZSRC: '0.000000', PERIODID4_TSTAMP: '/Date(1767225600000)/' },
    { PRDID: 'P3', ATRIBUTOZ: null, ZSRC: '-2', PERIODID4_TSTAMP: '/Date(1767225600000)/' },
    { PRDID: 'P4', ATRIBUTOZ: 'C4', ZSRC: null, PERIODID4_TSTAMP: '/Date(1767225600000)/' },
  ]

  it('renombra al destino, pasa el periodo a ISO y descarta vacíos y ceros', () => {
    expect(filasParaEscribir(filas, definicion, periodoIso)).toEqual([
      { PRDID: 'P1', CUSTID: 'C1', PERIODID4_TSTAMP: '2026-01-01T00:00:00', ZDST: '5.000000' },
      { PRDID: 'P3', CUSTID: '', PERIODID4_TSTAMP: '2026-01-01T00:00:00', ZDST: '-2' },
    ])
  })
})

describe('definicionDeLaCifra', () => {
  it('acepta una definición completa', () => {
    const { definicion: leida, error } = definicionDeLaCifra({
      ...definicion, conversiones: { UOMTOID: 'EA', OTRO: 'x' }, desde: '2026-01-01', hasta: 'mañana',
      condiciones: [{ field: 'PRDID', op: 'in', value: 'A,B' }, { field: "X' or", op: 'in', value: '1' }],
    })
    expect(error).toBeUndefined()
    expect(leida.conversiones).toEqual({ UOMTOID: 'EA' })
    expect(leida.desde).toBe('2026-01-01')
    expect(leida.hasta).toBe('')
    expect(leida.condiciones).toEqual([{ field: 'PRDID', op: 'in', value: 'A,B' }])
    expect(leida.soloConValor).toBe(true)
  })

  it('rechaza lo que no es un nombre de campo', () => {
    expect(definicionDeLaCifra({ ...definicion, cifra: { origen: 'A B', destino: 'C' } }).error).toBeTruthy()
    expect(definicionDeLaCifra({ ...definicion, nivel: [] }).error).toBeTruthy()
    expect(definicionDeLaCifra({ ...definicion, nivel: [{ destino: 'PRDID', origen: null }] }).error).toBeTruthy()
    expect(definicionDeLaCifra({ ...definicion, campoDeTiempo: 'PRDID' }).error).toBeTruthy()
  })

  it('no deja escribir un atributo de solo lectura', () => {
    expect(definicionDeLaCifra({ ...definicion, nivel: [{ destino: 'VERSIONID', origen: 'VERSIONID' }] }).error).toBeTruthy()
  })

  it('soloConValor: false se respeta', () => {
    expect(definicionDeLaCifra({ ...definicion, soloConValor: false }).definicion.soloConValor).toBe(false)
  })
})

describe('juzgar el resultado', () => {
  it('fallos que merecen otro intento, como v8', () => {
    expect(esFalloTransitorio(undefined)).toBe(true)
    expect(esFalloTransitorio(403)).toBe(true)
    expect(esFalloTransitorio(502)).toBe(true)
    expect(esFalloTransitorio(400)).toBe(false)
  })

  it('solo los mensajes E/A son rechazos; sin severidad cuentan todos', () => {
    expect(esMensajeDeRechazo({ Severity: 'E' })).toBe(true)
    expect(esMensajeDeRechazo({ Severity: 'A' })).toBe(true)
    expect(esMensajeDeRechazo({ Severity: 'I' })).toBe(false)
    expect(esMensajeDeRechazo({ MsgText: 'x' })).toBe(true)
  })

  it('un mensaje se reduce a lo que se enseña', () => {
    expect(mensajeBreve({ ExceptionId: 'E1', MsgText: 'm', Severity: 'E', __metadata: {}, Transactionid: 'T' }))
      .toEqual({ ExceptionId: 'E1', MsgText: 'm', Severity: 'E' })
  })

  it('estado de una key figure', () => {
    expect(estadoDeCifra({ hayError: true, mensajes: [{}] })).toBe('error')
    expect(estadoDeCifra({ mensajes: [{}] })).toBe('warning')
    expect(estadoDeCifra({ hayAviso: true })).toBe('warning')
    expect(estadoDeCifra({ sinConfirmar: true })).toBe('processing')
    expect(estadoDeCifra({})).toBe('ok')
  })

  it('estado de la corrida', () => {
    expect(estadoDeCorrida([{ status: 'ok' }, { status: 'cancelled' }, { status: 'error' }])).toBe('cancelled')
    expect(estadoDeCorrida([{ status: 'ok' }, { status: 'error' }])).toBe('error')
    expect(estadoDeCorrida([{ status: 'warning' }, { status: 'processing' }])).toBe('processing')
    expect(estadoDeCorrida([{ status: 'ok' }, { status: 'skipped' }])).toBe('ok')
  })

  it('las filas escritas y los tiempos se cuentan una vez por transacción', () => {
    const resultados = [
      { kf: 'A', txId: 'T1', total: 10, durationMs: 5, phaseTimes: { reading: 2 } },
      { kf: 'B', txId: 'T1', total: 10, durationMs: 5, phaseTimes: { reading: 2 } },
      { kf: 'C', txId: null, total: 3, durationMs: 9, phaseTimes: { reading: 1, count: 4 } },
    ]
    expect(totalEscrito(resultados)).toBe(13)
    const { totales, masLenta } = tiemposDeLaCorrida(resultados)
    expect(totales).toEqual({ reading: 3, count: 4 })
    expect(masLenta.kf).toBe('C')
  })
})

describe('duracionLegible', () => {
  it('como fmtDuration de v8', () => {
    expect(duracionLegible(null)).toBe('—')
    expect(duracionLegible(850)).toBe('850 ms')
    expect(duracionLegible(4200)).toBe('4,2 s')
    expect(duracionLegible(134_000)).toBe('2m 14s')
    expect(duracionLegible(3_720_000)).toBe('1h 02m')
  })
})

describe('siguienteTramo', () => {
  it('reparte cada periodo por posición hasta que se marca terminado', () => {
    const periodos = [{ periodo: 'A', skip: 0, done: false }, { periodo: 'B', skip: 0, done: false }]
    expect(siguienteTramo(periodos)).toMatchObject({ desde: 0, periodo: { periodo: 'A' } })
    expect(siguienteTramo(periodos)).toMatchObject({ desde: FILAS_POR_SEGMENTO, periodo: { periodo: 'A' } })
    periodos[0].done = true
    expect(siguienteTramo(periodos)).toMatchObject({ desde: 0, periodo: { periodo: 'B' } })
    periodos[1].done = true
    expect(siguienteTramo(periodos)).toBeNull()
  })
})

describe('cifrasPegadas', () => {
  const catalogos = { delDestino: ['ZDEMAND', 'ZFORECAST', 'ZSALES'], delOrigen: ['ZDEMAND', 'ZOLDSALES'] }

  it('una por línea o separadas por coma, contra el DESTINO y sin distinguir mayúsculas', () => {
    const r = cifrasPegadas('zdemand\nZFORECAST; NOEXISTE', catalogos)
    expect(r.agregadas).toEqual([{ dstKf: 'ZDEMAND', srcKf: 'ZDEMAND' }, { dstKf: 'ZFORECAST', srcKf: '' }])
    expect(r.faltantes).toEqual(['NOEXISTE'])
  })

  it('ORIGEN⇥DESTINO para los renombrados', () => {
    expect(cifrasPegadas('ZOLDSALES\tZSALES', catalogos).agregadas).toEqual([{ dstKf: 'ZSALES', srcKf: 'ZOLDSALES' }])
  })

  it('lo ya elegido se cuenta como repetido', () => {
    const r = cifrasPegadas('ZDEMAND\nZDEMAND\n"ZSALES"', { ...catalogos, yaElegidas: ['ZSALES'] })
    expect(r.agregadas).toEqual([{ dstKf: 'ZDEMAND', srcKf: 'ZDEMAND' }])
    expect(r.repetidas).toBe(2)
  })
})

describe('nombreDelInforme', () => {
  it('como v8', () => {
    expect(nombreDelInforme('CLARO CO (Producción)', new Date(2026, 9, 1, 8, 5)))
      .toBe('migracion-kf_CLARO-CO-Producci-n-_20261001-0805.pdf')
  })
})
