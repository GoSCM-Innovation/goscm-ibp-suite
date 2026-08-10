import { describe, it, expect } from 'vitest'

import {
  CAMPO_DE_SEVERIDAD,
  INDICE_DE_SEVERIDAD,
  TABLAS,
  TABLAS_DE_VISTA,
  TABLA_DE_ORIGEN,
  existeLaTabla,
  marcaDeOrigen,
  mismoOrigen,
  todasLasTablas,
} from './explorer-schema.js'

describe('todasLasTablas', () => {
  const todas = todasLasTablas()
  const porNombre = Object.fromEntries(todas.map((una) => [una.nombre, una]))

  it('incluye las de datos, las de vista y la de origen', () => {
    expect(todas).toHaveLength(TABLAS.length + TABLAS_DE_VISTA.length + 1)
    expect(porNombre[TABLA_DE_ORIGEN]).toBeTruthy()
  })

  it('no hay nombres repetidos', () => {
    expect(new Set(todas.map((una) => una.nombre)).size).toBe(todas.length)
  })

  // Estas dos se consultan de a una, por el producto o la ubicación que se está mirando.
  it('las que tienen clave propia la declaran', () => {
    expect(porNombre.bom_prd.clave).toBe('PRDID')
    expect(porNombre.bom_loc.clave).toBe('LOCID')
  })

  it('las demás se numeran solas', () => {
    expect(porNombre.bom_psh.clave).toBeNull()
    expect(porNombre.sn_loc_prod.clave).toBeNull()
  })

  // Filtrar "solo los errores" es lo primero que hace cualquiera con un informe de cien mil filas.
  it('todas las de vista llevan índice por severidad', () => {
    for (const nombre of TABLAS_DE_VISTA) {
      expect(porNombre[nombre].indices).toEqual([
        { nombre: INDICE_DE_SEVERIDAD, campo: CAMPO_DE_SEVERIDAD },
      ])
    }
  })

  it('cada índice apunta a un campo', () => {
    for (const tabla of todas) {
      for (const indice of tabla.indices ?? []) {
        expect(indice.nombre).toBeTruthy()
        expect(indice.campo).toBeTruthy()
      }
    }
  })

  // Los tres analizadores no comparten tablas: cada uno filtra y enriquece distinto.
  it('los tres grupos existen y no se pisan', () => {
    const grupos = (prefijo) => TABLAS.filter((una) => una.nombre.startsWith(prefijo))
    expect(grupos('bom_').length).toBeGreaterThan(0)
    expect(grupos('sn_').length).toBeGreaterThan(0)
    expect(grupos('pa_').length).toBeGreaterThan(0)
  })
})

describe('existeLaTabla', () => {
  it('reconoce las del esquema', () => {
    expect(existeLaTabla('bom_psh')).toBe(true)
    expect(existeLaTabla('pa_psi_web')).toBe(true)
  })

  // Abrir una transacción sobre una tabla inexistente revienta con un error que no explica nada.
  it('rechaza lo que no está', () => {
    expect(existeLaTabla('inventada')).toBe(false)
    expect(existeLaTabla('')).toBe(false)
  })
})

describe('marcaDeOrigen y mismoOrigen', () => {
  const origen = { connectionId: 'c-1', planningArea: 'PA', versionId: 'V1' }

  it('la marca junta tenant, área y versión', () => {
    expect(marcaDeOrigen(origen)).toBe('c-1|PA|V1')
  })

  it('la versión base no rompe la marca', () => {
    expect(marcaDeOrigen({ connectionId: 'c-1', planningArea: 'PA' })).toBe('c-1|PA|')
  })

  it('el mismo origen se reconoce', () => {
    expect(mismoOrigen('c-1|PA|V1', origen)).toBe(true)
  })

  // Cambiar cualquiera de los tres son datos de OTRO sitio, no una version vieja de los mismos.
  it('cambiar tenant, área o versión ya no es el mismo origen', () => {
    expect(mismoOrigen('c-1|PA|V1', { ...origen, connectionId: 'c-2' })).toBe(false)
    expect(mismoOrigen('c-1|PA|V1', { ...origen, planningArea: 'OTRA' })).toBe(false)
    expect(mismoOrigen('c-1|PA|V1', { ...origen, versionId: 'V2' })).toBe(false)
  })

  it('sin nada guardado no coincide con nada', () => {
    expect(mismoOrigen(null, origen)).toBe(false)
  })
})
