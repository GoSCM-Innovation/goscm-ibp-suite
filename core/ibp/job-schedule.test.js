import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../transport/sap-fetch.js', () => ({ sapFetch: vi.fn() }))

const { sapFetch } = await import('../transport/sap-fetch.js')
const {
  etiquetaDeParametro,
  nombreBase,
  numeroDeRanura,
  pasoDesdeSecuencia,
  tieneValor,
} = await import('./job-params.js')
const { readJobTemplateSet, readTemplateDetail, scheduleJob } = await import('./job-schedule.js')

const BASE = 'https://tenant-api.scmibp1.ondemand.com'
const cred = { user: 'u', password: 'p' }

beforeEach(() => { sapFetch.mockReset() })

describe('nombreBase', () => {
  // SAP pega un sufijo para distinguir instancias; el nombre real son ocho caracteres.
  it('se queda con los ocho primeros, sin espacios de relleno', () => {
    expect(nombreBase('P_FLTID ')).toBe('P_FLTID')
    expect(nombreBase('S_MATNR0001')).toBe('S_MATNR0')
    expect(nombreBase('P_VERS')).toBe('P_VERS')
  })

  it('sin nombre no revienta', () => {
    expect(nombreBase(undefined)).toBe('')
  })
})

describe('numeroDeRanura', () => {
  it('reconoce las ranuras de variable', () => {
    expect(numeroDeRanura('P_VARN01')).toBe(1)
    expect(numeroDeRanura('P_VARV15')).toBe(15)
  })

  it('lo que no es una ranura devuelve cero', () => {
    expect(numeroDeRanura('P_VARNO')).toBe(0)
    expect(numeroDeRanura('P_VERS')).toBe(0)
  })
})

describe('etiquetaDeParametro', () => {
  it('la etiqueta de la plantilla gana a la nuestra', () => {
    expect(etiquetaDeParametro('P_VERS', { P_VERS: 'Mi versión' })).toBe('Mi versión')
  })

  // Las de v8, en inglés: son los nombres que SAP IBP da a esos campos en su propia pantalla.
  it('sin etiqueta propia usa la conocida, la de v8', () => {
    expect(etiquetaDeParametro('P_FLTID')).toBe('Planning Filter')
    expect(etiquetaDeParametro('P_VERS')).toBe('Version')
  })

  // Faltaban en la primera versión del puerto y son las de los trabajos de integración con CI-DS.
  it('conoce las etiquetas de integración de v8', () => {
    expect(etiquetaDeParametro('P_ISPRD')).toBe('Production')
    expect(etiquetaDeParametro('P_TSKID')).toBe('Task Name')
    expect(etiquetaDeParametro('P_URCTX')).toBe('URL Context')
    expect(etiquetaDeParametro('P_CMD')).toBe('Batch Command')
  })

  it('busca por el nombre base, sin el sufijo de instancia', () => {
    expect(etiquetaDeParametro('P_TSKID 0001')).toBe('Task Name')
  })

  // Sin esto la pantalla enseñaría el nombre técnico y nadie sabría qué es.
  it('un parámetro desconocido se muestra por su nombre base', () => {
    expect(etiquetaDeParametro('P_RAROXX')).toBe('P_RAROXX')
  })
})

describe('tieneValor', () => {
  it('una casilla vale si está marcada', () => {
    expect(tieneValor({ name: 'P_PRM', isCheckbox: true }, { P_PRM: ['X'] })).toBe(true)
    expect(tieneValor({ name: 'P_PRM', isCheckbox: true }, { P_PRM: [] })).toBe(false)
  })

  // `0` y `00000000` son ranuras que SAP rellena, no valores que alguien puso.
  it('los rellenos de SAP no cuentan como valor', () => {
    expect(tieneValor({ name: 'P_DATE' }, { P_DATE: ['00000000'] })).toBe(false)
    expect(tieneValor({ name: 'P_DATE' }, { P_DATE: ['0'] })).toBe(false)
    expect(tieneValor({ name: 'P_DATE' }, { P_DATE: ['20260806'] })).toBe(true)
  })

  it('sin valores no tiene valor', () => {
    expect(tieneValor({ name: 'X' }, {})).toBe(false)
  })
})

