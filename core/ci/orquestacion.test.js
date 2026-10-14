import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultsDeCi, infoDeOrquestacion, pasosDeIntegracion, validarInicio } from './orquestacion.js'
import { getIntegrations } from './integrations.js'

vi.mock('./integrations.js', () => ({ getIntegrations: vi.fn() }))

const CLIENTE = 'c-1'
const CONEXION = 'conn-1'

const cuerpo = (filtro) => JSON.stringify({ KEYFIGURE: { FilterForTheDataSource: filtro } })
const integracion = (id, filtro = "A EQ '1'", connectionId = CONEXION) => ({ id, connectionId, name: id, folder: '', body: cuerpo(filtro) })
const paso = (id, integrationId) => ({ id, type: 'task', data: { label: id, integrationId } })
const orq = (nodes) => ({ id: 'o-1', connectionId: CONEXION, nodes, edges: [] })

beforeEach(() => {
  vi.clearAllMocks()
  getIntegrations.mockResolvedValue([])
})

describe('pasosDeIntegracion', () => {
  it('deja fuera los grupos', () => {
    const nodos = [{ id: 'g', type: 'group' }, { id: 'a', type: 'task' }]
    expect(pasosDeIntegracion({ nodes: nodos }).map((n) => n.id)).toEqual(['a'])
  })

  it('una orquestación sin nodos no tiene pasos', () => {
    expect(pasosDeIntegracion(null)).toEqual([])
  })
})

describe('infoDeOrquestacion', () => {
  it('une cada paso con su integración y reúne las variables de todos', async () => {
    getIntegrations.mockResolvedValue([
      integracion('i-1', "K BT '{{DESDE}}' '{{HASTA}}'"),
      integracion('i-2', "K BT '{{DESDE}}' '1'"),
    ])
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', 'i-1'), paso('b', 'i-2')]))

    expect(getIntegrations).toHaveBeenCalledWith(CLIENTE, ['i-1', 'i-2'])
    expect(info.variables).toEqual(['DESDE', 'HASTA'])
    expect(info.pasos[0]).toMatchObject({ nodeId: 'a', integrationId: 'i-1', variables: ['DESDE', 'HASTA'] })
    expect(info.rotos).toEqual([])
  })

  it('un paso que apunta a una integración que no existe está roto', async () => {
    getIntegrations.mockResolvedValue([integracion('i-1')])
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', 'i-1'), paso('b', 'borrada')]))
    expect(info.rotos).toEqual(['b'])
  })

  it('un paso sin integración está roto', async () => {
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', undefined)]))
    expect(info.rotos).toEqual(['a'])
  })

  // Correría contra un tenant que no es el de la orquestación.
  it('una integración de OTRA conexión cuenta como rota', async () => {
    getIntegrations.mockResolvedValue([integracion('i-1', "A EQ '1'", 'otra')])
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', 'i-1')]))
    expect(info.rotos).toEqual(['a'])
    expect(info.variables).toEqual([])
  })
})

describe('validarInicio', () => {
  const conDosVariables = () => getIntegrations.mockResolvedValue([integracion('i-1', "K BT '{{DESDE}}' '{{HASTA}}'")])

  it('con todo en orden devuelve la información', async () => {
    conDosVariables()
    const info = await validarInicio(CLIENTE, orq([paso('a', 'i-1')]), { variables: { DESDE: '20261005', HASTA: '20270412' } })
    expect(info.variables).toEqual(['DESDE', 'HASTA'])
  })

  it('una orquestación vacía no se lanza', async () => {
    await expect(validarInicio(CLIENTE, orq([]), {})).rejects.toThrow(/no tiene ninguna integración/)
  })

  // Descubrirlo en el quinto paso, con las cuatro primeras cargas ya hechas, es lo que se evita.
  it('un paso roto no deja lanzar y dice cuál', async () => {
    getIntegrations.mockResolvedValue([])
    await expect(validarInicio(CLIENTE, orq([paso('a', 'borrada')]), {})).rejects.toThrow(/«a» apunta a una integración que ya no existe/)
  })

  it('varios pasos rotos hablan en plural', async () => {
    await expect(validarInicio(CLIENTE, orq([paso('a', 'x'), paso('b', 'y')]), {})).rejects.toThrow(/«a», «b» apuntan/)
  })

  it('falta el valor de una variable', async () => {
    conDosVariables()
    await expect(validarInicio(CLIENTE, orq([paso('a', 'i-1')]), { variables: { DESDE: '20261005' } }))
      .rejects.toThrow('Falta el valor de {{HASTA}}.')
  })

  it('un valor vacío cuenta como faltante', async () => {
    conDosVariables()
    await expect(validarInicio(CLIENTE, orq([paso('a', 'i-1')]), { variables: { DESDE: '', HASTA: '1' } }))
      .rejects.toThrow(/\{\{DESDE\}\}/)
  })

  it('un valor con comillas no vale', async () => {
    conDosVariables()
    await expect(validarInicio(CLIENTE, orq([paso('a', 'i-1')]), { variables: { DESDE: "1'", HASTA: '2' } }))
      .rejects.toThrow(/Valor no válido.*«DESDE»/)
  })

  it('sin `defaults` falta todo lo que se pida', async () => {
    conDosVariables()
    await expect(validarInicio(CLIENTE, orq([paso('a', 'i-1')]), undefined)).rejects.toThrow(/Falta el valor/)
  })

  it('una orquestación sin variables se lanza sin valores', async () => {
    getIntegrations.mockResolvedValue([integracion('i-1', "A EQ '1'")])
    await expect(validarInicio(CLIENTE, orq([paso('a', 'i-1')]), undefined)).resolves.toMatchObject({ variables: [] })
  })
})

describe('defaultsDeCi', () => {
  it('se queda con las variables bien formadas y con quién lanzó, tomado del servidor', () => {
    expect(defaultsDeCi(
      { variables: { DESDE: '20261005', '1mala': 'x', OTRA: 7, 'a-b': 'y' }, startedBy: { email: 'falso@x.com' } },
      { id: 'u-1', email: 'a@x.com' },
    )).toEqual({ variables: { DESDE: '20261005' }, startedBy: { id: 'u-1', email: 'a@x.com' } })
  })

  it('lo que llega en el cuerpo no decide quién ejecutó', () => {
    const limpio = defaultsDeCi({ startedBy: { id: 'otro', email: 'otro@x.com' } }, { id: 'u-1', email: 'a@x.com' })
    expect(limpio.startedBy).toEqual({ id: 'u-1', email: 'a@x.com' })
  })

  it.each([undefined, null, {}, { variables: null }, { variables: [] }, { variables: 'x' }])('tolera %j', (entrada) => {
    expect(defaultsDeCi(entrada, { id: 'u', email: 'e' }).variables).toEqual({})
  })
})
