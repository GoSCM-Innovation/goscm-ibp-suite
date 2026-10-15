// @vitest-environment jsdom
//
// Armar una orquestación en la pantalla de verdad: la paleta, la secuencia, los grupos paralelos y el guardado automático.
//
// Lo que se mira es lo que se rompe en silencio:
//   - que el grafo que se guarda sea el que se dibujó (pasos encadenados y grupos con sus integraciones);
//   - que dos cambios seguidos se SUMEN, y que el último no se pierda al cambiar de pantalla;
//   - que una orquestación hecha con el editor de etapas (sin grupos) se lea como pasos y grupos;
//   - que lo que se ejecuta sea lo guardado, con los valores que se confirmaron.

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const orquestaciones = { saveOrchestration: vi.fn() }
vi.mock('../../lib/orchestrations.js', async (importOriginal) => ({ ...(await importOriginal()), ...orquestaciones }))
vi.mock('../../lib/ci.js', async (importOriginal) => ({ ...(await importOriginal()), infoDeOrquestacion: vi.fn() }))

const { infoDeOrquestacion } = await import('../../lib/ci.js')
const { grafoDePasos, grupoNuevo, pasoDeIntegracion } = await import('../../lib/ci-pasos.js')
const { default: ConstructorDeOrquestacion } = await import('./ConstructorDeOrquestacion.jsx')
const {
  boton, desmontar, dom, elegir, escribir, marcar, montar, porEtiqueta, pulsar, texto,
} = await import('./ayudas-de-prueba.js')

const CONEXION = { id: 'conn-1', name: 'CPI desarrollo', baseUrl: 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: false }

const resumen = (extra) => ({ valido: true, tipo: 'KEYFIGURES', comando: 'REPLACE', destino: '', variables: [], ...extra })
const INTEGRACIONES = [
  { id: 'int-a', name: 'MAESTRO', folder: 'AREA', resumen: resumen({ tipo: 'MASTERDATA', comando: 'INSERT_UPDATE', destino: 'SBPRODUCT' }) },
  { id: 'int-b', name: 'FACTURAS', folder: 'AREA', resumen: resumen({ variables: ['DESDE'], destino: 'SBINVOICE' }) },
  { id: 'int-c', name: 'PRODUCCION', folder: '', resumen: resumen() },
]

const paso = (id, integracion, extra = {}) => ({ ...pasoDeIntegracion(INTEGRACIONES.find((una) => una.id === integracion), id), ...extra })
const grupo = (id, hijos = [], extra = {}) => ({ ...grupoNuevo(id), children: hijos, ...extra })
const orquestacion = (pasos = [], extra = {}) => ({ id: 'o-1', name: 'Carga diaria', connectionId: 'conn-1', ...grafoDePasos(pasos), ...extra })

/** Un grafo como lo dejaba el editor de etapas: sin grupos, cada paso de una etapa conectado con todos los de la siguiente. */
function orquestacionDeEtapas(etapas) {
  const nodes = etapas.flat().map((una) => ({ id: una.id, type: 'task', data: { label: una.label, integrationId: una.integrationId, errorStrategy: 'stop', maxRetries: 0, retryDelaySeconds: 60 } }))
  const edges = []
  etapas.forEach((etapa, i) => {
    if (i === 0) return
    for (const antes of etapas[i - 1]) for (const despues of etapa) edges.push({ id: `e-${antes.id}-${despues.id}`, source: antes.id, target: despues.id })
  })
  return { id: 'o-1', name: 'Carga diaria', connectionId: 'conn-1', nodes, edges }
}

const props = (extra = {}) => ({
  connection: CONEXION,
  orquestacion: orquestacion(),
  integraciones: INTEGRACIONES,
  hayEjecucion: false,
  onVerEjecucion: vi.fn(),
  onArrancar: vi.fn(async () => ({})),
  onGuardada: vi.fn(),
  pantallaCompleta: false,
  onAlternarPantallaCompleta: vi.fn(),
  ...extra,
})

/** Un botón DENTRO del diálogo: con el diálogo abierto, el del editor de atrás tiene el mismo texto. */
const botonDelDialogo = (nombre) => [...dom().querySelectorAll('.modal button')].find((uno) => uno.textContent.trim() === nombre)

