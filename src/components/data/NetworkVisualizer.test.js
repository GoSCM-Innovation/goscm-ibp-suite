// @vitest-environment jsdom
//
// El Network Visualizer con la forma de v7: del mapeo al catálogo, del catálogo a la red, y de la red a
// sus filtros, su pantalla completa y sus rutas. El lienzo (vis-network) se sustituye por uno de
// mentira que anota lo que se le pide: dibujar de verdad exige un canvas, y lo que se comprueba aquí
// es QUÉ se le pide al lienzo, no cómo pinta.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const falso = vi.hoisted(() => {
  class ConjuntoFalso {
    constructor(items) { this.items = new Map(items.map((uno) => [uno.id, { ...uno }])) }

    get(id) { return this.items.get(id) ?? null }

    forEach(funcion) { this.items.forEach((valor) => funcion(valor)) }

    update(lista) {
      for (const cambio of lista) this.items.set(cambio.id, { ...this.items.get(cambio.id), ...cambio })
    }
  }

  class RedFalsa {
    static todas = []

    constructor(caja, datos, opciones) {
      this.caja = caja
      this.opciones = opciones
      this.body = { data: { nodes: datos.nodes, edges: datos.edges } }
      this.manejadores = {}
      this.llamadas = []
      this.destruida = false
      RedFalsa.todas.push(this)
    }

    once() {}

    on(evento, funcion) { this.manejadores[evento] = funcion }

    fit(opciones) { this.llamadas.push(['fit', opciones]) }

    selectNodes(ids) { this.llamadas.push(['selectNodes', ids]) }

    selectEdges(ids) { this.llamadas.push(['selectEdges', ids]) }

    focus(id, opciones) { this.llamadas.push(['focus', id, opciones]) }

    destroy() { this.destruida = true }

    pulsarNodo(id) { this.manejadores.click({ nodes: [id] }) }
  }

  return { ConjuntoFalso, RedFalsa }
})

vi.mock('vis-network/standalone', () => ({ DataSet: falso.ConjuntoFalso, Network: falso.RedFalsa }))
vi.mock('vis-network/styles/vis-network.css', () => ({}))

const detectado = {
  red: {
    location: { etiqueta: 'Arcos', entidad: 'SBSRCLOC', seguro: true, alternativas: [] },
    customer: { etiqueta: 'Clientes', entidad: 'SBSRCCUST', seguro: true, alternativas: [] },
    product: { etiqueta: 'Productos', entidad: 'SBPRODUCT', seguro: true, alternativas: [] },
    sourceProd: { etiqueta: 'Cabecera', entidad: 'SBHEADER', seguro: true, alternativas: [] },
    locMaster: { etiqueta: 'Ubicaciones', entidad: 'SBLOCATION', seguro: true, alternativas: [] },
    custMaster: { etiqueta: 'Clientes maestro', entidad: 'SBCUSTOMER', seguro: true, alternativas: [] },
    sourceItem: { etiqueta: 'Componentes', entidad: 'SBITEM', seguro: true, alternativas: [] },
    locProd: { etiqueta: 'Producto por ubicación', entidad: 'SBLOCPROD', seguro: true, alternativas: [] },
    custProd: { etiqueta: 'Producto por cliente', entidad: 'SBCUSTPROD', seguro: true, alternativas: [] },
  },
}
const entidades = ['SBSRCLOC', 'SBSRCCUST', 'SBPRODUCT', 'SBHEADER', 'SBLOCATION', 'SBCUSTOMER', 'SBITEM', 'SBLOCPROD', 'SBCUSTPROD']

vi.mock('../../lib/ibp-explorer.js', () => ({
  fetchExplorerMap: vi.fn(async () => ({
    detectado,
    entidades,
    campos: Object.fromEntries(entidades.map((nombre) => [nombre, ['A', 'B']])),
    guardado: { roles: {}, fields: {} },
    prefijo: 'SB',
  })),
  saveExplorerMap: vi.fn(async () => ({})),
  resetExplorerMap: vi.fn(async () => ({})),
}))

vi.mock('../../lib/network-load-sap.js', () => ({
  productosDeSap: vi.fn(),
  cargarRedDeSap: vi.fn(),
  planDeLaRed: vi.fn(() => ({ pasos: [], avisos: ['Cabecera: falta la tabla.'] })),
}))

vi.mock('../../lib/descargar-csv.js', () => ({ descargarTexto: vi.fn() }))

const { productosDeSap, cargarRedDeSap } = await import('../../lib/network-load-sap.js')
const { descargarTexto } = await import('../../lib/descargar-csv.js')
const { default: NetworkVisualizer } = await import('./NetworkVisualizer.jsx')

