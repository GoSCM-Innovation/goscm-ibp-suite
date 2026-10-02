// La red de un producto leída de SAP, sin descargar tablas.
//
// Lo que se prueba aquí no es que las filas lleguen —eso lo hace el transporte— sino QUÉ SE PIDE: con
// qué filtro y en qué orden, y qué se anota en el registro técnico. Es donde estaba el defecto: la
// pantalla exigía la descarga completa de casi 3 millones de filas para dibujar una red de veinte nodos.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TOPE_DE_COMPONENTES, TOPE_DE_DESTINOS, cargarRedDeSap, filtroLegible, lineaGet, planDeLaRed,
  productosDeSap,
} from './network-load-sap.js'
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

  it('devuelve las filas que espera armarRed', async () => {
    const datos = await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })

    expect(Object.keys(datos).sort()).toEqual([
      'arcos', 'arcosDeComponentes', 'clientes', 'componentes',
      'maestroDeClientes', 'plantas', 'plantasGlobales', 'ubicaciones',
    ])
    expect(datos.ubicaciones.P1.LOCDESCR).toBe('Planta')
    expect(datos.maestroDeClientes.C1.CUSTDESCR).toBe('Cliente')
  })

  // v7 sacaba la descripción del catálogo de materiales, no de una consulta más.
  it('no pide el maestro del producto: su descripción ya está en el catálogo', async () => {
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })
    expect(llamadasA('AS1PRODUCT')).toHaveLength(0)
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

// Lo que se ve tras «Ver logs técnicos»: las mismas líneas que escribía v7.
describe('el registro técnico', () => {
  function registrar() {
    const lineas = []
    return { lineas, onRegistro: (clase, texto) => lineas.push({ clase, texto }) }
  }

  beforeEach(() => {
    responder({
      AS1SOURCEPRODUCTION: [{ SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1', PLEADTIME: '2' }],
      AS1SOURCELOCATION: [{ LOCID: 'CD', LOCFR: 'P1', PRDID: 'TERM' }],
      AS1SOURCECUSTOMER: [{ LOCID: 'CD', PRDID: 'TERM', CUSTID: 'C1' }],
      AS1PRODUCTIONSOURCEITM: [{ SOURCEID: 'S1', PRDID: 'MAT' }],
      AS1LOCATION: [{ LOCID: 'P1' }],
      AS1CUSTOMER: [{ CUSTID: 'C1' }],
    })
  })

  it('anota «✓ Location Source: N registros» por cada tabla', async () => {
    const { lineas, onRegistro } = registrar()
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM', onRegistro })

    const textos = lineas.map((una) => una.texto)
    expect(textos).toContain('✓ Location Source: 1 registros')
    expect(textos).toContain('✓ Customer Source: 1 registros')
    expect(textos).toContain('✓ Production Source Header: 1 registros')
    expect(textos).toContain('✓ PSI: 1 componentes')
    expect(textos).toContain('✓ Location Master: 1 registros')
    expect(textos).toContain('✓ Customer Master: 1 registros')
  })

  it('anota la petición con «[GET]», el filtro y los campos', async () => {
    const { lineas, onRegistro } = registrar()
    await cargarRedDeSap({
      conexionId: 'c1',
      destino: { planningArea: 'ASIBPTS', versionId: 'V1' },
      plan: PLAN,
      prdid: 'TERM',
      onRegistro,
    })

    expect(lineas.map((una) => una.texto)).toContain(
      "[GET] AS1SOURCELOCATION | $filter=PlanningAreaID eq 'ASIBPTS' and VersionID eq 'V1' and PRDID eq 'TERM' | $select=LOCID,LOCFR,PRDID",
    )
  })

  it('las peticiones van como «info» y los resultados como «ok»', async () => {
    const { lineas, onRegistro } = registrar()
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM', onRegistro })

    expect(lineas.filter((una) => una.texto.startsWith('[GET]')).every((una) => una.clase === 'info')).toBe(true)
    expect(lineas.filter((una) => una.texto.startsWith('✓')).every((una) => una.clase === 'ok')).toBe(true)
  })

  it('los arcos de proveedor dicen para cuántos componentes se piden', async () => {
    const { lineas, onRegistro } = registrar()
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM', onRegistro })

    expect(lineas.map((una) => una.texto))
      .toContain('[GET] AS1SOURCELOCATION | Arcos de proveedor para 1 componentes')
  })
})

describe('las plantas de un insumo', () => {
  // Un insumo no tiene recetas propias. v7 pregunta qué plantas hay en los destinos de sus arcos.
  it('sin recetas propias pregunta por las plantas de los destinos de sus arcos', async () => {
    fetchMasterRows.mockImplementation(async (_conexion, { entidad, condiciones, skip }) => {
      if (skip > 0) return []
      if (entidad === 'AS1SOURCELOCATION') return [{ LOCFR: 'PROV', LOCID: 'FABRICA', PRDID: 'INSUMO' }]
      // Al preguntar por ubicación, la tabla de recetas responde con las del tenant.
      if (entidad === 'AS1SOURCEPRODUCTION' && condiciones[0].field === 'LOCID') {
        return [{ SOURCEID: 'X', PRDID: 'OTRO', LOCID: 'FABRICA' }]
      }
      return []
    })

    const lineas = []
    const datos = await cargarRedDeSap({
      conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'INSUMO', onRegistro: (_c, t) => lineas.push(t),
    })

    expect(datos.plantas).toEqual([])
    expect(datos.plantasGlobales).toEqual(['FABRICA'])
    const globales = llamadasA('AS1SOURCEPRODUCTION').find((una) => una.condiciones[0].field === 'LOCID')
    expect(globales.condiciones[0].value).toBe('FABRICA')
    expect(lineas).toContain('[GET] PSH global por LOCID para detectar plantas (1 ubicaciones)')
    expect(lineas).toContain('✓ Plantas globales detectadas: 1')
  })

  it('con recetas propias no pregunta', async () => {
    responder({ AS1SOURCEPRODUCTION: [{ SOURCEID: 'S1', PRDID: 'TERM', LOCID: 'P1' }] })
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'TERM' })
    expect(llamadasA('AS1SOURCEPRODUCTION').every((una) => una.condiciones[0].field === 'PRDID')).toBe(true)
  })

  it('pregunta por no más de 80 destinos', async () => {
    const muchos = Array.from(
      { length: TOPE_DE_DESTINOS + 20 },
      (_, i) => ({ LOCFR: 'PROV', LOCID: `L${i}`, PRDID: 'INSUMO' }),
    )
    responder({ AS1SOURCELOCATION: muchos })
    await cargarRedDeSap({ conexionId: 'c1', destino: DESTINO, plan: PLAN, prdid: 'INSUMO' })

    const globales = llamadasA('AS1SOURCEPRODUCTION').find((una) => una.condiciones[0].field === 'LOCID')
    expect(globales.condiciones[0].value.split(',')).toHaveLength(TOPE_DE_DESTINOS)
  })
})

