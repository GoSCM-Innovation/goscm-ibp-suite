// @vitest-environment jsdom
//
// El Mapping Dataflow Generator con la forma de v9 (revisión de paridad del 2026-10-05): la pantalla de
// arriba abajo, los tres modos, el log, la selección, el resultado y la descarga.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const entrada = (hoja, extra = {}) => ({
  sheetName: hoja,
  pkg: 'PROYECTO.zip',
  parsed: {
    jobName: hoja,
    dataflowName: `DF_${hoja}`,
    dataflowGuid: `guid-${hoja}`,
    tipoIntegracion: 'MD',
    targetTable: 'PRODUCT',
    mappings: [{ dstField: 'PRDID', dstDesc: '', ibpType: '', ibpExample: '' }],
    filters: [{ expression: 'x' }],
    lookups: [],
    variables: [],
  },
  paramRow: {
    sheetName: hoja, jobName: hoja, jobDesc: '', tipoIntegracion: 'MD', dataflowName: `DF_${hoja}`,
    srcDS: 'ERP', dstDS: 'IBP', atlSession: '', atlGroup: '',
  },
  ...extra,
})

const scanForDocument = vi.fn()
const buildWorkbook = vi.fn()
vi.mock('../../../lib/cids-doc.js', async (original) => ({
  ...(await original()),
  scanForDocument: (...args) => scanForDocument(...args),
  buildWorkbook: (...args) => buildWorkbook(...args),
}))

const fetchCatalog = vi.fn()
const fetchTaskIndex = vi.fn()
const fetchJobTemplates = vi.fn()
const fetchJobSteps = vi.fn()
vi.mock('../../../lib/ibp.js', () => ({
  listIbpConnections: vi.fn(async () => [{ id: 'i1', name: 'IBP CLARO QA' }]),
  fetchCatalog: (...args) => fetchCatalog(...args),
  fetchTaskIndex: (...args) => fetchTaskIndex(...args),
  fetchJobTemplates: (...args) => fetchJobTemplates(...args),
  fetchJobSteps: (...args) => fetchJobSteps(...args),
  fetchSampleRow: vi.fn(async () => ({ row: { PRDID: 'P1' }, detail: '' })),
  fetchFieldExample: vi.fn(async () => null),
  claveDeTarea: (nombre) => String(nombre ?? '').trim().toUpperCase(),
  nombreDeJob: (job) => job?.JobTemplateText || job?.JobTemplateName || '',
  plantillaDe: (job) => ({ templateName: job.JobTemplateName, templateVersion: String(job.JobTemplateVersion ?? '0') }),
}))

const { default: MappingDocumenter } = await import('./MappingDocumenter.jsx')

let contenedor
let raiz

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(MappingDocumenter))
  })
  await act(async () => { await Promise.resolve() })
}

const texto = () => contenedor.textContent
const boton = (parte) => [...contenedor.querySelectorAll('button')].find((b) => b.textContent.includes(parte))
const pulsar = (nodo) => act(async () => { nodo.click() })
const poner = (nodo, valor, prototipo = HTMLInputElement.prototype) => act(async () => {
  Object.getOwnPropertyDescriptor(prototipo, 'value').set.call(nodo, valor)
  nodo.dispatchEvent(new Event(prototipo === HTMLSelectElement.prototype ? 'change' : 'input', { bubbles: true }))
})

/** Sube un archivo al dropzone que acepta `extension`. */
async function subir(extension, nombre, contenido = 'x') {
  const campo = [...contenedor.querySelectorAll('input[type=file]')].find((una) => una.accept.includes(extension))
  const archivo = new File([contenido], nombre)
  Object.defineProperty(campo, 'files', { value: [archivo], configurable: true })
  await act(async () => { campo.dispatchEvent(new Event('change', { bubbles: true })) })
  await vi.waitFor(() => { if (!contenedor.textContent.includes(nombre)) throw new Error(`falta ${nombre}`) })
}