const DESTINO = { connectionId: 'c', planningArea: 'PA', versionId: '' }

const CATALOGO = [
  { prdid: 'TERM', descripcion: 'Terminado de prueba' },
  { prdid: 'MAT', descripcion: 'Un material' },
  { prdid: 'OTRO', descripcion: 'Terminal portátil' },
]

/**
 *   PROV (LOCTYPE V) ──trae MAT──▶ PLANTA ──transporte──▶ CD ──entrega──▶ CLI1
 *   Y una planta huérfana: PLANTA2 manda a un almacén que no entrega a nadie.
 */
function filas(extra = {}) {
  return {
    plantas: [
      { SOURCEID: 'S1', LOCID: 'PLANTA', PLEADTIME: '2' },
      { SOURCEID: 'S2', LOCID: 'PLANTA2' },
    ],
    componentes: [{ SOURCEID: 'S1', PRDID: 'MAT' }],
    arcos: [
      { LOCFR: 'PLANTA', LOCID: 'CD', TLEADTIME: '1' },
      { LOCFR: 'PLANTA2', LOCID: 'ALMACEN' },
    ],
    arcosDeComponentes: [{ LOCFR: 'PROV', LOCID: 'PLANTA', PRDID: 'MAT', TLEADTIME: '5' }],
    clientes: [{ LOCID: 'CD', CUSTID: 'CLI1', CLEADTIME: '3' }],
    plantasGlobales: [],
    ubicaciones: {
      PROV: { LOCID: 'PROV', LOCDESCR: 'Proveedor norte', LOCTYPE: 'V' },
      PLANTA: { LOCID: 'PLANTA', LOCDESCR: 'Planta Quito' },
    },
    maestroDeClientes: { CLI1: { CUSTID: 'CLI1', CUSTDESCR: 'Cadena' } },
    ...extra,
  }
}

let raiz
let contenedor

const botones = () => [...document.querySelectorAll('button')]
const boton = (texto) => botones().find((uno) => uno.textContent.trim() === texto)
const botonQueEmpieza = (texto) => botones().find((uno) => uno.textContent.trim().startsWith(texto))

async function pulsar(elemento) {
  if (!elemento) throw new Error('No hay ese botón en pantalla')
  await act(async () => { elemento.click() })
}

async function escribir(campo, valor) {
  const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    poner.call(campo, valor)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(NetworkVisualizer, { destino: DESTINO }))
  })
  await vi.waitFor(() => { if (!document.querySelector('.mdt-card')) throw new Error('aún leyendo') })
}

/** Confirma el mapeo y deja el catálogo cargado. */
async function conCatalogo() {
  await montar()
  await pulsar(boton('Confirmar mapeo y cargar productos'))
  await vi.waitFor(() => { if (!document.querySelector('.nv-barra')) throw new Error('aún sin catálogo') })
}

/** Elige un material y carga su red. */
async function conRed(prdid = 'TERM') {
  await conCatalogo()
  await escribir(document.querySelector('[aria-label="Buscar material"]'), prdid)
  await pulsar([...document.querySelectorAll('.ss-opt')].find((uno) => uno.textContent.startsWith(prdid)))
  await pulsar(boton('Cargar red logística'))
  await vi.waitFor(() => { if (!document.querySelector('.nv-rutas')) throw new Error('aún sin red') })
}

const textoDeLaPantalla = () => document.body.textContent

beforeEach(() => {
  falso.RedFalsa.todas.length = 0
  productosDeSap.mockReset()
  cargarRedDeSap.mockReset()
  descargarTexto.mockReset()
  productosDeSap.mockImplementation(async ({ onRegistro }) => {
    onRegistro?.('info', '[GET] SBPRODUCT | $select=PRDID,PRDDESCR')
    onRegistro?.('ok', '✓ 3 productos cargados')
    return CATALOGO
  })
  cargarRedDeSap.mockImplementation(async ({ onRegistro }) => {
    onRegistro?.('ok', '✓ Location Source: 2 registros')
    return filas()
  })
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  document.body.innerHTML = ''
})