describe('pasoDesdeSecuencia', () => {
  const secuencia = {
    basic_jce_name: '/IBP/HCI_DI',
    seq_param_val: [
      { name: 'P_VERS', label: 'Versión', value: [{ low: '__BASE' }] },
      { name: 'P_OCULTO', hidden: true, value: [{ low: 'x' }] },
      { name: 'P_VARNO', value: [{ low: '1' }] },
      { name: 'P_VARN01', value: [{ low: 'ACTIVA' }] },
      { name: 'P_VARN02', value: [{ low: '' }] },
    ],
  }

  it('junta los valores por nombre base', () => {
    expect(pasoDesdeSecuencia(secuencia, 1).valores.P_VERS).toEqual(['__BASE'])
  })

  it('los parámetros ocultos no se muestran', () => {
    expect(pasoDesdeSecuencia(secuencia, 1).params.map((uno) => uno.name)).not.toContain('P_OCULTO')
  })

  // Una plantilla declara quince ranuras aunque use una: enseñar catorce vacías sería ilegible.
  it('solo se muestran las ranuras de variable activas', () => {
    const nombres = pasoDesdeSecuencia(secuencia, 1).params.map((uno) => uno.name)
    expect(nombres).toContain('P_VARN01')
    expect(nombres).not.toContain('P_VARN02')
  })

  it('usa el texto del catálogo cuando lo hay', () => {
    const paso = pasoDesdeSecuencia(secuencia, 2, { textosDeCatalogo: { '/IBP/HCI_DI': 'Integración' } })
    expect(paso).toMatchObject({ posicion: 2, titulo: 'Integración' })
  })

  it('sin texto de catálogo se queda con el nombre técnico', () => {
    expect(pasoDesdeSecuencia(secuencia, 1).titulo).toBe('/IBP/HCI_DI')
  })
})

describe('readTemplateDetail', () => {
  /** Responde según qué entidad pide cada llamada. */
  const responder = ({ plantilla, grupos = [], secuencias = [], sueltos = [] }) => {
    sapFetch.mockImplementation(({ url }) => {
      if (url.includes('JobTemplateRead')) {
        if (!plantilla) return Promise.reject(new Error('no permitido'))
        return Promise.resolve({ json: { d: { TemplateData: JSON.stringify(plantilla) } } })
      }
      if (url.includes('JobTemplateParamGroupSet')) return Promise.resolve({ json: { d: { results: grupos } } })
      if (url.includes('JobTemplateSequenceSet')) return Promise.resolve({ json: { d: { results: secuencias } } })
      return Promise.resolve({ json: { d: { results: sueltos } } })
    })
  }

  it('arma los pasos desde la plantilla', async () => {
    responder({
      plantilla: { templates: [{ sequences: [{ basic_jce_name: '/IBP/X', seq_position: 1, seq_param_val: [{ name: 'P_VERS', value: [{ low: 'V1' }] }] }] }] },
      secuencias: [{ JobSequencePosition: 1, JobSequenceText: 'Cargar' }],
    })

    const detalle = await readTemplateDetail({ baseUrl: BASE, credentials: cred, templateName: 'T' })
    expect(detalle.completo).toBe(true)
    expect(detalle.pasos[0]).toMatchObject({ posicion: 1, nombre: 'Cargar' })
    expect(detalle.pasos[0].valores.P_VERS).toEqual(['V1'])
  })

  // Hay plantillas donde `JobTemplateRead` no está permitido; sin el respaldo la pantalla quedaría
  // en blanco justo en las que más se lanzan. Como en v8: un paso por cada secuencia declarada,
  // todos con los mismos valores sueltos.
  it('si no puede leer la plantilla, arma un paso por secuencia con los valores sueltos', async () => {
    responder({
      plantilla: null,
      secuencias: [
        { JobSequencePosition: 2, JobSequenceText: 'Segundo', BasicJobCatalogEntryName: '/IBP/HCI_DI', JceText: 'Data Integration' },
        { JobSequencePosition: 1, BasicJobCatalogEntryName: '/IBP/HCI_DI' },
      ],
      sueltos: [
        { JobTemplateParameterName: 'P_VERS', Low: 'V1' },
        { JobTemplateParameterName: 'P_VERS', Low: 'V2' },
        { JobTemplateParameterName: 'P_ISPRD', Low: 'X' },
      ],
    })

    const detalle = await readTemplateDetail({ baseUrl: BASE, credentials: cred, templateName: 'T' })
    expect(detalle.completo).toBe(false)
    expect(detalle.pasos.map((uno) => uno.posicion)).toEqual([1, 2])
    expect(detalle.pasos[1]).toMatchObject({ nombre: 'Segundo', titulo: 'Data Integration', catalogo: '/IBP/HCI_DI' })
    // Sin texto del tipo de paso, su nombre técnico; sin nombre propio, `null`.
    expect(detalle.pasos[0]).toMatchObject({ nombre: null, titulo: '/IBP/HCI_DI' })
    expect(detalle.pasos[0].valores.P_VERS).toEqual(['V1', 'V2'])
    // Un parámetro que aparece dos veces se lista una.
    expect(detalle.pasos[0].params.map((uno) => uno.name)).toEqual(['P_VERS', 'P_ISPRD'])
    // «Production» es la casilla que v8 reconocía sin la plantilla.
    expect(detalle.pasos[0].params[1]).toMatchObject({ label: 'Production', isCheckbox: true, group: null })
  })

  it('sin secuencias declaradas no hay pasos, aunque haya valores sueltos', async () => {
    responder({ plantilla: null, sueltos: [{ JobTemplateParameterName: 'P_VERS', Low: 'V1' }] })
    expect((await readTemplateDetail({ baseUrl: BASE, credentials: cred, templateName: 'T' })).pasos).toEqual([])
  })

  it('una plantilla sin nada devuelve cero pasos, no un error', async () => {
    responder({ plantilla: null, sueltos: [] })
    expect((await readTemplateDetail({ baseUrl: BASE, credentials: cred, templateName: 'T' })).pasos).toEqual([])
  })
})

