// Lo que la barra de ejecución y sus diálogos deciden sin dibujar nada. Portado de v9.

import { describe, expect, it, vi } from 'vitest'

import {
  armarValoresGenerales,
  aplanarAgentes,
  avanceDeCorrida,
  claveDePresets,
  consultarEnTandas,
  crearPreset,
  duracionDeCorrida,
  etiquetaDeCorrida,
  filasDeVariables,
  guardarPresets,
  guidsDelGrafo,
  hayNodosDePrimerNivel,
  horaDeCorrida,
  leerPresets,
  sufijoDeAgente,
  sufijoDeIdSap,
  tareasFueraDeGrupo,
  textoDeRepetir,
  valoresDePreset,
  variablesAEnviar,
  variablesDeTareas,
} from './orchestration-run-form.js'

const tarea = (id, extra = {}, parentId) => ({
  id, type: 'task', ...(parentId ? { parentId } : {}), data: { taskName: `T_${id}`, ...extra },
})
const grupo = (id) => ({ id, type: 'group', data: { label: id } })

/** Un almacén en memoria con la forma de `localStorage`. */
const almacen = (inicial = {}) => {
  const datos = { ...inicial }
  return {
    datos,
    getItem: (clave) => (clave in datos ? datos[clave] : null),
    setItem: (clave, valor) => { datos[clave] = String(valor) },
  }
}

describe('etiquetaDeCorrida', () => {
  it('usa las palabras de la insignia de v9', () => {
    expect(['running', 'success', 'error', 'cancelled'].map(etiquetaDeCorrida))
      .toEqual(['Ejecutando', 'Completado', 'Error', 'Cancelado'])
    expect(etiquetaDeCorrida('raro')).toBe('raro')
  })
})

describe('avanceDeCorrida', () => {
  it('cuenta hechos y total solo en el primer nivel', () => {
    const run = {
      nodes: {
        a: { status: 'success' },
        b: { status: 'running' },
        // Los hijos de un grupo no suman: el grupo ya es uno.
        g: { status: 'running', type: 'group', children: { h1: { status: 'success' }, h2: { status: 'success' } } },
        c: { status: 'skipped' },
        d: { status: 'pending' },
      },
    }
    expect(avanceDeCorrida(run)).toEqual({ hechos: 2, total: 5 })
  })

  it('sin corrida es 0/0', () => {
    expect(avanceDeCorrida(null)).toEqual({ hechos: 0, total: 0 })
  })
})

describe('tareasFueraDeGrupo', () => {
  it('sin ningún grupo no hay nada que avisar', () => {
    expect(tareasFueraDeGrupo({ nodes: [tarea('a'), tarea('b')] })).toEqual([])
  })

  it('con un grupo, las tareas sueltas de primer nivel se nombran', () => {
    const grafo = {
      nodes: [grupo('g'), tarea('a', {}, 'g'), tarea('b', { label: 'Mi paso' }), tarea('c')],
    }
    expect(tareasFueraDeGrupo(grafo)).toEqual(['Mi paso', 'T_c'])
  })

  it('con todo dentro de grupos no hay huérfanas', () => {
    expect(tareasFueraDeGrupo({ nodes: [grupo('g'), tarea('a', {}, 'g')] })).toEqual([])
  })

  it('una tarea sin etiqueta ni nombre se llama «Task»', () => {
    expect(tareasFueraDeGrupo({ nodes: [grupo('g'), { id: 'x', type: 'task', data: {} }] })).toEqual(['Task'])
  })

  it('un grafo ausente no revienta', () => {
    expect(tareasFueraDeGrupo(undefined)).toEqual([])
  })
})

describe('hayNodosDePrimerNivel', () => {
  it('un grafo vacío no tiene qué iniciar', () => {
    expect(hayNodosDePrimerNivel({ nodes: [] })).toBe(false)
    expect(hayNodosDePrimerNivel(null)).toBe(false)
  })

  it('basta un nodo de primer nivel; los hijos solos no cuentan', () => {
    expect(hayNodosDePrimerNivel({ nodes: [tarea('a')] })).toBe(true)
    expect(hayNodosDePrimerNivel({ nodes: [tarea('a', {}, 'g')] })).toBe(false)
  })
})

