import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  createConnection,
  deleteConnection,
  renameConnection,
  getConnection,
  getCredentials,
  listConnections,
  setIbpConnection,
  upsertAgreement,
} from './connections.js'
import { queryOneScoped, queryScoped } from '../persistence/tenant-scope.js'
import { assertSapHost } from '../transport/ssrf.js'
import { encryptSecret } from './crypto.js'

vi.mock('../persistence/tenant-scope.js', () => ({
  queryScoped: vi.fn(async () => []),
  queryOneScoped: vi.fn(async () => null),
}))
vi.mock('../transport/ssrf.js', () => ({ assertSapHost: vi.fn(async () => {}) }))

const CLIENTE = 'c-1'
const CONEXION = 'conn-1'
const CLAVE_ORIGINAL = process.env.CREDENTIALS_ENCRYPTION_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  assertSapHost.mockResolvedValue(undefined)
})

afterEach(() => {
  if (CLAVE_ORIGINAL === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
  else process.env.CREDENTIALS_ENCRYPTION_KEY = CLAVE_ORIGINAL
})

describe('listConnections', () => {
  it('consulta con el filtro de cliente puesto', async () => {
    await listConnections(CLIENTE)
    const [clientId, sql, params] = queryScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(params).toEqual([CLIENTE])
    expect(sql).toContain('c.client_id = $1')
  })

  it('no pide ninguna columna de secreto', async () => {
    await listConnections(CLIENTE)
    const sql = queryScoped.mock.calls[0][1]
    expect(sql).not.toMatch(/secret_/)
  })

  it('filtra por tipo cuando se lo piden, sin soltar el filtro de cliente', async () => {
    await listConnections(CLIENTE, { kind: 'cids' })
    const [, sql, params] = queryScoped.mock.calls[0]
    expect(sql).toContain('c.client_id = $1')
    expect(sql).toContain('c.kind = $2')
    expect(params).toEqual([CLIENTE, 'cids'])
  })

  it('rechaza un tipo que no existe en vez de devolver la lista entera', async () => {
    await expect(listConnections(CLIENTE, { kind: 'sqlserver' })).rejects.toThrow(/desconocido/)
    expect(queryScoped).not.toHaveBeenCalled()
  })
})

describe('getConnection', () => {
  it('devuelve null si la conexión no es de ese cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(getConnection(CLIENTE, CONEXION)).resolves.toBeNull()
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it('trae los acuerdos con su usuario de SAP, nunca con su contraseña', async () => {
    queryOneScoped.mockResolvedValue({ id: CONEXION, kind: 'ibp', name: 'QA', base_url: 'https://x/' })
    queryScoped.mockResolvedValue([{ id: 'a-1', agreement: 'SAP_COM_0326', sap_user: 'USR0326' }])

    const conexion = await getConnection(CLIENTE, CONEXION)

    expect(conexion.agreements[0]).toMatchObject({ id: 'a-1', agreement: 'SAP_COM_0326', sapUser: 'USR0326' })
    expect(queryScoped.mock.calls[0][1]).not.toMatch(/secret_/)
  })

  it('devuelve los nombres en el estilo de la aplicación, no los de la base', async () => {
    queryOneScoped.mockResolvedValue({ id: CONEXION, kind: 'ibp', name: 'QA', base_url: 'https://x/', is_production: true })
    queryScoped.mockResolvedValue([])

    const conexion = await getConnection(CLIENTE, CONEXION)

    expect(conexion.baseUrl).toBe('https://x/')
    expect(conexion.isProduction).toBe(true)
    expect(conexion).not.toHaveProperty('base_url')
  })
})

describe('createConnection', () => {
  const nueva = { kind: 'ibp', name: 'Tenant QA', baseUrl: 'https://qa-api.scmibp.ondemand.com/' }

  it('valida la dirección antes de guardarla', async () => {
    queryOneScoped.mockResolvedValue({ id: CONEXION })
    await createConnection(CLIENTE, nueva)
    expect(assertSapHost).toHaveBeenCalledWith(nueva.baseUrl, { kind: 'ibp' })
  })

  it('no guarda nada si la dirección no vale', async () => {
    assertSapHost.mockRejectedValue(new Error('Dirección rechazada (Host no permitido)'))
    await expect(createConnection(CLIENTE, nueva)).rejects.toThrow(/rechazada/)
    expect(queryOneScoped).not.toHaveBeenCalled()
  })

  it('rechaza un tipo de conexión que no existe', async () => {
    await expect(createConnection(CLIENTE, { ...nueva, kind: 'ftp' })).rejects.toThrow(/Tipo de conexión/)
  })

  it('exige nombre y dirección', async () => {
    await expect(createConnection(CLIENTE, { kind: 'ibp', baseUrl: 'https://x' })).rejects.toThrow(/nombre/)
    await expect(createConnection(CLIENTE, { kind: 'ibp', name: 'X' })).rejects.toThrow(/dirección/)
  })

  // En CI-DS el repositorio se elige en el logon: la conexión es pruebas Y producción a la vez, así
  // que guardar una marca solo podría mentir.
  it('en CI-DS ignora la marca de productiva', async () => {
    queryOneScoped.mockResolvedValue({ id: CONEXION })
    await createConnection(CLIENTE, {
      kind: 'cids', name: 'CI-DS', baseUrl: 'https://x.hana.ondemand.com/', isProduction: true,
    })
    expect(queryOneScoped.mock.calls[0][2].at(-1)).toBe(false)
  })

  describe('tipo ci (Cloud Integration)', () => {
    const endpoint = 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2'
    const deCi = { kind: 'ci', name: 'CPI desarrollo', baseUrl: endpoint }

    it('valida el host con el patrón de ci y guarda el endpoint completo', async () => {
      queryOneScoped.mockResolvedValue({ id: CONEXION })
      await createConnection(CLIENTE, deCi)
      expect(assertSapHost).toHaveBeenCalledWith(endpoint, { kind: 'ci' })
      expect(queryOneScoped.mock.calls[0][2]).toContain(endpoint)
    })

    // Una conexión de CI es de UN ambiente: el endpoint de desarrollo y el de producción son otros hosts.
    it('respeta la marca de productiva', async () => {
      queryOneScoped.mockResolvedValue({ id: CONEXION })
      await createConnection(CLIENTE, { ...deCi, isProduction: true })
      expect(queryOneScoped.mock.calls[0][2].at(-1)).toBe(true)
    })

    it.each([
      ['sin ruta', 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/', /ruta/],
      ['con usuario en la dirección', 'https://u:p@acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/X', /usuario/],
      ['con parámetros', 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/X?a=1', /parámetros/],
    ])('rechaza una dirección %s', async (_motivo, baseUrl, mensaje) => {
      await expect(createConnection(CLIENTE, { ...deCi, baseUrl })).rejects.toThrow(mensaje)
      expect(queryOneScoped).not.toHaveBeenCalled()
    })
  })

  it('en IBP la respeta, porque ahí el tenant productivo es otra dirección', async () => {
    queryOneScoped.mockResolvedValue({ id: CONEXION })
    await createConnection(CLIENTE, { ...nueva, isProduction: true })
    expect(queryOneScoped.mock.calls[0][2].at(-1)).toBe(true)
  })

  it('guarda con el cliente en la propia fila', async () => {
    queryOneScoped.mockResolvedValue({ id: CONEXION })
    await createConnection(CLIENTE, nueva)
    const [clientId, sql, params] = queryOneScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(sql).toContain('insert into connections')
    expect(params[0]).toBe(CLIENTE)
  })
})

describe('upsertAgreement', () => {
  beforeEach(() => {
    queryOneScoped.mockResolvedValue({ id: CONEXION })
  })

  it('guarda la contraseña cifrada, nunca en claro', async () => {
    await upsertAgreement(CLIENTE, CONEXION, {
      agreement: 'SAP_COM_0326', sapUser: 'USR0326', password: 'MiClaveSAP',
    })

    const [, , params] = queryOneScoped.mock.calls[1]
    expect(params.join('|')).not.toContain('MiClaveSAP')
    // Las tres partes del secreto viajan por separado.
    expect(params).toHaveLength(7)
  })

  it('cada acuerdo lleva su propio usuario de SAP', async () => {
    await upsertAgreement(CLIENTE, CONEXION, { agreement: 'SAP_COM_0720', sapUser: 'USR0720', password: 'x' })
    const [, , params] = queryOneScoped.mock.calls[1]
    expect(params[2]).toBe('SAP_COM_0720')
    expect(params[3]).toBe('USR0720')
  })

  it('vuelve a escribir el acuerdo si ya existía, en vez de duplicarlo', async () => {
    await upsertAgreement(CLIENTE, CONEXION, { agreement: 'SAP_COM_0326', sapUser: 'U', password: 'x' })
    expect(queryOneScoped.mock.calls[1][1]).toContain('on conflict (connection_id, agreement) do update')
  })

  it('no acepta un acuerdo para una conexión de otro cliente', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(upsertAgreement(CLIENTE, CONEXION, { agreement: 'A', sapUser: 'U', password: 'x' }))
      .rejects.toThrow(/no existe para este cliente/)
  })

  it.each([
    ['sin acuerdo', { sapUser: 'U', password: 'x' }, /acuerdo necesita un nombre/],
    ['sin usuario', { agreement: 'A', password: 'x' }, /usuario de SAP/],
    ['sin contraseña', { agreement: 'A', sapUser: 'U' }, /contraseña/],
  ])('rechaza %s', async (_, datos, mensaje) => {
    await expect(upsertAgreement(CLIENTE, CONEXION, datos)).rejects.toThrow(mensaje)
  })
})

describe('getCredentials', () => {
  it('devuelve usuario y contraseña descifrada', async () => {
    const secreto = encryptSecret('MiClaveSAP', {
      clientId: CLIENTE, connectionId: CONEXION, agreement: 'SAP_COM_0326',
    })
    queryOneScoped.mockResolvedValue({
      sap_user: 'USR0326',
      secret_ciphertext: secreto.ciphertext,
      secret_iv: secreto.iv,
      secret_tag: secreto.tag,
    })

    await expect(getCredentials(CLIENTE, CONEXION, 'SAP_COM_0326'))
      .resolves.toEqual({ user: 'USR0326', password: 'MiClaveSAP' })
  })

  it('no descifra el secreto de otro cliente aunque la fila se copiara', async () => {
    const secreto = encryptSecret('MiClaveSAP', {
      clientId: 'otro-cliente', connectionId: CONEXION, agreement: 'SAP_COM_0326',
    })
    queryOneScoped.mockResolvedValue({
      sap_user: 'USR0326',
      secret_ciphertext: secreto.ciphertext,
      secret_iv: secreto.iv,
      secret_tag: secreto.tag,
    })

    await expect(getCredentials(CLIENTE, CONEXION, 'SAP_COM_0326')).rejects.toThrow(/no se pudo descifrar/i)
  })

  it('avisa claro cuando el acuerdo no está configurado', async () => {
    queryOneScoped.mockResolvedValue(null)
    await expect(getCredentials(CLIENTE, CONEXION, 'SAP_COM_0924'))
      .rejects.toThrow(/no tiene configurado el acuerdo SAP_COM_0924/)
  })

  it('consulta con el filtro de cliente puesto', async () => {
    queryOneScoped.mockResolvedValue(null)
    await getCredentials(CLIENTE, CONEXION, 'A').catch(() => {})
    const [clientId, sql, params] = queryOneScoped.mock.calls[0]
    expect(clientId).toBe(CLIENTE)
    expect(sql).toContain('client_id = $3')
    expect(params[2]).toBe(CLIENTE)
  })
})

describe('deleteConnection', () => {
  it('devuelve true solo si borró algo de ese cliente', async () => {
    queryScoped.mockResolvedValue([{ id: CONEXION }])
    await expect(deleteConnection(CLIENTE, CONEXION)).resolves.toBe(true)

    queryScoped.mockResolvedValue([])
    await expect(deleteConnection(CLIENTE, 'ajena')).resolves.toBe(false)
  })
})

// Lo unico que se podia hacer con una conexion mal nombrada era BORRARLA, y eso se lleva sus acuerdos
// con sus contraseñas cifradas. Renombrar existe para no pagar eso por un nombre.
describe('renameConnection', () => {
  const fila = { id: CONEXION, kind: 'ibp', name: 'Tenant de calidad', base_url: 'https://x', organization: null, is_production: false, created_at: new Date(0) }

  it('cambia el nombre y devuelve la conexión ya con el nuevo', async () => {
    queryScoped.mockResolvedValue([fila])
    const suya = await renameConnection(CLIENTE, CONEXION, 'Tenant de calidad')

    expect(suya.name).toBe('Tenant de calidad')
    const [, sql, params] = queryScoped.mock.calls.at(-1)
    expect(sql).toContain('update connections set name')
    expect(params).toEqual([CONEXION, CLIENTE, 'Tenant de calidad'])
  })

  it('recorta los espacios: un nombre con espacios alrededor se ordena distinto en la lista', async () => {
    queryScoped.mockResolvedValue([fila])
    await renameConnection(CLIENTE, CONEXION, '  Tenant de calidad  ')
    expect(queryScoped.mock.calls.at(-1)[2][2]).toBe('Tenant de calidad')
  })

  it('un nombre vacío se rechaza antes de tocar la base', async () => {
    queryScoped.mockClear()
    await expect(renameConnection(CLIENTE, CONEXION, '   ')).rejects.toThrow('necesita un nombre')
    await expect(renameConnection(CLIENTE, CONEXION, '')).rejects.toThrow('necesita un nombre')
    expect(queryScoped).not.toHaveBeenCalled()
  })

  // El aislamiento por cliente: renombrar la conexión de otro no puede parecer que funcionó.
  it('la conexión de otro cliente no se renombra, y se dice', async () => {
    queryScoped.mockResolvedValue([])
    await expect(renameConnection(CLIENTE, 'ajena', 'Mía')).rejects.toThrow('no existe')
  })

  // Cambiar la direccion convertiria la conexion en OTRO tenant conservando sus credenciales, que es
  // la forma mas silenciosa de mandar las contraseñas de un cliente a un servidor que no es el suyo.
  it('NO toca la dirección: la consulta solo actualiza el nombre', async () => {
    queryScoped.mockResolvedValue([fila])
    await renameConnection(CLIENTE, CONEXION, 'Otro nombre')

    const sql = queryScoped.mock.calls.at(-1)[1]
    expect(sql).not.toContain('base_url =')
    expect(sql).not.toContain('kind =')
  })
})

describe('a qué IBP carga una conexión de Cloud Integration', () => {
  const IBP = '22222222-2222-4222-8222-222222222222'
  const deCi = { id: CONEXION, kind: 'ci', name: 'CI STARBRANDS DEV', base_url: 'https://x', organization: null, is_production: false }
  const deIbp = { id: IBP, kind: 'ibp', name: 'IBP STARBRANDS QAS', base_url: 'https://y', organization: null, is_production: false }

  it('la lista y el detalle piden el vínculo con el nombre del IBP, y siempre filtrando por cliente', async () => {
    await listConnections(CLIENTE)
    expect(queryScoped.mock.calls[0][1]).toContain('c.ibp_connection_id')
    expect(queryScoped.mock.calls[0][1]).toContain('ibp_connection_name')
    expect(queryScoped.mock.calls[0][1]).toContain('i.client_id = c.client_id')

    queryOneScoped.mockResolvedValue(null)
    await getConnection(CLIENTE, CONEXION)
    expect(queryOneScoped.mock.calls[0][1]).toContain('ibp_connection_name')
  })

  it('el mapper entrega el vínculo y su nombre, y nada más del IBP', async () => {
    queryScoped.mockResolvedValue([{ ...deCi, ibp_connection_id: IBP, ibp_connection_name: 'IBP STARBRANDS QAS', agreement_count: 1 }])
    const [una] = await listConnections(CLIENTE)
    expect(una).toMatchObject({ ibpConnectionId: IBP, ibpConnectionName: 'IBP STARBRANDS QAS' })
    expect(JSON.stringify(una)).not.toMatch(/https:\/\/y|secret|password/)
  })

  it('una conexión sin vínculo lo dice con null, no con «undefined»', async () => {
    queryScoped.mockResolvedValue([{ ...deCi, ibp_connection_id: null, ibp_connection_name: null }])
    const [una] = await listConnections(CLIENTE)
    expect(una.ibpConnectionId).toBeNull()
    expect(una.ibpConnectionName).toBeNull()
  })

  it('vincula una conexión de CI con una de IBP del mismo cliente', async () => {
    queryOneScoped.mockResolvedValueOnce(deCi).mockResolvedValueOnce(deIbp)
    queryScoped.mockResolvedValue([{ ...deCi, ibp_connection_id: IBP, created_at: new Date(0) }])
    const guardada = await setIbpConnection(CLIENTE, CONEXION, IBP)

    const [clienteDeLaConsulta, sql, params] = queryScoped.mock.calls.at(-1)
    expect(clienteDeLaConsulta).toBe(CLIENTE)
    expect(sql).toContain('client_id = $2')
    expect(params).toEqual([CONEXION, CLIENTE, IBP])
    expect(guardada.ibpConnectionId).toBe(IBP)
  })

  it('con null o vacío quita el vínculo', async () => {
    queryOneScoped.mockResolvedValueOnce(deCi)
    queryScoped.mockResolvedValue([{ ...deCi, ibp_connection_id: null, created_at: new Date(0) }])
    await setIbpConnection(CLIENTE, CONEXION, '')
    expect(queryScoped.mock.calls.at(-1)[2]).toEqual([CONEXION, CLIENTE, null])
  })

  it('solo una conexión de Cloud Integration lleva un IBP de destino', async () => {
    queryOneScoped.mockResolvedValueOnce(deIbp)
    await expect(setIbpConnection(CLIENTE, IBP, IBP)).rejects.toThrow(/Solo una conexión de Cloud Integration/)
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it('el destino tiene que ser de IBP, y se dice cuál no lo es', async () => {
    queryOneScoped.mockResolvedValueOnce(deCi).mockResolvedValueOnce({ ...deCi, id: IBP, name: 'Otra CI' })
    await expect(setIbpConnection(CLIENTE, CONEXION, IBP)).rejects.toThrow(/«Otra CI» no es una conexión de SAP IBP/)
    expect(queryScoped).not.toHaveBeenCalled()
  })

  // Aislamiento: una conexión de otro cliente «no existe» porque la búsqueda lleva el cliente.
  it('una conexión de IBP de otro cliente no se puede vincular', async () => {
    queryOneScoped.mockResolvedValueOnce(deCi).mockResolvedValueOnce(null)
    await expect(setIbpConnection(CLIENTE, CONEXION, IBP)).rejects.toThrow(/no existe/)
    expect(queryScoped).not.toHaveBeenCalled()
  })

  it('un identificador que no es UUID no llega a la base', async () => {
    queryOneScoped.mockResolvedValueOnce(deCi)
    await expect(setIbpConnection(CLIENTE, CONEXION, "1' or '1'='1")).rejects.toThrow(/no existe/)
    expect(queryScoped).not.toHaveBeenCalled()
  })
})
