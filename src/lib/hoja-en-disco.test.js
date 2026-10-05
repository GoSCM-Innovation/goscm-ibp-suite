import { describe, expect, it } from 'vitest'

import { COLORES } from '../../core/ibp/analisis-hojas.js'
import {
  FILAS_DE_RESPALDO,
  FILAS_POR_LOTE_WEB,
  LOTES_EN_VUELO,
  TABLA_DE_VISTA_DE,
  crearFabricaDeHojasGrandes,
  crearOrigenPaginado,
} from './hoja-en-disco.js'

const cfg = (nombre = 'Location Source') => ({
  nombre,
  color: 'FFF7A800',
  encabezados: ['Estado', 'Observación', 'PRDID'],
  notas: ['n1', 'n2', 'n3'],
  grupos: ['control', 'control', 'ibp'],
})

/** Una base falsa que guarda lo que le llega y permite hacer fallar o demorar las escrituras. */
function baseFalsa({ falla = false, demora = false } = {}) {
  const guardado = []
  const pendientes = []
  return {
    guardado,
    pendientes,
    guardarLote: (tabla, filas) => {
      if (falla) return Promise.reject(new Error('disco lleno'))
      if (demora) return new Promise((resolver) => { pendientes.push(() => { guardado.push({ tabla, filas }); resolver() }) })
      guardado.push({ tabla, filas })
      return Promise.resolve()
    },
  }
}

const llenar = (hoja, n, relleno = null) => {
  for (let i = 0; i < n; i++) hoja.agregar(['', `obs ${i}`, `P${i}`], relleno)
}

describe('los valores de v7', () => {
  it('son los mismos', () => {
    expect(FILAS_POR_LOTE_WEB).toBe(8000)
    expect(LOTES_EN_VUELO).toBe(12)
    expect(FILAS_DE_RESPALDO).toBe(20000)
    expect(TABLA_DE_VISTA_DE).toEqual({ 'Location Source': 'sn_loc_web', 'Customer Source': 'sn_cust_web' })
  })
})

describe('crearFabricaDeHojasGrandes — solo Excel', () => {
  it('escribe el Excel por partes y no toca la base local ni retiene filas', async () => {
    const base = baseFalsa()
    const hoja = crearFabricaDeHojasGrandes({ web: false, guardarLote: base.guardarLote })(cfg())
    llenar(hoja, 5)
    hoja.agregar(['', 'mal', 'X'], COLORES.C_RED)
    await hoja.cerrar()

    expect(base.guardado).toEqual([])
    expect(hoja.filas).toEqual([])
    expect(hoja.origen).toBeUndefined()
    expect(hoja.partes).toHaveLength(1)
    expect(hoja.total).toBe(6)
    expect(hoja.red).toBe(1)
    expect(hoja.ok).toBe(5)
  })

  it('el XML lleva el encabezado, las 6 filas y el rojo de la alerta', async () => {
    const hoja = crearFabricaDeHojasGrandes({ web: false })(cfg())
    llenar(hoja, 5)
    hoja.agregar(['', 'mal', 'X'], COLORES.C_RED)
    await hoja.cerrar()
    const xml = typeof hoja.partes[0].xml === 'string' ? hoja.partes[0].xml : await new Response(hoja.partes[0].xml).text()
    expect(xml).toContain('<dimension ref="A1:C7"/>')
    expect(xml).toContain('<c r="C7" t="inlineStr" s="2"><is><t>X</t></is></c>')
    expect(hoja.partes[0].notas).toHaveLength(3)
  })

  it('devuelve la severidad, como las hojas en memoria', () => {
    const hoja = crearFabricaDeHojasGrandes()(cfg())
    expect(hoja.agregar(['', 'a', 'b'], COLORES.C_YEL)).toBe('yel')
    expect(hoja.agregar(['', 'a', 'b'])).toBe('ok')
  })
})

