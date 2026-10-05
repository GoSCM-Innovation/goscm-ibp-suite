// @vitest-environment jsdom
//
// Los scripts pre/post-load del job, portados de `85666bd` de v9.
//
// Faltaban: el Integration Explorer de aquí no leía los scripts de ningún job. Se detectó en la
// revisión de paridad del 2026-10-05. Las pruebas cubren las tres capas: el parser, el buscador y los
// filtros que mira la pantalla.

import { describe, expect, it } from 'vitest'

import { parseIntegration, parseJobMetadata, parseJobScripts, parseXml } from './cids-export.js'
import { buildIndexes } from './integration-index.js'
import { baseFiltrada, filtrarIntegraciones, scriptsDe, tieneScripts } from './integration-view.js'

/** El `<Job>` de un XML con los elementos y conexiones que se le pasen. */
const jobDe = (interior) => parseXml(
  `<p xmlns:xmi="http://www.omg.org/XMI"><Job name="J">${interior}</Job></p>`,
).children[0]

const df = '<elements xmi:type="workflow:DataFlowReference" displayName="DF"/>'
const script = (nombre, extra = '') => `<elements xmi:type="workflow:Script" displayName="${nombre}" ${extra}/>`
const arista = (de, a) => `<connections sourceElement="/3/@elements.${de}" targetElement="/3/@elements.${a}"/>`

describe('parseJobScripts: pre o post', () => {
  it('por conexión: un script que apunta al dataflow es pre-load', () => {
    const job = jobDe(`${script('S')}${df}${arista(0, 1)}`)
    expect(parseJobScripts(job).map((s) => s.kind)).toEqual(['pre'])
  })

  it('por conexión: un script al que apunta el dataflow es post-load', () => {
    const job = jobDe(`${df}${script('S')}${arista(0, 1)}`)
    expect(parseJobScripts(job).map((s) => s.kind)).toEqual(['post'])
  })

  it('sin conexiones decide el nombre: POST', () => {
    expect(parseJobScripts(jobDe(script('NAME_SCRIPT_POSTLOAD')))[0].kind).toBe('post')
  })

  it('sin conexiones decide el nombre: PRE', () => {
    expect(parseJobScripts(jobDe(script('NAME_SCRIPT_PRELOAD')))[0].kind).toBe('pre')
  })

  it('el nombre manda sobre la posición', () => {
    // Está después del dataflow (posición de post) pero se llama PRE.
    const job = jobDe(`${df}${script('MI_PRE')}`)
    expect(parseJobScripts(job)[0].kind).toBe('pre')
  })

  it('sin conexiones ni pista en el nombre decide la posición', () => {
    expect(parseJobScripts(jobDe(`${script('A')}${df}`))[0].kind).toBe('pre')
    expect(parseJobScripts(jobDe(`${df}${script('A')}`))[0].kind).toBe('post')
  })

  it('si nada resuelve, queda vacío', () => {
    expect(parseJobScripts(jobDe(script('A')))[0].kind).toBe('')
  })

  it('un job sin <connections> no revienta', () => {
    expect(() => parseJobScripts(jobDe(`${script('A')}${df}`))).not.toThrow()
  })

  it('una conexión a medias se ignora', () => {
    const job = jobDe(`${script('A')}${df}<connections sourceElement="/3/@elements.0"/>`)
    expect(parseJobScripts(job)).toHaveLength(1)
  })
})

describe('parseJobScripts: lo que se lee', () => {
  it('trae el nombre, la descripción y el código', () => {
    const job = jobDe(script('SCRIPT_X', 'description="Limpia la tabla" expression="delete();"'))
    expect(parseJobScripts(job)[0]).toMatchObject({
      name: 'SCRIPT_X', description: 'Limpia la tabla', expression: 'delete();',
    })
  })

  it('devuelve los saltos de línea que el XML guarda como &#xA;', () => {
    const job = jobDe(script('S', 'expression="a;&#xA;b;"'))
    expect(parseJobScripts(job)[0].expression).toBe('a;\nb;')
  })

  // CI-DS crea el slot al abrir el editor de scripts aunque no se escriba nada.
  it('conserva un slot VACÍO', () => {
    const job = jobDe(script('NAME_SCRIPT_PRELOAD'))
    expect(parseJobScripts(job)).toEqual([
      { name: 'NAME_SCRIPT_PRELOAD', kind: 'pre', description: '', expression: '' },
    ])
  })

  it('un job sin scripts da una lista vacía', () => {
    expect(parseJobScripts(jobDe(df))).toEqual([])
  })

  it('solo mira lo que cuelga del job, no los elementos de dentro de un dataflow', () => {
    const job = jobDe(`${df}<DataFlow><elements xmi:type="workflow:Script" displayName="DENTRO"/></DataFlow>`)
    expect(parseJobScripts(job)).toEqual([])
  })
})