/** Deja pasar el tiempo (y lo que quede pendiente) dentro de `act`. */
const pasar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

const guardadoCon = (i = -1) => orquestaciones.saveOrchestration.mock.calls.at(i)[1]
const integraciones = (grafo) => grafo.nodes.filter((nodo) => nodo.type === 'task').map((nodo) => nodo.data.integrationId)
const aristas = (grafo) => grafo.edges.map((e) => `${e.source}->${e.target}`)
const tarjetas = () => [...dom().querySelectorAll('.ci-orq-tarjeta')]

/** Un evento de arrastre. jsdom no trae `DragEvent`: basta con uno de ratón, y el componente no necesita `dataTransfer`. */
const arrastre = (tipo) => new MouseEvent(tipo, { bubbles: true, cancelable: true, clientY: 0 })
const disparar = (elemento, tipo) => act(async () => { elemento.dispatchEvent(arrastre(tipo)) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  orquestaciones.saveOrchestration.mockImplementation(async (id, cambios) => ({ id, name: 'Carga diaria', ...cambios }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(async () => {
  await desmontar()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('lo que se dibuja', () => {
  it('muestra los pasos y los grupos de la orquestación guardada', async () => {
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: orquestacion([paso('p1', 'int-a'), grupo('g', [paso('p2', 'int-b'), paso('p3', 'int-c')])]),
    }))

    expect(dom().querySelectorAll('.ci-orq-tarjeta')).toHaveLength(2)
    expect(texto()).toContain('Grupo paralelo')
    expect(texto()).toContain('2 integraciones')
    expect(texto()).toContain('AREA · SBPRODUCT · INSERT_UPDATE')
    expect(dom().querySelectorAll('.ci-orq-hijo')).toHaveLength(2)
    expect(texto()).toContain('pide {{DESDE}}')
  })

  it('una orquestación hecha con el editor de etapas se lee como pasos y grupos', async () => {
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: orquestacionDeEtapas([[paso('p1', 'int-a')], [paso('p2', 'int-b'), paso('p3', 'int-c')]]),
    }))

    // Una etapa con una integración es un paso; con varias, un grupo paralelo.
    expect(dom().querySelectorAll('.ci-orq-tarjeta')).toHaveLength(2)
    expect(tarjetas()[1].classList.contains('grupo')).toBe(true)
    expect(dom().querySelectorAll('.ci-orq-hijo')).toHaveLength(2)
    expect(texto()).not.toContain('no se pueden mostrar como una lista')
  })

  it('una orquestación vacía dice qué hacer, y no se puede ejecutar', async () => {
    await montar(ConstructorDeOrquestacion, props())
    expect(texto()).toContain('Sin pasos configurados.')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
  })

  it('un paso que apunta a una integración borrada lo dice', async () => {
    const huerfano = { ...paso('p1', 'int-a'), integrationId: 'borrada', label: 'VIEJA' }
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([huerfano]) }))
    expect(texto()).toContain('VIEJA')
    expect(texto()).toContain('La integración ya no existe')
  })

  // Dos cadenas independientes no son una lista: mostrarlas como si lo fueran enseñaría otra cosa.
  it('un grafo que no se puede mostrar como lista lo avisa, no se edita y no deja ejecutar hasta convertirlo', async () => {
    const { nodes } = orquestacionDeEtapas([[paso('a', 'int-a'), paso('b', 'int-b'), paso('c', 'int-c'), paso('d', 'int-a')]])
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: { id: 'o-1', name: 'X', nodes, edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'c', target: 'd' }] },
    }))

    expect(texto()).toContain('no se pueden mostrar como una lista')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
    expect(dom().querySelector('.ci-orq-secuencia').hasAttribute('inert')).toBe(true)
    expect(dom().querySelector('.ci-orq-paleta-caja').hasAttribute('inert')).toBe(true)

    // Mientras no se convierte, no se guarda nada: guardarla así la cambiaría sin que se pidiera.
    await pasar(2000)
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()

    await pulsar(boton('Convertir a lista'))
    expect(window.confirm).toHaveBeenCalled()
    expect(texto()).not.toContain('no se pueden mostrar como una lista')
    expect(boton('▶ Ejecutar').disabled).toBe(false)
    await pasar(800)
    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    // Cada paso queda detrás del anterior, en el orden en que corrían.
    expect(aristas(guardadoCon())).toHaveLength(3)
  })

  it('si no se confirma la conversión, sigue como estaba', async () => {
    window.confirm.mockReturnValue(false)
    const { nodes } = orquestacionDeEtapas([[paso('a', 'int-a'), paso('b', 'int-b'), paso('c', 'int-c'), paso('d', 'int-a')]])
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: { id: 'o-1', name: 'X', nodes, edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'c', target: 'd' }] },
    }))
    await pulsar(boton('Convertir a lista'))
    await pasar(2000)
    expect(texto()).toContain('no se pueden mostrar como una lista')
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()
  })
})