describe('crearFabricaDeHojasGrandes — con vista web', () => {
  const opciones = (base, extra = {}) => ({
    web: true, guardarLote: base.guardarLote, filasPorLote: 4, filasDeRespaldo: 6, ...extra,
  })

  it('guarda las filas en la tabla de la hoja, en lotes, como texto y con su severidad', async () => {
    const base = baseFalsa()
    const hoja = crearFabricaDeHojasGrandes(opciones(base))(cfg('Customer Source'))
    llenar(hoja, 9)
    hoja.agregar(['', 'mal', 'X'], COLORES.C_YEL)
    await hoja.cerrar()

    // Diez filas en lotes de cuatro: 4 + 4 + 2.
    expect(base.guardado.map((g) => [g.tabla, g.filas.length])).toEqual([
      ['sn_cust_web', 4], ['sn_cust_web', 4], ['sn_cust_web', 2],
    ])
    expect(base.guardado[2].filas[1]).toEqual({ c: ['', 'mal', 'X'], s: 'yel' })
    expect(hoja.origen).toBeDefined()
  })

  it('en memoria deja solo las primeras filas de respaldo y avisa que está capada', async () => {
    const base = baseFalsa()
    const hoja = crearFabricaDeHojasGrandes(opciones(base))(cfg())
    llenar(hoja, 10)
    await hoja.cerrar()
    expect(hoja.filas).toHaveLength(6)
    expect(hoja.filas[0]).toEqual({ c: ['', 'obs 0', 'P0'], s: 'ok' })
    expect(hoja.capada).toBe(true)
    expect(hoja.total).toBe(10) // los contadores son de TODAS las filas
  })

  it('si las filas caben en el respaldo no está capada', async () => {
    const hoja = crearFabricaDeHojasGrandes(opciones(baseFalsa()))(cfg())
    llenar(hoja, 6)
    await hoja.cerrar()
    expect(hoja.capada).toBeUndefined()
  })

  it('si la base local falla, la hoja queda sin origen y avisa; el Excel sale igual', async () => {
    const registro = []
    const hoja = crearFabricaDeHojasGrandes(opciones(baseFalsa({ falla: true }), { registrar: (c, t) => registro.push([c, t]) }))(cfg())
    llenar(hoja, 9)
    await hoja.cerrar()
    expect(hoja.origen).toBeUndefined()
    expect(hoja.partes).toHaveLength(1)
    expect(registro).toEqual([['warn', 'Vista web (detalle completo Location Source) no disponible: disco lleno']])
  })

  it('con demasiados lotes sin terminar renuncia a la vista completa y sigue con el Excel', async () => {
    const base = baseFalsa({ demora: true })
    const registro = []
    const hoja = crearFabricaDeHojasGrandes(opciones(base, { lotesEnVuelo: 2, registrar: (c, t) => registro.push([c, t]) }))(cfg())
    llenar(hoja, 20) // cinco lotes de cuatro, ninguno termina
    await hoja.cerrar()
    expect(registro).toEqual([[
      'warn',
      'Vista web Location Source: volumen alto, se usará vista parcial (descarga Excel para el 100%).',
    ]])
    expect(hoja.origen).toBeUndefined()
    expect(hoja.filas).toHaveLength(6)
    expect(hoja.total).toBe(20)
    expect(hoja.partes).toHaveLength(1)
  })

  it('una hoja sin tabla de vista (no es de arcos) solo escribe el Excel', async () => {
    const base = baseFalsa()
    const hoja = crearFabricaDeHojasGrandes(opciones(base))(cfg('Otra'))
    llenar(hoja, 9)
    await hoja.cerrar()
    expect(base.guardado).toEqual([])
    expect(hoja.origen).toBeUndefined()
  })
})

describe('crearOrigenPaginado', () => {
  it('pide el tramo con el filtro de severidad, o todo si es «all»', async () => {
    const pedidos = []
    const origen = crearOrigenPaginado('sn_loc_web', {
      tramo: (tabla, opciones) => { pedidos.push([tabla, opciones]); return Promise.resolve(['fila']) },
    })
    await origen.pagina('all', 100, 50)
    await origen.pagina('red', 0, 50)
    expect(pedidos).toEqual([
      ['sn_loc_web', { desde: 100, cuantos: 50 }],
      ['sn_loc_web', { desde: 0, cuantos: 50, indice: 'by_severity', valor: 'red' }],
    ])
  })

  it('busca con los topes que le pasan', async () => {
    const pedidos = []
    const origen = crearOrigenPaginado('sn_cust_web', {
      buscar: (tabla, prueba, opciones) => { pedidos.push([tabla, opciones]); return Promise.resolve({ filas: [], truncada: false }) },
    })
    await origen.buscar('yel', () => true, 2000, 300000)
    expect(pedidos).toEqual([['sn_cust_web', { maximo: 2000, escanear: 300000, indice: 'by_severity', valor: 'yel' }]])
  })
})
