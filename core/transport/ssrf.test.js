import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkOdataService, isPrivateAddress, validateSapHost, validateSapUrl } from './ssrf.js'
import { lookup } from 'node:dns/promises'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))

const IBP = 'https://cliente-api.scmibp1.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/Producto'
const publica = [{ address: '52.10.20.30', family: 4 }]

beforeEach(() => {
  vi.clearAllMocks()
  lookup.mockResolvedValue(publica)
})

afterEach(() => {
  delete process.env.ALLOWED_IBP_HOST_REGEX
  delete process.env.ALLOWED_SAP_SERVICES
})

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1',
  ])('reconoce %s como interna', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each(['52.10.20.30', '8.8.8.8', '2606:4700::1111'])('reconoce %s como pública', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })

  it('trata lo que no es una dirección como insegura', () => {
    expect(isPrivateAddress('no-es-una-ip')).toBe(true)
  })
})

describe('validateSapUrl', () => {
  it('acepta un tenant de IBP con un servicio permitido', async () => {
    await expect(validateSapUrl(IBP, { kind: 'ibp' })).resolves.toBeNull()
  })

  it('rechaza http', async () => {
    await expect(validateSapUrl(IBP.replace('https', 'http'), { kind: 'ibp' })).resolves.toMatch(/HTTPS/)
  })

  it('rechaza una URL mal formada', async () => {
    await expect(validateSapUrl('esto no es una url', { kind: 'ibp' })).resolves.toBe('URL inválida')
  })

  it('rechaza un host que no es de SAP', async () => {
    const url = 'https://malicioso.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toBe('Host no permitido')
  })

  it('el patrón está anclado: no basta con contener el dominio de SAP', async () => {
    const url = 'https://cliente-api.scmibp.ondemand.com.malicioso.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toBe('Host no permitido')
  })

  it('rechaza llamar por dirección numérica aunque sea pública', async () => {
    const url = 'https://52.10.20.30/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toMatch(/por su nombre/)
  })

  it('rechaza un nombre válido que resuelve a una dirección interna', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    await expect(validateSapUrl(IBP, { kind: 'ibp' })).resolves.toMatch(/dirección interna/)
  })

  it('rechaza si alguna de las direcciones resueltas es interna', async () => {
    lookup.mockResolvedValue([{ address: '52.10.20.30' }, { address: '10.1.1.1' }])
    await expect(validateSapUrl(IBP, { kind: 'ibp' })).resolves.toMatch(/dirección interna/)
  })

  it('rechaza si el nombre no se puede resolver', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(validateSapUrl(IBP, { kind: 'ibp' })).resolves.toMatch(/resolver/)
  })

  it('rechaza un servicio de OData que no está en la lista', async () => {
    const url = 'https://cliente-api.scmibp.ondemand.com/sap/opu/odata/IBP/SERVICIO_RARO/X'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toMatch(/Servicio no permitido/)
  })

  it('comprueba el servicio ANTES de resolver el nombre', async () => {
    const url = 'https://cliente-api.scmibp.ondemand.com/sap/opu/odata/IBP/SERVICIO_RARO/X'
    await validateSapUrl(url, { kind: 'ibp' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('acepta el servicio de jobs, que va por la ruta en minúsculas', async () => {
    const url = 'https://cliente-api.scmibp.ondemand.com/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT/JobHeaderSet'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toBeNull()
  })

  it.each([
    'https://x.kyma.ondemand.com/service',
    'https://mi-tenant.hana.ondemand.com/service',
    'https://algo.hcs.cloud.sap/service',
  ])('acepta el destino de CI-DS %s', async (url) => {
    await expect(validateSapUrl(url, { kind: 'cids' })).resolves.toBeNull()
  })

  it('no aplica la lista de servicios de OData a CI-DS', async () => {
    await expect(validateSapUrl('https://x.kyma.ondemand.com/lo-que-sea', { kind: 'cids' })).resolves.toBeNull()
  })

  it('no acepta un host de IBP como destino de CI-DS ni al revés', async () => {
    await expect(validateSapUrl(IBP, { kind: 'cids' })).resolves.toBe('Host no permitido')
    // Con una ruta de servicio válida, lo que sobra es el host.
    const cidsConRutaDeIbp = 'https://x.kyma.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X'
    await expect(validateSapUrl(cidsConRutaDeIbp, { kind: 'ibp' })).resolves.toBe('Host no permitido')
    // Y con la ruta propia de CI-DS, sobra la ruta.
    await expect(validateSapUrl('https://x.kyma.ondemand.com/s', { kind: 'ibp' }))
      .resolves.toMatch(/no es un servicio/)
  })

  it('exige decir a qué destino se llama', async () => {
    await expect(validateSapUrl(IBP, {})).rejects.toThrow(/Destino desconocido/)
    await expect(validateSapUrl(IBP, { kind: 'otro' })).rejects.toThrow(/Destino desconocido/)
  })

  it('permite abrir el patrón por variable de entorno para un tenant no estándar', async () => {
    const url = 'https://raro.interno-sap.example.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toBe('Host no permitido')
    process.env.ALLOWED_IBP_HOST_REGEX = '^raro\\.interno-sap\\.example\\.com$'
    await expect(validateSapUrl(url, { kind: 'ibp' })).resolves.toBeNull()
  })

  it('un patrón inválido en la variable no abre la puerta: se usa el de siempre', async () => {
    process.env.ALLOWED_IBP_HOST_REGEX = '(('
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(validateSapUrl(IBP, { kind: 'ibp' })).resolves.toBeNull()
    const ajena = 'https://malicioso.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X'
    await expect(validateSapUrl(ajena, { kind: 'ibp' })).resolves.toBe('Host no permitido')
  })
})

describe('validateSapHost', () => {
  it('acepta la dirección base de un tenant, sin servicio en la ruta', async () => {
    // Es lo que hace falta para guardar una conexión: todavía no hay ninguna llamada.
    await expect(validateSapHost('https://cliente-api.scmibp1.ondemand.com/', { kind: 'ibp' }))
      .resolves.toBeNull()
  })

  it('esa misma dirección no vale para llamar, porque no lleva servicio', async () => {
    await expect(validateSapUrl('https://cliente-api.scmibp1.ondemand.com/', { kind: 'ibp' }))
      .resolves.toMatch(/no es un servicio/)
  })

  it('sigue rechazando un host ajeno', async () => {
    await expect(validateSapHost('https://malicioso.com/', { kind: 'ibp' })).resolves.toBe('Host no permitido')
  })

  it('sigue rechazando lo que resuelve a una dirección interna', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.5' }])
    await expect(validateSapHost('https://cliente-api.scmibp.ondemand.com/', { kind: 'ibp' }))
      .resolves.toMatch(/dirección interna/)
  })
})

describe('checkOdataService', () => {
  it('acepta los tres servicios de la lista por defecto', () => {
    expect(checkOdataService('/sap/opu/odata/IBP/MASTER_DATA_API_SRV/X')).toBeNull()
    expect(checkOdataService('/sap/opu/odata/IBP/PLANNING_DATA_API_SRV/X')).toBeNull()
    expect(checkOdataService('/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT/X')).toBeNull()
  })

  it('rechaza una ruta que no es de OData de IBP', () => {
    expect(checkOdataService('/otra/cosa')).toMatch(/no es un servicio/)
  })

  // Así publica SAP los Application Jobs, y así hay que llamarlos. Sin esto, la ruta real del
  // tenant se rechazaba aunque el servicio estuviera permitido.
  it('acepta la versión pegada al nombre del servicio', () => {
    expect(checkOdataService('/sap/opu/odata/sap/BC_EXT_APPJOB_MANAGEMENT;v=0002/$metadata')).toBeNull()
  })

  // La versión no puede colar un servicio que no está permitido.
  it('lo que se autoriza es el servicio, no la versión', () => {
    expect(checkOdataService('/sap/opu/odata/sap/OTRO_SRV;v=0002/X')).toMatch(/no permitido/)
  })

  it('se puede ampliar la lista por variable de entorno', () => {
    expect(checkOdataService('/sap/opu/odata/IBP/OTRO_SRV/X')).toMatch(/no permitido/)
    process.env.ALLOWED_SAP_SERVICES = 'MASTER_DATA_API_SRV, OTRO_SRV'
    expect(checkOdataService('/sap/opu/odata/IBP/OTRO_SRV/X')).toBeNull()
  })
})