describe('variables', () => {
  it('guidsDelGrafo no repite y se salta lo que no tiene guid', () => {
    const grafo = {
      nodes: [tarea('a', { taskGuid: 'G1' }), tarea('b', { taskGuid: 'G1' }), tarea('c', { taskGuid: 'G2' }),
        tarea('d'), grupo('g')],
    }
    expect(guidsDelGrafo(grafo)).toEqual(['G1', 'G2'])
  })

  it('variablesDeTareas junta sin repetir, gana la primera, y una consulta caída no tumba las demás', () => {
    const resultados = [
      { status: 'fulfilled', value: { globalVariables: [{ name: 'FECHA', description: 'la primera' }, { name: 'PAIS' }] } },
      { status: 'rejected', reason: new Error('x') },
      { status: 'fulfilled', value: { globalVariables: [{ name: 'FECHA', description: 'la segunda' }, { name: 'MONEDA' }] } },
      { status: 'fulfilled', value: null },
    ]
    const juntas = variablesDeTareas(resultados)
    expect(juntas.map((v) => v.name)).toEqual(['FECHA', 'PAIS', 'MONEDA'])
    expect(juntas[0].description).toBe('la primera')
  })

  it('las filas nacen con el nombre y el valor vacío', () => {
    expect(filasDeVariables([{ name: 'A', defaultValue: '1' }])).toEqual([{ name: 'A', value: '' }])
  })

  it('solo viajan las que tienen nombre y valor', () => {
    expect(variablesAEnviar([
      { name: 'A', value: '1' },
      { name: 'B', value: '' },
      { name: '  ', value: 'x' },
      { name: 'C', value: '0' },
    ])).toEqual([{ name: 'A', value: '1' }, { name: 'C', value: '0' }])
  })
})

describe('armarValoresGenerales', () => {
  it('omite el agente y la configuración vacíos', () => {
    expect(armarValoresGenerales({ agentName: ' ', profileName: '', globalVariables: [] }))
      .toEqual({ globalVariables: [] })
  })

  it('manda la configuración como profileName', () => {
    expect(armarValoresGenerales({
      agentName: 'AG1', profileName: 'PERFIL', globalVariables: [{ name: 'A', value: '1' }, { name: 'B', value: '' }],
    })).toEqual({ agentName: 'AG1', profileName: 'PERFIL', globalVariables: [{ name: 'A', value: '1' }] })
  })
})

describe('textoDeRepetir', () => {
  it('nombra el agente y el perfil, o «default»', () => {
    expect(textoDeRepetir({ agentName: 'AG1', profileName: 'P' })).toBe('Repetir con AG1 / P')
    expect(textoDeRepetir({})).toBe('Repetir con default / default')
    expect(textoDeRepetir(null)).toBe('Repetir con default / default')
  })
})

describe('agentes', () => {
  it('aplanarAgentes saca los agentes de sus grupos', () => {
    expect(aplanarAgentes([{ agents: [{ name: 'A' }, { name: 'B' }] }, { agents: [{ name: 'C' }] }, {}])
      .map((a) => a.name)).toEqual(['A', 'B', 'C'])
    expect(aplanarAgentes(null)).toEqual([])
  })

  it('el sufijo solo aparece si el agente no está conectado', () => {
    expect(sufijoDeAgente({ agentStatus: 'AGENT:CONNECTED' })).toBe('')
    expect(sufijoDeAgente({ agentStatus: 'CONNECTED' })).toBe('')
    expect(sufijoDeAgente({})).toBe('')
    expect(sufijoDeAgente({ agentStatus: 'RUNNING' })).toBe(' (RUNNING)')
  })

  // v9 comprobaba `includes('CONNECTED')` y «DISCONNECTED» lo contiene.
  it('un agente desconectado se marca aunque «desconectado» contenga «conectado»', () => {
    expect(sufijoDeAgente({ agentStatus: 'AGENT:DISCONNECTED' })).toBe(' (DISCONNECTED)')
  })
})