describe('① confirmar el mapeo', () => {
  it('el botón dice «Confirmar mapeo y cargar productos» y no hay nada más hasta pulsarlo', async () => {
    await montar()
    expect(boton('Confirmar mapeo y cargar productos')).toBeDefined()
    expect(document.querySelector('.nv-barra')).toBeNull()
    expect(document.querySelector('.progress-bar')).toBeNull()
  })

  it('al terminar: barra al 100 % y los controles a la vista', async () => {
    await conCatalogo()
    // El panel se plegó al terminar, y con él la barra: se mira desplegándolo otra vez.
    await pulsar(document.querySelector('.panel-title'))
    expect(document.querySelector('.progress-bar .fill').style.width).toBe('100%')
    expect(document.querySelector('.nv-barra')).not.toBeNull()
  })

  it('el estado dice cuántos materiales hay, con las palabras de v7', async () => {
    await montar()
    // El mapeo se pliega al terminar, y con él su estado: se mira desplegándolo otra vez.
    await pulsar(boton('Confirmar mapeo y cargar productos'))
    await vi.waitFor(() => { if (!document.querySelector('.nv-barra')) throw new Error('aún sin catálogo') })
    await pulsar(document.querySelector('.panel-title'))
    expect(textoDeLaPantalla()).toContain('✓ 3 materiales listos — selecciona uno y haz click en "Cargar red logística"')
  })

  it('el panel ① se pliega (▶) al terminar', async () => {
    await conCatalogo()
    expect(document.querySelector('.panel-title').textContent).toContain('▶')
    expect(document.querySelector('.mdt-card')).toBeNull()
  })

  it('«Ver logs técnicos» abre las líneas de la descarga y pasa a «Ocultar logs»', async () => {
    await conCatalogo()
    await pulsar(document.querySelector('.panel-title'))
    expect(document.querySelector('.log-area')).toBeNull()
    await pulsar(boton('Ver logs técnicos'))
    expect(document.querySelector('.log-area').textContent).toContain('[GET] SBPRODUCT')
    expect(document.querySelector('.log-area').textContent).toContain('✓ 3 productos cargados')
    expect(boton('Ocultar logs')).toBeDefined()
  })

  it('lo que el tenant no tiene queda escrito en los logs como aviso', async () => {
    await conCatalogo()
    await pulsar(document.querySelector('.panel-title'))
    await pulsar(boton('Ver logs técnicos'))
    expect(document.querySelector('.log-area .warn').textContent).toContain('Cabecera: falta la tabla.')
  })

  it('si falla, lo dice con «✕ Error:», deja la barra en 0 y el panel abierto', async () => {
    productosDeSap.mockRejectedValue(new Error('sin permiso'))
    await montar()
    await pulsar(boton('Confirmar mapeo y cargar productos'))
    await vi.waitFor(() => { if (!textoDeLaPantalla().includes('✕ Error: sin permiso')) throw new Error('sin error') })
    expect(document.querySelector('.progress-bar .fill').style.width).toBe('0%')
    expect(document.querySelector('.mdt-card')).not.toBeNull()
    expect(document.querySelector('.nv-barra')).toBeNull()
  })
})

describe('la barra de control', () => {
  it('trae el buscador, «Cargar red logística» desactivado, «⊞ Ajustar» y «⊟ Compactar»', async () => {
    await conCatalogo()
    expect(boton('Cargar red logística').disabled).toBe(true)
    expect(boton('⊞ Ajustar')).toBeDefined()
    expect(boton('⊟ Compactar')).toBeDefined()
    // Hasta cargar una red no hay filtros ni pantalla completa.
    expect(botonQueEmpieza('▼ Filtros')).toBeUndefined()
    expect(boton('⛶ Pantalla completa')).toBeUndefined()
  })

  it('el estado vacío dice «Busca un material para visualizar su red logística»', async () => {
    await conCatalogo()
    expect(document.querySelector('.nv-vacio').textContent).toContain('Busca un material para visualizar su red logística')
  })

  it('la leyenda ya está a la vista, con cuatro casillas y sin «Producto»', async () => {
    await conCatalogo()
    const leyenda = document.querySelector('.nv-leyenda')
    expect(leyenda.querySelector('.nv-leyenda-titulo').textContent).toBe('Leyenda')
    expect([...leyenda.querySelectorAll('label')].map((una) => una.textContent)).toEqual([
      'Planta', 'Ubicación', 'Cliente', 'Proveedor',
    ])
    expect(leyenda.querySelectorAll('input[type=checkbox]')).toHaveLength(4)
    expect([...leyenda.querySelectorAll('label')].map((una) => una.title)).toEqual([
      'Mostrar/ocultar plantas', 'Mostrar/ocultar ubicaciones', 'Mostrar/ocultar clientes', 'Mostrar/ocultar proveedores',
    ])
    expect(leyenda.textContent).not.toContain('Producto')
  })
})

