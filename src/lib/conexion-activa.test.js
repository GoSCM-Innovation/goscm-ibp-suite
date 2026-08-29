import { beforeEach, describe, expect, it } from 'vitest'

import {
  conectar, conexionActiva, desconectar, destinoDe, estaConectado,
} from './conexion-activa.js'
import { VERSION_BASE } from './version-elegida.js'

// Que avisar a la pantalla funcione se comprueba en `Shell.test.js`: el candado del menú se cae al
// conectar sin recargar la página, y eso solo pasa si la suscripción despierta al componente.

const COMPLETA = {
  connectionId: 'c1',
  nombre: 'Tenant de pruebas',
  baseUrl: 'https://my400444-api.scmibp1.ondemand.com',
  planningArea: 'SAP4',
  version: VERSION_BASE,
}

beforeEach(() => { desconectar() })

describe('estaConectado', () => {
  it('hace falta tenant, área Y versión: con dos de tres no se puede consultar nada', () => {
    // Es lo que el asistente existe para evitar. Dejar pasar con el destino a medias da un error de
    // SAP que no dice qué falta.
    conectar({ ...COMPLETA, version: '' })
    expect(estaConectado()).toBe(false)

    conectar({ ...COMPLETA, planningArea: '' })
    expect(estaConectado()).toBe(false)

    conectar({ ...COMPLETA, connectionId: '' })
    expect(estaConectado()).toBe(false)

    conectar(COMPLETA)
    expect(estaConectado()).toBe(true)
  })

  it('la versión base cuenta como elegida', () => {
    // Costó que un módulo entero fuera inalcanzable: la base viaja vacía a SAP, pero elegirla ES una
    // elección. Ver `version-elegida.js`.
    conectar({ ...COMPLETA, version: VERSION_BASE })
    expect(estaConectado()).toBe(true)
  })

  it('sin nadie conectado, es falso', () => {
    expect(estaConectado()).toBe(false)
  })
})

describe('conectar', () => {
  it('guarda lo que hace falta para decir contra qué se está trabajando', () => {
    conectar(COMPLETA)
    expect(conexionActiva()).toMatchObject({
      connectionId: 'c1',
      nombre: 'Tenant de pruebas',
      planningArea: 'SAP4',
      esProduccion: false,
    })
  })

  it('marca los tenants productivos', () => {
    conectar({ ...COMPLETA, esProduccion: true })
    expect(conexionActiva().esProduccion).toBe(true)
  })

  it('desconectar la deja vacía', () => {
    conectar(COMPLETA)
    desconectar()
    expect(estaConectado()).toBe(false)
    expect(conexionActiva().connectionId).toBe('')
    expect(conexionActiva().nombre).toBe('')
  })
})

describe('destinoDe', () => {
  it('traduce la versión base a la cadena vacía que espera SAP', () => {
    conectar({ ...COMPLETA, version: VERSION_BASE })
    expect(destinoDe()).toEqual({ connectionId: 'c1', planningArea: 'SAP4', versionId: '' })
  })

  it('una versión con nombre viaja tal cual', () => {
    conectar({ ...COMPLETA, version: 'ESCENARIO1' })
    expect(destinoDe()).toEqual({ connectionId: 'c1', planningArea: 'SAP4', versionId: 'ESCENARIO1' })
  })

  it('no arrastra el nombre ni la dirección: eso es para la pantalla, no para SAP', () => {
    conectar(COMPLETA)
    expect(Object.keys(destinoDe()).sort()).toEqual(['connectionId', 'planningArea', 'versionId'])
  })
})