describe('la paleta', () => {
  it('lista las integraciones por carpeta, con a qué cargan', async () => {
    await montar(ConstructorDeOrquestacion, props())
    const paleta = dom().querySelector('.ci-orq-paleta')
    expect(paleta.textContent).toContain('AREA')
    expect(paleta.textContent).toContain('Sin carpeta')
    expect(paleta.textContent).toContain('SBPRODUCT · INSERT_UPDATE')
    expect(paleta.querySelectorAll('.ci-orq-paleta-fila')).toHaveLength(3)
  })

  it('el buscador deja solo las que coinciden', async () => {
    await montar(ConstructorDeOrquestacion, props())
    await escribir(porEtiqueta('Buscar integración'), 'factu')
    const filas = [...dom().querySelectorAll('.ci-orq-paleta-fila')]
    expect(filas).toHaveLength(1)
    expect(filas[0].textContent).toContain('FACTURAS')

    await escribir(porEtiqueta('Buscar integración'), 'zzz')
    expect(texto()).toContain('Sin coincidencias')
  })

  it('sin integraciones en la conexión, manda a crearlas', async () => {
    await montar(ConstructorDeOrquestacion, props({ integraciones: [] }))
    expect(texto()).toContain('Todavía no hay integraciones en esta conexión')
  })
})

