import { describe, it, expect } from 'vitest'
import {
  ERROR_STRATEGIES,
  MAX_RETRIES_LIMIT,
  MAX_RETRY_DELAY_SECONDS,
  normalizeGraph,
} from './graph.js'

const tarea = (id, extra = {}) => ({
  id,
  type: 'task',
  position: { x: 0, y: 0 },
  data: { taskName: id, ...extra },
})

const arista = (desde, hasta) => ({ id: `e-${desde}-${hasta}`, source: desde, target: hasta })

describe('normalizeGraph', () => {
  it('deja pasar un grafo válido y devuelve nodos y conexiones', () => {
    const { nodes, edges } = normalizeGraph({
      nodes: [tarea('a'), tarea('b')],
      edges: [arista('a', 'b')],
    })

    expect(nodes).toHaveLength(2)
    expect(edges).toEqual([{ id: 'e-a-b', source: 'a', target: 'b' }])
  })

  it('acepta un grafo vacío: una orquestación se empieza sin nada', () => {
    expect(normalizeGraph()).toEqual({ nodes: [], edges: [] })
    expect(normalizeGraph({})).toEqual({ nodes: [], edges: [] })
  })

  it('exige que nodos y conexiones vengan en listas', () => {
    expect(() => normalizeGraph({ nodes: 'a' })).toThrow(/lista/)
    expect(() => normalizeGraph({ edges: {} })).toThrow(/lista/)
  })

  describe('tipos de nodo', () => {
    // La librería del lienzo nombra sus tipos distinto de como se guardan.
    it('traduce los tipos de la librería del lienzo', () => {
      const { nodes } = normalizeGraph({
        nodes: [{ ...tarea('a'), type: 'orchTask' }, { ...tarea('g'), type: 'orchGroup' }],
      })
      expect(nodes.map((nodo) => nodo.type)).toEqual(['task', 'group'])
    })

    it('rechaza un tipo desconocido', () => {
      expect(() => normalizeGraph({ nodes: [{ ...tarea('a'), type: 'loop' }] })).toThrow(/Tipo de nodo/)
    })

    it('exige identificador en cada nodo', () => {
      expect(() => normalizeGraph({ nodes: [{ type: 'task' }] })).toThrow(/identificador/)
    })

    it('rechaza dos nodos con el mismo identificador', () => {
      expect(() => normalizeGraph({ nodes: [tarea('a'), tarea('a')] })).toThrow(/mismo identificador/)
    })
  })

  describe('configuración de un paso', () => {
    const soloDatos = (data) => normalizeGraph({ nodes: [{ ...tarea('a'), data }] }).nodes[0].data

    it('por omisión para si algo falla, que es lo prudente', () => {
      expect(soloDatos({ taskName: 'CARGA' }).errorStrategy).toBe('stop')
    })

    it.each(ERROR_STRATEGIES)('acepta la estrategia %s', (estrategia) => {
      expect(soloDatos({ errorStrategy: estrategia }).errorStrategy).toBe(estrategia)
    })

    it('una estrategia desconocida cae en "parar", no se acepta a ciegas', () => {
      expect(soloDatos({ errorStrategy: 'ignorar_todo' }).errorStrategy).toBe('stop')
    })

    it('acota los reintentos al tope', () => {
      expect(soloDatos({ maxRetries: 99 }).maxRetries).toBe(MAX_RETRIES_LIMIT)
      expect(soloDatos({ maxRetries: -3 }).maxRetries).toBe(0)
      expect(soloDatos({ maxRetries: 2.7 }).maxRetries).toBe(2)
    })

    it('acota la espera entre reintentos al tope', () => {
      expect(soloDatos({ retryDelaySeconds: 99999 }).retryDelaySeconds).toBe(MAX_RETRY_DELAY_SECONDS)
      expect(soloDatos({ retryDelaySeconds: -1 }).retryDelaySeconds).toBe(0)
    })

    it('acepta el nombre viejo de la espera, que es como lo guardaba v9', () => {
      expect(soloDatos({ retryDelaySec: 120 }).retryDelaySeconds).toBe(120)
    })

    it('sin dato, la espera por omisión es la de v9', () => {
      expect(soloDatos({}).retryDelaySeconds).toBe(30)
    })

    it('un valor que no es número no se cuela: cae en el de por omisión', () => {
      expect(soloDatos({ maxRetries: 'muchos' }).maxRetries).toBe(0)
      expect(soloDatos({ retryDelaySeconds: 'un rato' }).retryDelaySeconds).toBe(30)
    })

    it('los hijos de un grupo corren en paralelo salvo que se diga lo contrario', () => {
      expect(soloDatos({}).executionMode).toBe('parallel')
      expect(soloDatos({ executionMode: 'serial' }).executionMode).toBe('serial')
      expect(soloDatos({ executionMode: 'cualquiera' }).executionMode).toBe('parallel')
    })

    it('la etiqueta cae al nombre de la tarea, y si no hay, a un texto legible', () => {
      expect(soloDatos({ taskName: 'CARGA' }).label).toBe('CARGA')
      expect(soloDatos({ label: 'Paso 1', taskName: 'CARGA' }).label).toBe('Paso 1')
      expect(soloDatos({}).label).toBe('Sin nombre')
    })

    // Sin esto cada paso de IBP se guardaba sin plantilla y fallaba al ejecutarse.
    it('conserva la plantilla y el texto de un paso de IBP', () => {
      const datos = soloDatos({ templateName: 'ZCARGA', jobText: 'Carga diaria' })
      expect(datos).toMatchObject({ templateName: 'ZCARGA', jobText: 'Carga diaria', label: 'Carga diaria' })
    })

    it('acepta los nombres con que v8 exportaba la plantilla', () => {
      expect(soloDatos({ jobTemplateName: 'ZCARGA', jobTemplateText: 'Carga' }))
        .toMatchObject({ templateName: 'ZCARGA', jobText: 'Carga' })
    })

    it('un paso de CI-DS no gana campos de IBP', () => {
      const datos = soloDatos({ taskName: 'CARGA' })
      expect(datos).not.toHaveProperty('templateName')
      expect(datos).not.toHaveProperty('jobText')
    })

    it('sin texto, la etiqueta de un paso de IBP es el nombre técnico de la plantilla', () => {
      expect(soloDatos({ templateName: 'ZCARGA' }).label).toBe('ZCARGA')
    })

    it('la etiqueta de un grupo puede quedar vacía: es una descripción opcional', () => {
      const [grupo] = normalizeGraph({ nodes: [{ id: 'g', type: 'group', data: {} }] }).nodes
      expect(grupo.data.label).toBe('')
    })

    it('descarta variables sin nombre y pasa los valores a texto', () => {
      const { globalVariables } = soloDatos({
        globalVariables: [{ name: 'FECHA', value: 20260804 }, { name: '', value: 'x' }, {}],
      })
      expect(globalVariables).toEqual([{ name: 'FECHA', value: '20260804' }])
    })
  })

  // Los de IBP son los del orquestador de v8; los de CI-DS siguen siendo los de v9.
  describe('topes de reintentos según el tipo de conexión', () => {
    const datosDe = (kind, data) => normalizeGraph({ nodes: [{ ...tarea('a'), data }] }, { kind }).nodes[0].data

    it('IBP: de 1 a 10 reintentos, 3 por omisión', () => {
      expect(datosDe('ibp', { maxRetries: 99 }).maxRetries).toBe(10)
      expect(datosDe('ibp', { maxRetries: 0 }).maxRetries).toBe(1)
      expect(datosDe('ibp', {}).maxRetries).toBe(3)
    })

    it('IBP: espera de 10 a 3600 s, 60 por omisión', () => {
      expect(datosDe('ibp', { retryDelaySec: 1 }).retryDelaySeconds).toBe(10)
      expect(datosDe('ibp', { retryDelaySeconds: 99999 }).retryDelaySeconds).toBe(3600)
      expect(datosDe('ibp', {}).retryDelaySeconds).toBe(60)
    })

    it('CI-DS conserva los suyos, también sin decir el tipo', () => {
      expect(datosDe('cids', { maxRetries: 9 }).maxRetries).toBe(MAX_RETRIES_LIMIT)
      expect(datosDe(undefined, {}).retryDelaySeconds).toBe(30)
      expect(datosDe('cids', {}).maxRetries).toBe(0)
    })
  })

  describe('grupos', () => {
    it('un nodo dentro de un grupo no se puede arrastrar afuera', () => {
      const { nodes } = normalizeGraph({
        nodes: [{ ...tarea('g'), type: 'group' }, { ...tarea('a'), parentId: 'g' }],
      })
      const hijo = nodes.find((nodo) => nodo.id === 'a')
      expect(hijo.parentId).toBe('g')
      expect(hijo.extent).toBe('parent')
    })

    it('un nodo de primer nivel no lleva ni padre ni límite', () => {
      const [nodo] = normalizeGraph({ nodes: [tarea('a')] }).nodes
      expect(nodo).not.toHaveProperty('parentId')
      expect(nodo).not.toHaveProperty('extent')
    })

    // Quedaría suelto en el lienzo y fuera de toda ola de ejecución.
    it('rechaza un nodo que dice estar en un grupo que no existe', () => {
      expect(() => normalizeGraph({ nodes: [{ ...tarea('a'), parentId: 'fantasma' }] }))
        .toThrow(/grupo que no existe/)
    })
  })

  describe('conexiones', () => {
    it('exige identificador, origen y destino', () => {
      expect(() => normalizeGraph({ nodes: [tarea('a')], edges: [{ source: 'a', target: 'a' }] }))
        .toThrow(/identificador/)
      expect(() => normalizeGraph({ nodes: [tarea('a')], edges: [{ id: 'e' }] }))
        .toThrow(/de qué nodo sale/)
    })

    // v9 las ignoraba en silencio, así que el grafo guardado y el ejecutado eran distintos.
    it('rechaza una conexión que apunta a un nodo inexistente', () => {
      expect(() => normalizeGraph({ nodes: [tarea('a')], edges: [arista('a', 'fantasma')] }))
        .toThrow(/apunta a un nodo que no existe/)
      expect(() => normalizeGraph({ nodes: [tarea('a')], edges: [arista('fantasma', 'a')] }))
        .toThrow(/apunta a un nodo que no existe/)
    })
  })

  describe('ciclos', () => {
    // Es la guarda que más importa: el motor arma el orden con Kahn, y los nodos de un ciclo nunca
    // entran en ninguna ola. Parecería que la orquestación corrió, y esas tareas no corrieron.
    it('rechaza un ciclo de dos pasos', () => {
      expect(() => normalizeGraph({
        nodes: [tarea('a'), tarea('b')],
        edges: [arista('a', 'b'), arista('b', 'a')],
      })).toThrow(/ciclo/)
    })

    it('rechaza un ciclo largo', () => {
      expect(() => normalizeGraph({
        nodes: [tarea('a'), tarea('b'), tarea('c')],
        edges: [arista('a', 'b'), arista('b', 'c'), arista('c', 'a')],
      })).toThrow(/ciclo/)
    })

    it('rechaza un paso conectado a sí mismo', () => {
      expect(() => normalizeGraph({ nodes: [tarea('a')], edges: [arista('a', 'a')] })).toThrow(/ciclo/)
    })

    it('el mensaje nombra los pasos afectados, para poder arreglarlo', () => {
      expect(() => normalizeGraph({
        nodes: [tarea('a', { label: 'Extraer' }), tarea('b', { label: 'Cargar' })],
        edges: [arista('a', 'b'), arista('b', 'a')],
      })).toThrow(/Extraer.*Cargar|Cargar.*Extraer/)
    })

    it('un grafo que se abre y se vuelve a juntar NO es un ciclo', () => {
      const { nodes } = normalizeGraph({
        nodes: [tarea('a'), tarea('b'), tarea('c'), tarea('d')],
        edges: [arista('a', 'b'), arista('a', 'c'), arista('b', 'd'), arista('c', 'd')],
      })
      expect(nodes).toHaveLength(4)
    })

    it('pasos sueltos sin ninguna conexión están bien: corren todos a la vez', () => {
      expect(normalizeGraph({ nodes: [tarea('a'), tarea('b')] }).nodes).toHaveLength(2)
    })

    it('los hijos de un grupo sin conexiones entre ellos están bien', () => {
      const { nodes } = normalizeGraph({
        nodes: [
          { ...tarea('g'), type: 'group' },
          { ...tarea('a'), parentId: 'g' },
          { ...tarea('b'), parentId: 'g' },
        ],
      })
      expect(nodes).toHaveLength(3)
    })

    // El motor ordena los hijos de un grupo por las conexiones que hay entre ellos, igual que el
    // primer nivel. Un ciclo ahí dejaba al grupo esperando para siempre.
    describe('dentro de un grupo', () => {
      const grupo = { ...tarea('g', { label: 'Cierre' }), type: 'group' }
      const hijo = (id, extra) => ({ ...tarea(id, extra), parentId: 'g' })

      it('rechaza un ciclo entre los hijos y nombra sus pasos', () => {
        expect(() => normalizeGraph({
          nodes: [grupo, hijo('a', { label: 'Extraer' }), hijo('b', { label: 'Cargar' })],
          edges: [arista('a', 'b'), arista('b', 'a')],
        })).toThrow(/ciclo.*(Extraer.*Cargar|Cargar.*Extraer)/)
      })

      it('no confunde al grupo con sus hijos: el grupo no figura entre los atascados', () => {
        let mensaje = ''
        try {
          normalizeGraph({
            nodes: [grupo, hijo('a', { label: 'Extraer' }), hijo('b', { label: 'Cargar' })],
            edges: [arista('a', 'b'), arista('b', 'a')],
          })
        } catch (error) { mensaje = error.message }
        expect(mensaje).not.toContain('Cierre')
      })

      it('acepta hijos encadenados en fila', () => {
        const { edges } = normalizeGraph({
          nodes: [grupo, hijo('a'), hijo('b'), hijo('c')],
          edges: [arista('a', 'b'), arista('b', 'c')],
        })
        expect(edges).toHaveLength(2)
      })

      it('un ciclo en un grupo se detecta aunque el primer nivel esté bien', () => {
        expect(() => normalizeGraph({
          nodes: [tarea('x'), grupo, hijo('a'), hijo('b')],
          edges: [arista('x', 'g'), arista('a', 'b'), arista('b', 'a')],
        })).toThrow(/ciclo/)
      })

      it('con ciclos en el primer nivel y en un grupo, los nombra a todos', () => {
        expect(() => normalizeGraph({
          nodes: [tarea('p', { label: 'Uno' }), tarea('q', { label: 'Dos' }), grupo,
            hijo('a', { label: 'Tres' }), hijo('b', { label: 'Cuatro' })],
          edges: [arista('p', 'q'), arista('q', 'p'), arista('a', 'b'), arista('b', 'a')],
        })).toThrow(/Uno.*Dos.*Tres.*Cuatro/)
      })

      // Una conexión entre niveles distintos no ordena nada: el motor la ignora, y por tanto no
      // puede formar un ciclo.
      it('una conexión entre un hijo y un paso de fuera no cuenta como ciclo', () => {
        const { nodes } = normalizeGraph({
          nodes: [tarea('x'), grupo, hijo('a')],
          edges: [arista('a', 'x'), arista('x', 'a')],
        })
        expect(nodes).toHaveLength(3)
      })
    })
  })
})
