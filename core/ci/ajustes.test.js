import { describe, expect, it } from 'vitest'
import {
  aplicarAjustes,
  contarAjustes,
  normalizarAjustes,
  resolverAjustes,
  sinAjustes,
  textosDeCambios,
  vistaDeBloque,
} from './ajustes.js'
import { aplicarVariables, resumenDeBody, variablesDeBody, variablesDeFechaDeBloque } from './body.js'

const bloque = (cambios = {}) => ({
  BatchCommand: 'REPLACE',
  PlanningArea: 'STARBRANDS',
  PlanningAreaVersion: 'PVSMD',
  DestinationforAddon: 'PRD',
  DestinationforSAPIBP: 'IBP',
  DataSource: 'ZIBP_PEDIDOSVTA_KF',
  FilterForTheDataSource: "AUART EQ 'ZVEX',MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',KEYFIGUREDATE BT '20260101' '20271231'",
  ...cambios,
})
const texto = (cambios) => JSON.stringify({ KEYFIGURE: bloque(cambios) }, null, 2)
const leer = (cuerpo) => JSON.parse(cuerpo).KEYFIGURE

describe('normalizarAjustes', () => {
  it('sin nada, vacío', () => {
    expect(normalizarAjustes(undefined)).toEqual({})
    expect(normalizarAjustes(null)).toEqual({})
    expect(normalizarAjustes({})).toEqual({})
  })

  it('deja lo que dice algo, sin espacios sobrantes', () => {
    expect(normalizarAjustes({
      version: ' PV2 ', comando: 'INSERT_UPDATE', origen: 'QAS', destino: 'IBP',
      fechas: { desde: '20260101', hasta: '{{HASTA}}' },
      filtro: { MATTYPEID: { valores: [' ZFER ', 'ZHAW'] }, KEYFIGUREDATE: { desde: '20260301', hasta: '20260331' } },
    })).toEqual({
      version: 'PV2', comando: 'INSERT_UPDATE', origen: 'QAS', destino: 'IBP',
      fechas: { desde: '20260101', hasta: '{{HASTA}}' },
      filtro: { MATTYPEID: { valores: ['ZFER', 'ZHAW'] }, KEYFIGUREDATE: { desde: '20260301', hasta: '20260331' } },
    })
  })

  it('la versión vacía es la BASE: se conserva, no es «sin cambio»', () => {
    expect(normalizarAjustes({ version: '' })).toEqual({ version: '' })
    expect(normalizarAjustes({ version: '   ' })).toEqual({ version: '' })
  })

  it('un comando, origen o destino vacío no vale', () => {
    for (const clave of ['comando', 'origen', 'destino']) {
      expect(() => normalizarAjustes({ [clave]: '' })).toThrow(/vacío/)
    }
  })

  it.each([
    [{ version: 5 }, /Versión: tiene que ser un texto/],
    [{ comando: "RE'PLACE" }, /Comando: lleva comillas/],
    [{ origen: 'A\\B' }, /Origen/],
    [{ destino: 'x'.repeat(201) }, /Destino: pasa de/],
    [{ fechas: { desde: '20261301' } }, /Fecha desde: tiene que ser una fecha/],
    [{ fechas: { hasta: 'mañana' } }, /Fecha hasta/],
    [{ fechas: { desde: '{{A}} y {{B}}' } }, /Fecha desde/],
    [{ fechas: 'x' }, /Fechas/],
    [{ filtro: { 'MAT TYPE': { valores: ['a'] } } }, /nombre de campo/],
    [{ filtro: { A: { valores: ["a'b"] } } }, /lleva comillas/],
    [{ filtro: { A: { valores: ['a,b'] } } }, /comillas simples ni comas/],
    [{ filtro: { A: { valores: [3] } } }, /tienen que ser texto/],
    [{ filtro: { KEYFIGUREDATE: { desde: 'x' } } }, /fecha/],
    [{ filtro: { A: {} } }, /falta «valores»/],
    [{ filtro: { A: 'x' } }, /tiene que ser un objeto/],
    [{ filtro: [] }, /Filtro/],
    [7, /objeto/],
  ])('rechaza %j', (entrada, mensaje) => {
    expect(() => normalizarAjustes(entrada)).toThrow(mensaje)
  })

  it('una condición del filtro que no es de fechas acepta un texto como límite', () => {
    expect(normalizarAjustes({ filtro: { ZFECHAX: { desde: 'A1', hasta: 'B9' } } })).toEqual({ filtro: { ZFECHAX: { desde: 'A1', hasta: 'B9' } } })
  })

  it('limpia lo vacío y lo desconocido', () => {
    expect(normalizarAjustes({
      fechas: {}, filtro: { A: { valores: ['', '  '] }, B: { desde: '', hasta: '' } }, raro: 1, comando: undefined,
    })).toEqual({})
  })

  it('pone tope al filtro', () => {
    const muchas = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`C${i}`, { valores: ['x'] }]))
    expect(() => normalizarAjustes({ filtro: muchas })).toThrow(/demasiadas condiciones/)
    expect(() => normalizarAjustes({ filtro: { A: { valores: Array.from({ length: 101 }, () => 'x') } } })).toThrow(/demasiados valores/)
  })

  it('normalizar dos veces da lo mismo', () => {
    const una = normalizarAjustes({ version: ' PV2 ', filtro: { A: { valores: [' x '] } } })
    expect(normalizarAjustes(una)).toEqual(una)
  })
})

