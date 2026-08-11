import { describe, it, expect } from 'vitest'

import {
  ATRIBUTOS_DE_SOLO_LECTURA,
  FILAS_POR_SEGMENTO,
  NIVELES_DE_TIEMPO,
  UMBRAL_PARA_PARTIR_POR_TIEMPO,
  dimensionesEscribibles,
  esCampoDeTiempo,
  filaParaEscribir,
  nivelDeTiempoDe,
  nombreEnDestino,
  renombrados,
  planificarSegmentos,
  revisarMigracionDeCifras,
  selectDeLaMigracion,
} from './kf-migration-plan.js'

const ORIGEN = { connectionId: 'c-1', area: 'ASIBPTS', versionId: 'V1' }
const DESTINO = { connectionId: 'c-2', area: 'GCINDURAMA', versionId: 'V2' }

describe('niveles de tiempo', () => {
  // Que el número no siga el calendario —4 es semana, 3 mes, 0 día— es de SAP.
  it('reconoce los campos de periodo de SAP', () => {
    expect(esCampoDeTiempo('PERIODID4_TSTAMP')).toBe(true)
    expect(esCampoDeTiempo('PRDID')).toBe(false)
  })

  it('encuentra el nivel de tiempo dentro de un nivel', () => {
    expect(nivelDeTiempoDe(['PRDID', 'PERIODID3_TSTAMP'])).toMatchObject({ clave: 'mes' })
  })

  it('un nivel sin tiempo no tiene ninguno', () => {
    expect(nivelDeTiempoDe(['PRDID', 'LOCID'])).toBeNull()
    expect(nivelDeTiempoDe(undefined)).toBeNull()
  })

  it('todos los niveles declaran campo, clave y etiqueta', () => {
    for (const uno of NIVELES_DE_TIEMPO) {
      expect(uno.campo).toMatch(/^PERIODID\d_TSTAMP$/)
      expect(uno.clave).toBeTruthy()
      expect(uno.etiqueta).toBeTruthy()
    }
  })
})

describe('dimensionesEscribibles', () => {
  // La versión y el escenario viajan en la transacción, no como columnas.
  it('quita los atributos que SAP no acepta al escribir', () => {
    expect(dimensionesEscribibles(['PRDID', 'VERSIONID', 'AGGREGATE', 'LOCID'])).toEqual(['PRDID', 'LOCID'])
  })

  it('sin dimensiones no revienta', () => {
    expect(dimensionesEscribibles(undefined)).toEqual([])
  })

  it('la lista de solo lectura incluye la versión y el escenario', () => {
    expect(ATRIBUTOS_DE_SOLO_LECTURA).toContain('VERSIONID')
    expect(ATRIBUTOS_DE_SOLO_LECTURA).toContain('SCENARIOID')
  })
})

describe('revisarMigracionDeCifras', () => {
  const base = {
    origen: ORIGEN,
    destino: DESTINO,
    cifras: ['ADJUSTEDPRODUCTION'],
    dimensiones: ['PRDID', 'LOCID', 'PERIODID4_TSTAMP'],
    cifrasDelDestino: ['ADJUSTEDPRODUCTION', 'OTRA'],
    dimensionesDelDestino: ['PRDID', 'LOCID', 'PERIODID4_TSTAMP'],
  }

  it('una migración completa se puede hacer', () => {
    const revision = revisarMigracionDeCifras(base)
    expect(revision).toMatchObject({ sePuede: true, impedimentos: [], avisos: [] })
    expect(revision.nivelDeTiempo).toMatchObject({ clave: 'semana' })
  })

  it('sin cifras elegidas no se puede', () => {
    expect(revisarMigracionDeCifras({ ...base, cifras: [] }).sePuede).toBe(false)
  })

  // Un nivel vacío hace que SAP sume todo en un solo valor.
  it('un nivel vacío lo impide', () => {
    const revision = revisarMigracionDeCifras({ ...base, dimensiones: [] })
    expect(revision.sePuede).toBe(false)
    expect(revision.impedimentos.join(' ')).toMatch(/nivel está vacío/)
  })

  // ESTE es el caso que muerde en silencio: el resultado es creíble y está mal.
  it('un nivel sin periodo se avisa, no se impide', () => {
    const revision = revisarMigracionDeCifras({ ...base, dimensiones: ['PRDID', 'LOCID'] })
    expect(revision.sePuede).toBe(true)
    expect(revision.avisos.join(' ')).toMatch(/no incluye ningún periodo/)
    expect(revision.avisos.join(' ')).toMatch(/TODO el horizonte/)
  })

  it('una cifra que el destino no tiene lo impide', () => {
    const revision = revisarMigracionDeCifras({ ...base, cifras: ['NOEXISTE'] })
    expect(revision.sePuede).toBe(false)
    expect(revision.impedimentos.join(' ')).toMatch(/NOEXISTE/)
  })

  it('un atributo del nivel que el destino no tiene lo impide', () => {
    const revision = revisarMigracionDeCifras({ ...base, dimensionesDelDestino: ['PRDID'] })
    expect(revision.sePuede).toBe(false)
    expect(revision.impedimentos.join(' ')).toMatch(/LOCID/)
  })

  // Sin catálogo del destino no se puede comprobar; mejor dejar seguir que impedir por no saber.
  it('sin catálogo del destino no se inventan impedimentos', () => {
    expect(revisarMigracionDeCifras({
      ...base, cifrasDelDestino: [], dimensionesDelDestino: [],
    }).sePuede).toBe(true)
  })

  it('los atributos de solo lectura se avisan y se quitan del nivel', () => {
    const revision = revisarMigracionDeCifras({
      ...base, dimensiones: ['PRDID', 'VERSIONID', 'PERIODID4_TSTAMP'],
    })
    expect(revision.nivel).toEqual(['PRDID', 'PERIODID4_TSTAMP'])
    expect(revision.avisos.join(' ')).toMatch(/VERSIONID/)
  })

  it('el mismo tenant, área y versión lo impide', () => {
    expect(revisarMigracionDeCifras({ ...base, destino: { ...ORIGEN } }).sePuede).toBe(false)
  })

  // El mismo tenant con OTRA versión es un caso legítimo: copiar de una versión a otra.
  it('el mismo tenant con otra versión sí se puede', () => {
    expect(revisarMigracionDeCifras({
      ...base, destino: { ...ORIGEN, versionId: 'V9' },
    }).sePuede).toBe(true)
  })

  it('sin argumentos no revienta', () => {
    expect(revisarMigracionDeCifras().sePuede).toBe(false)
  })
})

