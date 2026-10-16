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

  // Se piden con un calendario al ejecutar la orquestación.
  it('las variables de fecha son las que, en todos los pasos donde aparecen, van en una condición sobre KEYFIGUREDATE', async () => {
    getIntegrations.mockResolvedValue([
      integracion('i-1', "KEYFIGUREDATE BT '{{DESDE}}' '{{HASTA}}',MATTYPEID EQ '{{TIPO}}'"),
      // Aquí DESDE se usa en otro campo: en esta orquestación ya no es solo una fecha.
      integracion('i-2', "KEYFIGUREDATE BT '{{DESDE}}' '{{HASTA}}',ZVIGENTE EQ '{{DESDE}}'"),
    ])
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', 'i-1'), paso('b', 'i-2')]))
    expect(info.variables).toEqual(['DESDE', 'HASTA', 'TIPO'])
    expect(info.variablesDeFecha).toEqual(['HASTA'])
    expect(info.pasos[0].variablesDeFecha).toEqual(['DESDE', 'HASTA'])
  })

  it('un paso roto no aporta variables ni fechas', async () => {
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', 'borrada')]))
    expect(info.variablesDeFecha).toEqual([])
    expect(info.pasos[0].variablesDeFecha).toEqual([])
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

// Una orquestación puede cambiar, para su carga, lo que dicen sus integraciones. Lo que se pide al ejecutar y lo que se enseña es lo que
// quedaría DESPUÉS de los ajustes: lo que se ve es lo que se envía.
describe('infoDeOrquestacion con ajustes', () => {
  const conFecha = (id) => ({
    id, connectionId: CONEXION, name: id, folder: '',
    body: JSON.stringify({ K: {
      BatchCommand: 'REPLACE', PlanningAreaVersion: 'PVSMD', DestinationforAddon: 'PRD', DestinationforSAPIBP: 'IBP',
      FilterForTheDataSource: "KEYFIGUREDATE BT '{{DESDE}}' '{{HASTA}}'",
    } }),
  })
  const conAjustes = (nodes, ajustes) => ({ ...orq(nodes), ajustes })

  it('una variable que un ajuste reemplaza por una fecha fija deja de pedirse', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1')])
    const info = await infoDeOrquestacion(CLIENTE, conAjustes([paso('a', 'i-1')], { fechas: { desde: '20260101', hasta: '20261231' } }))
    expect(info.variables).toEqual([])
    expect(info.pasos[0].variables).toEqual([])
    expect(info.pasos[0].cambios.map((c) => c.clave)).toEqual(['filtro'])
  })

  it('una variable que un ajuste trae se pide, y con calendario si va en una fecha', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1')])
    const info = await infoDeOrquestacion(CLIENTE, conAjustes([paso('a', 'i-1')], { fechas: { desde: '{{INICIO}}', hasta: '{{FIN}}' } }))
    expect(info.variables).toEqual(['FIN', 'INICIO'])
    expect(info.variablesDeFecha).toEqual(['FIN', 'INICIO'])
  })

  it('los ajustes del paso se suman a los del lote y mandan sobre ellos', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1'), conFecha('i-2')])
    const nodos = [
      paso('a', 'i-1'),
      { ...paso('b', 'i-2'), data: { label: 'b', integrationId: 'i-2', ajustes: { version: 'PV3', filtro: { KEYFIGUREDATE: { desde: '20260601', hasta: '20260630' } } } } },
    ]
    const info = await infoDeOrquestacion(CLIENTE, conAjustes(nodos, { version: 'PV2', fechas: { desde: '20260101', hasta: '20261231' } }))

    expect(info.pasos[0].efectivo).toMatchObject({ version: 'PV2', comando: 'REPLACE', sistemaOrigen: 'PRD', sistemaDestino: 'IBP' })
    expect(info.pasos[1].efectivo.version).toBe('PV3')
    expect(info.pasos[1].cambios.find((c) => c.clave === 'filtro')).toMatchObject({ a: '20260601 → 20260630', fuente: 'paso' })
    expect(info.variables).toEqual([])
  })

  it('sin ajustes todo queda como antes, y `efectivo` dice lo de la integración', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1')])
    const info = await infoDeOrquestacion(CLIENTE, orq([paso('a', 'i-1')]))
    expect(info.pasos[0]).toMatchObject({ cambios: [], avisos: [], errorDeAjustes: null, efectivo: { version: 'PVSMD', comando: 'REPLACE' } })
    expect(info.variables).toEqual(['DESDE', 'HASTA'])
  })

  it('un ajuste del paso que ya no tiene a qué aplicarse da un aviso', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1')])
    const nodo = { ...paso('a', 'i-1'), data: { label: 'a', integrationId: 'i-1', ajustes: { filtro: { ZVIGENTE: { valores: ['S'] } } } } }
    const info = await infoDeOrquestacion(CLIENTE, orq([nodo]))
    expect(info.pasos[0].avisos).toHaveLength(1)
  })

  it('unos ajustes que no valen se dicen en el paso, sin romper el resto', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1'), conFecha('i-2')])
    const malo = { ...paso('a', 'i-1'), data: { label: 'a', integrationId: 'i-1', ajustes: { comando: "x'y" } } }
    const info = await infoDeOrquestacion(CLIENTE, orq([malo, paso('b', 'i-2')]))
    expect(info.pasos[0].errorDeAjustes).toMatch(/Comando/)
    expect(info.pasos[1].errorDeAjustes).toBeNull()
  })

  it('una orquestación con ajustes que no valen no se lanza, y dice en qué paso', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1')])
    const malo = { ...paso('a', 'i-1'), data: { label: 'a', integrationId: 'i-1', ajustes: { comando: "x'y" } } }
    await expect(validarInicio(CLIENTE, orq([malo]), { variables: { DESDE: '1', HASTA: '2' } })).rejects.toThrow(/los ajustes no valen.*«a»: Comando/)
  })

  it('valida las variables que quedan DESPUÉS de los ajustes: una que sobraba ya no hace falta', async () => {
    getIntegrations.mockResolvedValue([conFecha('i-1')])
    const lote = { fechas: { desde: '20260101', hasta: '20261231' } }
    await expect(validarInicio(CLIENTE, conAjustes([paso('a', 'i-1')], lote), { variables: {} })).resolves.toMatchObject({ variables: [] })
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
    )).toEqual({ variables: { DESDE: '20261005' }, startedBy: { id: 'u-1', email: 'a@x.com' }, ajustes: {} })
  })

  // Los del lote salen de la orquestación guardada, no de la petición: lo que mande el navegador no los decide.
  it('lleva los ajustes del lote de la orquestación guardada, y no los que traiga la petición', () => {
    const limpio = defaultsDeCi(
      { ajustes: { version: 'LA_DEL_NAVEGADOR' } },
      { id: 'u-1', email: 'a@x.com' },
      { version: 'PV2', fechas: { desde: '20260101' } },
    )
    expect(limpio.ajustes).toEqual({ version: 'PV2', fechas: { desde: '20260101' } })
  })

  it('unos ajustes guardados que no valen no dejan lanzar', () => {
    expect(() => defaultsDeCi({}, { id: 'u', email: 'e' }, { comando: "x'y" })).toThrow(/Comando/)
    expect(() => defaultsDeCi({}, { id: 'u', email: 'e' }, { filtro: { A: { valores: ['x'] } } })).toThrow(/no llevan filtro/)
  })

  it('lo que llega en el cuerpo no decide quién ejecutó', () => {
    const limpio = defaultsDeCi({ startedBy: { id: 'otro', email: 'otro@x.com' } }, { id: 'u-1', email: 'a@x.com' })
    expect(limpio.startedBy).toEqual({ id: 'u-1', email: 'a@x.com' })
  })

  it.each([undefined, null, {}, { variables: null }, { variables: [] }, { variables: 'x' }])('tolera %j', (entrada) => {
    expect(defaultsDeCi(entrada, { id: 'u', email: 'e' }).variables).toEqual({})
  })
})