describe('el buscador de material', () => {
  it('sin texto no ofrece nada', async () => {
    await conCatalogo()
    expect(document.querySelectorAll('.ss-opt')).toHaveLength(0)
  })

  it('busca por código y por descripción, y ordena primero los que empiezan por el texto', async () => {
    await conCatalogo()
    await escribir(document.querySelector('[aria-label="Buscar material"]'), 'term')
    // «TERM» empieza por el texto (código); «OTRO» solo lo tiene en la descripción («Terminal»).
    expect([...document.querySelectorAll('.ss-opt')].map((uno) => uno.querySelector('strong').textContent))
      .toEqual(['TERM', 'OTRO'])
  })

  it('al elegir: pone el código, habilita el botón y dice qué hacer', async () => {
    await conCatalogo()
    await escribir(document.querySelector('[aria-label="Buscar material"]'), 'mat')
    await pulsar(document.querySelector('.ss-opt'))
    expect(document.querySelector('[aria-label="Buscar material"]').value).toBe('MAT')
    expect(boton('Cargar red logística').disabled).toBe(false)
    expect(document.querySelector('.nv-barra-estado').textContent)
      .toBe('Material: MAT — haz click en "Cargar red logística"')
  })
})

describe('cargar la red', () => {
  it('dice cuántos nodos y conexiones, con las palabras de v7', async () => {
    await conRed()
    expect(document.querySelector('.nv-franja-texto').textContent).toBe('✓ 6 nodos · 4 conexiones')
    expect(document.querySelector('.nv-barra-estado').textContent).toBe('6 nodos · 4 conexiones')
  })

  it('pasa por «⏳ Cargando...» y «Procesando red de TERM…», y vuelve a «Cargar red logística»', async () => {
    let terminar
    cargarRedDeSap.mockImplementation(() => new Promise((resolver) => { terminar = () => resolver(filas()) }))
    await conCatalogo()
    await escribir(document.querySelector('[aria-label="Buscar material"]'), 'TERM')
    await pulsar(document.querySelector('.ss-opt'))
    await pulsar(boton('Cargar red logística'))

    expect(boton('⏳ Cargando...').disabled).toBe(true)
    expect(document.querySelector('.nv-franja-texto').textContent).toBe('Procesando red de TERM…')
    expect(document.querySelector('.nv-barra-estado').textContent).toBe('⏳ Cargando TERM…')

    await act(async () => { terminar() })
    await vi.waitFor(() => { if (!boton('Cargar red logística')) throw new Error('aún cargando') })
  })

  it('los logs empiezan por «▶ Cargando red para: TERM» y llevan las líneas de la lectura', async () => {
    await conRed()
    await pulsar(boton('Ver logs técnicos'))
    const log = document.querySelector('.nv-franja + .log-area').textContent
    expect(log).toContain('▶ Cargando red para: TERM')
    expect(log).toContain('✓ Location Source: 2 registros')
    expect(log).toContain('✓ Diagrama: 6 nodos · 4 conexiones')
  })

  it('aparecen «▼ Filtros» y «⛶ Pantalla completa», y el panel ① queda plegado', async () => {
    await conRed()
    expect(boton('▼ Filtros')).toBeDefined()
    expect(boton('⛶ Pantalla completa')).toBeDefined()
    expect(document.querySelector('.panel-title').textContent).toContain('▶')
  })

  it('dibuja con el lienzo y sin el estado vacío', async () => {
    await conRed()
    expect(falso.RedFalsa.todas).toHaveLength(1)
    expect([...falso.RedFalsa.todas[0].body.data.nodes.items.keys()].sort())
      .toEqual(['ALMACEN', 'CD', 'CLI1', 'PLANTA', 'PLANTA2', 'PROV'])
    expect(document.querySelector('.nv-vacio')).toBeNull()
  })

  it('un error se dice en la franja, en el estado y en los logs', async () => {
    cargarRedDeSap.mockRejectedValue(new Error('SAP no responde'))
    await conCatalogo()
    await escribir(document.querySelector('[aria-label="Buscar material"]'), 'TERM')
    await pulsar(document.querySelector('.ss-opt'))
    await pulsar(boton('Cargar red logística'))
    await vi.waitFor(() => { if (!boton('Cargar red logística')) throw new Error('aún cargando') })

    expect(document.querySelector('.nv-franja-texto').textContent).toBe('✕ Error: SAP no responde')
    expect(document.querySelector('.nv-barra-estado').textContent).toBe('✕ Error: SAP no responde')
    expect(boton('⛶ Pantalla completa')).toBeUndefined()
  })

  it('NO avisa de «nodos sin ningún arco»: v7 no lo hacía', async () => {
    await conRed()
    expect(textoDeLaPantalla()).not.toContain('sin ningún arco')
  })

  it('el producto no es un nodo', async () => {
    await conRed()
    expect(falso.RedFalsa.todas[0].body.data.nodes.get('TERM')).toBeNull()
  })
})

