import { describe, expect, it } from 'vitest'
import {
  COMANDOS_CONOCIDOS,
  conCampo,
  conFecha,
  conFiltro,
  efectosDeLosAjustes,
  fechaCorta,
  opcionesDeAjustes,
  rangoCorto,
  integracionConAjustes,
  integracionConCambios,
  resumenConAjustes,
  resumenDeLote,
} from './ci-ajustes.js'
import { pasoDeIntegracion, tareasDeLosPasos, grupoNuevo } from './ci-pasos.js'

const resumen = (extra = {}) => ({
  valido: true, areaDePlanificacion: 'STARBRANDS', version: 'PVSMD', comando: 'REPLACE', sistemaOrigen: 'PRD', sistemaDestino: 'IBP',
  condiciones: [{ campo: 'KEYFIGUREDATE', tipo: 'entre', desde: '20260101', hasta: '20271231' }],
  ...extra,
})
const integracion = (id, extra) => ({ id, name: `Integración ${id}`, folder: '', resumen: resumen(extra) })

describe('opcionesDeAjustes', () => {
  it('junta lo que ya usan las integraciones, sin repetir y ordenado', () => {
    const opciones = opcionesDeAjustes([
      integracion('a', { version: 'PV2', sistemaOrigen: 'QAS' }),
      integracion('b'),
      integracion('c', { version: '' }),
    ])
    expect(opciones.version).toEqual(['PV2', 'PVSMD'])
    expect(opciones.origen).toEqual(['PRD', 'QAS'])
    expect(opciones.destino).toEqual(['IBP'])
  })

  it('el comando siempre ofrece los dos conocidos, y los que se usen además', () => {
    expect(opcionesDeAjustes([]).comando).toEqual([...COMANDOS_CONOCIDOS])
    expect(opcionesDeAjustes([integracion('a', { comando: 'OTRO' })]).comando).toEqual(['INSERT_UPDATE', 'REPLACE', 'OTRO'])
  })

  it('ignora las integraciones con el body roto', () => {
    const opciones = opcionesDeAjustes([{ id: 'x', resumen: { valido: false, version: 'NO' } }, { id: 'y' }])
    expect(opciones.version).toEqual([])
  })
})

describe('cambios sobre un objeto de ajustes', () => {
  it('conCampo pone o quita, sin tocar lo demás ni lo recibido', () => {
    const original = { version: 'PV2', comando: 'REPLACE' }
    expect(conCampo(original, 'origen', 'QAS')).toEqual({ version: 'PV2', comando: 'REPLACE', origen: 'QAS' })
    expect(conCampo(original, 'comando', undefined)).toEqual({ version: 'PV2' })
    expect(conCampo(undefined, 'version', '')).toEqual({ version: '' })
    expect(original).toEqual({ version: 'PV2', comando: 'REPLACE' })
  })

  it('conFecha pone un lado, y vaciar los dos deja sin fechas', () => {
    const uno = conFecha({}, 'desde', '20260101')
    expect(uno).toEqual({ fechas: { desde: '20260101' } })
    const dos = conFecha(uno, 'hasta', '20261231')
    expect(dos).toEqual({ fechas: { desde: '20260101', hasta: '20261231' } })
    expect(conFecha(dos, 'desde', '')).toEqual({ fechas: { hasta: '20261231' } })
    expect(conFecha(conFecha(dos, 'desde', undefined), 'hasta', undefined)).toEqual({})
    expect(conFecha({ version: 'PV2' }, 'desde', '20260101')).toEqual({ version: 'PV2', fechas: { desde: '20260101' } })
  })

  it('conFiltro pone el ajuste de una condición, y con null la quita', () => {
    const una = conFiltro({}, 'MATTYPEID', { valores: ['ZNEW'] })
    expect(una).toEqual({ filtro: { MATTYPEID: { valores: ['ZNEW'] } } })
    const dos = conFiltro(una, 'KEYFIGUREDATE', { desde: '20260101' })
    expect(Object.keys(dos.filtro)).toEqual(['MATTYPEID', 'KEYFIGUREDATE'])
    expect(conFiltro(dos, 'MATTYPEID', null)).toEqual({ filtro: { KEYFIGUREDATE: { desde: '20260101' } } })
    expect(conFiltro(una, 'MATTYPEID', null)).toEqual({})
  })
})

describe('textos', () => {
  it('una fecha se lee DD-MM-AAAA; una variable o un texto, tal cual', () => {
    expect(fechaCorta('20260105')).toBe('05-01-2026')
    expect(fechaCorta('{{DESDE}}')).toBe('{{DESDE}}')
    expect(fechaCorta(undefined)).toBe('')
    expect(rangoCorto({ desde: '20260101', hasta: '{{HASTA}}' })).toBe('01-01-2026 → {{HASTA}}')
  })

  it('el resumen del lote dice lo que cambia, y está vacío si no cambia nada', () => {
    expect(resumenDeLote({})).toBe('')
    expect(resumenDeLote(undefined)).toBe('')
    expect(resumenDeLote({ version: 'PV2', comando: 'REPLACE', origen: 'QAS', destino: 'IBP2' })).toBe('Versión PV2 · Comando REPLACE · Origen QAS · Destino IBP2')
    expect(resumenDeLote({ version: '' })).toBe('Versión base')
    expect(resumenDeLote({ fechas: { desde: '20260301', hasta: '20260331' } })).toBe('Fechas 01-03-2026 → 31-03-2026')
    expect(resumenDeLote({ fechas: { hasta: '20260331' } })).toBe('Fechas … → 31-03-2026')
  })
})

