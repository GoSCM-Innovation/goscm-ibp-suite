import { describe, expect, it } from 'vitest'

import {
  TABLAS_QUE_BAJA_PA,
  TABLAS_REQUERIDAS_PA,
  entidadesDeLaEjecucion,
  formatoDeProduccion,
  marca,
} from './registro-pa.js'

const formato = () => formatoDeProduccion({ leerSourceIds: async () => 7 })

describe('la línea de estado', () => {
  it('las tablas que se guardaban en IndexedDB dicen «Descargando X → IDB...»', () => {
    expect(formato().estado({ tabla: 'bom_psh' })).toEqual({ texto: 'Descargando Production Source Header → IDB...', pct: 2 })
    expect(formato().estado({ tabla: 'bom_psi' }).texto).toBe('Descargando Production Source Item → IDB...')
    expect(formato().estado({ tabla: 'sn_loc_prod' }).texto).toBe('Descargando Location Product → IDB...')
    expect(formato().estado({ tabla: 'sn_loc' })).toEqual({ texto: 'Descargando Location Source → IDB...', pct: 68 })
  })

  it('los maestros, que v7 solo indexaba en memoria, dicen «Indexando X...»', () => {
    expect(formato().estado({ tabla: 'bom_prd' })).toEqual({ texto: 'Indexando Product...', pct: 32 })
    expect(formato().estado({ tabla: 'bom_loc' }).texto).toBe('Indexando Location...')
    expect(formato().estado({ tabla: 'bom_res' }).texto).toBe('Indexando Resource...')
    expect(formato().estado({ tabla: 'bom_resloc' })).toEqual({ texto: 'Indexando Resource Location...', pct: 60 })
  })

  it('una tabla que no es de este analizador no tiene texto propio', () => {
    expect(formato().estado({ tabla: 'sn_cust' })).toBeNull()
  })

  it('los porcentajes de arranque suben en el orden de la descarga', () => {
    const pcts = TABLAS_QUE_BAJA_PA.map((tabla) => formato().estado({ tabla }).pct)
    expect(pcts).toEqual([2, 12, 18, 22, 32, 44, 54, 60, 64, 68])
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts)
  })
})

describe('lo que falta', () => {
  it('sin cabecera dice lo que decía v7', () => {
    expect(formato().alFaltar([{ tabla: 'bom_psh' }]))
      .toBe('Configura al menos la entidad Production Source Header antes de analizar')
  })

  it('sin otra tabla imprescindible habla de correcciones pendientes', () => {
    expect(formato().alFaltar([{ tabla: 'sn_loc' }]))
      .toBe('Hay correcciones pendientes. Resuélvelas en el paso de mapeo de entidades antes de ejecutar.')
  })

  it('las imprescindibles son las cuatro que v7 validaba', () => {
    expect(TABLAS_REQUERIDAS_PA).toEqual(['bom_psh', 'bom_psi', 'bom_psisub', 'sn_loc'])
  })
})

