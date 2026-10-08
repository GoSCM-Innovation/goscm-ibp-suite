// @vitest-environment jsdom
//
// El Integration Explorer con la forma y los textos de v9 (revisión de paridad del 2026-10-05):
// la lista de la izquierda, el detalle de una dimensión y la pantalla entera.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CONEXIONES_CIDS = [{ id: 'c1', name: 'CLARO CO', isProduction: false }]
const CONEXIONES_IBP = [{ id: 'i1', name: 'IBP CLARO QA', isProduction: false }]

vi.mock('../../../lib/cids.js', () => ({
  cidsTargets: (lista) => lista.flatMap((una) => [
    { id: `${una.id}:sandbox`, connectionId: una.id, production: false, name: una.name, label: `${una.name} · Sandbox` },
    { id: `${una.id}:production`, connectionId: una.id, production: true, name: una.name, label: `${una.name} · Productivo` },
  ]),
  listCidsConnections: vi.fn(async () => CONEXIONES_CIDS),
  fetchPromotedTaskNames: vi.fn(async () => new Set(['JOB_A'])),
}))
vi.mock('../../../lib/ibp.js', () => ({
  claveDeTarea: (nombre) => String(nombre).toUpperCase(),
  listIbpConnections: vi.fn(async () => CONEXIONES_IBP),
  fetchTaskIndex: vi.fn(async () => ({ JOB_A: [{ template: 'T', jobName: 'JOB IBP', stepName: 'S1', stepPos: 1, stepType: 'DI' }] })),
}))

const integracion = (idx, extra = {}) => ({
  _idx: idx,
  _zipName: 'p.zip',
  jobName: `JOB_${idx}`,
  jobDesc: '',
  dataflowName: `DF_${idx}`,
  targetTable: 'PRODUCT',
  tipoIntegracion: 'MD',
  srcDSName: 'ERP',
  dstDSName: 'IBP',
  planArea: 'SAP1',
  mappings: [
    { srcDS: 'ERP', srcTable: 'MARA', srcField: 'MATNR', dstTable: 'PRODUCT', dstField: 'PRDID', dstDesc: 'Id', ops: '' },
  ],
  filters: [],
  lookups: [],
  variables: [],
  diagram: { nodes: [], edges: [] },
  jobScripts: [],
  ...extra,
})

const analisis = (integraciones, extra = {}) => ({
  integraciones,
  errores: [],
  cadenas: [],
  indices: {
    searchTokens: integraciones.map((una) => ({ idx: una._idx, tokens: `${una.jobName} mara matnr`.toLowerCase() })),
    byDstTable: { 'IBP::PRODUCT': integraciones.map((una) => ({ intIdx: una._idx, mIdx: 0 })) },
    byDstField: { PRDID: integraciones.map((una) => ({ intIdx: una._idx, mIdx: 0 })) },
  },
  ...extra,
})

vi.mock('../../../lib/integration-index.js', async (original) => ({
  ...(await original()),
  analyzeProject: vi.fn(),
}))

const { default: ExplorerMaster } = await import('./ExplorerMaster.jsx')
const { default: DimensionDetail } = await import('./DimensionDetail.jsx')
const { default: IntegrationExplorer } = await import('./IntegrationExplorer.jsx')
const { analyzeProject } = await import('../../../lib/integration-index.js')

let contenedor
let raiz

async function montar(elemento) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(elemento)
  })
}

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

const lista = (props) => createElement(ExplorerMaster, {
  dimension: 'integracion',
  integraciones: [],
  entradas: [],
  cadenas: [],
  transportadas: null,
  indiceDeJobs: null,
  enConflicto: null,
  seleccion: null,
  claveElegida: null,
  onElegirIntegracion: () => {},
  onElegirClave: () => {},
  ...props,
})