describe('presets', () => {
  it('la clave es por destino', () => {
    expect(claveDePresets('c1:sandbox')).toBe('ibp.cids.presets.c1:sandbox')
  })

  it('guarda y vuelve a leer', () => {
    const mem = almacen()
    const preset = crearPreset({
      label: 'Diario', agentName: 'AG1', profileName: '', globalVariables: [{ name: 'A', value: '1' }, { name: 'B', value: '' }],
    })
    expect(preset).toMatchObject({ label: 'Diario', agentName: 'AG1', profileName: null })
    expect(preset.globalVariables).toEqual([{ name: 'A', value: '1' }])
    expect(preset.id).toBeTruthy()

    expect(guardarPresets('c1:sandbox', [preset], mem)).toBe(true)
    expect(leerPresets('c1:sandbox', mem)).toEqual([preset])
    // Otro destino no ve los de este.
    expect(leerPresets('c1:production', mem)).toEqual([])
  })

  it('JSON roto o de otra forma da la lista vacía', () => {
    expect(leerPresets('d', almacen({ [claveDePresets('d')]: '{no es json' }))).toEqual([])
    expect(leerPresets('d', almacen({ [claveDePresets('d')]: '{"a":1}' }))).toEqual([])
    expect(leerPresets('d', almacen({ [claveDePresets('d')]: '[1, null, {"id":"x","label":"ok"}]' })))
      .toEqual([{ id: 'x', label: 'ok' }])
  })

  it('un almacenamiento que lanza no rompe nada', () => {
    const roto = {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('lleno') },
    }
    expect(leerPresets('d', roto)).toEqual([])
    expect(guardarPresets('d', [], roto)).toBe(false)
  })

  it('sin destino no lee ni guarda', () => {
    const mem = almacen()
    expect(leerPresets(undefined, mem)).toEqual([])
    expect(guardarPresets(undefined, [], mem)).toBe(false)
    expect(mem.datos).toEqual({})
  })

  it('valoresDePreset da la misma forma que el diálogo', () => {
    expect(valoresDePreset({ agentName: 'AG1', profileName: null, globalVariables: [{ name: 'A', value: '1' }] }))
      .toEqual({ agentName: 'AG1', globalVariables: [{ name: 'A', value: '1' }] })
  })
})

describe('consultarEnTandas', () => {
  it('no pasa de `tamanio` consultas a la vez y conserva el orden', async () => {
    let activas = 0
    let maximo = 0
    const consultar = vi.fn(async (x) => {
      activas += 1
      maximo = Math.max(maximo, activas)
      await Promise.resolve()
      activas -= 1
      if (x === 3) throw new Error('falló')
      return x * 2
    })

    const resultados = await consultarEnTandas([1, 2, 3, 4, 5, 6, 7], consultar, 3)
    expect(maximo).toBeLessThanOrEqual(3)
    expect(resultados.map((r) => r.status)).toEqual([
      'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled',
    ])
    expect(resultados[6].value).toBe(14)
  })

  it('sin elementos no consulta nada', async () => {
    expect(await consultarEnTandas([], vi.fn())).toEqual([])
  })
})

describe('hora y duración de v9', () => {
  it('la duración se escribe «Xm Ys» o «Ns»', () => {
    const inicio = '2026-10-05T10:00:00.000Z'
    expect(duracionDeCorrida(inicio, '2026-10-05T10:00:42.900Z')).toBe('42s')
    expect(duracionDeCorrida(inicio, '2026-10-05T10:03:07.000Z')).toBe('3m 7s')
    expect(duracionDeCorrida(inicio, '2026-10-05T10:01:00.000Z')).toBe('1m 0s')
  })

  it('sin fin se mide contra ahora; sin inicio, un guion', () => {
    const inicio = '2026-10-05T10:00:00.000Z'
    expect(duracionDeCorrida(inicio, null, Date.parse(inicio) + 75_000)).toBe('1m 15s')
    expect(duracionDeCorrida(null, null)).toBe('—')
  })

  it('la hora sale con hora, minutos y segundos, y sin dato un guion', () => {
    expect(horaDeCorrida(null)).toBe('—')
    expect(horaDeCorrida('2026-10-05T10:00:00.000Z')).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  it('el identificador de SAP se acorta a sus últimos seis', () => {
    expect(sufijoDeIdSap('1234567890')).toBe('#567890')
    expect(sufijoDeIdSap(42)).toBe('#42')
    expect(sufijoDeIdSap(null)).toBe('')
  })
})