describe('más de 20 clientes', () => {
  beforeEach(() => {
    const clientes = Array.from({ length: 23 }, (_, i) => ({ LOCID: 'CD', CUSTID: `C${String(i).padStart(2, '0')}` }))
    cargarRedDeSap.mockImplementation(async () => filas({ clientes }))
  })

  it('oculta los que pasan de 20 y lo dice, con el aviso de v7', async () => {
    await conRed()
    expect(document.querySelector('.nv-barra-estado').textContent)
      .toBe('25 nodos · 23 conexiones — 3 clientes ocultos automáticamente. Usa ▼ Filtros para ajustar.')
  })

  it('el botón pasa a «▼ Filtros (3)» en ámbar', async () => {
    await conRed()
    const filtros = botonQueEmpieza('▼ Filtros')
    expect(filtros.textContent).toBe('▼ Filtros (3)')
    expect(filtros.className).toContain('nv-filtros-activos')
  })
})

describe('la leyenda', () => {
  // v7: ocultar un tipo marca esos nodos `hidden` y vuelve a encuadrar, SIN recalcular la disposición.
  it('apagar «Cliente» oculta sus nodos y encuadra, sin reconstruir el lienzo', async () => {
    await conRed()
    const red = falso.RedFalsa.todas[0]
    const antes = red.llamadas.filter(([que]) => que === 'fit').length

    const casilla = [...document.querySelectorAll('.nv-leyenda label')]
      .find((una) => una.textContent === 'Cliente').querySelector('input')
    await pulsar(casilla)

    expect(falso.RedFalsa.todas).toHaveLength(1)
    expect(red.destruida).toBe(false)
    expect(red.body.data.nodes.get('CLI1').hidden).toBe(true)
    expect(red.body.data.nodes.get('PLANTA').hidden).toBe(false)
    expect(red.llamadas.filter(([que]) => que === 'fit')).toHaveLength(antes + 1)
  })

  it('volver a encenderla los muestra', async () => {
    await conRed()
    const casilla = [...document.querySelectorAll('.nv-leyenda label')]
      .find((una) => una.textContent === 'Proveedor').querySelector('input')
    await pulsar(casilla)
    await pulsar(casilla)
    expect(falso.RedFalsa.todas[0].body.data.nodes.get('PROV').hidden).toBe(false)
  })
})

describe('«⊞ Ajustar» y «⊟ Compactar»', () => {
  it('«Ajustar» encuadra la vista', async () => {
    await conRed()
    const antes = falso.RedFalsa.todas[0].llamadas.length
    await pulsar(boton('⊞ Ajustar'))
    expect(falso.RedFalsa.todas[0].llamadas.slice(antes)).toEqual([['fit', { animation: { duration: 500, easingFunction: 'easeInOutQuad' } }]])
  })

  it('«Compactar» reconstruye el grafo: destruye el lienzo y crea otro', async () => {
    await conRed()
    await pulsar(boton('⊟ Compactar'))
    expect(falso.RedFalsa.todas).toHaveLength(2)
    expect(falso.RedFalsa.todas[0].destruida).toBe(true)
  })
})

describe('el detalle del nodo', () => {
  it('«Seleccionado», la insignia del tipo, el código y el globo del nodo', async () => {
    await conRed()
    await act(async () => { falso.RedFalsa.todas[0].pulsarNodo('PLANTA') })
    const detalle = document.querySelector('.nv-detalle')
    expect(detalle.querySelector('.nv-detalle-rotulo').textContent).toBe('Seleccionado')
    expect(detalle.querySelector('.badge').textContent).toBe('Planta')
    expect(detalle.querySelector('.nv-detalle-id').textContent).toBe('PLANTA')
    expect(detalle.querySelector('.nv-detalle-titulo').textContent).toContain('Planta Quito')
    // Lo que una versión anterior añadió y v7 no tenía.
    expect(detalle.textContent).not.toContain('Le llega de')
    expect(detalle.textContent).not.toContain('Manda a')
  })

  it('un proveedor lista los «Insumos abastecidos (N):» con su descripción', async () => {
    await conRed()
    await act(async () => { falso.RedFalsa.todas[0].pulsarNodo('PROV') })
    const detalle = document.querySelector('.nv-detalle')
    expect(detalle.querySelector('.badge').textContent).toBe('Proveedor')
    expect(detalle.querySelector('.nv-detalle-insumos-titulo').textContent).toBe('Insumos abastecidos (1):')
    expect(detalle.querySelector('.nv-detalle-chip').textContent).toBe('MAT Un material')
  })

  it('la ✕ lo cierra', async () => {
    await conRed()
    await act(async () => { falso.RedFalsa.todas[0].pulsarNodo('PLANTA') })
    await pulsar(document.querySelector('.nv-detalle-cerrar'))
    expect(document.querySelector('.nv-detalle')).toBeNull()
  })
})