describe('la lista de la izquierda', () => {
  it('la primera línea va en el orden de v9: tipo · ✓ · IBP · 📜 · nombre', async () => {
    const una = integracion(0, { jobName: 'JOB_A', jobScripts: [{ name: 'S', kind: 'pre', expression: 'x();' }] })
    await montar(lista({
      integraciones: [una],
      transportadas: new Set(['JOB_A']),
      indiceDeJobs: { JOB_A: [{ template: 'T' }] },
    }))

    const linea = contenedor.querySelector('.exp-item-name')
    const orden = [...linea.children].map((nodo) => nodo.className.split(' ')[0])
    expect(orden).toEqual(['exp-type', 'exp-promoted', 'exp-ibp-badge', 'exp-script-badge'])
    expect(linea.textContent).toContain('JOB_A')
  })

  it('la insignia IBP solo sale si el índice de IBP trae la tarea', async () => {
    await montar(lista({ integraciones: [integracion(0, { jobName: 'JOB_A' })], indiceDeJobs: { OTRA: [{}] } }))
    expect(contenedor.querySelector('.exp-ibp-badge')).toBeNull()
  })

  it('los títulos de las marcas son los de v9', async () => {
    await montar(lista({
      integraciones: [integracion(0, { jobName: 'JOB_A' })],
      transportadas: new Set(['JOB_A']),
      indiceDeJobs: { JOB_A: [{}] },
      enConflicto: new Set([0]),
      cadenas: [{ from: 0, to: 1, via: 'table' }],
    }))
    expect(contenedor.querySelector('.exp-promoted').title).toBe('Promovido a producción')
    expect(contenedor.querySelector('.exp-ibp-badge').title).toBe('🔌 SAP IBP · Jobs y Steps')
    expect(contenedor.querySelector('.exp-chain-marks span').title).toBe('Alimenta a (table)')
    expect(contenedor.querySelector('.exp-warn').title).toContain('Posible conflicto entre la cadena de datos')
  })

  it('el ⚠ va DESPUÉS de las flechas de cadena', async () => {
    await montar(lista({
      integraciones: [integracion(0)],
      enConflicto: new Set([0]),
      cadenas: [{ from: 0, to: 1, via: 'table' }],
    }))
    const clases = [...contenedor.querySelector('.exp-item-name').children].map((nodo) => nodo.className.split(' ')[0])
    expect(clases.indexOf('exp-chain-marks')).toBeLessThan(clases.indexOf('exp-warn'))
  })

  it('con varios ZIP, cada proyecto nace plegado y dice «nombre (N)»', async () => {
    await montar(lista({
      integraciones: [integracion(0, { _zipName: 'A.zip' }), integracion(1, { _zipName: 'B.zip' })],
    }))
    const cabeceras = [...contenedor.querySelectorAll('.exp-project-head')].map((uno) => uno.textContent)
    expect(cabeceras[0]).toContain('A (1)')
    expect(contenedor.querySelector('.exp-item')).toBeNull()
  })

  it('el proyecto que contiene la integración elegida nace abierto', async () => {
    await montar(lista({
      integraciones: [integracion(0, { _zipName: 'A.zip' }), integracion(1, { _zipName: 'B.zip' })],
      seleccion: 1,
    }))
    expect(contenedor.querySelectorAll('.exp-item')).toHaveLength(1)
  })

  it('el proyecto que contiene la integración elegida se puede plegar', async () => {
    const integraciones = [integracion(0, { _zipName: 'A.zip' }), integracion(1, { _zipName: 'B.zip' })]
    await montar(lista({ integraciones, seleccion: 1 }))

    const cabeceraB = [...contenedor.querySelectorAll('.exp-project-head')].find((una) => una.textContent.includes('B ('))
    await act(async () => { cabeceraB.click() })
    expect(contenedor.querySelectorAll('.exp-item')).toHaveLength(0)
    expect(cabeceraB.textContent).toContain('▶')

    // Volver a dibujar con la MISMA selección (un filtro que cambia, por ejemplo) no lo reabre.
    await act(async () => { raiz.render(lista({ integraciones: [...integraciones], seleccion: 1 })) })
    expect(contenedor.querySelectorAll('.exp-item')).toHaveLength(0)
  })

  it('elegir algo de un proyecto plegado (saltar a una vecina) lo abre', async () => {
    const integraciones = [integracion(0, { _zipName: 'A.zip' }), integracion(1, { _zipName: 'B.zip' })]
    await montar(lista({ integraciones, seleccion: 1 }))
    await act(async () => { raiz.render(lista({ integraciones, seleccion: 0 })) })
    expect(contenedor.querySelectorAll('.exp-item.active')).toHaveLength(1)
  })

  it('una tarea con varios dataflows se puede plegar aunque contenga la elegida', async () => {
    const integraciones = [integracion(0, { jobName: 'JOB_X' }), integracion(1, { jobName: 'JOB_X' })]
    await montar(lista({ integraciones, seleccion: 1 }))
    expect(contenedor.querySelectorAll('.exp-item.child')).toHaveLength(2)

    await act(async () => { contenedor.querySelector('.exp-task-head').click() })
    expect(contenedor.querySelectorAll('.exp-item.child')).toHaveLength(0)
  })

  it('sin integraciones dice lo de v9', async () => {
    await montar(lista({}))
    expect(contenedor.textContent).toBe('No se encontraron integraciones')
  })

  it('una dimensión de tabla muestra el nombre y, abajo, «DS · N integraciones · M mapeos»', async () => {
    await montar(lista({
      dimension: 'dst-table',
      entradas: [{ clave: 'IBP::PRODUCT', etiqueta: 'IBP · PRODUCT', filas: [{ intIdx: 0, mIdx: 0 }, { intIdx: 0, mIdx: 1 }, { intIdx: 1, mIdx: 0 }] }],
    }))
    expect(contenedor.querySelector('.exp-item-name').textContent).toBe('PRODUCT')
    expect(contenedor.querySelector('.exp-item-sub').textContent).toBe('IBP · 2 integraciones · 3 mapeos')
  })

  it('una dimensión de campo dice «N usos · M integraciones», y con una sola, en singular', async () => {
    await montar(lista({
      dimension: 'dst-field',
      entradas: [{ clave: 'PRDID', etiqueta: 'PRDID', filas: [{ intIdx: 0, mIdx: 0 }] }],
    }))
    expect(contenedor.querySelector('.exp-item-sub').textContent).toBe('1 uso · 1 integración')
  })

  it('una dimensión de filtro cuenta filtros', async () => {
    await montar(lista({
      dimension: 'filter-table',
      entradas: [{ clave: 'ERP::MARA', etiqueta: 'ERP · MARA', filas: [{ intIdx: 0, fIdx: 0 }] }],
    }))
    // En las tablas de filtro v9 no antepone el datastore: "N integración(es) · M filtro(s)".
    expect(contenedor.querySelector('.exp-item-sub').textContent).toBe('1 integración · 1 filtro')
  })

  it('sin claves dice «Sin resultados»', async () => {
    await montar(lista({ dimension: 'dst-table', entradas: [] }))
    expect(contenedor.textContent).toBe('Sin resultados')
  })
})