beforeEach(() => {
  scanForDocument.mockReset()
  buildWorkbook.mockReset()
  fetchCatalog.mockReset()
  fetchTaskIndex.mockReset()
  fetchJobTemplates.mockReset()
  fetchJobSteps.mockReset()
  scanForDocument.mockResolvedValue({ entradas: [entrada('JOB_A'), entrada('JOB_B')], errores: [] })
  buildWorkbook.mockResolvedValue(new ArrayBuffer(8))
  fetchCatalog.mockResolvedValue({ descs: { PRDID: 'Id' }, types: {}, entitySets: [], entityProps: {}, planAreas: ['SAP1'], fallados: [] })
  if (!File.prototype.arrayBuffer) File.prototype.arrayBuffer = async function arrayBuffer() { return new ArrayBuffer(2048) }
  if (!File.prototype.text) File.prototype.text = async function text() { return 'CREATE PLAN P' }
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

describe('la pantalla, de arriba abajo', () => {
  it('trae el banner, la conexión, los tres modos, el avance, el Pro tip y el log', async () => {
    await montar()
    const t = texto()
    expect(t).toContain('Generador de Mapping Dataflow para tareas de integración de SAP CI-DS')
    expect(t).toContain('🔌 Conexión SAP IBP')
    expect(t).toContain('(opcional · solo para modos con Jobs)')
    expect(t).toContain('Pro tip:')
    expect(t).toContain('📋 Log de procesamiento')
    expect(t).toContain('Sube un ZIP para comenzar')
    expect([...contenedor.querySelectorAll('.docs-modos button')].map((b) => b.textContent)).toEqual([
      '📦 Desde archivos ZIP', '🔄 Desde Application Jobs', '🔗 ZIP + Jobs',
    ])
  })

  it('el orden es el de v9: banner · conexión · modos · avance · pro tip · paneles', async () => {
    await montar()
    const t = texto()
    const posiciones = ['Generador de Mapping', 'Conexión SAP IBP', 'Desde archivos ZIP', 'Subir ZIPs', 'Pro tip', 'Archivos ZIP de entrada']
      .map((parte) => t.indexOf(parte))
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b))
    expect(posiciones.every((p) => p >= 0)).toBe(true)
  })

  it('el selector de Planning Area lleva su etiqueta y arranca apagado', async () => {
    await montar()
    expect(texto()).toContain('Planning Area (para los ejemplos de datos)')
    const select = [...contenedor.querySelectorAll('select')].at(-1)
    expect(select.disabled).toBe(true)
    expect(select.options[0].textContent).toBe('— conecta para cargar —')
  })

  it('modo ZIP: panel de ZIP con «?», botón de analizar apagado y panel de ATL opcional', async () => {
    await montar()
    expect(texto()).toContain('📦 Archivos ZIP de entrada')
    expect(texto()).toContain('Arrastra los ZIP aquí')
    expect(texto()).toContain('📋 Archivos ATL (opcional)')
    expect(boton('Analizar Integraciones').disabled).toBe(true)
    expect(contenedor.querySelector('.docs-ayuda img').getAttribute('src')).toBe('/ci-ds-export.png')
  })

  it('el avance de cada modo tiene sus pasos', async () => {
    await montar()
    const pasos = () => [...contenedor.querySelectorAll('.step-label')].map((p) => p.textContent)
    expect(pasos()).toEqual(['Subir ZIPs', 'ATL opcional', 'Seleccionar', 'Generar Excel'])
    await pulsar(boton('Desde Application Jobs'))
    expect(pasos()).toEqual(['Obtener Jobs', 'Seleccionar', 'Generar Excel'])
    await pulsar(boton('ZIP + Jobs'))
    expect(pasos()).toEqual(['Subir ZIPs', 'Analizar', 'Seleccionar', 'Generar Excel'])
  })
})