describe('«Filtros de red»', () => {
  async function abrirFiltros() {
    await conRed()
    await pulsar(botonQueEmpieza('▼ Filtros'))
  }

  it('el diálogo trae dos columnas, con buscador, «Seleccionar todo», «Limpiar todo» y «Aplicar»', async () => {
    await abrirFiltros()
    const dialogo = document.querySelector('dialog.nv-filtros')
    expect(dialogo.querySelector('.nv-filtros-nombre').textContent).toBe('Filtros de red')
    const columnas = dialogo.querySelectorAll('.nv-filtros-columna')
    expect([...columnas].map((una) => una.querySelector('.nv-filtros-titulo > span').textContent))
      .toEqual(['Ubicaciones', 'Clientes'])
    expect(dialogo.querySelectorAll('input[placeholder="Buscar... (ej: *T1, T1*, *US*)"]')).toHaveLength(2)
    expect(dialogo.textContent).toContain('Seleccionar todo')
    expect([...dialogo.querySelectorAll('button')].map((uno) => uno.textContent)).toContain('Limpiar todo')
    expect([...dialogo.querySelectorAll('button')].map((uno) => uno.textContent)).toContain('Aplicar')
  })

  it('cuenta «(N de M)» y el buscador admite comodines', async () => {
    await abrirFiltros()
    const ubicaciones = document.querySelectorAll('.nv-filtros-columna')[0]
    expect(ubicaciones.querySelector('.nv-filtros-cuenta').textContent).toBe('(4 de 4)')
    await escribir(ubicaciones.querySelector('.nv-filtros-buscar'), 'PLANTA*')
    expect(ubicaciones.querySelector('.nv-filtros-cuenta').textContent).toBe('(2 de 2)')
    await escribir(ubicaciones.querySelector('.nv-filtros-buscar'), '*ALMACEN')
    expect([...ubicaciones.querySelectorAll('.nv-filtros-id')].map((uno) => uno.textContent)).toEqual(['ALMACEN'])
  })

  it('apagar una ubicación y «Aplicar» reconstruye la red y pone «▼ Filtros (1)»', async () => {
    await abrirFiltros()
    const ubicaciones = document.querySelectorAll('.nv-filtros-columna')[0]
    const fila = [...ubicaciones.querySelectorAll('.nv-filtros-fila')].find((una) => una.textContent.includes('ALMACEN'))
    await pulsar(fila.querySelector('input'))
    await pulsar(boton('Aplicar'))

    expect(document.querySelector('dialog.nv-filtros')).toBeNull()
    expect(botonQueEmpieza('▼ Filtros').textContent).toBe('▼ Filtros (1)')
    expect(falso.RedFalsa.todas).toHaveLength(2)
    expect(falso.RedFalsa.todas[1].body.data.nodes.get('ALMACEN')).toBeNull()
  })

  // Diferencia consciente con v7: allí cerrar con ✕ dejaba los cambios puestos sin aplicarlos.
  it('cerrar con la ✕ descarta lo marcado', async () => {
    await abrirFiltros()
    const fila = [...document.querySelectorAll('.nv-filtros-fila')].find((una) => una.textContent.includes('ALMACEN'))
    await pulsar(fila.querySelector('input'))
    await pulsar(document.querySelector('.nv-filtros-x'))
    expect(botonQueEmpieza('▼ Filtros').textContent).toBe('▼ Filtros')
    expect(falso.RedFalsa.todas).toHaveLength(1)
  })

  it('«Limpiar todo» enciende todo y cierra', async () => {
    cargarRedDeSap.mockImplementation(async () => filas({
      clientes: Array.from({ length: 22 }, (_, i) => ({ LOCID: 'CD', CUSTID: `C${String(i).padStart(2, '0')}` })),
    }))
    await abrirFiltros()
    expect(botonQueEmpieza('▼ Filtros').textContent).toBe('▼ Filtros (2)')
    await pulsar(boton('Limpiar todo'))
    expect(botonQueEmpieza('▼ Filtros').textContent).toBe('▼ Filtros')
    expect(document.querySelector('dialog.nv-filtros')).toBeNull()
  })
})