describe('el detalle de una dimensión', () => {
  const entrada = { clave: 'IBP::PRODUCT', etiqueta: 'IBP · PRODUCT', filas: [{ intIdx: 0, mIdx: 0 }] }
  const detalle = (props) => createElement(DimensionDetail, {
    dimension: 'dst-table',
    entrada,
    integraciones: [integracion(0)],
    onIrAIntegracion: () => {},
    onCopiarTareas: () => true,
    ...props,
  })

  it('arriba: el título, el datastore y la línea «<dimensión> · N mapeo · M integración»', async () => {
    await montar(detalle())
    expect(contenedor.querySelector('.exp-h-title').textContent).toBe('PRODUCT')
    expect(contenedor.querySelector('.exp-h-flow').textContent).toBe('Datastore: IBP')
    expect(contenedor.querySelector('.exp-header-card .exp-sub').textContent).toContain('Tabla Destino · 1 mapeo · 1 integración')
  })

  it('lleva su botón «Copiar» con el título de v9', async () => {
    await montar(detalle())
    expect(contenedor.querySelector('.exp-copy-btn').title).toBe('Copiar listado de tareas (formato tabla)')
  })

  it('cada integración es un bloque plegado con «N campo» y la píldora «Ver»', async () => {
    await montar(detalle())
    expect(contenedor.querySelector('.exp-section-body')).toBeNull()
    expect(contenedor.querySelector('.exp-section-derecha').textContent).toContain('1 campo')
    expect(contenedor.querySelector('.exp-chain-pill').textContent).toBe('Ver')
  })

  it('«Ver» lleva a la integración SIN desplegar el bloque', async () => {
    const ir = vi.fn()
    await montar(detalle({ onIrAIntegracion: ir }))
    await act(async () => { contenedor.querySelector('.exp-chain-pill').click() })
    expect(ir).toHaveBeenCalledWith(0)
    expect(contenedor.querySelector('.exp-section-body')).toBeNull()
  })

  it('desplegado, la tabla lleva las cabeceras de v9 y no la insignia de lookup', async () => {
    await montar(detalle({ integraciones: [integracion(0, { mappings: [{ srcDS: 'ERP', srcTable: 'M', srcField: 'F', dstTable: 'T', dstField: 'D', ops: 'lookup(a)' }] })] }))
    await act(async () => { contenedor.querySelector('.exp-section-head').click() })
    const cabeceras = [...contenedor.querySelectorAll('th')].map((uno) => uno.textContent)
    expect(cabeceras).toEqual(['Campo Destino', 'Origen', 'Transformación'])
    expect(contenedor.querySelector('.exp-lookup-badge')).toBeNull()
  })

  it('una dimensión de origen cambia la primera cabecera a «Campo Origen»', async () => {
    await montar(detalle({ dimension: 'src-field', entrada: { clave: 'MATNR', etiqueta: 'MATNR', filas: [{ intIdx: 0, mIdx: 0 }] } }))
    await act(async () => { contenedor.querySelector('.exp-section-head').click() })
    expect([...contenedor.querySelectorAll('th')].map((uno) => uno.textContent)[0]).toBe('Campo Origen')
  })

  it('sin nada elegido dice lo de v9', async () => {
    await montar(detalle({ entrada: null }))
    expect(contenedor.textContent).toBe('Selecciona un elemento a la izquierda')
  })
})