describe('el modo ZIP', () => {
  const analizar = async () => {
    await montar()
    await subir('.zip', 'PROYECTO.zip')
    await pulsar(boton('Analizar Integraciones'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Selección de integraciones')) throw new Error('falta la selección') })
  }

  it('subir el primer ZIP avanza el paso', async () => {
    await montar()
    await subir('.zip', 'PROYECTO.zip')
    expect(contenedor.querySelector('.stepper-step.completed .step-label').textContent).toBe('Subir ZIPs')
    expect(boton('Analizar Integraciones').disabled).toBe(false)
  })

  it('al analizar, la selección sale DEBAJO y los paneles de carga SIGUEN a la vista', async () => {
    await analizar()
    expect(texto()).toContain('✅ Selección de integraciones')
    expect(texto()).toContain('📦 Archivos ZIP de entrada')
    expect(texto()).toContain('📋 Archivos ATL (opcional)')
    expect(texto()).not.toContain('Volver a empezar')
  })

  it('el log cuenta lo que pasó, con los textos de v9', async () => {
    await analizar()
    const t = texto()
    expect(t).toContain('📦 Escaneando ZIPs…')
    expect(t).toContain('  ✔ JOB_A  (1 mapeos · 1 filtros · 0 lookups)')
    expect(t).toContain('✅ Escaneado — 2 integraciones encontradas')
    expect(t).not.toContain('Sube un ZIP para comenzar')
  })

  it('cada integración lleva casilla marcada, insignia de tipo, nombre, dataflow y ZIP', async () => {
    await analizar()
    const fila = contenedor.querySelector('.docs-sel-item')
    expect(fila.querySelector('input').checked).toBe(true)
    expect(fila.querySelector('.docs-sel-badge').textContent).toBe('MD')
    expect(fila.textContent).toContain('JOB_A')
    expect(fila.textContent).toContain('DF_JOB_A')
    expect(fila.querySelector('.docs-sel-pkg').textContent).toBe('PROYECTO.zip')
  })

  it('el contador y los botones son los de v9, y el filtro solo toca lo visible', async () => {
    await analizar()
    expect(contenedor.querySelector('.docs-sel-barra .exp-counter').textContent).toBe('2 / 2 seleccionadas')

    await poner(contenedor.querySelector('.docs-sel-barra input'), 'job_a')
    expect(contenedor.querySelector('.docs-sel-barra .exp-counter').textContent).toBe('1 / 1 filtradas · 2 / 2 total')

    await pulsar(boton('Desactivar filtradas'))
    expect(contenedor.querySelector('.docs-sel-barra .exp-counter').textContent).toBe('0 / 1 filtradas · 1 / 2 total')

    await pulsar(boton('Activar filtradas'))
    expect(contenedor.querySelector('.docs-sel-barra .exp-counter').textContent).toBe('1 / 1 filtradas · 2 / 2 total')
  })

  it('«Generar Excel» NO descarga: saca el panel de resultado con sus tres contadores', async () => {
    await analizar()
    await pulsar(boton('Generar Excel'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('📊 Resultado')) throw new Error('falta el resultado') })

    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
    const numeros = [...contenedor.querySelectorAll('.docs-stat-num')].map((n) => n.textContent)
    expect(numeros).toEqual(['2', '2', '2'])
    expect(texto()).toContain('✅ Listo — 2 jobs · 2 mapeos · 2 filtros')
    expect(texto()).toContain('⬇️ Descargar Excel')
  })

  it('«⬇️ Descargar Excel» baja el archivo con el nombre de v9', async () => {
    await analizar()
    await pulsar(boton('Generar Excel'))
    await vi.waitFor(() => { if (!boton('⬇️ Descargar Excel')) throw new Error('falta el botón') })

    const enlace = { click: vi.fn(), set href(v) { this._h = v }, set download(v) { this._d = v } }
    const crear = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((etiqueta) => (etiqueta === 'a' ? enlace : crear(etiqueta)))
    await pulsar(boton('⬇️ Descargar Excel'))
    document.createElement.mockRestore()

    expect(enlace.click).toHaveBeenCalled()
    expect(enlace._d).toMatch(/^SAP_CIDS_Documentacion_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('sin nada marcado avisa y no genera', async () => {
    await analizar()
    await pulsar(boton('Desactivar filtradas'))
    await pulsar(boton('Generar Excel'))
    expect(texto()).toContain('⚠ No hay integraciones seleccionadas.')
    expect(buildWorkbook).not.toHaveBeenCalled()
  })

  it('el ATL se aplica al GENERAR (se puede añadir después de analizar) y no reordena', async () => {
    await analizar()
    await subir('.atl', 'proceso.atl', 'CREATE PLAN P ( BEGIN CALL DATAFLOW DF_JOB_B::\'guid-JOB_B\' ( ); END ) CREATE SESSION S1 ( BEGIN CALL PLAN P::\'x\' ( ); END )')
    await pulsar(boton('Generar Excel'))
    await vi.waitFor(() => { if (!buildWorkbook.mock.calls.length) throw new Error('no se generó') })

    const filas = buildWorkbook.mock.calls[0][0]
    expect(filas.map((una) => una.sheetName)).toEqual(['JOB_A', 'JOB_B'])
    // Lo que el ATL no menciona sale con el grupo vacío, no con «Sin grupo ATL».
    expect(filas[0].paramRow.atlGroup).toBe('')
  })
})

describe('con una conexión de IBP', () => {
  const usarConexion = async () => {
    const select = contenedor.querySelector('.docs-conexion-rejilla select')
    await poner(select, 'i1', HTMLSelectElement.prototype)
    await pulsar(boton('Usar conexión'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('✓ Conexión cargada')) throw new Error('falta la conexión') })
  }

  it('«Usar conexión» sin elegir una avisa', async () => {
    await montar()
    await pulsar(boton('Usar conexión'))
    expect(texto()).toContain('Elige una conexión.')
  })

  it('carga las planning areas y dice cuántas', async () => {
    await montar()
    await usarConexion()
    expect(texto()).toContain('✓ Conexión cargada para IBP CLARO QA.')
    expect(texto()).toContain('1 planning areas cargadas — elige una para los ejemplos.')
    const select = [...contenedor.querySelectorAll('select')].at(-1)
    expect(select.disabled).toBe(false)
    expect(select.options[0].textContent).toBe('— elegir —')
  })

  it('un catálogo que falla no impide generar y lo dice', async () => {
    fetchCatalog.mockRejectedValue(new Error('sin permiso'))
    await montar()
    await poner(contenedor.querySelector('.docs-conexion-rejilla select'), 'i1', HTMLSelectElement.prototype)
    await pulsar(boton('Usar conexión'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('No se pudo leer el catálogo')) throw new Error('falta el error') })
    expect(texto()).toContain('sin permiso')
  })

  it('al generar con catálogo, el log cuenta lo de IBP', async () => {
    await montar()
    await usarConexion()
    await subir('.zip', 'PROYECTO.zip')
    await pulsar(boton('Analizar Integraciones'))
    await vi.waitFor(() => { if (!boton('Generar Excel')) throw new Error('falta generar') })
    await pulsar(boton('Generar Excel'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('✅ Listo')) throw new Error('no terminó') })

    const t = texto()
    expect(t).toContain('✔ 1 descripciones de campos obtenidas de IBP')
    expect(t).toContain('↺ Backfill desde cache')
  })

  it('sin catálogo avisa que se usarán las descripciones del XML', async () => {
    await montar()
    await subir('.zip', 'PROYECTO.zip')
    await pulsar(boton('Analizar Integraciones'))
    await vi.waitFor(() => { if (!boton('Generar Excel')) throw new Error('falta generar') })
    await pulsar(boton('Generar Excel'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('✅ Listo')) throw new Error('no terminó') })
    expect(texto()).toContain('⚠ Sin conexión a IBP — se usarán descripciones del XML')
  })
})