describe('«⛶ Pantalla completa»', () => {
  async function abrirPantalla() {
    await conRed()
    await pulsar(boton('⛶ Pantalla completa'))
  }

  it('abre un diálogo con el código del material, «⊞ Ajustar», «⊟ Compactar» y «✕ Cerrar»', async () => {
    await abrirPantalla()
    const dialogo = document.querySelector('dialog.nv-pantalla')
    expect(dialogo.querySelector('.nv-pantalla-titulo').textContent).toBe('TERM')
    expect([...dialogo.querySelectorAll('.nv-pantalla-botones button')].map((uno) => uno.textContent))
      .toEqual(['⊞ Ajustar', '⊟ Compactar', '✕ Cerrar'])
  })

  it('tiene su propio lienzo, su propia leyenda y el panel Rutas', async () => {
    await abrirPantalla()
    const dialogo = document.querySelector('dialog.nv-pantalla')
    expect(falso.RedFalsa.todas).toHaveLength(2)
    expect(dialogo.querySelector('.nv-leyenda-titulo').textContent).toBe('Leyenda')
    expect(dialogo.querySelectorAll('.nv-leyenda input')).toHaveLength(4)
    expect(dialogo.querySelector('.nv-rutas--pantalla')).not.toBeNull()
  })

  it('la leyenda de la pantalla completa y la de la página son la misma', async () => {
    await abrirPantalla()
    const dialogo = document.querySelector('dialog.nv-pantalla')
    const casilla = [...dialogo.querySelectorAll('.nv-leyenda label')]
      .find((una) => una.textContent === 'Cliente').querySelector('input')
    await pulsar(casilla)

    const principal = [...document.querySelectorAll('.nv-lienzo-caja .nv-leyenda label')]
      .find((una) => una.textContent === 'Cliente').querySelector('input')
    expect(principal.checked).toBe(false)
    expect(falso.RedFalsa.todas[1].body.data.nodes.get('CLI1').hidden).toBe(true)
  })

  it('tiene su propio detalle de nodo', async () => {
    await abrirPantalla()
    await act(async () => { falso.RedFalsa.todas[1].pulsarNodo('CD') })
    const detalle = document.querySelector('dialog.nv-pantalla .nv-pantalla-detalle')
    expect(detalle.textContent).toContain('CD')
    expect(document.querySelector('.nv-detalle')).toBeNull()
  })

  it('«✕ Cerrar» lo cierra y destruye su lienzo', async () => {
    await abrirPantalla()
    await pulsar(boton('✕ Cerrar'))
    expect(document.querySelector('dialog.nv-pantalla')).toBeNull()
    expect(falso.RedFalsa.todas[1].destruida).toBe(true)
  })

  it('«⊟ Compactar» reconstruye solo el de la pantalla completa', async () => {
    await abrirPantalla()
    await pulsar([...document.querySelectorAll('dialog.nv-pantalla button')].find((uno) => uno.textContent === '⊟ Compactar'))
    expect(falso.RedFalsa.todas).toHaveLength(3)
    expect(falso.RedFalsa.todas[0].destruida).toBe(false)
    expect(falso.RedFalsa.todas[1].destruida).toBe(true)
  })
})