describe('los scripts llegan a cada integración', () => {
  const xml = `<p xmlns:xmi="http://www.omg.org/XMI">
    <DataStore name="ERP"/><DataStore name="IBP"/>
    <Job name="GOSCM_MD_PRODUCTO">
      ${script('NAME_SCRIPT_PRELOAD', 'expression="truncate();"')}
    </Job>
    <DataFlow name="DF1">
      <elements xmi:type="dataflow:TableLoader" displayName="Cargar" tableName="PRODUCT" referencedDataStore="//@DataStore/1"/>
    </DataFlow>
  </p>`

  it('parseJobMetadata los incluye', () => {
    expect(parseJobMetadata(parseXml(xml)).jobScripts).toHaveLength(1)
  })

  it('parseIntegration los pone en cada dataflow del job', () => {
    const integraciones = parseIntegration(xml)
    expect(integraciones.length).toBeGreaterThan(0)
    for (const una of integraciones) expect(una.jobScripts[0].name).toBe('NAME_SCRIPT_PRELOAD')
  })
})

describe('el buscador encuentra los scripts', () => {
  const base = {
    jobName: 'JOB', dataflowName: 'DF', srcDSName: '', dstDSName: '', targetTable: '',
    tipoIntegracion: 'MD', fileLoaderFileName: '', mappings: [], filters: [], lookups: [], variables: [],
  }
  const integraciones = [
    { ...base, _idx: 0, jobScripts: [{ name: 'NAME_SCRIPT_PRELOAD', kind: 'pre', description: '', expression: 'truncate_tabla();' }] },
    { ...base, _idx: 1, jobScripts: [] },
    { ...base, _idx: 2 },
  ]
  const indices = buildIndexes(integraciones)
  const buscar = (texto) => filtrarIntegraciones(integraciones, indices, texto).map((una) => una._idx)

  it('por el código', () => expect(buscar('truncate_tabla')).toEqual([0]))
  it('por el nombre del slot, aunque estuviera vacío', () => expect(buscar('name_script_preload')).toEqual([0]))
  it('una integración sin la lista (de antes de este cambio) no rompe el índice', () => {
    expect(buscar('job')).toEqual([0, 1, 2])
  })
})

describe('el filtro «Solo con script»', () => {
  const conCodigo = { _idx: 0, jobScripts: [{ name: 'A', kind: 'pre', expression: 'x();' }] }
  const vacio = { _idx: 1, jobScripts: [{ name: 'B', kind: 'pre', expression: '  \n ' }] }
  const sin = { _idx: 2, jobScripts: [] }
  const antiguo = { _idx: 3 }

  it('scriptsDe devuelve siempre una lista', () => {
    expect(scriptsDe(antiguo)).toEqual([])
    expect(scriptsDe(null)).toEqual([])
    expect(scriptsDe(vacio)).toHaveLength(1)
  })

  it('tieneScripts cuenta solo los que tienen contenido: un slot vacío no hace nada', () => {
    expect([conCodigo, vacio, sin, antiguo].map(tieneScripts)).toEqual([true, false, false, false])
  })

  it('con el filtro dejan pasar solo las que tienen contenido', () => {
    const lista = [conCodigo, vacio, sin, antiguo]
    expect(baseFiltrada(lista, { soloConScript: true }).map((una) => una._idx)).toEqual([0])
  })

  it('sin el filtro dejan pasar todas', () => {
    expect(baseFiltrada([conCodigo, vacio, sin], {})).toHaveLength(3)
  })
})
