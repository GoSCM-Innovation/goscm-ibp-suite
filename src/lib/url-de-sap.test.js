import { describe, expect, it } from 'vitest'

import { urlDeSap } from './url-de-sap.js'

describe('urlDeSap', () => {
  it('quita el `-api` del host, que es lo único que separa la API del launchpad', () => {
    expect(urlDeSap('https://my400439-api.scmibp.ondemand.com/sap/opu/odata/IBP/X'))
      .toBe('https://my400439.scmibp.ondemand.com')
  })

  it('respeta el número del centro de datos', () => {
    expect(urlDeSap('https://my400444-api.scmibp1.ondemand.com'))
      .toBe('https://my400444.scmibp1.ondemand.com')
  })

  it('con un dominio que no encaja devuelve null, y el enlace no se dibuja', () => {
    // Un enlace que lleva a ninguna parte es peor que no tenerlo. Hay tenants con dominio propio.
    expect(urlDeSap('https://ibp.cliente.com/sap/opu/odata')).toBeNull()
  })

  it('con una dirección ilegible devuelve null en vez de reventar', () => {
    expect(urlDeSap('no es una url')).toBeNull()
    expect(urlDeSap('')).toBeNull()
    expect(urlDeSap(null)).toBeNull()
  })
})