describe('sinAjustes y contarAjustes', () => {
  it('cuentan lo que cambia', () => {
    expect(sinAjustes({})).toBe(true)
    expect(sinAjustes(undefined)).toBe(true)
    expect(sinAjustes({ version: '' })).toBe(false)
    expect(contarAjustes({})).toBe(0)
    expect(contarAjustes({ version: '', comando: 'REPLACE' })).toBe(2)
    expect(contarAjustes({ fechas: { desde: '20260101', hasta: '20261231' } })).toBe(2)
    expect(contarAjustes({ filtro: { A: { valores: ['x'] }, KEYFIGUREDATE: { desde: '20260101' } } })).toBe(2)
    expect(contarAjustes(null)).toBe(0)
  })
})

describe('resolverAjustes', () => {
  const vista = () => vistaDeBloque(bloque())

  it('sin ajustes no cambia nada', () => {
    const r = resolverAjustes(vista())
    expect(r.cambios).toEqual([])
    expect(r).toMatchObject({ version: 'PVSMD', comando: 'REPLACE', origen: 'PRD', destino: 'IBP' })
    expect(r.condiciones.every((c) => !c.cambiada)).toBe(true)
  })

  it('manda el más específico: el paso, luego el lote, luego la integración', () => {
    const r = resolverAjustes(vista(), { general: { version: 'PV2', comando: 'INSERT_UPDATE' }, paso: { comando: 'REPLACE', origen: 'QAS' } })
    expect(r).toMatchObject({ version: 'PV2', comando: 'REPLACE', origen: 'QAS', destino: 'IBP' })
    // El comando del paso es el original: no cambia nada, aunque el lote dijera otra cosa.
    expect(r.cambios.map((c) => [c.clave, c.fuente])).toEqual([['version', 'orquestacion'], ['origen', 'paso']])
  })

  it('un ajuste igual al original no cuenta como cambio', () => {
    expect(resolverAjustes(vista(), { general: { version: 'PVSMD', destino: 'IBP' } }).cambios).toEqual([])
  })

  it('la versión base («») es un valor: cambia desde una versión', () => {
    const r = resolverAjustes(vista(), { general: { version: '' } })
    expect(r.version).toBe('')
    expect(r.cambios).toEqual([{ clave: 'version', etiqueta: 'Versión', de: 'PVSMD', a: '', fuente: 'orquestacion' }])
    expect(textosDeCambios(r.cambios)).toEqual(['Versión: PVSMD → base'])
  })

  it('el filtro del paso cambia los valores de una condición, y solo esa', () => {
    const r = resolverAjustes(vista(), { paso: { filtro: { MATTYPEID: { valores: ['ZNEW'] } } } })
    const mat = r.condiciones.find((c) => c.campo === 'MATTYPEID')
    expect(mat).toMatchObject({ valores: ['ZNEW'], cambiada: true, fuente: 'paso', original: { valores: ['ZFER', 'ZHAW'] } })
    expect(r.condiciones.find((c) => c.campo === 'AUART').cambiada).toBe(false)
    expect(r.cambios).toEqual([{ clave: 'filtro', campo: 'MATTYPEID', etiqueta: 'MATTYPEID', de: 'ZFER, ZHAW', a: 'ZNEW', fuente: 'paso' }])
  })

  it('las fechas del lote van a KEYFIGUREDATE y a ninguna otra condición', () => {
    const r = resolverAjustes(vista(), { general: { fechas: { desde: '20260301', hasta: '20260331' } } })
    expect(r.fechas).toEqual([{ campo: 'KEYFIGUREDATE', original: { desde: '20260101', hasta: '20271231' }, efectivo: { desde: '20260301', hasta: '20260331' }, cambia: true, fuente: 'orquestacion' }])
    expect(r.condiciones.filter((c) => c.cambiada).map((c) => c.campo)).toEqual(['KEYFIGUREDATE'])
  })

  it('con solo un lado en el lote, el otro queda como en la integración', () => {
    const r = resolverAjustes(vista(), { general: { fechas: { hasta: '20261231' } } })
    expect(r.fechas[0].efectivo).toEqual({ desde: '20260101', hasta: '20261231' })
  })

  it('las fechas del paso mandan sobre las del lote, lado por lado', () => {
    const r = resolverAjustes(vista(), {
      general: { fechas: { desde: '20260301', hasta: '20260331' } },
      paso: { filtro: { KEYFIGUREDATE: { hasta: '20260630' } } },
    })
    expect(r.fechas[0]).toMatchObject({ efectivo: { desde: '20260301', hasta: '20260630' }, fuente: 'paso' })
  })

  it('una integración sin KEYFIGUREDATE no se ve afectada por las fechas del lote', () => {
    const sinFecha = vistaDeBloque(bloque({ FilterForTheDataSource: "AUART EQ 'ZVEX'" }))
    const r = resolverAjustes(sinFecha, { general: { fechas: { desde: '20260301', hasta: '20260331' } } })
    expect(r.fechas).toEqual([])
    expect(r.cambios).toEqual([])
  })

  it('una fecha de un solo valor (EQ) no es un rango y no se toca', () => {
    const unica = vistaDeBloque(bloque({ FilterForTheDataSource: "KEYFIGUREDATE EQ '20260101'" }))
    expect(resolverAjustes(unica, { general: { fechas: { desde: '20260301', hasta: '20260331' } } }).cambios).toEqual([])
  })

  it('el campo del filtro se reconoce sin distinguir mayúsculas', () => {
    const minusculas = vistaDeBloque(bloque({ FilterForTheDataSource: "keyfiguredate BT '20260101' '20271231'" }))
    expect(resolverAjustes(minusculas, { general: { fechas: { desde: '20260301' } } }).fechas[0].efectivo.desde).toBe('20260301')
  })

  it('un ajuste del paso que no encuentra su condición avisa y no cambia nada', () => {
    const r = resolverAjustes(vista(), { paso: { filtro: { ZVIGENTE: { valores: ['S'] } } } })
    expect(r.cambios).toEqual([])
    expect(r.avisos).toEqual(['El ajuste del filtro «ZVIGENTE» no se aplica: la integración ya no tiene esa condición.'])
  })

  it('una condición del paso de otra forma (rango sobre un campo de valores) tampoco se aplica', () => {
    const r = resolverAjustes(vista(), { paso: { filtro: { AUART: { desde: '1', hasta: '2' } } } })
    expect(r.condiciones.find((c) => c.campo === 'AUART').cambiada).toBe(false)
    expect(r.avisos).toHaveLength(1)
  })

  it('un campo repetido se ajusta en UNA sola fila (la primera)', () => {
    const repetido = vistaDeBloque(bloque({ FilterForTheDataSource: "A EQ 'x',B EQ 'y',A EQ 'z'" }))
    const r = resolverAjustes(repetido, { paso: { filtro: { A: { valores: ['n'] } } } })
    expect(r.condiciones.map((c) => c.valores.join())).toEqual(['n', 'y', 'z'])
  })

  it('lo que se está escribiendo (sin forma de ajuste) se ignora en vez de romper', () => {
    expect(() => resolverAjustes(vista(), { general: { version: 5, fechas: 'x', filtro: 3 }, paso: { filtro: { A: 'x' }, comando: '   ' } })).not.toThrow()
    expect(resolverAjustes(vista(), { general: { comando: '   ' } }).cambios).toEqual([])
  })

  it('una variable cuenta como valor', () => {
    const r = resolverAjustes(vista(), { general: { fechas: { desde: '{{DESDE}}' } } })
    expect(r.fechas[0].efectivo.desde).toBe('{{DESDE}}')
  })

  it('el resumen de una integración sirve tal cual como vista', () => {
    const resumen = resumenDeBody(texto())
    const r = resolverAjustes(resumen, { general: { version: 'PV2', fechas: { hasta: '20261231' } } })
    expect(r.cambios.map((c) => c.clave)).toEqual(['version', 'filtro'])
  })
})

