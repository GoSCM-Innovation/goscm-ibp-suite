// @vitest-environment jsdom
//
// El diagrama del dataflow con la forma de v9: la paleta de los doce tipos de nodo, el panel de
// detalle por tipo, el tooltip, las flechas con la etiqueta cortada y la pantalla completa.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cortarEtiqueta, cortarEtiquetaDeCadena, estiloDe, etiquetaDelNodoDeCadena, tooltipDeLaIntegracion, tooltipDelNodo,
} from '../../../lib/dataflow-style.js'

// La librería del lienzo mide el DOM al montarse y en jsdom no hay con qué: se sustituye por una
// que ofrece un botón por nodo, que es lo único que estas pruebas necesitan (hacer clic en una caja).
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, onNodeClick, onPaneClick, children }) => createElement(
    'div',
    { 'data-prueba': 'lienzo' },
    nodes.map((nodo) => createElement(
      'button',
      { key: nodo.id, 'data-nodo': nodo.id, title: nodo.data.tooltip, onClick: (e) => onNodeClick(e, nodo) },
      nodo.data.displayName,
    )),
    edges.map((arista) => createElement('span', { key: arista.id, 'data-arista': arista.id }, arista.label)),
    createElement('button', { 'data-panel': 'si', onClick: onPaneClick }, 'fondo'),
    children,
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
}))
vi.mock('@xyflow/react/dist/style.css', () => ({}))

const { default: DataflowDiagram, DetalleDelNodo } = await import('./DataflowDiagram.jsx')
const { default: ChainGraph } = await import('./ChainGraph.jsx')

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
  document.body.style.overflow = ''
})

describe('la paleta de v9', () => {
  it('trae los doce tipos con su color e icono', () => {
    expect(estiloDe('TableReader')).toEqual({ color: '#5b7a99', icono: '📋' })
    expect(estiloDe('TableLoader')).toEqual({ color: '#8a6450', icono: '🎯' })
    expect(estiloDe('FileReader')).toEqual({ color: '#6f7a8a', icono: '📄' })
    expect(estiloDe('FileLoader')).toEqual({ color: '#8a6450', icono: '📄' })
    expect(estiloDe('QueryTransform')).toEqual({ color: '#475569', icono: '▦' })
    expect(estiloDe('XMLMapTransform')).toEqual({ color: '#475569', icono: '⟨⟩' })
    expect(estiloDe('RowGenerationTransform')).toEqual({ color: '#7d7866', icono: '🔢' })
  })

  // Eran los cinco que caían en el color por omisión: Merge, Case, Validation, SQL y MapOperation.
  it.each([
    ['MergeTransform', '◆'], ['CaseTransform', '◆'], ['ValidationTransform', '✓'],
    ['SQLTransform', 'SQL'], ['MapOperationTransform', '⟲'],
  ])('%s tiene el suyo', (tipo, icono) => {
    expect(estiloDe(tipo)).toEqual({ color: '#5a5e6e', icono })
  })

  it('un tipo desconocido recibe el de omisión de v9', () => {
    expect(estiloDe('Inventado')).toEqual({ color: '#7d9abf', icono: '◇' })
  })
})

describe('el tooltip y la etiqueta de las flechas', () => {
  it('el tooltip lleva nombre, tipo y lo que tenga el nodo', () => {
    expect(tooltipDelNodo({
      displayName: 'MARA_R', xmiType: 'TableReader', tableName: 'MARA', dsName: 'ERP',
    })).toBe('MARA_R\nTipo: TableReader\nTabla: MARA\nDatastore: ERP')
  })

  it('un archivo y un contador de filas también salen', () => {
    expect(tooltipDelNodo({ displayName: 'G', xmiType: 'RowGenerationTransform', rowCount: '10' })).toContain('Filas: 10')
    expect(tooltipDelNodo({ displayName: 'F', xmiType: 'FileLoader', fileName: 'a.csv' })).toContain('Archivo: a.csv')
  })

  it('la etiqueta de una flecha se corta a 14 caracteres (13 y «…»)', () => {
    expect(cortarEtiqueta('Target_Query')).toBe('Target_Query')
    expect(cortarEtiqueta('Un_nombre_muy_largo')).toBe('Un_nombre_muy…')
    expect(cortarEtiqueta('12345678901234')).toBe('12345678901234')
    expect(cortarEtiqueta('123456789012345')).toBe('1234567890123…')
  })
})