describe('el guardado automático', () => {
  it('agregar una integración la guarda sola a los 800 ms, con el grafo que se dibujó', async () => {
    const p = props()
    await montar(ConstructorDeOrquestacion, p)

    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()
    expect(texto()).toContain('Cambios sin guardar')

    await pasar(800)
    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(orquestaciones.saveOrchestration.mock.calls[0][0]).toBe('o-1')
    expect(integraciones(guardadoCon())).toEqual(['int-a'])
    expect(guardadoCon().edges).toEqual([])
    expect(texto()).toContain('✓ Guardado')
    expect(p.onGuardada).toHaveBeenCalled()
  })

  it('dos cambios seguidos se suman en UN guardado, y los pasos quedan encadenados', async () => {
    await montar(ConstructorDeOrquestacion, props())
    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    await pulsar(porEtiqueta('Agregar a la secuencia: FACTURAS'))
    await pasar(800)

    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(integraciones(guardadoCon())).toEqual(['int-a', 'int-b'])
    expect(aristas(guardadoCon())).toHaveLength(1)
  })

  it('«⊞ Nuevo grupo paralelo» agrega un grupo vacío, que se puede guardar', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a')]) }))
    await pulsar(boton('⊞ Nuevo grupo paralelo'))
    await pasar(800)

    const grupos = guardadoCon().nodes.filter((nodo) => nodo.type === 'group')
    expect(grupos).toHaveLength(1)
    expect(aristas(guardadoCon())).toEqual([`p1->${grupos[0].id}`])
    expect(texto()).toContain('Sin integraciones en el grupo')
  })

  it('el modo grupo mete las integraciones en el grupo elegido, y «Cancelar» lo deja', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([grupo('g')]) }))
    await pulsar(boton('+ Agregar integración al grupo'))
    expect(texto()).toContain('Modo grupo activo')

    await pulsar(porEtiqueta('Agregar al grupo: FACTURAS'))
    await pulsar(porEtiqueta('Agregar al grupo: PRODUCCION'))
    await pasar(800)

    const hijos = guardadoCon().nodes.filter((nodo) => nodo.parentId === 'g')
    expect(hijos.map((nodo) => nodo.data.integrationId)).toEqual(['int-b', 'int-c'])
    // Las del grupo no se conectan entre sí: así el motor las lanza a la vez.
    expect(guardadoCon().edges).toEqual([])
    expect(texto()).toContain('Modo grupo activo')

    await pulsar(boton('✕ Cancelar'))
    expect(texto()).not.toContain('Modo grupo activo')
    expect(porEtiqueta('Agregar a la secuencia: MAESTRO')).not.toBeNull()
  })

  it('quitar un paso lo saca; quitar un grupo se lleva sus integraciones', async () => {
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: orquestacion([paso('p1', 'int-a'), grupo('g', [paso('p2', 'int-b')]), paso('p3', 'int-c')]),
    }))
    await pulsar(porEtiqueta('Quitar MAESTRO'))
    await pulsar(porEtiqueta('Quitar grupo 1'))
    await pasar(800)

    expect(integraciones(guardadoCon())).toEqual(['int-c'])
    expect(guardadoCon().nodes).toHaveLength(1)
  })

  it('quitar una integración de un grupo solo saca esa', async () => {
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: orquestacion([grupo('g', [paso('p2', 'int-b'), paso('p3', 'int-c')])]),
    }))
    await pulsar(porEtiqueta('Quitar FACTURAS del grupo'))
    await pasar(800)
    expect(guardadoCon().nodes.filter((nodo) => nodo.parentId === 'g').map((nodo) => nodo.data.integrationId)).toEqual(['int-c'])
  })

  it('↑ y ↓ cambian el orden, y las conexiones lo siguen', async () => {
    await montar(ConstructorDeOrquestacion, props({
      orquestacion: orquestacion([paso('p1', 'int-a'), paso('p2', 'int-b'), paso('p3', 'int-c')]),
    }))
    await pulsar(porEtiqueta('Subir FACTURAS'))
    await pasar(800)
    expect(guardadoCon().nodes.map((nodo) => nodo.id)).toEqual(['p2', 'p1', 'p3'])
    expect(aristas(guardadoCon())).toEqual(['p2->p1', 'p1->p3'])

    await pulsar(porEtiqueta('Bajar PRODUCCION'))
    await pasar(800)
    expect(guardadoCon().nodes.map((nodo) => nodo.id)).toEqual(['p2', 'p1', 'p3'])
  })

  it('los de los bordes no se mueven hacia fuera', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a'), paso('p2', 'int-b')]) }))
    expect(porEtiqueta('Subir MAESTRO').disabled).toBe(true)
    expect(porEtiqueta('Bajar FACTURAS').disabled).toBe(true)
  })

  it('un error al guardar se dice y no se da por guardado', async () => {
    orquestaciones.saveOrchestration.mockRejectedValue(new Error('Hay un ciclo'))
    await montar(ConstructorDeOrquestacion, props())
    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    await pasar(800)

    expect(texto()).toContain('Hay un ciclo')
    expect(texto()).toContain('No se pudo guardar')
  })

  // Cambiar de pantalla a medio debounce no debe perder el último cambio.
  it('al desmontar guarda lo que estuviera pendiente', async () => {
    await montar(ConstructorDeOrquestacion, props())
    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()

    await desmontar()
    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(integraciones(guardadoCon())).toEqual(['int-a'])
  })

  it('al desmontar sin cambios no guarda nada', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a')]) }))
    await desmontar()
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()
  })

  // El guardado devuelve lo que guardó: un cambio que llegó mientras tanto no se da por guardado.
  it('un cambio que llega mientras se guarda otro queda pendiente y se guarda después', async () => {
    let terminar
    orquestaciones.saveOrchestration.mockImplementationOnce(() => new Promise((resolver) => { terminar = () => resolver({ id: 'o-1', name: 'Carga diaria' }) }))
    await montar(ConstructorDeOrquestacion, props())
    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    await pasar(800)
    expect(texto()).toContain('Guardando…')

    await pulsar(porEtiqueta('Agregar a la secuencia: FACTURAS'))
    await act(async () => { terminar() })
    // El primer guardado terminó, pero hay un cambio nuevo: no puede decir «Guardado».
    expect(texto()).toContain('Cambios sin guardar')

    await pasar(800)
    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(2)
    expect(integraciones(guardadoCon())).toEqual(['int-a', 'int-b'])
    expect(texto()).toContain('✓ Guardado')
  })
})