describe('el panel «Rutas»', () => {
  it('plegado: «▶ Rutas» y el resumen al lado, con las plantas huérfanas', async () => {
    await conRed()
    const panel = document.querySelector('.nv-rutas')
    expect(panel.querySelector('.nv-rutas-boton').textContent).toBe('▶ Rutas')
    expect(panel.querySelector('.nv-rutas-texto').textContent)
      .toBe('1 con llegada a cliente · 1 sin llegada a cliente (1 dead-end) · ⚠ 1 planta huérfana: PLANTA2')
    expect(panel.querySelector('.nv-rutas-cuerpo')).toBeNull()
  })

  it('desplegado: «▼ Rutas», «Tipo:» y la tabla con las columnas de v7', async () => {
    await conRed()
    await pulsar(document.querySelector('.nv-rutas-boton'))
    const panel = document.querySelector('.nv-rutas')
    expect(panel.querySelector('.nv-rutas-boton').textContent).toBe('▼ Rutas')
    expect(panel.querySelector('.nv-rutas-rotulo').textContent).toBe('Tipo:')
    expect([...panel.querySelectorAll('.nv-rutas-filtros > .nv-rutas-filtro')].map((uno) => uno.textContent))
      .toEqual(['Todas', 'Con llegada a cliente', 'Sin llegada a cliente'])
    expect([...panel.querySelectorAll('th')].map((uno) => uno.textContent)).toEqual(['#', 'Tipo', 'Ruta', 'Termina en', 'Saltos'])
    const filas = [...panel.querySelectorAll('tbody tr')]
    expect(filas).toHaveLength(2)
    expect(filas[0].textContent).toContain('✓ Con llegada a cliente')
    expect(filas[0].textContent).toContain('PLANTA → CD → CLI1')
    expect(filas[1].textContent).toContain('⚠ Sin llegada · Dead-end')
  })

  it('«Sin llegada a cliente» muestra «Causa:» con «Todas / Dead-end / Ciclo»', async () => {
    await conRed()
    await pulsar(document.querySelector('.nv-rutas-boton'))
    expect(document.querySelector('.nv-rutas-causa')).toBeNull()
    await pulsar([...document.querySelectorAll('.nv-rutas-filtro')].find((uno) => uno.textContent === 'Sin llegada a cliente'))
    const causa = document.querySelector('.nv-rutas-causa')
    expect(causa.querySelector('.nv-rutas-rotulo').textContent).toBe('Causa:')
    expect([...causa.querySelectorAll('.nv-rutas-filtro')].map((uno) => uno.textContent)).toEqual(['Todas', 'Dead-end', 'Ciclo'])
    expect(document.querySelectorAll('.nv-rutas tbody tr')).toHaveLength(1)
  })

  it('un clic en una fila resalta la ruta en el grafo: selecciona nodos y arcos y enfoca', async () => {
    await conRed()
    await pulsar(document.querySelector('.nv-rutas-boton'))
    await pulsar(document.querySelector('.nv-rutas tbody tr'))

    const llamadas = falso.RedFalsa.todas[0].llamadas
    expect(llamadas).toContainEqual(['selectNodes', ['PLANTA', 'CD', 'CLI1']])
    expect(llamadas).toContainEqual(['selectEdges', ['PLANTA->CD', 'CD->CLI1']])
    const enfoque = llamadas.find(([que]) => que === 'focus')
    expect(enfoque[1]).toBe('PLANTA')
    expect(enfoque[2].scale).toBe(0.85)
  })

  it('si la ruta pasa por algo apagado en los filtros, lo enciende y reconstruye antes de resaltar', async () => {
    await conRed()
    await pulsar(boton('▼ Filtros'))
    const fila = [...document.querySelectorAll('.nv-filtros-fila')].find((una) => una.textContent.includes('CD'))
    await pulsar(fila.querySelector('input'))
    await pulsar(boton('Aplicar'))
    expect(falso.RedFalsa.todas[1].body.data.nodes.get('CD')).toBeNull()

    await pulsar(document.querySelector('.nv-rutas-boton'))
    await pulsar(document.querySelector('.nv-rutas tbody tr'))

    expect(botonQueEmpieza('▼ Filtros').textContent).toBe('▼ Filtros')
    const ultima = falso.RedFalsa.todas.at(-1)
    expect(ultima.body.data.nodes.get('CD')).not.toBeNull()
    expect(ultima.llamadas).toContainEqual(['selectNodes', ['PLANTA', 'CD', 'CLI1']])
  })

  it('«↓ Exportar CSV» baja TODAS las rutas, sin filtrar, con el nombre de v7', async () => {
    await conRed()
    await pulsar(document.querySelector('.nv-rutas-boton'))
    await pulsar([...document.querySelectorAll('.nv-rutas-filtro')].find((uno) => uno.textContent === 'Con llegada a cliente'))
    await pulsar(boton('↓ Exportar CSV'))

    expect(descargarTexto).toHaveBeenCalledTimes(1)
    const [csv, nombre, tipo] = descargarTexto.mock.calls[0]
    expect(nombre).toBe('Rutas_TERM.csv')
    expect(tipo).toBe('text/csv')
    expect(csv.split('\n')).toHaveLength(3)
    expect(csv.split('\n')[0]).toBe('"#","Tipo","Causa","Planta","Ruta","Termina en","Cliente","# Saltos"')
    expect(csv.charCodeAt(0)).toBe('"'.charCodeAt(0))
  })

  it('en la pantalla completa el filtro es el mismo que en la página', async () => {
    await conRed()
    await pulsar(document.querySelector('.nv-rutas-boton'))
    await pulsar([...document.querySelectorAll('.nv-rutas-filtro')].find((uno) => uno.textContent === 'Sin llegada a cliente'))
    await pulsar(boton('⛶ Pantalla completa'))

    const enPantalla = document.querySelector('dialog.nv-pantalla .nv-rutas--pantalla')
    await pulsar(enPantalla.querySelector('.nv-rutas-boton'))
    expect(enPantalla.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(enPantalla.querySelector('.nv-rutas-causa')).not.toBeNull()
  })

  it('al elegir otro material y cargarlo, el panel vuelve a empezar plegado', async () => {
    await conRed()
    await pulsar(document.querySelector('.nv-rutas-boton'))
    await escribir(document.querySelector('[aria-label="Buscar material"]'), 'MAT')
    await pulsar(document.querySelector('.ss-opt'))
    await pulsar(boton('Cargar red logística'))
    await vi.waitFor(() => { if (!document.querySelector('.nv-rutas')) throw new Error('aún sin rutas') })
    expect(document.querySelector('.nv-rutas-boton').textContent).toBe('▶ Rutas')
  })
})
