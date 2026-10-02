import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  armarAppJobs,
  conjuntosDeDatoMaestro,
  contarEntidad,
  contarTipos,
  entidadesDeJobs,
  leerAppJobs,
  resolverEntidades,
} = await import('./pa-doc-live.js')

const BASE = 'https://tenant-api.scmibp1.ondemand.com'
const CREDENCIALES = { user: 'u', password: 'p' }

beforeEach(() => { sapFetch.mockReset() })

describe('conjuntosDeDatoMaestro', () => {
  it('lee los conjuntos del documento del servicio, que es liviano', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { EntitySets: ['PRODUCT', 'LOCATION'] } } })

    expect(await conjuntosDeDatoMaestro({ baseUrl: BASE, credentials: CREDENCIALES }))
      .toEqual(['PRODUCT', 'LOCATION'])
    expect(sapFetch).toHaveBeenCalledTimes(1)
    expect(sapFetch.mock.calls[0][0].url).toContain('/MASTER_DATA_API_SRV/')
  })

  // v7 leía el $metadata; si el documento del servicio no trae nada se hace lo mismo.
  it('si el documento no trae conjuntos, cae al $metadata', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { EntitySets: [] } } })
      .mockResolvedValueOnce({ text: '<edmx><EntitySet Name="PRODUCT"/></edmx>' })

    expect(await conjuntosDeDatoMaestro({ baseUrl: BASE, credentials: CREDENCIALES })).toEqual(['PRODUCT'])
    expect(sapFetch.mock.calls[1][0].url).toContain('$metadata')
  })

  it('un permiso que falta no se esconde tras el respaldo', async () => {
    const fallo = Object.assign(new Error('SAP devolvió 403'), { status: 403 })
    sapFetch.mockRejectedValueOnce(fallo)

    await expect(conjuntosDeDatoMaestro({ baseUrl: BASE, credentials: CREDENCIALES })).rejects.toBe(fallo)
    expect(sapFetch).toHaveBeenCalledTimes(1)
  })
})

describe('resolverEntidades', () => {
  it('cruza por nombre exacto sin distinguir mayúsculas', () => {
    expect(resolverEntidades(['product', 'LOCATION', 'VIRTUAL'], ['PRODUCT', 'Location']))
      .toEqual({ product: 'PRODUCT', LOCATION: 'Location', VIRTUAL: null })
  })

  it('no inventa entidades parecidas', () => {
    expect(resolverEntidades(['PRODUCT'], ['PRODUCTTrans'])).toEqual({ PRODUCT: null })
  })
})

describe('contarEntidad', () => {
  it('pide una fila con el total y lee d.__count', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { __count: '1234', results: [] } } })

    expect(await contarEntidad({ baseUrl: BASE, credentials: CREDENCIALES, entidad: 'PRODUCT' })).toBe(1234)
    expect(sapFetch.mock.calls[0][0].url).toContain('PRODUCT?$format=json&$top=1&$inlinecount=allpages')
  })

  it('un total que no es número queda en null', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: {} } })
    expect(await contarEntidad({ baseUrl: BASE, credentials: CREDENCIALES, entidad: 'X' })).toBeNull()
  })

  it('un fallo de lectura queda en null: no tumba a los demás tipos', async () => {
    sapFetch.mockRejectedValueOnce(new Error('boom'))
    expect(await contarEntidad({ baseUrl: BASE, credentials: CREDENCIALES, entidad: 'X' })).toBeNull()
  })

  it('el cero es un cero, no un null', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { __count: '0' } } })
    expect(await contarEntidad({ baseUrl: BASE, credentials: CREDENCIALES, entidad: 'X' })).toBe(0)
  })
})