describe('qué hacer si un paso falla', () => {
  it('por omisión, detener', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a')]) }))
    expect(porEtiqueta('Si falla: MAESTRO').value).toBe('stop')
  })

  it('«Reintentar» pone al menos un reintento, enseña reintentos y espera, y avisa que repite la carga entera', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a')]) }))
    await elegir(porEtiqueta('Si falla: MAESTRO'), 'retry')
    await pasar(800)

    expect(guardadoCon().nodes[0].data).toMatchObject({ errorStrategy: 'retry', maxRetries: 1, retryDelaySeconds: 60 })
    expect(porEtiqueta('Reintentos: MAESTRO').value).toBe('1')
    expect(porEtiqueta('Espera: MAESTRO').value).toBe('60')
    expect(texto()).toContain('Reintentar repite la carga completa')
  })

  it('los reintentos se escriben de a poco y se llevan al rango al salir del campo', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a', { errorStrategy: 'retry', maxRetries: 1 })]) }))

    await escribir(porEtiqueta('Reintentos: MAESTRO'), '2')
    await pasar(800)
    expect(guardadoCon().nodes[0].data.maxRetries).toBe(2)

    // 5 está fuera de rango (el máximo es 3): no se guarda mientras se escribe.
    await escribir(porEtiqueta('Reintentos: MAESTRO'), '5')
    await pasar(800)
    expect(guardadoCon().nodes[0].data.maxRetries).toBe(2)

    await act(async () => { porEtiqueta('Reintentos: MAESTRO').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(porEtiqueta('Reintentos: MAESTRO').value).toBe('3')
    await pasar(800)
    expect(guardadoCon().nodes[0].data.maxRetries).toBe(3)
  })

  it('la espera se puede escribir de a poco: «30» no se corrige a 10 en el «3»', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a', { errorStrategy: 'retry', maxRetries: 1 })]) }))
    await escribir(porEtiqueta('Espera: MAESTRO'), '3')
    expect(porEtiqueta('Espera: MAESTRO').value).toBe('3')
    await escribir(porEtiqueta('Espera: MAESTRO'), '30')
    await pasar(800)
    expect(guardadoCon().nodes[0].data.retryDelaySeconds).toBe(30)
  })

  it('un grupo ofrece detener o continuar, pero no reintentar: el motor reintenta cada integración', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([grupo('g', [paso('p2', 'int-b')], { label: 'Cifras' })]) }))
    const opciones = [...porEtiqueta('Si falla: Cifras').options].map((una) => una.value)
    expect(opciones).toEqual(['stop', 'continue'])

    await elegir(porEtiqueta('Si falla: Cifras'), 'continue')
    await pasar(800)
    expect(guardadoCon().nodes.find((nodo) => nodo.id === 'g').data.errorStrategy).toBe('continue')
  })

  it('la estrategia de una integración dentro de un grupo es la suya', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([grupo('g', [paso('p2', 'int-b'), paso('p3', 'int-c')])]) }))
    await elegir(porEtiqueta('Si falla: PRODUCCION'), 'continue')
    await pasar(800)
    const nodos = guardadoCon().nodes
    expect(nodos.find((nodo) => nodo.id === 'p3').data.errorStrategy).toBe('continue')
    expect(nodos.find((nodo) => nodo.id === 'p2').data.errorStrategy).toBe('stop')
    expect(nodos.find((nodo) => nodo.id === 'g').data.errorStrategy).toBe('stop')
  })

  it('la descripción de un grupo se guarda', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([grupo('g')]) }))
    await escribir(porEtiqueta('Descripción del grupo 1'), 'Cifras del día')
    await pasar(800)
    expect(guardadoCon().nodes[0].data.label).toBe('Cifras del día')
  })

  it('un grupo se pliega y se despliega', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([grupo('g', [paso('p2', 'int-b')], { label: 'Cifras' })]) }))
    expect(dom().querySelector('.ci-orq-hijos')).not.toBeNull()
    await pulsar(porEtiqueta('Plegar Cifras'))
    expect(dom().querySelector('.ci-orq-hijos')).toBeNull()
    await pulsar(porEtiqueta('Desplegar Cifras'))
    expect(dom().querySelector('.ci-orq-hijos')).not.toBeNull()
  })
})