describe('textosDeCambios', () => {
  it('escribe cada cambio como una frase corta', () => {
    const r = resolverAjustes(vistaDeBloque(bloque({ PlanningAreaVersion: '' })), { general: { version: 'PV2', comando: 'INSERT_UPDATE' } })
    expect(textosDeCambios(r.cambios)).toEqual(['Versión: base → PV2', 'Comando: REPLACE → INSERT_UPDATE'])
    expect(textosDeCambios(undefined)).toEqual([])
  })

  // Dos flechas seguidas («20260101 → 20271231 → 20260301 → 20260331») no se entienden: un rango se escribe «desde a hasta».
  it('un rango del filtro se lee «desde a hasta», con fechas como se ven en pantalla', () => {
    const cambio = (de, a) => ({ clave: 'filtro', campo: 'KEYFIGUREDATE', etiqueta: 'KEYFIGUREDATE', de, a, fuente: 'paso' })
    expect(textosDeCambios([cambio('20260101 → 20271231', '20260301 → 20260331')])).toEqual(['KEYFIGUREDATE: 01-01-2026 a 31-12-2027 → 01-03-2026 a 31-03-2026'])
    // Una variable o un texto que no es fecha, tal cual.
    expect(textosDeCambios([cambio('20260101 → 20271231', '{{DESDE}} → {{HASTA}}')])).toEqual(['KEYFIGUREDATE: 01-01-2026 a 31-12-2027 → {{DESDE}} a {{HASTA}}'])
    expect(textosDeCambios([cambio('A1 → B9', 'A2 → B8')])).toEqual(['KEYFIGUREDATE: A1 a B9 → A2 a B8'])
    // Los valores de una condición de igualdad no cambian.
    expect(textosDeCambios([{ clave: 'filtro', campo: 'MATTYPEID', etiqueta: 'MATTYPEID', de: 'ZFER, ZHAW', a: 'ZFER', fuente: 'paso' }])).toEqual(['MATTYPEID: ZFER, ZHAW → ZFER'])
  })
})

