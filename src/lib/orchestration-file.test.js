import { describe, it, expect } from 'vitest'
import { FILE_FORMAT, fromFile, toFile } from './orchestration-file.js'

const orquestacion = {
  id: 'orq-1',
  connectionId: 'conn-1',
  production: true,
  name: 'Carga diaria',
  nodes: [{ id: 'a', type: 'task', position: { x: 0, y: 0 }, data: { taskName: 'CARGA' } }],
  edges: [],
  createdAt: 'x',
}

describe('toFile', () => {
  it('lleva el nombre y el grafo', () => {
    const archivo = toFile([orquestacion])
    expect(archivo.format).toBe(FILE_FORMAT)
    expect(archivo.orchestrations).toEqual([
      { name: 'Carga diaria', nodes: orquestacion.nodes, edges: [] },
    ])
  })

  // Traerse el destino haría que importar en producción algo exportado de pruebas apuntara en
  // silencio al repositorio equivocado.
  it('NO lleva el destino ni los identificadores', () => {
    const [una] = toFile([orquestacion]).orchestrations
    expect(una).not.toHaveProperty('id')
    expect(una).not.toHaveProperty('connectionId')
    expect(una).not.toHaveProperty('production')
  })
})

describe('fromFile', () => {
  it('lee lo que escribió toFile', () => {
    expect(fromFile(toFile([orquestacion]))).toEqual([
      { name: 'Carga diaria', nodes: orquestacion.nodes, edges: [] },
    ])
  })

  it('acepta una lista suelta, que es como exportaba v9', () => {
    expect(fromFile([{ name: 'X', nodes: [], edges: [] }])[0].name).toBe('X')
  })

  it('descarta las que no tienen nombre', () => {
    expect(fromFile([{ name: '  ' }, { name: 'X', nodes: [{ id: 'a' }] }])).toHaveLength(1)
  })

  it('rechaza un archivo que no es una exportación', () => {
    expect(() => fromFile({ cualquier: 'cosa' })).toThrow(/no parece una exportación/)
    expect(() => fromFile(null)).toThrow(/no parece una exportación/)
  })

  it('rechaza un archivo sin ninguna utilizable', () => {
    expect(() => fromFile([{ name: '' }])).toThrow(/ninguna orquestación con nombre/)
  })

  describe('formato viejo de v9, con pasos planos', () => {
    const viejo = [{
      name: 'De v9',
      steps: [
        { id: 's1', taskName: 'EXTRAER', errorStrategy: 'retry', maxRetries: 2, retryDelaySec: 90 },
        { id: 's2', taskName: 'CARGAR' },
      ],
    }]

    it('lo convierte en un grafo encadenado, conservando el orden', () => {
      const [una] = fromFile(viejo)
      expect(una.nodes.map((nodo) => nodo.data.taskName)).toEqual(['EXTRAER', 'CARGAR'])
      expect(una.edges).toEqual([{ id: 'e-s1-s2', source: 's1', target: 's2' }])
    })

    it('conserva la configuración de cada paso, con el nombre nuevo de la espera', () => {
      const [{ nodes }] = fromFile(viejo)
      expect(nodes[0].data).toMatchObject({ errorStrategy: 'retry', maxRetries: 2, retryDelaySeconds: 90 })
    })

    it('un solo paso no genera ninguna conexión', () => {
      expect(fromFile([{ name: 'X', steps: [{ id: 's1', taskName: 'A' }] }])[0].edges).toEqual([])
    })

    it('descarta pasos sin tarea', () => {
      const [una] = fromFile([{ name: 'X', steps: [{ taskName: 'A' }, { id: 'vacio' }] }])
      expect(una.nodes).toHaveLength(1)
    })

    // El grafo manda: si trae los dos, el formato viejo se ignora.
    it('si trae grafo Y pasos planos, usa el grafo', () => {
      const [una] = fromFile([{ name: 'X', nodes: [{ id: 'a', data: {} }], steps: [{ taskName: 'VIEJO' }] }])
      expect(una.nodes).toHaveLength(1)
      expect(una.nodes[0].id).toBe('a')
    })
  })
})
