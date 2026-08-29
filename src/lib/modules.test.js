import { describe, expect, it } from 'vitest'

import { APPS_EXPLORER, MODULES, appById, moduleById, partirRuta } from './modules.js'

describe('las seis aplicaciones de v7', () => {
  it('están las seis, con los nombres de v7 y en su orden', () => {
    // Los nombres son los del menú de v7 y se quedan en inglés a propósito: son los que el cliente
    // lleva años viendo. Renombrar «Production Analyzer» no traduce nada, cambia un producto en uso.
    expect(APPS_EXPLORER.map((una) => una.name)).toEqual([
      'Production Visualizer',
      'Production Analyzer',
      'Network Visualizer',
      'Network Analyzer',
      'Glosario Analyzers',
      'Planning Area Documenter',
    ])
  })

  it('las cuatro que hablan con SAP piden conexión; el glosario y el documentador no', () => {
    const piden = APPS_EXPLORER.filter((una) => una.requiereConexion).map((una) => una.id)
    expect(piden).toEqual(['bom', 'pa', 'visualizer', 'network'])
  })

  it('cada una que pide conexión trae su texto de módulo restringido', () => {
    for (const una of APPS_EXPLORER.filter((otra) => otra.requiereConexion)) {
      expect(una.bloqueado, una.id).toBeTruthy()
    }
  })

  it('cuelgan de Data Tools y de ningún otro módulo', () => {
    expect(moduleById('explorer').apps).toBe(APPS_EXPLORER)
    expect(MODULES.filter((uno) => uno.apps)).toHaveLength(1)
  })
})

describe('appById', () => {
  it('encuentra la aplicación de su módulo', () => {
    expect(appById('explorer', 'network').name).toBe('Network Analyzer')
  })

  it('devuelve null para lo que no existe, en vez de reventar', () => {
    expect(appById('explorer', 'inventada')).toBeNull()
    expect(appById('cids', 'bom')).toBeNull()
  })
})

describe('partirRuta', () => {
  it('parte `modulo/app` en sus dos mitades', () => {
    expect(partirRuta('explorer/network')).toEqual({ moduleId: 'explorer', appId: 'network' })
  })

  it('sin aplicación cae en la primera del módulo', () => {
    expect(partirRuta('explorer')).toEqual({ moduleId: 'explorer', appId: 'bom' })
  })

  it('una aplicación que no existe cae en la primera, no deja la pantalla en blanco', () => {
    // Pasa con una dirección vieja guardada en marcadores o escrita a mano.
    expect(partirRuta('explorer/inventada')).toEqual({ moduleId: 'explorer', appId: 'bom' })
  })

  it('un módulo sin aplicaciones no inventa ninguna', () => {
    expect(partirRuta('cids')).toEqual({ moduleId: 'cids', appId: null })
  })

  it('con una ruta desconocida devuelve lo que le dieron y ninguna aplicación', () => {
    expect(partirRuta('admin')).toEqual({ moduleId: 'admin', appId: null })
    expect(partirRuta('')).toEqual({ moduleId: '', appId: null })
  })
})