describe('el panel de detalle de un nodo', () => {
  const vista = async (nodo) => montar(createElement(DetalleDelNodo, { nodo }))

  it('al principio dice que hay que hacer clic en un nodo', async () => {
    await vista(null)
    expect(contenedor.textContent).toBe('Click en un nodo del diagrama para ver sus detalles')
  })

  it('un lector de tabla dice su datastore y su tabla', async () => {
    await vista({ displayName: 'MARA_R', xmiType: 'TableReader', dsName: 'ERP', tableName: 'MARA' })
    expect(contenedor.textContent).toContain('Datastore: ERP')
    expect(contenedor.textContent).toContain('Tabla: MARA')
    expect(contenedor.querySelector('.exp-df-tipo').textContent).toBe('TableReader')
  })

  it('un escritor de tabla también', async () => {
    await vista({ displayName: 'L', xmiType: 'TableLoader', dsName: 'IBP', tableName: 'PRODUCT' })
    expect(contenedor.textContent).toContain('Tabla: PRODUCT')
  })

  it('un lector o escritor de archivo dice su datastore y su archivo', async () => {
    await vista({ displayName: 'F', xmiType: 'FileLoader', dsName: 'FILE_DC', fileName: 'salida.csv' })
    expect(contenedor.textContent).toContain('Archivo: salida.csv')
    expect(contenedor.textContent).not.toContain('Tabla:')
  })

  it('el generador de filas dice cuántas', async () => {
    await vista({ displayName: 'G', xmiType: 'RowGenerationTransform', rowCount: '25' })
    expect(contenedor.textContent).toContain('Filas: 25')
  })

  it('un dato que falta sale como «—»', async () => {
    await vista({ displayName: 'R', xmiType: 'TableReader' })
    expect(contenedor.textContent).toContain('Datastore: —')
  })

  it('una consulta trae Inputs, uniones con ⋈, WHERE y los mappings CON proyección', async () => {
    await vista({
      displayName: 'Target_Query',
      xmiType: 'QueryTransform',
      inputSchemas: ['A', 'B'],
      joins: [{ leftSchemaName: 'A', rightSchemaName: 'B', expression: 'A.X = B.X' }],
      filterExpression: "A.T = 'F'",
      fields: [
        { name: 'PRDID', description: 'Id', projectionExpression: 'A.MATNR' },
        { name: 'VACIO', description: '', projectionExpression: '   ' },
        { name: 'SIN', description: '', projectionExpression: '' },
      ],
    })
    const texto = contenedor.textContent
    expect(texto).toContain('Inputs:')
    expect(contenedor.querySelectorAll('.exp-df-chip')).toHaveLength(2)
    expect(texto).toContain('A ⋈ B')
    expect(texto).toContain('WHERE')
    expect(texto).toContain("A.T = 'F'")
    // Solo el campo con proyección, y la cabecera es «Projection» como en v9.
    expect(texto).toContain('Mappings (1)')
    expect(texto).toContain('Projection')
    expect(texto).not.toContain('VACIO')
  })

  it('una consulta sin nada no pinta secciones vacías', async () => {
    await vista({ displayName: 'Q', xmiType: 'QueryTransform', inputSchemas: [], joins: [], fields: [] })
    expect(contenedor.textContent).not.toContain('Inputs')
    expect(contenedor.textContent).not.toContain('Mappings')
  })

  it('el resto de los tipos dice que no hay más detalle', async () => {
    await vista({ displayName: 'M', xmiType: 'MergeTransform' })
    expect(contenedor.textContent).toContain('Sin detalle adicional disponible para este tipo de nodo.')
  })
})