describe('contarTipos', () => {
  it('cuenta los tipos con entidad y deja en null los que no tienen', async () => {
    sapFetch.mockImplementation(async ({ url }) => ({
      json: { d: { __count: url.includes('/PRODUCT?') ? '10' : '20' } },
    }))

    const cuentas = await contarTipos({
      baseUrl: BASE,
      credentials: CREDENCIALES,
      ids: ['PRODUCT', 'LOCATION', 'SIN_ENTIDAD'],
      conjuntos: ['PRODUCT', 'LOCATION'],
    })

    expect(cuentas).toEqual({ PRODUCT: 10, LOCATION: 20, SIN_ENTIDAD: null })
  })

  // El manual de IBP recomienda unos seis en paralelo: más tumba al servicio, menos tarda de más.
  it('nunca hay más de seis lecturas a la vez', async () => {
    let enCurso = 0
    let maximo = 0
    sapFetch.mockImplementation(async () => {
      enCurso += 1
      maximo = Math.max(maximo, enCurso)
      await new Promise((listo) => { setTimeout(listo, 5) })
      enCurso -= 1
      return { json: { d: { __count: '1' } } }
    })

    const ids = Array.from({ length: 25 }, (nada, i) => `T${i}`)
    const cuentas = await contarTipos({ baseUrl: BASE, credentials: CREDENCIALES, ids, conjuntos: ids })

    expect(Object.keys(cuentas)).toHaveLength(25)
    expect(maximo).toBe(6)
  })

  it('sin conjuntos dados, los pide al servicio', async () => {
    sapFetch
      .mockResolvedValueOnce({ json: { d: { EntitySets: ['PRODUCT'] } } })
      .mockResolvedValueOnce({ json: { d: { __count: '7' } } })

    expect(await contarTipos({ baseUrl: BASE, credentials: CREDENCIALES, ids: ['PRODUCT'] }))
      .toEqual({ PRODUCT: 7 })
  })

  it('sin tipos no llama a nadie', async () => {
    expect(await contarTipos({ baseUrl: BASE, credentials: CREDENCIALES, ids: [], conjuntos: [] })).toEqual({})
    expect(sapFetch).not.toHaveBeenCalled()
  })
})

describe('entidadesDeJobs', () => {
  it('prefiere los nombres exactos', () => {
    expect(entidadesDeJobs(['JobTemplateSequenceSet', 'JobTemplateSet', 'Otra']))
      .toEqual({ plantillas: 'JobTemplateSet', pasos: 'JobTemplateSequenceSet' })
  })

  it('si no hay exactos, el que termina parecido', () => {
    expect(entidadesDeJobs(['MyJobTemplate', 'MySequences']))
      .toEqual({ plantillas: 'MyJobTemplate', pasos: 'MySequences' })
  })

  it('si no hay nada, los nombres por omisión de v7', () => {
    expect(entidadesDeJobs([])).toEqual({ plantillas: 'JobTemplateSet', pasos: 'JobTemplateSequenceSet' })
  })
})