describe('renombrar para el destino', () => {
  it('sin mapa, el nombre es el mismo', () => {
    expect(nombreEnDestino('ADJUSTEDPRODUCTION')).toBe('ADJUSTEDPRODUCTION')
    expect(nombreEnDestino('ADJUSTEDPRODUCTION', {})).toBe('ADJUSTEDPRODUCTION')
  })

  it('con mapa, el del destino', () => {
    expect(nombreEnDestino('ADJUSTEDPRODUCTION', { ADJUSTEDPRODUCTION: 'ZPROD' })).toBe('ZPROD')
  })

  // Una entrada vacía es «con el mismo nombre», no «con un nombre vacío».
  it('un destino vacío no borra el nombre', () => {
    expect(nombreEnDestino('KF', { KF: '' })).toBe('KF')
  })

  it('solo lista lo que de verdad cambia de nombre', () => {
    expect(renombrados(['A', 'B', 'C'], { A: 'ZA', B: 'B' }))
      .toEqual([{ origen: 'A', destino: 'ZA' }])
  })

  it('sin nombres no revienta', () => {
    expect(renombrados(undefined, undefined)).toEqual([])
  })
})

describe('revisarMigracionDeCifras con renombrado y tramo', () => {
  const base = {
    origen: ORIGEN,
    destino: DESTINO,
    cifras: ['ADJUSTEDPRODUCTION'],
    dimensiones: ['PRDID', 'PERIODID4_TSTAMP'],
    cifrasDelDestino: ['ZPROD', 'OTRA'],
    dimensionesDelDestino: ['ZPRODUCTO', 'PERIODID4_TSTAMP'],
  }

  // Lo que tiene que existir en el destino es el nombre NUEVO, no el del origen.
  it('con el renombrado puesto, la migración se puede hacer', () => {
    const revision = revisarMigracionDeCifras({
      ...base,
      destinoDe: { ADJUSTEDPRODUCTION: 'ZPROD', PRDID: 'ZPRODUCTO' },
    })
    expect(revision.sePuede).toBe(true)
  })

  it('sin el renombrado, el destino no tiene esos nombres', () => {
    const revision = revisarMigracionDeCifras(base)
    expect(revision.sePuede).toBe(false)
    expect(revision.impedimentos.join(' ')).toContain('ADJUSTEDPRODUCTION')
  })

  // Se configura una vez y se olvida, y escribe en una cifra que no era.
  it('avisa por escrito de cada renombrado', () => {
    const revision = revisarMigracionDeCifras({
      ...base,
      destinoDe: { ADJUSTEDPRODUCTION: 'ZPROD', PRDID: 'ZPRODUCTO' },
    })
    expect(revision.avisos.join(' ')).toContain('ADJUSTEDPRODUCTION → ZPROD')
    expect(revision.avisos.join(' ')).toContain('PRDID → ZPRODUCTO')
  })

  // Un rango al revés no da error en SAP: da cero filas, que se lee como «no hay datos».
  it('un tramo de fechas al revés no se puede', () => {
    const revision = revisarMigracionDeCifras({
      ...base,
      destinoDe: { ADJUSTEDPRODUCTION: 'ZPROD', PRDID: 'ZPRODUCTO' },
      desde: '2026-03-01',
      hasta: '2026-01-01',
    })
    expect(revision.sePuede).toBe(false)
    expect(revision.impedimentos.join(' ')).toContain('al revés')
  })

  it('un tramo en orden, o con un solo extremo, sí', () => {
    const conDestino = { ...base, destinoDe: { ADJUSTEDPRODUCTION: 'ZPROD', PRDID: 'ZPRODUCTO' } }
    expect(revisarMigracionDeCifras({ ...conDestino, desde: '2026-01-01', hasta: '2026-03-01' }).sePuede).toBe(true)
    expect(revisarMigracionDeCifras({ ...conDestino, desde: '2026-01-01' }).sePuede).toBe(true)
    expect(revisarMigracionDeCifras({ ...conDestino, hasta: '2026-03-01' }).sePuede).toBe(true)
  })
})