describe('efectosDeLosAjustes', () => {
  const pasos = [
    { ...pasoDeIntegracion({ id: 'a', name: 'A' }, 'p1') },
    { ...grupoNuevo('g'), children: [{ ...pasoDeIntegracion({ id: 'b', name: 'B' }, 'p2'), ajustes: { version: 'PV3' } }, pasoDeIntegracion({ id: 'z', name: 'Z' }, 'p3')] },
  ]
  const porId = new Map([
    ['a', integracion('a')],
    ['b', integracion('b')],
    // Sin fecha en el filtro, y otra con el body roto.
    ['z', { id: 'z', name: 'Integración z', resumen: { valido: false, error: 'x' } }],
  ])

  it('dice, por cada integración, qué cambia y de quién viene', () => {
    const efectos = efectosDeLosAjustes(tareasDeLosPasos(pasos), porId, { version: 'PV2', fechas: { desde: '20260301' } })
    expect(efectos.map((e) => [e.numero, e.enGrupo, e.nombre])).toEqual([[1, false, 'Integración a'], [2, true, 'Integración b'], [2, true, 'Integración z']])
    // `a`: version y fecha vienen del lote; `b`: la versión es del paso y la fecha, del lote.
    expect(efectos[0]).toMatchObject({ delLote: 2, delPaso: 0 })
    expect(efectos[1]).toMatchObject({ delLote: 1, delPaso: 1 })
    // Con el body roto no hay qué resolver.
    expect(efectos[2]).toMatchObject({ resuelto: null, delLote: 0, delPaso: 0 })
  })

  it('resumenConAjustes deja el resumen como quedaría', () => {
    const efecto = efectosDeLosAjustes(tareasDeLosPasos(pasos), porId, { version: 'PV2', origen: 'QAS' })[0]
    expect(resumenConAjustes(efecto.integracion.resumen, efecto.resuelto)).toMatchObject({ version: 'PV2', sistemaOrigen: 'QAS', comando: 'REPLACE', sistemaDestino: 'IBP' })
    expect(resumenConAjustes({ valido: false }, null)).toEqual({ valido: false })
  })
})

describe('integracionConAjustes', () => {
  const base = integracion('a')

  it('es la integración como se enviaría, con lo que cambia', () => {
    const { efectiva, cambios } = integracionConAjustes(base, { ajustes: { comando: 'INSERT_UPDATE' } }, { version: 'PV2' })
    expect(efectiva.resumen).toMatchObject({ version: 'PV2', comando: 'INSERT_UPDATE', sistemaOrigen: 'PRD', sistemaDestino: 'IBP' })
    expect(cambios.map((c) => [c.clave, c.fuente])).toEqual([['version', 'orquestacion'], ['comando', 'paso']])
    // La integración original no se toca.
    expect(base.resumen).toMatchObject({ version: 'PVSMD', comando: 'REPLACE' })
  })

  it('sin ajustes es la misma integración y sin cambios', () => {
    const { efectiva, cambios } = integracionConAjustes(base, {}, {})
    expect(efectiva.resumen).toMatchObject({ version: 'PVSMD', comando: 'REPLACE' })
    expect(cambios).toEqual([])
  })

  it('sin integración o con el body roto no hay nada que ajustar', () => {
    expect(integracionConAjustes(undefined, { ajustes: { comando: 'X' } }, {})).toEqual({ efectiva: undefined, resuelto: null, cambios: [] })
    const rota = { id: 'z', resumen: { valido: false, error: 'x' } }
    expect(integracionConAjustes(rota, { ajustes: { comando: 'X' } }, {})).toEqual({ efectiva: rota, resuelto: null, cambios: [] })
  })
})

describe('integracionConCambios', () => {
  const base = integracion('a')

  it('deja la integración como quedó según lo anotado al enviarla', () => {
    const anotados = [
      { clave: 'version', de: 'PVSMD', a: 'PV2' },
      { clave: 'destino', de: 'IBP', a: 'IBP2' },
      { clave: 'filtro', campo: 'KEYFIGUREDATE', de: '20260101 → 20271231', a: '20260301 → 20260331' },
    ]
    expect(integracionConCambios(base, anotados).resumen).toMatchObject({ version: 'PV2', comando: 'REPLACE', sistemaOrigen: 'PRD', sistemaDestino: 'IBP2' })
    expect(base.resumen.version).toBe('PVSMD')
  })

  it('la versión base anotada es un valor vacío, no «sin cambio»', () => {
    expect(integracionConCambios(base, [{ clave: 'version', de: 'PVSMD', a: '' }]).resumen.version).toBe('')
  })

  it('sin cambios anotados, o con el body roto, no toca nada', () => {
    expect(integracionConCambios(base, undefined)).toEqual(base)
    expect(integracionConCambios(base, [])).toEqual(base)
    const rota = { id: 'z', resumen: { valido: false } }
    expect(integracionConCambios(rota, [{ clave: 'comando', a: 'X' }])).toBe(rota)
  })
})