describe('arrastrar para reordenar', () => {
  const tres = () => orquestacion([paso('p1', 'int-a'), paso('p2', 'int-b'), paso('p3', 'int-c')])

  it('arrastrar una tarjeta sobre otra enseña dónde va a caer, y soltarla la mueve', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: tres() }))
    await disparar(tarjetas()[0], 'dragstart')
    await disparar(tarjetas()[2], 'dragover')
    expect(dom().querySelectorAll('.ci-orq-linea')).toHaveLength(1)

    await disparar(tarjetas()[2], 'drop')
    expect(dom().querySelectorAll('.ci-orq-linea')).toHaveLength(0)
    await pasar(800)
    // En jsdom las cajas miden cero, así que cae en la mitad de abajo.
    expect(guardadoCon().nodes.map((nodo) => nodo.id)).toEqual(['p2', 'p3', 'p1'])
    expect(aristas(guardadoCon())).toEqual(['p2->p3', 'p3->p1'])
  })

  it('soltar una tarjeta sobre sí misma no cambia nada', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: tres() }))
    await disparar(tarjetas()[0], 'dragstart')
    await disparar(tarjetas()[0], 'dragover')
    expect(dom().querySelectorAll('.ci-orq-linea')).toHaveLength(0)
    await disparar(tarjetas()[0], 'drop')
    await pasar(800)
    expect(orquestaciones.saveOrchestration).not.toHaveBeenCalled()
  })

  it('al salir de la tarjeta se quita la línea', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: tres() }))
    await disparar(tarjetas()[0], 'dragstart')
    await disparar(tarjetas()[1], 'dragover')
    expect(dom().querySelectorAll('.ci-orq-linea')).toHaveLength(1)
    await disparar(tarjetas()[1], 'dragleave')
    expect(dom().querySelectorAll('.ci-orq-linea')).toHaveLength(0)
  })
})