describe('selectDeLaMigracion', () => {
  // Si el select y la lista del nivel no coinciden, SAP escribe a otro nivel del que se leyó.
  it('pone el nivel primero y las cifras después', () => {
    expect(selectDeLaMigracion(['PRDID', 'PERIODID4_TSTAMP'], ['KF1', 'KF2']))
      .toEqual(['PRDID', 'PERIODID4_TSTAMP', 'KF1', 'KF2'])
  })

  it('sin nada devuelve una lista vacía', () => {
    expect(selectDeLaMigracion()).toEqual([])
  })
})

describe('planificarSegmentos', () => {
  it('cuenta los segmentos que hacen falta', () => {
    expect(planificarSegmentos(FILAS_POR_SEGMENTO * 2 + 5))
      .toMatchObject({ segmentos: 3, porSegmento: FILAS_POR_SEGMENTO })
  })

  it('sin filas no hay segmentos', () => {
    expect(planificarSegmentos(0)).toMatchObject({ segmentos: 0 })
  })

  // Con volúmenes grandes un $skip muy profundo se vuelve caro y frágil.
  it('por encima del umbral parte por periodo', () => {
    expect(planificarSegmentos(UMBRAL_PARA_PARTIR_POR_TIEMPO + 1).partirPorTiempo).toBe(true)
    expect(planificarSegmentos(UMBRAL_PARA_PARTIR_POR_TIEMPO).partirPorTiempo).toBe(false)
  })

  it('una cuenta ilegible se trata como cero', () => {
    expect(planificarSegmentos(undefined)).toMatchObject({ total: 0, segmentos: 0 })
  })
})

describe('filaParaEscribir', () => {
  const fila = {
    PRDID: 'P1', LOCID: 'L1', PERIODID4_TSTAMP: '/Date(1)/',
    ADJUSTEDPRODUCTION: '10', VERSIONID: 'V1', AGGREGATE: 'X', SOBRA: 'z',
  }

  it('se queda con el nivel y las cifras, y nada más', () => {
    expect(filaParaEscribir(fila, ['PRDID', 'PERIODID4_TSTAMP'], ['ADJUSTEDPRODUCTION']))
      .toEqual({ PRDID: 'P1', PERIODID4_TSTAMP: '/Date(1)/', ADJUSTEDPRODUCTION: '10' })
  })

  it('un campo que la fila no trae no se inventa', () => {
    expect(filaParaEscribir(fila, ['PRDID', 'NOESTA'], [])).toEqual({ PRDID: 'P1' })
  })

  // La fila se LEE con los nombres del origen y se ESCRIBE con los del destino.
  it('escribe con el nombre del destino', () => {
    const fila = { PRDID: 'P1', ADJUSTEDPRODUCTION: 5 }
    expect(filaParaEscribir(fila, ['PRDID'], ['ADJUSTEDPRODUCTION'], {
      PRDID: 'ZPRODUCTO', ADJUSTEDPRODUCTION: 'ZPROD',
    })).toEqual({ ZPRODUCTO: 'P1', ZPROD: 5 })
  })

  it('sin mapa escribe con el mismo nombre', () => {
    expect(filaParaEscribir({ PRDID: 'P1' }, ['PRDID'], [], {})).toEqual({ PRDID: 'P1' })
  })

  it('sin fila no revienta', () => {
    expect(filaParaEscribir(undefined, ['PRDID'], ['KF'])).toEqual({})
  })
})
