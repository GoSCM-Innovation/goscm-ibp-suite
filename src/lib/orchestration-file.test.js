import { describe, it, expect } from 'vitest'
import {
  FILE_FORMAT,
  clasificarImportacion,
  clavesDeNombres,
  fromFile,
  nombreDeArchivoExportado,
  nombreLibre,
  parseOrchImportText,
  resumirExportacion,
  resumirImportacion,
  toFile,
} from './orchestration-file.js'

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
  // Antes entraba vacía: se leía como un archivo de v9 y no encontraba ninguna `taskName`.
  it('lee un archivo del orquestador de IBP de v8: cadena de pasos y grupos en paralelo', () => {
    const [una] = fromFile({
      version: '1.0',
      orchestrations: [{
        name: 'Cierre',
        steps: [
          { id: 's1', type: 'task', jobTemplateName: 'ZA', jobTemplateText: 'Carga A', errorStrategy: 'retry', maxRetries: 5, retryDelaySec: 120 },
          { id: 'g1', type: 'group', label: 'Paralelo', children: [
            { id: 'c1', type: 'task', jobTemplateName: 'ZB' },
            { id: 'c2', type: 'task', jobTemplateName: 'ZC' },
          ] },
          { id: 's2', type: 'task', jobTemplateName: 'ZD' },
        ],
      }],
    }).orchestrations

    expect(una.name).toBe('Cierre')
    expect(una.nodes.find((n) => n.id === 's1').data)
      .toMatchObject({ templateName: 'ZA', jobText: 'Carga A', maxRetries: 5, retryDelaySeconds: 120 })
    expect(una.nodes.filter((n) => n.parentId === 'g1').map((n) => n.id)).toEqual(['c1', 'c2'])
    expect(una.edges.map((e) => [e.source, e.target])).toEqual([['s1', 'g1'], ['g1', 's2']])
  })

  it('lee lo que escribió toFile', () => {
    const { orchestrations, invalid } = fromFile(toFile([orquestacion]))
    expect(orchestrations).toEqual([{ name: 'Carga diaria', nodes: orquestacion.nodes, edges: [] }])
    expect(invalid).toEqual([])
  })

  it('acepta una lista suelta, que es como exportaba v9', () => {
    expect(fromFile([{ name: 'X', nodes: [], edges: [] }]).orchestrations[0].name).toBe('X')
  })

  it('recorta el nombre y deja las conexiones en lista vacía si no vienen', () => {
    expect(fromFile([{ name: '  X  ', nodes: [{ id: 'a' }] }]).orchestrations)
      .toEqual([{ name: 'X', nodes: [{ id: 'a' }], edges: [] }])
  })

  it('trae el origen que escribió v9, si lo hay', () => {
    const origen = { name: 'CLARO', orgName: 'claro-org' }
    expect(fromFile({ orchestrations: [{ name: 'X', nodes: [] }], sourceConnection: origen }).sourceConnection)
      .toEqual(origen)
    expect(fromFile([{ name: 'X', nodes: [] }]).sourceConnection).toBeNull()
  })

  describe('errores de archivo, con los textos de v9', () => {
    it('lo que no es un array de orquestaciones', () => {
      expect(() => fromFile({ cualquier: 'cosa' })).toThrow('El archivo no contiene un array de orquestaciones')
      expect(() => fromFile(null)).toThrow('El archivo no contiene un array de orquestaciones')
    })

    it('un array vacío', () => {
      expect(() => fromFile([])).toThrow('El archivo no contiene orquestaciones')
    })
  })

  describe('entradas inválidas, con el motivo de v9', () => {
    const motivos = (entradas) => fromFile([...entradas, { name: 'ok', nodes: [] }]).invalid

    it('no es un objeto', () => {
      expect(motivos([null, 'texto', 7])).toEqual([
        { index: 0, reason: 'no es un objeto' },
        { index: 1, reason: 'no es un objeto' },
        { index: 2, reason: 'no es un objeto' },
      ])
    })

    it('falta el campo name (vacío, en blanco o que no es texto)', () => {
      expect(motivos([{ nodes: [] }, { name: '   ', nodes: [] }, { name: 5, nodes: [] }]).map((m) => m.reason))
        .toEqual(['falta el campo name', 'falta el campo name', 'falta el campo name'])
    })

    // Antes entraba con 0 pasos: una orquestación vacía por un archivo mal armado.
    it('nodes no es un array: NO entra vacía', () => {
      const salida = fromFile([{ name: 'X' }, { name: 'Y', nodes: 'no' }, { name: 'ok', nodes: [] }])
      expect(salida.invalid).toEqual([
        { index: 0, reason: 'nodes no es un array' },
        { index: 1, reason: 'nodes no es un array' },
      ])
      expect(salida.orchestrations.map((una) => una.name)).toEqual(['ok'])
    })

    it('edges debe ser un array (ausente vale; presente y de otro tipo, no)', () => {
      const salida = fromFile([
        { name: 'A', nodes: [{ id: 'a' }], edges: {} },
        { name: 'B', nodes: [{ id: 'a' }], edges: null },
        { name: 'C', nodes: [{ id: 'a' }] },
      ])
      expect(salida.invalid).toEqual([
        { index: 0, reason: 'edges debe ser un array' },
        { index: 1, reason: 'edges debe ser un array' },
      ])
      expect(salida.orchestrations.map((una) => una.name)).toEqual(['C'])
    })

    it('el índice es la posición en el archivo, también para las buenas', () => {
      const salida = fromFile([{ name: 'ok', nodes: [] }, null])
      expect(salida.orchestrations).toHaveLength(1)
      expect(salida.invalid).toEqual([{ index: 1, reason: 'no es un objeto' }])
    })

    it('si TODAS son inválidas no revienta: las devuelve para que se vea por qué', () => {
      const salida = fromFile([{ nodes: [] }, { name: 'X' }])
      expect(salida.orchestrations).toEqual([])
      expect(salida.invalid).toHaveLength(2)
    })
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
      const [una] = fromFile(viejo).orchestrations
      expect(una.nodes.map((nodo) => nodo.data.taskName)).toEqual(['EXTRAER', 'CARGAR'])
      expect(una.edges).toEqual([{ id: 'e-s1-s2', source: 's1', target: 's2' }])
    })

    it('conserva la configuración de cada paso, con el nombre nuevo de la espera', () => {
      const [{ nodes }] = fromFile(viejo).orchestrations
      expect(nodes[0].data).toMatchObject({ errorStrategy: 'retry', maxRetries: 2, retryDelaySeconds: 90 })
    })

    it('un solo paso no genera ninguna conexión', () => {
      expect(fromFile([{ name: 'X', steps: [{ id: 's1', taskName: 'A' }] }]).orchestrations[0].edges).toEqual([])
    })

    it('descarta pasos sin tarea', () => {
      const [una] = fromFile([{ name: 'X', steps: [{ taskName: 'A' }, { id: 'vacio' }] }]).orchestrations
      expect(una.nodes).toHaveLength(1)
    })

    // El grafo manda: si trae los dos, el formato viejo se ignora.
    it('si trae grafo Y pasos planos, usa el grafo', () => {
      const [una] = fromFile([{ name: 'X', nodes: [{ id: 'a', data: {} }], steps: [{ taskName: 'VIEJO' }] }]).orchestrations
      expect(una.nodes).toHaveLength(1)
      expect(una.nodes[0].id).toBe('a')
    })

    it('unos pasos que no son una lista tampoco salvan una entrada sin nodes', () => {
      expect(fromFile([{ name: 'X', steps: 'no' }, { name: 'ok', nodes: [] }]).invalid)
        .toEqual([{ index: 0, reason: 'nodes no es un array' }])
    })
  })
})