describe('la pantalla entera', () => {
  const archivoZip = new File([new Uint8Array(2048)], 'PROYECTO.zip', { type: 'application/zip' })

  beforeEach(() => {
    analyzeProject.mockReset()
    analyzeProject.mockResolvedValue(analisis([integracion(0, { jobName: 'JOB_A' }), integracion(1, { jobName: 'JOB_B' })]))
  })

  const subirYExplorar = async () => {
    const entrada = contenedor.querySelector('input[type=file]')
    Object.defineProperty(entrada, 'files', { value: [archivoZip], configurable: true })
    await act(async () => { entrada.dispatchEvent(new Event('change', { bubbles: true })) })
    // El `File` de jsdom no trae `arrayBuffer`; se espera a que la lista de archivos se pinte.
    await vi.waitFor(() => { if (!contenedor.querySelector('.exp-file-tag')) throw new Error('falta el archivo') })
    const explorar = [...contenedor.querySelectorAll('button')].find((b) => b.textContent.includes('Explorar integraciones'))
    await act(async () => { explorar.click() })
    await vi.waitFor(() => { if (!contenedor.querySelector('.exp-resultados')) throw new Error('faltan los resultados') })
  }

  beforeEach(() => {
    if (!File.prototype.arrayBuffer) File.prototype.arrayBuffer = async function arrayBuffer() { return new ArrayBuffer(2048) }
  })

  it('arranca con el banner y el panel de carga, sin resultados', async () => {
    await montar(createElement(IntegrationExplorer))
    expect(contenedor.querySelector('.tab-info-desc').textContent).toContain('Explora visualmente las integraciones CI-DS')
    expect(contenedor.textContent).toContain('📦 ZIPs de integraciones CI-DS')
    expect(contenedor.textContent).toContain('Arrastra los ZIP aquí o haz click para seleccionar')
    expect(contenedor.querySelector('.exp-resultados')).toBeNull()
  })

  it('el botón de explorar está apagado sin ZIP', async () => {
    await montar(createElement(IntegrationExplorer))
    const explorar = [...contenedor.querySelectorAll('button')].find((b) => b.textContent.includes('Explorar integraciones'))
    expect(explorar.disabled).toBe(true)
  })

  it('ofrece «Conectar SAP CI-DS» y «Conectar SAP IBP» y NADA se conecta solo', async () => {
    await montar(createElement(IntegrationExplorer))
    await act(async () => { await Promise.resolve() })
    const opciones = [...contenedor.querySelectorAll('select option[disabled]')].map((uno) => uno.textContent)
    expect(opciones).toEqual(['Conectar SAP CI-DS', 'Conectar SAP IBP'])
    expect(contenedor.querySelector('.exp-conn-pildora')).toBeNull()
  })

  it('al elegir una conexión sale su píldora con «Desconectar», y los «?»', async () => {
    await montar(createElement(IntegrationExplorer))
    await act(async () => { await Promise.resolve() })

    const select = contenedor.querySelector('select.es-ibp')
    const poner = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    await act(async () => { poner.call(select, 'i1'); select.dispatchEvent(new Event('change', { bubbles: true })) })

    expect(contenedor.querySelector('.exp-conn-pildora.es-ibp').textContent).toContain('SAP IBP: IBP CLARO QA')
    expect(contenedor.textContent).toContain('Desconectar')
    expect(contenedor.querySelectorAll('.exp-ayuda-btn')).toHaveLength(2)
  })

  it('el «?» abre su popover con el texto de v9 y Escape lo cierra', async () => {
    await montar(createElement(IntegrationExplorer))
    await act(async () => { await Promise.resolve() })

    await act(async () => { contenedor.querySelector('.exp-ayuda-btn').click() })
    expect(contenedor.querySelector('.exp-ayuda-pop-titulo').textContent).toBe('Conexión SAP CI-DS')
    expect(contenedor.querySelector('.exp-ayuda-pop-cuerpo').textContent).toContain('Para qué sirve')

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(contenedor.querySelector('.exp-ayuda-pop')).toBeNull()
  })

  it('tras explorar: los resultados salen y el panel de carga SIGUE (plegado), sin «Cargar otro proyecto»', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()

    expect(contenedor.querySelector('.exp-panel-titulo')).not.toBeNull()
    expect(contenedor.textContent).not.toContain('Cargar otro proyecto')
    // Plegado: no se ve la zona de arrastre, pero el título para desplegarlo sí.
    expect(contenedor.textContent).not.toContain('Arrastra los ZIP aquí')
  })

  it('los rótulos de las dimensiones son los de v9', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()
    const botones = [...contenedor.querySelectorAll('.exp-dim-btn')].map((uno) => uno.textContent)
    expect(botones).toEqual([
      '🔗 Integración', '📤 Tabla Destino', '📥 Tabla Origen', '📋 Campo Destino', '📋 Campo Origen',
      '🔍 Tabla Filtro/Join', '🎯 Campo Filtro/Join',
    ])
  })

  it('la cabecera de la lista dice «Tareas (N)» y el contador «N integraciones»', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()
    expect(contenedor.querySelector('.exp-pane-title').textContent).toBe('Tareas (2)')
    expect(contenedor.querySelector('.exp-counter').textContent).toBe('2 integraciones')
    expect(contenedor.querySelector('.exp-search').placeholder).toBe('🔍 Buscar...')
  })

  it('buscar por VARIAS palabras exige todas (AND) y el contador pasa a «visibles / total»', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()

    const buscador = contenedor.querySelector('.exp-search')
    const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set

    await act(async () => { poner.call(buscador, 'mara matnr'); buscador.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(contenedor.querySelector('.exp-counter').textContent).toBe('2 integraciones')

    await act(async () => { poner.call(buscador, 'mara inventada'); buscador.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(contenedor.querySelector('.exp-counter').textContent).toBe('0 / 2')
  })

  it('en una dimensión, la búsqueda por la clave NO se aplica dos veces', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()

    const botonDimension = [...contenedor.querySelectorAll('.exp-dim-btn')].find((b) => b.textContent.includes('Campo Destino'))
    await act(async () => { botonDimension.click() })
    expect(contenedor.querySelector('.exp-counter').textContent).toBe('1 campos destino')

    // El texto «prdid» no está en las palabras indexadas de las integraciones, pero SÍ es una clave.
    const buscador = contenedor.querySelector('.exp-search')
    const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { poner.call(buscador, 'prdid'); buscador.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(contenedor.querySelectorAll('.exp-dim-list .exp-item')).toHaveLength(1)
  })

  it('el placeholder del detalle es el de v9', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()
    expect(contenedor.querySelector('.exp-detail-pane').textContent)
      .toBe('Selecciona una integración a la izquierda para explorar sus campos')
  })

  it('sin ningún transform con «Select Distinct Rows» no sale su interruptor', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()
    expect(contenedor.textContent).not.toContain('Select Distinct Rows')
  })

  it('el interruptor «Solo con Select Distinct Rows» lleva su contador y filtra', async () => {
    analyzeProject.mockResolvedValue(analisis([
      integracion(0, { jobName: 'JOB_A' }),
      integracion(1, { jobName: 'JOB_B', distinctTransforms: ['Transform4'] }),
    ]))
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()

    const interruptor = [...contenedor.querySelectorAll('.interruptor')]
      .find((uno) => uno.textContent.includes('Solo con Select Distinct Rows'))
    expect(interruptor.querySelector('.exp-distinct-count').textContent).toBe('1')

    await act(async () => { interruptor.querySelector('input').click() })
    expect(contenedor.querySelector('.exp-counter').textContent).toBe('1 / 2')
    expect(contenedor.querySelector('.exp-master').textContent).toContain('JOB_B')
    expect(contenedor.querySelector('.exp-master').textContent).not.toContain('JOB_A')
  })

  it('sale el interruptor «Promovido a producción» solo tras conectar CI-DS', async () => {
    await montar(createElement(IntegrationExplorer))
    await subirYExplorar()
    expect(contenedor.textContent).not.toContain('Promovido a producción')

    // Con el panel plegado hay que desplegarlo para ver las conexiones.
    await act(async () => { contenedor.querySelector('.exp-panel-titulo').click() })
    const select = contenedor.querySelector('select.es-cids')
    const poner = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    await act(async () => { poner.call(select, 'c1:production'); select.dispatchEvent(new Event('change', { bubbles: true })) })
    await vi.waitFor(() => { if (!contenedor.textContent.includes('Promovido a producción')) throw new Error('falta el interruptor') })

    expect(contenedor.querySelector('.interruptor').title).toBe('Mostrar solo integraciones en CI-DS Productivo')
  })
})