describe('aplicarAjustes', () => {
  it('sin ajustes devuelve el texto TAL CUAL, sin reescribirlo', () => {
    const crudo = '{"KEYFIGURE":   {"BatchCommand":"REPLACE"}}'
    expect(aplicarAjustes(crudo, {})).toEqual({ texto: crudo, cambios: [], avisos: [] })
    expect(aplicarAjustes(crudo, { general: {}, paso: {} }).texto).toBe(crudo)
  })

  it('un ajuste igual al original tampoco reescribe nada', () => {
    const original = texto()
    expect(aplicarAjustes(original, { general: { comando: 'REPLACE', version: 'PVSMD' } }).texto).toBe(original)
  })

  it('cambia los campos pedidos y deja el resto intacto', () => {
    const { texto: nuevo, cambios } = aplicarAjustes(texto(), { general: { version: 'PV2', comando: 'INSERT_UPDATE', origen: 'QAS', destino: 'IBP2' } })
    expect(leer(nuevo)).toEqual(bloque({ PlanningAreaVersion: 'PV2', BatchCommand: 'INSERT_UPDATE', DestinationforAddon: 'QAS', DestinationforSAPIBP: 'IBP2' }))
    expect(cambios.map((c) => c.clave)).toEqual(['version', 'comando', 'origen', 'destino'])
    // El orden de las claves es el que tenía el body.
    expect(Object.keys(leer(nuevo))).toEqual(Object.keys(bloque()))
  })

  it('el paso manda sobre el lote', () => {
    const { texto: nuevo } = aplicarAjustes(texto(), { general: { version: 'PV2' }, paso: { version: 'PV3' } })
    expect(leer(nuevo).PlanningAreaVersion).toBe('PV3')
  })

  it('la versión base deja el campo vacío', () => {
    expect(leer(aplicarAjustes(texto(), { paso: { version: '' } }).texto).PlanningAreaVersion).toBe('')
  })

  it('un body sin ese campo lo agrega', () => {
    const sinVersion = JSON.stringify({ K: { BatchCommand: 'REPLACE' } })
    expect(JSON.parse(aplicarAjustes(sinVersion, { general: { version: 'PV2' } }).texto).K).toEqual({ BatchCommand: 'REPLACE', PlanningAreaVersion: 'PV2' })
  })

  it('cambia las fechas del lote y deja el resto del filtro tal cual', () => {
    const { texto: nuevo } = aplicarAjustes(texto(), { general: { fechas: { desde: '20260301', hasta: '20260331' } } })
    expect(leer(nuevo).FilterForTheDataSource).toBe("AUART EQ 'ZVEX',MATTYPEID EQ 'ZFER',MATTYPEID EQ 'ZHAW',KEYFIGUREDATE BT '20260301' '20260331'")
  })

  it('cambia los valores de una condición del paso: el resto del filtro y su orden no se tocan', () => {
    const { texto: nuevo } = aplicarAjustes(texto(), { paso: { filtro: { MATTYPEID: { valores: ['ZNEW', 'ZOLD', 'ZMID'] } } } })
    expect(leer(nuevo).FilterForTheDataSource).toBe("AUART EQ 'ZVEX',MATTYPEID EQ 'ZNEW',MATTYPEID EQ 'ZOLD',MATTYPEID EQ 'ZMID',KEYFIGUREDATE BT '20260101' '20271231'")
  })

  it('lo que el filtro tiene y no se entiende se conserva tal cual', () => {
    const raro = texto({ FilterForTheDataSource: "AUART EQ 'ZVEX',ALGO RARO(1),KEYFIGUREDATE BT '20260101' '20271231'" })
    const { texto: nuevo } = aplicarAjustes(raro, { general: { fechas: { hasta: '20261231' } } })
    expect(leer(nuevo).FilterForTheDataSource).toBe("AUART EQ 'ZVEX',ALGO RARO(1),KEYFIGUREDATE BT '20260101' '20261231'")
  })

  it('una variable como fecha queda en el body y se pide al ejecutar', () => {
    const { texto: nuevo } = aplicarAjustes(texto(), { general: { fechas: { desde: '{{DESDE}}', hasta: '{{HASTA}}' } } })
    expect(variablesDeBody(nuevo)).toEqual(['DESDE', 'HASTA'])
    // Y las dos son fechas: se piden con calendario.
    expect(variablesDeFechaDeBloque(leer(nuevo))).toEqual(['DESDE', 'HASTA'])
    expect(JSON.parse(aplicarVariables(nuevo, { DESDE: '20260501', HASTA: '20260531' })).KEYFIGURE.FilterForTheDataSource)
      .toContain("KEYFIGUREDATE BT '20260501' '20260531'")
  })

  it('una variable que el body original usaba y el ajuste reemplaza deja de pedirse', () => {
    const conVariables = texto({ FilterForTheDataSource: "KEYFIGUREDATE BT '{{DESDE}}' '{{HASTA}}'" })
    expect(variablesDeBody(conVariables)).toEqual(['DESDE', 'HASTA'])
    const { texto: nuevo } = aplicarAjustes(conVariables, { general: { fechas: { desde: '20260301', hasta: '20260331' } } })
    expect(variablesDeBody(nuevo)).toEqual([])
  })

  it('aplicar dos veces da lo mismo que una', () => {
    const ajustes = { general: { version: 'PV2', fechas: { desde: '20260301' } }, paso: { filtro: { AUART: { valores: ['ZNEW'] } } } }
    const una = aplicarAjustes(texto(), ajustes)
    expect(aplicarAjustes(una.texto, ajustes).texto).toBe(una.texto)
    expect(aplicarAjustes(una.texto, ajustes).cambios).toEqual([])
  })

  it('devuelve los avisos de un ajuste que ya no tiene a qué aplicarse, sin tocar el body', () => {
    const resultado = aplicarAjustes(texto(), { paso: { filtro: { ZVIGENTE: { valores: ['S'] } } } })
    expect(resultado.texto).toBe(texto())
    expect(resultado.avisos).toHaveLength(1)
  })

  it('unos ajustes que no valen NO se aplican: lanzan, y así no se envía nada', () => {
    expect(() => aplicarAjustes(texto(), { general: { comando: "x'y" } })).toThrow(/Comando/)
    expect(() => aplicarAjustes(texto(), { paso: { filtro: { A: { valores: ['a,b'] } } } })).toThrow(/comas/)
  })

  it('un body que no se puede leer lanza', () => {
    expect(() => aplicarAjustes('{ no', { general: { version: 'PV2' } })).toThrow(/JSON válido/)
  })

  it('el valor de una variable de fecha ya enviado no se mezcla con los ajustes: valores con comilla no entran', () => {
    expect(() => aplicarAjustes(texto(), { general: { fechas: { desde: "20260101' OR '1" } } })).toThrow(/Fecha desde/)
  })
})