describe('productosDeSap', () => {
  it('lee el maestro de productos del área y lo ordena por código', async () => {
    responder({ AS1PRODUCT: [{ PRDID: 'B', PRDDESCR: 'Segundo' }, { PRDID: 'A', PRDDESCR: 'Primero' }, { PRDID: '' }] })
    const lineas = []
    const productos = await productosDeSap({
      conexionId: 'c1', destino: DESTINO, plan: PLAN, onRegistro: (clase, texto) => lineas.push({ clase, texto }),
    })

    expect(productos).toEqual([
      { prdid: 'A', descripcion: 'Primero' }, { prdid: 'B', descripcion: 'Segundo' },
    ])
    expect(lineas[0].texto)
      .toBe("[GET] AS1PRODUCT | $filter=PlanningAreaID eq 'ASIBPTS' | $select=PRDID,PRDDESCR")
    expect(lineas[1]).toEqual({ clase: 'ok', texto: '✓ 2 productos cargados' })
  })

  it('sin la entidad de Product, falla con un mensaje que se entiende', async () => {
    const sinProducto = { pasos: PLAN.pasos.filter((uno) => uno.tabla !== 'bom_prd') }
    await expect(productosDeSap({ conexionId: 'c1', destino: DESTINO, plan: sinProducto }))
      .rejects.toThrow(/Product/)
  })
})

describe('el texto de las peticiones', () => {
  it('filtroLegible pone el área, la versión y las condiciones con «or» entre los valores', () => {
    expect(filtroLegible(
      { planningArea: 'PA', versionId: 'V' },
      [{ field: 'LOCID', op: 'eq', value: 'A,B' }],
    )).toBe("PlanningAreaID eq 'PA' and VersionID eq 'V' and (LOCID eq 'A' or LOCID eq 'B')")
  })

  it('sin versión no la nombra, y sin área no pone nada', () => {
    expect(filtroLegible({ planningArea: 'PA' }, [])).toBe("PlanningAreaID eq 'PA'")
    expect(filtroLegible({}, [])).toBe('')
  })

  it('lineaGet no deja un «$filter» vacío', () => {
    expect(lineaGet({ entidad: 'E', select: ['A', 'B'] }, {}, [])).toBe('[GET] E | $select=A,B')
  })
})

describe('planDeLaRed', () => {
  const entidad = (nombre) => ({ entidad: nombre })
  const paso = (plan, tabla) => plan.pasos.find((uno) => uno.tabla === tabla)

  it('lee el producto y las ubicaciones de lo que se eligió en la RED, no del árbol', () => {
    const plan = planDeLaRed({
      arbol: { product: entidad('DEL_ARBOL'), locMaster: entidad('LOC_DEL_ARBOL') },
      red: { product: entidad('DE_LA_RED'), locMaster: entidad('LOC_DE_LA_RED') },
    })
    expect(paso(plan, 'bom_prd').entidad).toBe('DE_LA_RED')
    expect(paso(plan, 'bom_loc').entidad).toBe('LOC_DE_LA_RED')
  })

  it('si la red no tiene la suya, cae al árbol', () => {
    const plan = planDeLaRed({ arbol: { product: entidad('DEL_ARBOL') }, red: {} })
    expect(paso(plan, 'bom_prd').entidad).toBe('DEL_ARBOL')
  })

  // «(ninguna)» sobre el producto es una decisión: el plan no puede leerlo.
  it('«(ninguna)» en la red no se rellena con el árbol', () => {
    const plan = planDeLaRed({
      arbol: { product: entidad('DEL_ARBOL') },
      red: { product: { entidad: null } },
    })
    expect(paso(plan, 'bom_prd').sePuede).toBe(false)
  })

  it('pide los dos grupos', () => {
    const plan = planDeLaRed({ arbol: {}, red: { location: entidad('ARCOS') } })
    expect(paso(plan, 'sn_loc').entidad).toBe('ARCOS')
  })
})