describe('parseOrchImportText', () => {
  it('lee el texto de un archivo', () => {
    const { orchestrations } = parseOrchImportText(JSON.stringify(toFile([orquestacion])))
    expect(orchestrations.map((una) => una.name)).toEqual(['Carga diaria'])
  })

  it('un texto que no es JSON dice «no es un JSON válido», no el error crudo del navegador', () => {
    expect(() => parseOrchImportText('{esto no')).toThrow('El archivo no es un JSON válido')
    expect(() => parseOrchImportText('')).toThrow('El archivo no es un JSON válido')
  })

  it('un JSON que no es una exportación sigue diciendo qué falta', () => {
    expect(() => parseOrchImportText('{"a":1}')).toThrow('El archivo no contiene un array de orquestaciones')
    expect(() => parseOrchImportText('[]')).toThrow('El archivo no contiene orquestaciones')
  })
})

describe('clasificarImportacion', () => {
  const puestas = [{ name: 'Carga diaria' }, { name: 'Cierre de mes' }]

  it('reparte entre lo nuevo y lo que ya estaba', () => {
    const salida = clasificarImportacion(
      [{ name: 'Carga diaria' }, { name: 'Carga semanal' }],
      puestas,
    )
    expect(salida.nuevas.map((una) => una.name)).toEqual(['Carga semanal'])
    expect(salida.repetidas.map((una) => una.name)).toEqual(['Carga diaria'])
  })

  // «Carga diaria» y «carga diaria » son la misma para quien las mira.
  it('no distingue mayusculas ni espacios sobrantes', () => {
    expect(clasificarImportacion([{ name: ' carga DIARIA ' }], puestas).repetidas).toHaveLength(1)
  })

  it('cuenta los pasos y las uniones de cada una', () => {
    const salida = clasificarImportacion(
      [{ name: 'Nueva', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e' }] }],
      [],
    )
    expect(salida.nuevas[0]).toMatchObject({ pasos: 2, uniones: 1 })
  })

  it('una orquestacion sin grafo cuenta cero, no undefined', () => {
    expect(clasificarImportacion([{ name: 'Vacia' }], []).nuevas[0]).toMatchObject({ pasos: 0, uniones: 0 })
  })

  it('sin nada que importar no revienta', () => {
    expect(clasificarImportacion([], [])).toEqual({ nuevas: [], repetidas: [] })
    expect(clasificarImportacion(undefined, undefined)).toEqual({ nuevas: [], repetidas: [] })
  })
})

describe('nombreLibre', () => {
  it('un nombre que no choca queda como está', () => {
    expect(nombreLibre('Nueva', clavesDeNombres([{ name: 'Otra' }]))).toBe('Nueva')
  })

  // Es la misma comparación que usa clasificar: si una dijera «repetida» y la otra «libre», se
  // crearían dos con el mismo nombre.
  it('compara como clasificar: sin mayúsculas ni espacios sobrantes', () => {
    const usados = clavesDeNombres([{ name: 'Carga diaria' }])
    expect(clasificarImportacion([{ name: ' CARGA diaria ' }], [{ name: 'Carga diaria' }]).repetidas).toHaveLength(1)
    expect(nombreLibre('CARGA diaria', usados)).toBe('CARGA diaria (2)')
  })

  it('va subiendo el número y anota cada nombre que reparte', () => {
    const usados = clavesDeNombres([{ name: 'X' }, { name: 'X (2)' }])
    expect(nombreLibre('X', usados)).toBe('X (3)')
    expect(nombreLibre('X', usados)).toBe('X (4)')
  })

  it('dos del mismo archivo con el mismo nombre no se llevan el mismo', () => {
    const usados = clavesDeNombres([])
    expect([nombreLibre('Y', usados), nombreLibre('y', usados)]).toEqual(['Y', 'y (2)'])
  })
})

describe('avisos', () => {
  it('el resumen de importar junta lo que pasó, con los textos de v9', () => {
    expect(resumirImportacion({ agregadas: 2, omitidas: 1, fallidas: 3 })).toBe('2 agregadas, 1 omitida, 3 con error')
    expect(resumirImportacion({ agregadas: 1 })).toBe('1 agregada')
  })

  it('sin nada que contar dice «Sin cambios»', () => {
    expect(resumirImportacion({})).toBe('Sin cambios')
  })

  it('el de exportar concuerda en número', () => {
    expect(resumirExportacion(1)).toBe('1 orquestación exportada')
    expect(resumirExportacion(4)).toBe('4 orquestaciones exportadas')
  })
})

describe('nombreDeArchivoExportado', () => {
  it('es ibp-orquestaciones-<conexión>-<fecha>.json, como v9', () => {
    expect(nombreDeArchivoExportado('CLARO', '2026-10-05')).toBe('ibp-orquestaciones-CLARO-2026-10-05.json')
  })

  it('cambia por guion bajo lo que no sirve en un nombre de archivo y recorta a 40', () => {
    expect(nombreDeArchivoExportado('Mi Empresa / QA', '2026-10-05')).toBe('ibp-orquestaciones-Mi_Empresa_QA-2026-10-05.json')
    expect(nombreDeArchivoExportado('x'.repeat(60), 'f')).toBe(`ibp-orquestaciones-${'x'.repeat(40)}-f.json`)
  })

  it('sin nombre usa «connection», como v9', () => {
    expect(nombreDeArchivoExportado('', 'f')).toBe('ibp-orquestaciones-connection-f.json')
  })
})
