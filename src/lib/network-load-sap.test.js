// La red de un producto leída de SAP, sin descargar tablas.
//
// Lo que se prueba acá no es que las filas lleguen —eso lo hace el transporte— sino QUÉ SE PIDE: con
// qué filtro y en qué orden. Es donde estaba el defecto: la pantalla exigía la descarga completa de
// casi 3 millones de filas para dibujar una red de veinte nodos.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TOPE_DE_COMPONENTES, cargarRedDeSap } from './network-load-sap.js'
import { fetchMasterRows } from './ibp-master-data.js'

vi.mock('./ibp-master-data.js', () => ({ fetchMasterRows: vi.fn() }))

const DESTINO = { planningArea: 'ASIBPTS', versionId: '' }

/** Un plan con las tablas resueltas a entidades de un tenant `AS1`. */
const PLAN = {
  pasos: [
    { tabla: 'sn_plant', entidad: 'AS1SOURCEPRODUCTION', select: ['SOURCEID', 'PRDID', 'LOCID', 'PLEADTIME'], sePuede: true, descartarSi: null },
    { tabla: 'sn_loc', entidad: 'AS1SOURCELOCATION', select: ['LOCID', 'LOCFR', 'PRDID'], sePuede: true, descartarSi: null },
    { tabla: 'sn_cust', entidad: 'AS1SOURCECUSTOMER', select: ['LOCID', 'PRDID', 'CUSTID'], sePuede: true, descartarSi: null },
    { tabla: 'sn_psi', entidad: 'AS1PRODUCTIONSOURCEITM', select: ['SOURCEID', 'PRDID'], sePuede: true, descartarSi: null },
    { tabla: 'bom_loc', entidad: 'AS1LOCATION', select: ['LOCID', 'LOCDESCR'], sePuede: true, descartarSi: null },
    { tabla: 'sn_cust_master', entidad: 'AS1CUSTOMER', select: ['CUSTID', 'CUSTDESCR'], sePuede: true, descartarSi: null },
    { tabla: 'bom_prd', entidad: 'AS1PRODUCT', select: ['PRDID', 'PRDDESCR'], sePuede: true, descartarSi: null },
  ],
}

/** Lo que devuelve cada entidad, para armar respuestas por tabla. */
function responder(porEntidad) {
  fetchMasterRows.mockImplementation(async (_conexion, { entidad, skip }) => (
    skip > 0 ? [] : (porEntidad[entidad] ?? [])
  ))
}

/** Las llamadas hechas a una entidad, con su filtro. */
const llamadasA = (entidad) => fetchMasterRows.mock.calls
  .map(([, opciones]) => opciones)
  .filter((una) => una.entidad === entidad)

beforeEach(() => { vi.clearAllMocks() })