describe('el diagrama', () => {
  const diagrama = {
    nodes: [
      { id: 0, xmiType: 'TableReader', displayName: 'MARA_R', dsName: 'ERP', tableName: 'MARA', location: { x: 0, y: 0 } },
      { id: 1, xmiType: 'TableLoader', displayName: 'Cargar', dsName: 'IBP', tableName: 'PRODUCT', location: { x: 200, y: 0 } },
    ],
    edges: [{ from: 0, to: 1, schemaName: 'Un_nombre_muy_largo_de_esquema' }],
  }
  const integracion = { tipoIntegracion: 'MD', jobName: 'JOB_A', dataflowName: 'DF_A' }
  const dibujo = () => createElement(DataflowDiagram, { diagrama, integracion, nombre: 'DF_A' })

  it('antes de hacer clic en un nodo, el panel dice qué hacer', async () => {
    await montar(dibujo())
    expect(contenedor.textContent).toContain('Click en un nodo del diagrama para ver sus detalles')
  })

  it('hacer clic en un nodo muestra su detalle y el fondo lo quita', async () => {
    await montar(dibujo())
    await act(async () => { contenedor.querySelector('[data-nodo="0"]').click() })
    expect(contenedor.textContent).toContain('Tabla: MARA')

    await act(async () => { contenedor.querySelector('[data-panel]').click() })
    expect(contenedor.textContent).toContain('Click en un nodo del diagrama')
  })

  it('cada caja lleva su tooltip', async () => {
    await montar(dibujo())
    expect(contenedor.querySelector('[data-nodo="0"]').title).toContain('Tipo: TableReader')
  })

  it('la flecha corta su etiqueta pero conserva el texto completo en el title', async () => {
    await montar(dibujo())
    const etiqueta = contenedor.querySelector('[data-arista] span')
    expect(etiqueta.textContent).toBe('Un_nombre_muy…')
    expect(etiqueta.title).toBe('Un_nombre_muy_largo_de_esquema')
  })

  it('el botón ⛶ se llama «Pantalla completa»', async () => {
    await montar(dibujo())
    expect(contenedor.querySelector('.exp-df-fs').title).toBe('Pantalla completa')
  })
})

describe('la pantalla completa', () => {
  const diagrama = {
    nodes: [{ id: 0, xmiType: 'TableReader', displayName: 'MARA_R', dsName: 'ERP', tableName: 'MARA', location: { x: 0, y: 0 } }],
    edges: [],
  }
  const integracion = { tipoIntegracion: 'KF', jobName: 'JOB_A', dataflowName: 'DF_A' }

  const abrir = async () => {
    await montar(createElement(DataflowDiagram, { diagrama, integracion, nombre: 'DF_A' }))
    await act(async () => { contenedor.querySelector('.exp-df-fs').click() })
  }
  const modal = () => document.body.querySelector('.exp-df-fs-modal')

  it('ocupa la ventana: cabecera con tipo, job y dataflow, y ✕ «Cerrar (Esc)»', async () => {
    await abrir()
    expect(modal()).not.toBeNull()
    const cabecera = modal().querySelector('.exp-df-fs-cabecera').textContent
    expect(cabecera).toContain('KF')
    expect(cabecera).toContain('JOB_A')
    expect(cabecera).toContain('↳ DF_A')
    expect(modal().querySelector('button[title="Cerrar (Esc)"]')).not.toBeNull()
  })

  it('lleva el panel de detalle a la derecha y un divisor que se arrastra', async () => {
    await abrir()
    expect(modal().querySelector('.exp-df-fs-panel').textContent).toContain('Click en un nodo del diagrama')
    expect(modal().querySelector('.exp-df-fs-divisor').title).toBe('Arrastra para ajustar el ancho del panel')
    expect(modal().querySelector('.exp-df-fs-panel').style.width).toBe('380px')
  })

  it('elegir un nodo en la pantalla completa llena el panel de la derecha', async () => {
    await abrir()
    await act(async () => { modal().querySelector('[data-nodo="0"]').click() })
    expect(modal().querySelector('.exp-df-fs-panel').textContent).toContain('Tabla: MARA')
  })

  it('Escape la cierra', async () => {
    await abrir()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(modal()).toBeNull()
  })

  it('el ✕ la cierra y devuelve el desplazamiento de la página', async () => {
    await abrir()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { modal().querySelector('button[title="Cerrar (Esc)"]').click() })
    expect(modal()).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })
})

