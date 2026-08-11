import { describe, it, expect } from 'vitest'

import {
  duracionLegible,
  estadoDeCorrida,
  filasDeConfiguracion,
  filasDeSegmentos,
  mensajesAgrupados,
  momentoLegible,
  nombreDelInforme,
  resumirCorrida,
} from './kf-run-report.js'

const INICIO = Date.parse('2026-08-11T10:00:00Z')

const CORRIDA = {
  inicio: INICIO,
  fin: INICIO + 195_000,
  origen: { tenant: 'Tenant IBP · my400444', area: 'ASIBPTS', versionId: 'ASIBPTSIRR' },
  destino: { tenant: 'Tenant IBP', area: 'GCINDURAMA', versionId: '' },
  cifras: ['ACTUALSQTY', 'ADJUSTEDPRODUCTION'],
  nivel: ['PRDID', 'PERIODID4_TSTAMP'],
  periodo: 'Semana',
  desdeFecha: '2024-01-01',
  hastaFecha: '2024-03-31',
  destinoDe: { ACTUALSQTY: 'ZACTUALS', PRDID: 'PRDID' },
  conversiones: { UOMTOID: 'KG', CURRTOID: '' },
  condiciones: [{ field: 'PRDID', value: 'P1,P2' }, { field: '', value: 'nada' }],
  previstas: 44_839,
  nombre: 'goscm-suite',
  mensajes: [],
  segmentos: [
    { desde: 0, filas: 20_000, transactionId: 'TX1', estado: 'PROCESADA', ms: 65_000 },
    { desde: 20_000, filas: 20_000, transactionId: 'TX2', estado: 'PROCESADA', ms: 90_000 },
    { desde: 40_000, filas: 4_839, transactionId: 'TX3', estado: 'PROCESADA', ms: 40_000 },
  ],
}

describe('duracionLegible', () => {
  it('por debajo de diez segundos, con un decimal', () => {
    expect(duracionLegible(6400)).toBe('6.4 s')
  })

  it('por debajo del minuto, en segundos redondos', () => {
    expect(duracionLegible(45_000)).toBe('45 s')
  })

  it('minutos y segundos', () => {
    expect(duracionLegible(195_000)).toBe('3 min 15 s')
  })

  it('horas y minutos, que es lo que dura una migracion grande', () => {
    expect(duracionLegible(3 * 3_600_000 + 25 * 60_000)).toBe('3 h 25 min')
  })

  it('sin dato no dice NaN', () => {
    expect(duracionLegible(undefined)).toBe('0.0 s')
    expect(duracionLegible(-5)).toBe('0.0 s')
  })
})

describe('momentoLegible', () => {
  it('sin marca de tiempo pone una raya, no 1970', () => {
    expect(momentoLegible(0)).toBe('—')
    expect(momentoLegible(undefined)).toBe('—')
  })

  it('con marca escribe la fecha', () => {
    expect(momentoLegible(INICIO)).toMatch(/2026/)
  })
})

describe('estadoDeCorrida', () => {
  // Tres finales distintos, y el informe no los puede confundir.
  it('sin nada raro es completa', () => {
    expect(estadoDeCorrida(CORRIDA).clave).toBe('ok')
  })

  it('un error manda sobre todo lo demas', () => {
    expect(estadoDeCorrida({ ...CORRIDA, error: 'se cayo', cancelado: true }).clave).toBe('error')
  })

  it('cancelada no es lo mismo que fallida', () => {
    expect(estadoDeCorrida({ ...CORRIDA, cancelado: true }).clave).toBe('cancelado')
  })

  // Escribir y que SAP rechace filas no es una corrida limpia, aunque no lance error.
  it('con filas rechazadas se dice', () => {
    expect(estadoDeCorrida({ ...CORRIDA, mensajes: [{ Message: 'clave duplicada' }] }).clave)
      .toBe('conRechazos')
  })
})

describe('resumirCorrida', () => {
  it('cuenta los segmentos y las filas que SAP confirmo', () => {
    const resumen = resumirCorrida(CORRIDA)
    expect(resumen.segmentos).toBe(3)
    expect(resumen.copiadas).toBe(44_839)
  })

  it('la duracion es del principio al fin', () => {
    expect(resumirCorrida(CORRIDA).duracion).toBe(195_000)
  })

  it('senala el segmento mas lento', () => {
    expect(resumirCorrida(CORRIDA).masLento.transactionId).toBe('TX2')
  })

  // La media por segmento es lo que permite estimar una corrida mayor.
  it('la media por segmento sale de los que tienen tiempo medido', () => {
    expect(resumirCorrida(CORRIDA).mediaPorSegmento).toBe(65_000)
  })

  it('una corrida sin segmentos no revienta ni inventa un mas lento', () => {
    const resumen = resumirCorrida({ inicio: INICIO, fin: INICIO })
    expect(resumen).toMatchObject({ segmentos: 0, copiadas: 0, mediaPorSegmento: 0, masLento: null })
  })

  it('sin corrida tampoco', () => {
    expect(resumirCorrida(undefined).copiadas).toBe(0)
  })
})