describe('qué se le pide a SAP', () => {
  beforeEach(() => {
    responder({
      AS1SOURCEPRODUCTION: [{ SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1', PLEADTIME: '2' }],
      AS1SOURCELOCATION: [{ LOCID: 'CD', LOCFR: 'P1', PRDID: 'TERM' }],
      AS1SOURCECUSTOMER: [{ LOCID: 'CD', PRDID: 'TERM', CUSTID: 'C1' }],
      AS1PRODUCTIONSOURCEITM: [{ SOURCEID: 'S1', PRDID: 'MAT' }],
      AS1LOCATION: [{ LOCID: 'P1', LOCDESCR: 'Planta' }],
      AS1CUSTOMER: [{ CUSTID: 'C1', CUSTDESCR: 'Cliente' }],
      AS1PRODUCT: [{ PRDID: 'TERM', PRDDESCR: 'Terminado' }],
    })
  })

  // El defecto que esto arregla: sin filtro, dibujar una red de veinte nodos costaba bajar 1,28
  // millones de arcos a cliente.
  it('todas las peticiones van filtradas: ninguna pide una tabla entera', async () => {
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    expect(fetchMasterRows).toHaveBeenCalled()
    for (const [, opciones] of fetchMasterRows.mock.calls) {
      expect(opciones.condiciones?.length, opciones.entidad).toBeGreaterThan(0)
    }
  })

  it('los arcos y las recetas se piden por el producto', async () => {
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    for (const entidad of ['AS1SOURCEPRODUCTION', 'AS1SOURCECUSTOMER']) {
      expect(llamadasA(entidad)[0].condiciones, entidad)
        .toEqual([{ field: 'PRDID', op: 'eq', value: 'TERM' }])
    }
  })

  // Una receta se identifica por su `SOURCEID`, y es lo único que ata un componente a la receta que lo
  // lleva. Pedir los componentes por producto traería los de todas las recetas del tenant.
  it('los componentes se piden por las recetas que salieron, no por el producto', async () => {
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    expect(llamadasA('AS1PRODUCTIONSOURCEITM')[0].condiciones)
      .toEqual([{ field: 'SOURCEID', op: 'eq', value: 'S1' }])
  })

  it('los arcos de proveedor se piden por los componentes que salieron', async () => {
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    const deArcos = llamadasA('AS1SOURCELOCATION')
    expect(deArcos).toHaveLength(2)
    expect(deArcos[0].condiciones).toEqual([{ field: 'PRDID', op: 'eq', value: 'TERM' }])
    expect(deArcos[1].condiciones).toEqual([{ field: 'PRDID', op: 'eq', value: 'MAT' }])
  })

  // Traer los 478 de ubicaciones y los 9.082 de clientes para una red de veinte nodos es traer el
  // tenant para nada.
  it('los maestros se piden solo por los códigos que salieron', async () => {
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    const ubicaciones = llamadasA('AS1LOCATION')[0].condiciones[0]
    expect(ubicaciones.field).toBe('LOCID')
    expect(ubicaciones.value.split(',').sort()).toEqual(['CD', 'P1'])

    expect(llamadasA('AS1CUSTOMER')[0].condiciones)
      .toEqual([{ field: 'CUSTID', op: 'eq', value: 'C1' }])
  })

  it('devuelve la misma forma que el cargador de la base local', async () => {
    const datos = await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    expect(Object.keys(datos).sort()).toEqual([
      'arcos', 'arcosDeComponentes', 'clientes', 'componentes',
      'maestroDeClientes', 'plantas', 'plazoDePlanta', 'producto', 'ubicaciones',
    ])
    expect(datos.plazoDePlanta).toEqual({ P1: '2' })
    expect(datos.ubicaciones.P1.LOCDESCR).toBe('Planta')
    expect(datos.maestroDeClientes.C1.CUSTDESCR).toBe('Cliente')
    expect(datos.producto.PRDDESCR).toBe('Terminado')
  })
})

describe('los casos que no se pueden pedir', () => {
  it('sin recetas no se piden componentes ni arcos de proveedor', async () => {
    responder({})
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    expect(llamadasA('AS1PRODUCTIONSOURCEITM')).toHaveLength(0)
    // Solo la petición del producto, no la de los componentes.
    expect(llamadasA('AS1SOURCELOCATION')).toHaveLength(1)
  })

  it('una tabla que este tenant no tiene se salta sin romper', async () => {
    responder({ AS1SOURCEPRODUCTION: [{ SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1' }] })
    const plan = {
      pasos: PLAN.pasos.map((uno) => (
        uno.tabla === 'sn_cust' ? { ...uno, sePuede: false, entidad: null } : uno
      )),
    }

    const datos = await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan, prdid: 'TERM' })
    expect(datos.clientes).toEqual([])
    expect(llamadasA('AS1SOURCECUSTOMER')).toHaveLength(0)
  })

  it('un producto vacío no dispara ninguna petición', async () => {
    responder({})
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: '' })
    expect(fetchMasterRows).not.toHaveBeenCalled()
  })
})

// El tope es del largo de la URL: cada componente añade un `PRDID eq '…' or `, y sin cortar SAP
// rechaza la petición. Es el mismo número que usaba v7 y por el mismo motivo.
describe('el tope de componentes', () => {
  it('no pide más de los que caben en la URL', async () => {
    const muchos = Array.from({ length: TOPE_DE_COMPONENTES + 50 }, (_, i) => ({
      SOURCEID: 'S1', PRDID: `MAT${i}`,
    }))
    responder({
      AS1SOURCEPRODUCTION: [{ SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1' }],
      AS1PRODUCTIONSOURCEITM: muchos,
    })

    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    const deProveedores = llamadasA('AS1SOURCELOCATION')[1]
    expect(deProveedores.condiciones[0].value.split(',')).toHaveLength(TOPE_DE_COMPONENTES)
  })
})