describe('el nombre', () => {
  it('se guarda junto con lo demás, sin esperar a salir del campo', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a')]) }))
    await escribir(porEtiqueta('Nombre de la orquestación'), 'Carga nocturna')
    await pasar(800)
    expect(guardadoCon().name).toBe('Carga nocturna')
  })

  it('sin cambiarlo, no se manda', async () => {
    await montar(ConstructorDeOrquestacion, props())
    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    await pasar(800)
    expect(guardadoCon().name).toBeUndefined()
  })

  it('un nombre vacío vuelve al anterior al salir del campo y nunca se manda', async () => {
    await montar(ConstructorDeOrquestacion, props())
    const campo = porEtiqueta('Nombre de la orquestación')
    await escribir(campo, '   ')
    await act(async () => { campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(campo.value).toBe('Carga diaria')
    await pasar(800)
    expect(orquestaciones.saveOrchestration.mock.calls.every(([, cambios]) => cambios.name === undefined)).toBe(true)
  })
})

describe('la cabecera', () => {
  it('«Pantalla completa» avisa a quien la maneja, y dice «Salir» cuando ya lo está', async () => {
    const p = props()
    await montar(ConstructorDeOrquestacion, p)
    await pulsar(boton('Pantalla completa'))
    expect(p.onAlternarPantallaCompleta).toHaveBeenCalledTimes(1)
  })

  it('en pantalla completa ofrece salir', async () => {
    await montar(ConstructorDeOrquestacion, props({ pantallaCompleta: true }))
    expect(boton('Salir de pantalla completa')).toBeDefined()
  })

  it('«Ver última ejecución» solo está si hay una', async () => {
    await montar(ConstructorDeOrquestacion, props())
    expect(boton('Ver última ejecución')).toBeUndefined()
    await desmontar()

    const p = props({ hayEjecucion: true })
    await montar(ConstructorDeOrquestacion, p)
    await pulsar(boton('Ver última ejecución'))
    expect(p.onVerEjecucion).toHaveBeenCalledTimes(1)
  })
})

describe('lanzar la orquestación', () => {
  const conGrupo = () => orquestacion([paso('p1', 'int-a'), grupo('g', [paso('p2', 'int-b'), paso('p3', 'int-c')])])

  beforeEach(() => {
    infoDeOrquestacion.mockResolvedValue({
      pasos: [
        { nodeId: 'p1', label: 'MAESTRO', integrationId: 'int-a', variables: [], integracion: INTEGRACIONES[0] },
        { nodeId: 'p2', label: 'FACTURAS', integrationId: 'int-b', variables: ['DESDE'], integracion: INTEGRACIONES[1] },
        { nodeId: 'p3', label: 'PRODUCCION', integrationId: 'int-c', variables: [], integracion: INTEGRACIONES[2] },
      ],
      variables: ['DESDE'],
      variablesDeFecha: [],
      rotos: [],
      ultimas: { DESDE: '20261005' },
    })
  })

  it('guarda lo pendiente, pide los valores con los de la última vez y arranca con ellos', async () => {
    const p = props({ orquestacion: conGrupo() })
    await montar(ConstructorDeOrquestacion, p)

    // Un cambio pendiente: lo que se ejecuta tiene que ser lo que se ve.
    await pulsar(porEtiqueta('Subir grupo 2'))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    expect(orquestaciones.saveOrchestration).toHaveBeenCalledTimes(1)
    expect(infoDeOrquestacion).toHaveBeenCalledWith('o-1')
    expect(texto()).toContain('Ejecutar «Carga diaria»')
    expect(texto()).toContain('CPI desarrollo')
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('20261005')

    await escribir(dom().querySelector('#ci-var-DESDE'), '20261014')
    await pulsar(botonDelDialogo('▶ Ejecutar'))
    await pasar(0)
    expect(p.onArrancar).toHaveBeenCalledWith({ DESDE: '20261014' })
  })

  it('el diálogo dice el orden: el número de paso, y cuáles de un grupo corren a la vez', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: conGrupo() }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    expect(texto()).toContain('Se ejecutarán, en este orden (3)')
    expect(texto()).toContain('Paso 1 · AREA / MAESTRO')
    expect(texto()).toContain('Paso 2 (a la vez) · AREA / FACTURAS')
    expect(texto()).toContain('Paso 2 (a la vez) · PRODUCCION')
  })

  it('una variable que es una fecha se pide con un calendario', async () => {
    infoDeOrquestacion.mockResolvedValue({ ...(await infoDeOrquestacion()), variablesDeFecha: ['DESDE'] })
    await montar(ConstructorDeOrquestacion, props({ orquestacion: conGrupo() }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    const campo = dom().querySelector('#ci-var-DESDE')
    expect(campo.type).toBe('date')
    expect(campo.value).toBe('2026-10-05')
  })

  it('con un paso roto no abre el diálogo y dice cuál', async () => {
    infoDeOrquestacion.mockResolvedValue({
      pasos: [{ nodeId: 'p1', label: 'VIEJA', integrationId: 'x', variables: [], integracion: null }],
      variables: [], rotos: ['p1'], ultimas: {},
    })
    await montar(ConstructorDeOrquestacion, props({ orquestacion: conGrupo() }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    expect(texto()).toContain('«VIEJA» apunta a una integración que ya no existe')
    expect(dom().querySelector('.modal')).toBeNull()
  })

  it('si guardar falla, no se ejecuta', async () => {
    orquestaciones.saveOrchestration.mockRejectedValue(new Error('Hay un ciclo'))
    await montar(ConstructorDeOrquestacion, props({ orquestacion: conGrupo() }))
    await pulsar(porEtiqueta('Subir grupo 2'))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)

    expect(texto()).toContain('Hay un ciclo')
    expect(infoDeOrquestacion).not.toHaveBeenCalled()
    expect(dom().querySelector('.modal')).toBeNull()
  })

  it('si el servidor no deja arrancar, el diálogo sigue abierto con el motivo', async () => {
    const p = props({ orquestacion: conGrupo(), onArrancar: vi.fn().mockRejectedValue(Object.assign(new Error('Ya hay una ejecución activa'), { status: 409 })) })
    await montar(ConstructorDeOrquestacion, p)
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)
    await pulsar(botonDelDialogo('▶ Ejecutar'))
    await pasar(0)

    expect(texto()).toContain('Ya hay una ejecución activa')
    expect(dom().querySelector('.modal')).not.toBeNull()
  })

  it('en producción exige marcar que se entiende antes de ejecutar', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: conGrupo(), connection: { ...CONEXION, isProduction: true, name: 'CPI producción' } }))
    await pulsar(boton('▶ Ejecutar'))
    await pasar(0)
    await escribir(dom().querySelector('#ci-var-DESDE'), '20261014')
    expect(botonDelDialogo('▶ Ejecutar').disabled).toBe(true)

    await marcar(dom().querySelector('.ci-confirmar-prod input'))
    expect(botonDelDialogo('▶ Ejecutar').disabled).toBe(false)
  })
})

