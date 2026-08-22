import { describe, expect, it } from 'vitest'

import { etiquetaDeConexion, hostDe } from './nombre-de-conexion.js'

describe('el host de una dirección', () => {
  it('saca el host y descarta el resto', () => {
    expect(hostDe('https://my400444-api.scmibp.ondemand.com/sap/opu/odata')).toBe('my400444-api.scmibp.ondemand.com')
  })

  it('aguanta una dirección sin protocolo o a medio escribir', () => {
    expect(hostDe('my400444-api.scmibp.ondemand.com/algo')).toBe('my400444-api.scmibp.ondemand.com')
    expect(hostDe('')).toBe('')
    expect(hostDe(null)).toBe('')
  })
})

describe('la etiqueta de una conexión', () => {
  // El caso real: dos conexiones llamadas «Tenant IBP» y «Tenant IBP · my400444».
  it('añade el host cuando el nombre no identifica el tenant', () => {
    expect(etiquetaDeConexion({ name: 'Tenant IBP', baseUrl: 'https://my301282-api.scmibp1.ondemand.com' }))
      .toBe('Tenant IBP — my301282-api.scmibp1.ondemand.com')
  })

  // Si el nombre ya lo dice, repetirlo convierte el desplegable en una lista de direcciones largas.
  it('NO lo añade cuando el nombre ya lleva el tenant', () => {
    expect(etiquetaDeConexion({ name: 'Tenant IBP · my400444', baseUrl: 'https://my400444-api.scmibp.ondemand.com' }))
      .toBe('Tenant IBP · my400444')
  })

  it('el sufijo -api no impide reconocerlo', () => {
    expect(etiquetaDeConexion({ name: 'Calidad my301282', baseUrl: 'https://my301282-api.scmibp1.ondemand.com' }))
      .toBe('Calidad my301282')
  })

  it('sirve igual para CI-DS', () => {
    expect(etiquetaDeConexion({ name: 'Ci-DS GO', baseUrl: 'https://us.cids.cloud.sap/webservices' }))
      .toBe('Ci-DS GO — us.cids.cloud.sap')
  })

  it('aguanta lo que falte', () => {
    expect(etiquetaDeConexion({ name: 'Solo nombre' })).toBe('Solo nombre')
    expect(etiquetaDeConexion({ baseUrl: 'https://x.scmibp.ondemand.com' })).toBe('x.scmibp.ondemand.com')
    expect(etiquetaDeConexion(null)).toBe('')
  })
})