describe('readJobTemplateSet', () => {
  // Es la consulta de «Job Templates» de v8: la entidad directamente, sin leer antes el $metadata.
  it('lee JobTemplateSet directamente, todas las plantillas', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { results: [{ JobTemplateName: '/IBP/X' }, { JobTemplateName: 'YY1_Y' }] } } })

    const filas = await readJobTemplateSet({ baseUrl: BASE, credentials: cred })

    expect(sapFetch).toHaveBeenCalledTimes(1)
    expect(sapFetch.mock.calls[0][0].url).toContain('/JobTemplateSet?$format=json')
    expect(sapFetch.mock.calls[0][0].url).not.toContain('$metadata')
    expect(filas.map((una) => una.JobTemplateName)).toEqual(['/IBP/X', 'YY1_Y'])
  })
})

describe('scheduleJob', () => {
  it('lanza por POST con plantilla, texto y usuario', async () => {
    sapFetch.mockResolvedValueOnce({ json: { d: { JobName: 'J1', JobRunCount: '7' } } })

    const salida = await scheduleJob({
      baseUrl: BASE, credentials: cred, templateName: 'MI_PLANTILLA', jobText: 'Carga de prueba', jobUser: 'USER',
    })

    const llamada = sapFetch.mock.calls[0][0]
    expect(llamada.method).toBe('POST')
    const url = decodeURIComponent(llamada.url)
    expect(url).toContain("JobTemplateName='MI_PLANTILLA'")
    expect(url).toContain("JobText='Carga de prueba'")
    expect(url).toContain("JobUser='USER'")
    expect(salida).toEqual({ ok: true, jobName: 'J1', jobRunCount: '7' })
  })

  it('sin texto usa el nombre de la plantilla', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await scheduleJob({ baseUrl: BASE, credentials: cred, templateName: 'T' })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("JobText='T'")
  })

  // Una comilla sin escapar cambiaría la llamada entera.
  it('escapa las comillas', async () => {
    sapFetch.mockResolvedValueOnce({ json: {} })
    await scheduleJob({ baseUrl: BASE, credentials: cred, templateName: 'T', jobText: "O'Brien" })
    expect(decodeURIComponent(sapFetch.mock.calls[0][0].url)).toContain("JobText='O''Brien'")
  })

  it('sin plantilla no llega a SAP', async () => {
    await expect(scheduleJob({ baseUrl: BASE, credentials: cred })).rejects.toThrow(/Falta la plantilla/)
    expect(sapFetch).not.toHaveBeenCalled()
  })
})