describe('en el teléfono', () => {
  beforeEach(() => { window.innerWidth = 500 })
  afterEach(() => { window.innerWidth = 1024 })

  it('la paleta es un cajón que se abre con «+», y al agregar se cierra', async () => {
    await montar(ConstructorDeOrquestacion, props())
    expect(dom().querySelector('.ci-orq-paleta')).toBeNull()
    expect(dom().querySelector('.ci-orq-ancho')).toBeNull()

    await pulsar(porEtiqueta('Agregar una integración'))
    expect(dom().querySelector('.ci-orq-cajon .ci-orq-paleta')).not.toBeNull()

    await pulsar(porEtiqueta('Agregar a la secuencia: MAESTRO'))
    expect(dom().querySelector('.ci-orq-cajon')).toBeNull()
    expect(tarjetas()).toHaveLength(1)
  })

  it('tocar el fondo cierra el cajón', async () => {
    await montar(ConstructorDeOrquestacion, props())
    await pulsar(porEtiqueta('Agregar una integración'))
    await pulsar(dom().querySelector('.ci-orq-fondo'))
    expect(dom().querySelector('.ci-orq-cajon')).toBeNull()
  })

  it('las tarjetas no se arrastran ni enseñan el asa', async () => {
    await montar(ConstructorDeOrquestacion, props({ orquestacion: orquestacion([paso('p1', 'int-a')]) }))
    expect(tarjetas()[0].draggable).toBe(false)
    expect(dom().querySelector('.ci-orq-asa')).toBeNull()
  })
})

describe('el ancho de la paleta', () => {
  it('se ajusta con las flechas y vuelve al original con «Inicio»', async () => {
    await montar(ConstructorDeOrquestacion, props())
    const asa = porEtiqueta('Ajustar el ancho de la paleta')
    const ancho = Number(asa.getAttribute('aria-valuenow'))
    await act(async () => { asa.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
    expect(Number(asa.getAttribute('aria-valuenow'))).toBe(ancho + 16)
    await act(async () => { asa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })) })
    expect(Number(asa.getAttribute('aria-valuenow'))).toBe(ancho)
  })

  it('no baja del mínimo ni pasa del máximo', async () => {
    await montar(ConstructorDeOrquestacion, props())
    const asa = porEtiqueta('Ajustar el ancho de la paleta')
    for (let i = 0; i < 40; i += 1) await act(async () => { asa.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })) })
    expect(Number(asa.getAttribute('aria-valuenow'))).toBe(180)
    for (let i = 0; i < 60; i += 1) await act(async () => { asa.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })) })
    expect(Number(asa.getAttribute('aria-valuenow'))).toBe(520)
  })
})