describe('el grafo de cadenas', () => {
  it('un rótulo de hasta 30 caracteres queda tal cual', () => {
    expect(etiquetaDelNodoDeCadena('DF_PRODUCTO')).toBe('DF_PRODUCTO')
  })

  it('uno más largo se parte en dos líneas por el último «_» o espacio, y se corta a 30', () => {
    expect(etiquetaDelNodoDeCadena('DF_MD_PRODUCTO_CARGA_INICIAL_COMPLETA_2026')).toBe('DF_MD_PRODUCTO_CARGA_INICIAL\nC')
    expect(etiquetaDelNodoDeCadena('UNOSOLOSINSEPARADORESCONMASDETREINTACARACTERES'))
      .toBe('UNOSOLOSINSEPARADORESCONMASDET')
  })

  it('el rótulo de una flecha se corta a 24 (22 y «…»)', () => {
    expect(cortarEtiquetaDeCadena('SOPMD_STAG_PRODUCT')).toBe('SOPMD_STAG_PRODUCT')
    expect(cortarEtiquetaDeCadena('SOPMD_STAG_PRODUCT_TRANSLATION_LONG')).toBe('SOPMD_STAG_PRODUCT_TRA…')
  })

  it('el tooltip de una caja lleva dataflow, job, de dónde a dónde, Target y ZIP', () => {
    expect(tooltipDeLaIntegracion({
      dataflowName: 'DF_A', jobName: 'JOB_A', srcDSName: 'ERP', dstDSName: 'IBP', targetTable: 'PRODUCT', _zipName: 'p.zip',
    })).toBe('DF_A\nJob: JOB_A\nERP → IBP\nTarget: PRODUCT\nZIP: p.zip')
  })

  it('sin datastores pone «?» y sin dataflow distinto no repite el job', () => {
    expect(tooltipDeLaIntegracion({ jobName: 'JOB_A', targetTable: 'T', _zipName: 'p.zip' }))
      .toBe('JOB_A\n? → ?\nTarget: T\nZIP: p.zip')
  })

  const integraciones = [
    { _idx: 0, jobName: 'J0', dataflowName: 'DF_0', tipoIntegracion: 'MD', srcDSName: 'ERP', dstDSName: 'IBP', targetTable: 'T0', _zipName: 'p.zip' },
    { _idx: 1, jobName: 'J1', dataflowName: 'DF_1', tipoIntegracion: 'KF', srcDSName: 'ERP', dstDSName: 'IBP', targetTable: 'T1', _zipName: 'p.zip' },
  ]
  const grafo = (extra) => createElement(ChainGraph, {
    integraciones, cadenas: [{ from: 0, to: 1, via: 'table', label: 'SOPMD_STAG_PRODUCT_TRANSLATION_LONG' }], onElegir: () => {}, ...extra,
  })

  it('la leyenda es la de v9: «Leyenda», «Conexiones» y «Nodos»', async () => {
    await montar(grafo())
    const texto = contenedor.querySelector('.exp-legend').textContent
    for (const parte of ['Leyenda', 'Conexiones', 'Tabla (DB)', 'Archivo', 'Lookup', 'Nodos', 'Master data', 'Key figure']) {
      expect(texto, parte).toContain(parte)
    }
    expect(contenedor.querySelectorAll('.exp-legend svg')).toHaveLength(3)
  })

  it('la flecha corta su rótulo y guarda tipo y vía en el title', async () => {
    await montar(grafo())
    const etiqueta = contenedor.querySelector('[data-arista] span')
    expect(etiqueta.textContent).toBe('SOPMD_STAG_PRODUCT_TRA…')
    expect(etiqueta.title).toBe('Tipo: table\nVía: SOPMD_STAG_PRODUCT_TRANSLATION_LONG')
  })

  it('hacer clic en una caja elige esa integración', async () => {
    const elegir = vi.fn()
    await montar(grafo({ onElegir: elegir }))
    await act(async () => { contenedor.querySelector('[data-nodo="1"]').click() })
    expect(elegir).toHaveBeenCalledWith(1)
  })

  it('sin integraciones dice que no hay nada que dibujar', async () => {
    await montar(grafo({ integraciones: [] }))
    expect(contenedor.textContent).toBe('No hay nada que dibujar.')
  })
})