describe('filasDeConfiguracion', () => {
  const pares = Object.fromEntries(filasDeConfiguracion(CORRIDA))

  it('nombra los dos tenants con su area y version', () => {
    expect(pares.Origen).toBe('Tenant IBP · my400444 · ASIBPTS · ASIBPTSIRR')
  })

  // La version base no tiene identificador: dejarla vacia no dice nada.
  it('la version base se nombra', () => {
    expect(pares.Destino).toContain('version base')
  })

  it('lista las cifras y el nivel', () => {
    expect(pares['Cifras clave']).toBe('ACTUALSQTY, ADJUSTEDPRODUCTION')
    expect(pares['Nivel de agregacion']).toBe('PRDID x PERIODID4_TSTAMP')
  })

  // Es la trampa que mas muerde: sin periodo, SAP suma todo el horizonte y el numero es creible.
  it('un nivel sin periodo se dice con todas las letras', () => {
    const sin = Object.fromEntries(filasDeConfiguracion({ ...CORRIDA, periodo: '' }))
    expect(sin['Periodo del nivel']).toContain('sumo todo el horizonte')
  })

  it('el tramo de tiempo, y que no habia tramo', () => {
    expect(pares['Tramo de tiempo']).toBe('2024-01-01 a 2024-03-31')
    const todo = Object.fromEntries(filasDeConfiguracion({ ...CORRIDA, desdeFecha: '', hastaFecha: '' }))
    expect(todo['Tramo de tiempo']).toBe('todo el horizonte')
  })

  it('un tramo con un solo extremo se lee', () => {
    const medio = Object.fromEntries(filasDeConfiguracion({ ...CORRIDA, hastaFecha: '' }))
    expect(medio['Tramo de tiempo']).toBe('2024-01-01 a ...')
  })

  // Con flecha ASCII: la fuente de jsPDF no tiene «→» y saldria un caracter roto.
  it('los renombrados van con flecha ASCII, y solo los que cambian', () => {
    expect(pares['Escrito con otro nombre']).toBe('ACTUALSQTY -> ZACTUALS')
  })

  it('sin renombrados lo dice, en vez de dejarlo vacio', () => {
    const sin = Object.fromEntries(filasDeConfiguracion({ ...CORRIDA, destinoDe: {} }))
    expect(sin['Escrito con otro nombre']).toContain('los mismos nombres')
  })

  it('solo lista las conversiones que tienen valor', () => {
    expect(pares['Conversion exigida']).toBe('UOMTOID = KG')
  })

  it('descarta las condiciones a medio escribir', () => {
    expect(pares.Filtro).toBe('PRDID = P1,P2')
  })

  it('sin conversiones ni filtro no deja filas vacias', () => {
    const pelada = Object.fromEntries(filasDeConfiguracion({
      ...CORRIDA, conversiones: {}, condiciones: [], previstas: 0,
    }))
    expect(pelada['Conversion exigida']).toBeUndefined()
    expect(pelada.Filtro).toBeUndefined()
    expect(pelada['Filas previstas al contar']).toBeUndefined()
  })

  it('una corrida vacia no revienta', () => {
    expect(filasDeConfiguracion(undefined).length).toBeGreaterThan(0)
  })
})

describe('filasDeSegmentos', () => {
  // El segmento es la unidad de la transaccion: si algo falla, lo escrito son los confirmados antes.
  it('una fila por segmento, numerada, con su transaccion', () => {
    const filas = filasDeSegmentos(CORRIDA)
    expect(filas).toHaveLength(3)
    expect(filas[1]).toEqual(['2', '20.000', '20.000', 'TX2', 'PROCESADA', '1 min 30 s'])
  })

  it('sin segmentos devuelve nada', () => {
    expect(filasDeSegmentos({ segmentos: [] })).toEqual([])
    expect(filasDeSegmentos(undefined)).toEqual([])
  })

  it('un segmento sin transaccion no deja el hueco en blanco', () => {
    expect(filasDeSegmentos({ segmentos: [{ desde: 0, filas: 3 }] })[0][3]).toBe('—')
  })
})

describe('mensajesAgrupados', () => {
  // Cien mensajes iguales son UN problema, no cien.
  it('agrupa por texto y cuenta las veces', () => {
    const salida = mensajesAgrupados([
      { Message: 'clave duplicada' }, { Message: 'clave duplicada' }, { Message: 'otra cosa' },
    ])
    expect(salida).toEqual([
      { texto: 'clave duplicada', veces: 2 },
      { texto: 'otra cosa', veces: 1 },
    ])
  })

  it('lee los otros nombres de campo que usa SAP', () => {
    expect(mensajesAgrupados([{ MessageText: 'uno' }, { MsgText: 'dos' }]).map((u) => u.texto))
      .toEqual(['uno', 'dos'])
  })

  it('un mensaje con forma rara no se pierde', () => {
    expect(mensajesAgrupados([{ raro: 1 }])[0].texto).toContain('raro')
  })

  it('sin mensajes no hay nada', () => {
    expect(mensajesAgrupados(undefined)).toEqual([])
  })
})

describe('nombreDelInforme', () => {
  it('lleva el destino y cuando acabo', () => {
    expect(nombreDelInforme(CORRIDA)).toMatch(/^cifras_Tenant-IBP_2026\d{4}-\d{4}\.pdf$/)
  })

  it('si no acabo usa el arranque', () => {
    expect(nombreDelInforme({ inicio: INICIO, destino: { tenant: 'X' } })).toMatch(/^cifras_X_2026/)
  })

  it('sin destino no deja el nombre a medias', () => {
    expect(nombreDelInforme({ inicio: INICIO })).toMatch(/^cifras_tenant_/)
  })
})