describe('armarAppJobs', () => {
  const plantillas = [
    { JobTemplateName: 'ZB', JobTemplateText: 'Carga B' },
    { JobTemplateName: 'ZA' },
    { JobTemplateName: 'ZA' },
    { JobTemplateName: '/IBP/ESTANDAR', JobTemplateText: 'De SAP' },
  ]
  const pasos = [
    { JobTemplateName: 'ZB', JobSequencePosition: 2, JobSequenceText: 'Segundo', JceText: 'COPY OPERATOR' },
    { JobTemplateName: 'ZB', JobSequencePosition: 1, JobSequenceText: 'Primero', JceText: 'Data Integration' },
    { JobTemplateName: 'ZA', JobSequencePosition: '1', JobSequenceName: 'NOMBRE', JceText: '' },
    { JobSequencePosition: 9, JceText: 'sin plantilla' },
  ]
  const jobs = armarAppJobs(plantillas, pasos)

  // v7 no filtra las plantillas estándar: documenta todas.
  it('lista todas las plantillas, sin repetidos y por nombre', () => {
    expect(jobs.map((una) => una.name)).toEqual(['/IBP/ESTANDAR', 'ZA', 'ZB'])
  })

  it('el texto es el de la plantilla o, si no tiene, su nombre', () => {
    expect(jobs.find((una) => una.name === 'ZB').text).toBe('Carga B')
    expect(jobs.find((una) => una.name === 'ZA').text).toBe('ZA')
  })

  it('los pasos van por posición y el tipo de paso se conserva', () => {
    const zb = jobs.find((una) => una.name === 'ZB')
    expect(zb.steps.map((paso) => paso.pos)).toEqual([1, 2])
    expect(zb.steps[1].type).toBe('COPY OPERATOR')
  })

  it('un paso de integración de datos se marca como CI-DS, sin distinguir mayúsculas', () => {
    const zb = jobs.find((una) => una.name === 'ZB')
    expect(zb.steps[0].cids).toBe(true)
    expect(zb.steps[1].cids).toBe(false)
  })

  it('el nombre del paso cae al nombre de la secuencia', () => {
    expect(jobs.find((una) => una.name === 'ZA').steps[0].name).toBe('NOMBRE')
  })

  it('una plantilla sin pasos sale con la lista vacía', () => {
    expect(jobs.find((una) => una.name === '/IBP/ESTANDAR').steps).toEqual([])
  })

  it('sin plantillas, la lista sale de los pasos', () => {
    expect(armarAppJobs([], pasos).map((una) => una.name)).toEqual(['ZA', 'ZB'])
  })

  it('sin nada no hay jobs', () => {
    expect(armarAppJobs([], [])).toEqual([])
  })
})

describe('leerAppJobs', () => {
  const xml = '<edmx><EntitySet Name="JobTemplateSet"/><EntitySet Name="JobTemplateSequenceSet"/></edmx>'

  it('lee el catálogo, las plantillas y los pasos del servicio de Application Jobs', async () => {
    sapFetch
      .mockResolvedValueOnce({ text: xml })
      .mockResolvedValueOnce({ json: { d: { results: [{ JobTemplateName: 'ZA', JobTemplateText: 'Uno' }] } } })
      .mockResolvedValueOnce({
        json: { d: { results: [{ JobTemplateName: 'ZA', JobSequencePosition: 1, JceText: 'DATA INTEGRATION' }] } },
      })

    const { entidades, jobs } = await leerAppJobs({ baseUrl: BASE, credentials: CREDENCIALES })

    expect(entidades).toEqual({ plantillas: 'JobTemplateSet', pasos: 'JobTemplateSequenceSet' })
    expect(jobs).toEqual([{
      name: 'ZA', text: 'Uno', steps: [{ pos: 1, name: '', type: 'DATA INTEGRATION', cids: true }],
    }])
    expect(sapFetch.mock.calls[1][0].url).toContain('/JobTemplateSet?$top=50000&$format=json')
  })

  // `fetchAllPages` de v7 trataba un 404 de entidad como «sin datos» y seguía.
  it('una entidad que no existe (404) cuenta como vacía', async () => {
    sapFetch
      .mockResolvedValueOnce({ text: xml })
      .mockRejectedValueOnce(Object.assign(new Error('SAP devolvió 404'), { status: 404 }))
      .mockResolvedValueOnce({ json: { d: { results: [{ JobTemplateName: 'ZA' }] } } })

    const { jobs } = await leerAppJobs({ baseUrl: BASE, credentials: CREDENCIALES })
    expect(jobs.map((una) => una.name)).toEqual(['ZA'])
  })

  it('cualquier otro fallo sube', async () => {
    sapFetch
      .mockResolvedValueOnce({ text: xml })
      .mockRejectedValueOnce(Object.assign(new Error('SAP devolvió 403'), { status: 403 }))

    await expect(leerAppJobs({ baseUrl: BASE, credentials: CREDENCIALES })).rejects.toThrow('403')
  })
})