describe('el modo ZIP + Jobs', () => {
  const entrarAlModo = async () => {
    await montar()
    await pulsar(boton('ZIP + Jobs'))
  }

  it('pide solo los ZIP, con su descripción y su botón', async () => {
    await entrarAlModo()
    expect(texto()).toContain('enriquece automáticamente')
    expect(texto()).toContain('JobTemplateSequenceSet')
    expect(boton('Analizar ZIPs + Enriquecer con Jobs IBP').disabled).toBe(true)
    // No se eligen jobs ni se sube ATL.
    expect(texto()).not.toContain('Selección de Jobs')
    expect(texto()).not.toContain('Archivos ATL')
  })

  it('sin conexión analiza igual y avisa que Job/Step quedan vacíos', async () => {
    await entrarAlModo()
    await subir('.zip', 'PROYECTO.zip')
    await pulsar(boton('Analizar ZIPs'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Selección de integraciones')) throw new Error('falta la selección') })
    expect(texto()).toContain('ℹ Sin conexión a IBP — las columnas Job/Step quedarán vacías.')
    expect(fetchTaskIndex).not.toHaveBeenCalled()
  })

  it('con conexión empareja cada tarea por su task ID y lo cuenta en el log', async () => {
    fetchTaskIndex.mockResolvedValue({ JOB_A: [{ jobName: 'Carga diaria', template: 'T', stepName: 'Paso 1', stepPos: 3, stepType: 'DATA INTEGRATION' }] })
    await entrarAlModo()
    await poner(contenedor.querySelector('.docs-conexion-rejilla select'), 'i1', HTMLSelectElement.prototype)
    await pulsar(boton('Usar conexión'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('✓ Conexión cargada')) throw new Error('falta la conexión') })

    await subir('.zip', 'PROYECTO.zip')
    await pulsar(boton('Analizar ZIPs'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Selección de integraciones')) throw new Error('falta la selección') })

    const t = texto()
    expect(t).toContain('  📌 "JOB_A" → Job: "Carga diaria" (pos 3)')
    expect(t).toContain('  ⚠ "JOB_B" sin match en IBP')
    expect(t).toContain('✔ Match: 1 encontrados · 1 sin match')

    await pulsar(boton('Generar Excel'))
    await vi.waitFor(() => { if (!buildWorkbook.mock.calls.length) throw new Error('no se generó') })
    const [filas, opciones] = buildWorkbook.mock.calls[0]
    expect(opciones.modoJobs).toBe(true)
    expect(filas[0].paramRow).toMatchObject({ ibpJobName: 'Carga diaria', ibpStepName: 'Paso 1', ibpStepType: 'DATA INTEGRATION' })
    expect(texto()).toContain('✅ Listo — 2 integraciones · 2 mapeos · 2 filtros')
  })
})

describe('el modo Application Jobs', () => {
  const JOBS = [
    { JobTemplateName: 'YY1_AAA', JobTemplateVersion: '1', JobTemplateText: 'Datos maestros' },
    { JobTemplateName: 'YY1_BBB', JobTemplateVersion: '1', JobTemplateText: 'Transaccional' },
  ]

  const conConexion = async () => {
    await montar()
    await pulsar(boton('Desde Application Jobs'))
    await poner(contenedor.querySelector('.docs-conexion-rejilla select'), 'i1', HTMLSelectElement.prototype)
    await pulsar(boton('Usar conexión'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('✓ Conexión cargada')) throw new Error('falta la conexión') })
  }

  it('arranca con el panel de «Obtener Application Jobs» y la guía del Communication Arrangement', async () => {
    await montar()
    await pulsar(boton('Desde Application Jobs'))
    expect(texto()).toContain('🔄 Application Jobs desde SAP IBP')
    expect(texto()).toContain('🔧 Configuración: Communication Arrangement')
    expect(texto()).toContain('SAP_COM_0326')
    // Los paneles de ATL y ZIP salen DESPUÉS de obtener los jobs.
    expect(texto()).not.toContain('Archivos ATL de procesos CI-DS')
  })

  it('sin conexión avisa', async () => {
    await montar()
    await pulsar(boton('Desde Application Jobs'))
    await pulsar(boton('Obtener Application Jobs'))
    expect(texto()).toContain('⚠ Debes conectarte a SAP IBP primero.')
  })

  it('obtiene los jobs, los lista SIN marcar y saca los paneles de ATL y ZIP', async () => {
    fetchJobTemplates.mockResolvedValue(JOBS)
    await conConexion()
    await pulsar(boton('Obtener Application Jobs'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Selección de Jobs')) throw new Error('falta la lista') })

    expect(texto()).toContain('✔ 2 jobs obtenidos')
    expect(contenedor.querySelectorAll('.docs-sel-item input:checked')).toHaveLength(0)
    expect(contenedor.querySelector('.docs-sel-barra .exp-counter').textContent).toBe('0 / 2 seleccionados')
    expect(texto()).toContain('📄 Archivos ATL de procesos CI-DS')
    expect(texto()).toContain('📦 Archivos ZIP de integraciones CI-DS')
    expect(texto()).toContain('Los mismos exports de CI-DS que usarías en el modo ZIP')
    expect(boton('Analizar y Generar').disabled).toBe(true)
  })

  it('«Analizar y Generar» produce el Excel directo, sin lista de integraciones', async () => {
    fetchJobTemplates.mockResolvedValue(JOBS)
    fetchJobSteps.mockResolvedValue({
      pasos: [[{ pos: 1, text: 'JOB_A', jceText: 'DATA INTEGRATION', taskId: 'JOB_A', tpl: 'YY1_AAA', ver: '1', seqName: 'S1' }], []],
      avisoDeTaskId: '',
    })
    await conConexion()
    await pulsar(boton('Obtener Application Jobs'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Selección de Jobs')) throw new Error('falta la lista') })

    await pulsar(contenedor.querySelector('.docs-sel-item input'))
    await subir('.zip', 'PROYECTO.zip')
    expect(boton('Analizar y Generar').disabled).toBe(false)
    await pulsar(boton('Analizar y Generar'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('📊 Resultado')) throw new Error('falta el resultado') })

    expect(texto()).not.toContain('Selección de integraciones')
    expect(texto()).toContain('📋 1 jobs seleccionados')
    expect(texto()).toContain('  ✔ Datos maestros: 1 pasos')
    expect(texto()).toContain('  ✔ 1 task IDs resueltos via P_TSKID')
    // Solo se documenta lo que el job ejecuta: JOB_B no está en ningún paso.
    expect(texto()).toContain('✔ 1 integraciones documentadas (solo las presentes en el job)')
    const [filas, opciones] = buildWorkbook.mock.calls[0]
    expect(opciones.modoJobs).toBe(true)
    expect(filas.filter((una) => !una.isNonDI).map((una) => una.sheetName)).toEqual(['JOB_A'])
  })

  it('las filas que no son de integración entran como informativas', async () => {
    fetchJobTemplates.mockResolvedValue(JOBS)
    fetchJobSteps.mockResolvedValue({
      pasos: [[{ pos: 1, text: 'Copiar versión', jceText: 'COPY VERSION', taskId: '', tpl: 'YY1_AAA', ver: '1', seqName: 'S1' }], []],
      avisoDeTaskId: '',
    })
    await conConexion()
    await pulsar(boton('Obtener Application Jobs'))
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Selección de Jobs')) throw new Error('falta la lista') })
    await pulsar(contenedor.querySelector('.docs-sel-item input'))
    await subir('.zip', 'PROYECTO.zip')
    await pulsar(boton('Analizar y Generar'))
    await vi.waitFor(() => { if (!buildWorkbook.mock.calls.length) throw new Error('no se generó') })

    const filas = buildWorkbook.mock.calls[0][0]
    expect(filas.some((una) => una.isNonDI)).toBe(true)
  })
})