describe('el registro de la descarga', () => {
  const paso = (tabla, extra = {}) => ({ tabla, entidad: `E_${tabla}`, sePuede: true, omitidos: [], ...extra })
  const hecho = (tabla, extra = {}) => ({ tabla, entidad: `E_${tabla}`, bajadas: 10, guardadas: 10, ...extra })
  const textos = (lineas) => lineas.map((una) => `${una.clase}|${una.texto}`)

  it('la cabecera lleva la petición y cuántos SOURCEIDs; las demás solo «N reg»', async () => {
    const plan = { pasos: [paso('bom_psh'), paso('bom_psi')] }
    const salida = { hechos: [hecho('bom_psh', { bajadas: 2437 }), hecho('bom_psi', { bajadas: 9 })] }
    const tiempos = new Map([['bom_psh', 120], ['bom_psi', 450]])

    const lineas = await formato().lineas({ plan, salida, tiempos })
    expect(textos(lineas)).toEqual([
      'info|[+0ms] [GET] E_bom_psh',
      'ok|[+120ms] PSH: 2437 reg (7 SOURCEIDs)',
      'ok|[+450ms] PSI: 9 reg',
    ])
  })

  it('una tabla sin entidad dice «sin entidad configurada»', async () => {
    const plan = { pasos: [paso('bom_res', { sePuede: false })] }
    const lineas = await formato().lineas({ plan, salida: { hechos: [] }, tiempos: new Map() })
    expect(textos(lineas)).toEqual(['warn|Resource: sin entidad configurada'])
  })

  it('una entidad que devolvió 0 registros avisa, sin voseo', async () => {
    const plan = { pasos: [paso('bom_prd')] }
    const salida = { hechos: [hecho('bom_prd', { bajadas: 0, guardadas: 0 })] }
    const lineas = await formato().lineas({ plan, salida, tiempos: new Map([['bom_prd', 300]]) })

    expect(textos(lineas)).toEqual([
      'ok|[+300ms] Product: 0 reg',
      'warn|[+300ms] ⚠️ Product (E_bom_prd): 0 registros. Verifica que la entidad OData seleccionada sea la correcta para esta Planning Area.',
    ])
  })

  it('una tabla incompleta se dice en rojo', async () => {
    const plan = { pasos: [paso('sn_loc')] }
    const salida = { hechos: [hecho('sn_loc', { bajadas: 5, enSap: 9, faltan: 4 })] }
    const lineas = await formato().lineas({ plan, salida, tiempos: new Map() })
    expect(textos(lineas)[1]).toContain('err|✕ Location Source: incompleta')
  })

  it('un error de una tabla sale como error', async () => {
    const plan = { pasos: [paso('bom_psr')] }
    const salida = { hechos: [hecho('bom_psr', { error: 'se cayó' })] }
    const lineas = await formato().lineas({ plan, salida, tiempos: new Map() })
    expect(textos(lineas)).toEqual(['err|[+0ms] PSR: error — se cayó'])
  })

  it('el tiempo se escribe como v7', () => {
    expect(marca(1234.6)).toBe('[+1235ms]')
    expect(marca(-3)).toBe('[+0ms]')
  })
})

describe('entidadesDeLaEjecucion', () => {
  const hechos = [
    { tabla: 'bom_psh', entidad: 'PSH_E', bajadas: 5, guardadas: 2 },
    { tabla: 'bom_psisub', entidad: 'SUB_E', bajadas: 4, guardadas: 4 },
    { tabla: 'bom_prd', entidad: 'PRD_E', bajadas: 7, guardadas: 7 },
    { tabla: 'sn_loc_prod', entidad: 'LP_E', bajadas: 3, guardadas: 3 },
    { tabla: 'sn_loc', entidad: 'LS_E', bajadas: 8, guardadas: 6 },
    { tabla: 'bom_res', entidad: null, omitido: true },
  ]

  it('devuelve las entidades en el orden de v7, con su nota y la hoja con que se cruzan', () => {
    const e = entidadesDeLaEjecucion(hechos)
    expect(e.map((una) => una.name)).toEqual([
      'Production Source Header', 'Production Source Item Sub', 'Product', 'Location Product', 'Location Source',
    ])
    expect(e[0]).toEqual({
      name: 'Production Source Header',
      entityName: 'PSH_E',
      downloaded: 5,
      retained: 2,
      statKey: 'Prod Source Header',
      note: 'Excluye PINVALID=X',
    })
  })

  it('solo las que pasan por un filtro automático llevan «retenidas»', () => {
    const e = entidadesDeLaEjecucion(hechos)
    expect(e.find((una) => una.name === 'Product').retained).toBeUndefined()
    expect(e.find((una) => una.name === 'Location Product').retained).toBeUndefined()
    expect(e.find((una) => una.name === 'Location Source')).toMatchObject({ retained: 6, note: 'Excluye TINVALID=X' })
  })

  it('no anota las que no se bajaron', () => {
    expect(entidadesDeLaEjecucion(hechos).map((una) => una.name)).not.toContain('Resource')
  })
})
