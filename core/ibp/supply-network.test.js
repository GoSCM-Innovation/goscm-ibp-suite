import { describe, it, expect } from 'vitest'

import {
  ARCOS,
  CLASES,
  FINALES,
  TODAS_VISIBLES,
  UMBRAL_DE_CLIENTES,
  armarRed,
  claseDeUbicacion,
  clientesParaFiltro,
  clientesQueSobran,
  coincideConComodin,
  colocarNodos,
  insumosDeProveedor,
  plantasDetectadas,
  plantasHuerfanas,
  resumirRed,
  resumirRutas,
  rutasDeLaRed,
  texto,
  ubicacionesParaFiltro,
} from './supply-network.js'

/**
 * Una red de juguete con lo que muerde:
 *
 *   PROV1 (LOCTYPE V) ──trae MAT──▶ PLANTA1 ──transporte──▶ ALMACEN ──entrega──▶ CLI1
 *   Y un PROV2 que trae AJENO, que no está en la receta de PLANTA1.
 *
 * Los arcos de proveedor llegan por la vía de los COMPONENTES; los del producto van en `arcos`.
 */
const DATOS = {
  plantas: [{ SOURCEID: 'S1', PRDID: 'EL_PRODUCTO', LOCID: 'PLANTA1', PLEADTIME: '2' }],
  componentes: [{ SOURCEID: 'S1', PRDID: 'MAT' }],
  arcos: [{ LOCFR: 'PLANTA1', LOCID: 'ALMACEN', TLEADTIME: '1' }],
  arcosDeComponentes: [
    { LOCFR: 'PROV1', LOCID: 'PLANTA1', PRDID: 'MAT', TLEADTIME: '5' },
    { LOCFR: 'PROV2', LOCID: 'PLANTA1', PRDID: 'AJENO', TLEADTIME: '9' },
  ],
  clientes: [{ LOCID: 'ALMACEN', CUSTID: 'CLI1', CLEADTIME: '3' }],
  ubicaciones: {
    PROV1: { LOCID: 'PROV1', LOCDESCR: 'Proveedor del norte', LOCTYPE: 'V' },
    PROV2: { LOCID: 'PROV2', LOCDESCR: 'Otro proveedor', LOCTYPE: 'V' },
    PLANTA1: { LOCID: 'PLANTA1', LOCDESCR: 'Planta de Quito', LOCTYPE: '' },
    ALMACEN: { LOCID: 'ALMACEN', LOCDESCR: 'Centro de distribución' },
  },
  maestroDeClientes: { CLI1: { CUSTID: 'CLI1', CUSTDESCR: 'Cadena de supermercados' } },
}

const red = armarRed('EL_PRODUCTO', DATOS)
const nodo = (id, de = red) => de.nodos.find((uno) => uno.id === id)
const arco = (desde, hasta, de = red) => de.arcos.find((uno) => uno.desde === desde && uno.hasta === hasta)

describe('claseDeUbicacion', () => {
  const contexto = { ubicaciones: DATOS.ubicaciones, plantas: new Set(['PLANTA1']) }

  // Regla 1: la clase sale del maestro, no del nombre ni de dónde aparezca.
  it('LOCTYPE V es proveedor', () => {
    expect(claseDeUbicacion('PROV1', contexto)).toBe(CLASES.proveedor)
  })

  it('una ubicación que fabrica el producto es planta', () => {
    expect(claseDeUbicacion('PLANTA1', contexto)).toBe(CLASES.planta)
  })

  it('lo demás es ubicación', () => {
    expect(claseDeUbicacion('ALMACEN', contexto)).toBe(CLASES.ubicacion)
  })

  // Ser proveedor manda: es de dónde entra el material, y es lo que hay que ver.
  it('un proveedor que además fabricara seguiría siendo proveedor', () => {
    expect(claseDeUbicacion('PROV1', { ...contexto, plantas: new Set(['PROV1']) }))
      .toBe(CLASES.proveedor)
  })

  it('una ubicación que no está en el maestro es ubicación, no un fallo', () => {
    expect(claseDeUbicacion('DESCONOCIDA', contexto)).toBe(CLASES.ubicacion)
  })

  it('sin identificador no hay clase', () => {
    expect(claseDeUbicacion('', contexto)).toBe(null)
    expect(claseDeUbicacion(null, contexto)).toBe(null)
  })

  it('sin contexto no revienta', () => {
    expect(claseDeUbicacion('X')).toBe(CLASES.ubicacion)
  })
})

describe('plantasDetectadas', () => {
  it('con recetas propias, son las plantas de esas recetas', () => {
    expect([...plantasDetectadas(DATOS)]).toEqual(['PLANTA1'])
  })

  // Un insumo no tiene recetas: v7 pregunta a SAP qué plantas hay en sus destinos.
  it('sin recetas propias, usa las plantas detectadas en SAP', () => {
    expect([...plantasDetectadas({ plantas: [], plantasGlobales: ['P9'] })]).toEqual(['P9'])
  })

  it('con recetas propias ignora las globales', () => {
    expect([...plantasDetectadas({ ...DATOS, plantasGlobales: ['P9'] })]).toEqual(['PLANTA1'])
  })

  it('sin nada devuelve un conjunto vacío', () => {
    expect(plantasDetectadas().size).toBe(0)
  })
})

describe('armarRed', () => {
  // v7 no dibuja el producto como un nodo ni la planta apunta a él: «N nodos · M conexiones» tiene que
  // decir lo mismo que allí.
  it('no hay nodo del producto ni arco de fabricación', () => {
    expect(nodo('EL_PRODUCTO')).toBeUndefined()
    expect(red.arcos.every((uno) => uno.hasta !== 'EL_PRODUCTO')).toBe(true)
  })

  it('la planta llega con su nombre y el plazo de producción en su globo', () => {
    expect(nodo('PLANTA1')).toMatchObject({
      clase: CLASES.planta,
      nombre: 'Planta de Quito',
      etiqueta: 'PLANTA1\nPlanta de Quito',
      titulo: 'Planta: PLANTA1\nPlanta de Quito\nLead time producción: 2',
    })
  })

  it('un arco entre ubicaciones es transporte, con el texto de v7', () => {
    expect(arco('PLANTA1', 'ALMACEN')).toMatchObject({
      clase: ARCOS.transporte, detalle: 'Lead time transporte: 1', titulo: 'Lead time transporte: 1',
    })
  })

  it('un arco sin plazo se rotula con sus dos extremos', () => {
    const sinPlazo = armarRed('P', { arcos: [{ LOCFR: 'A', LOCID: 'B' }] })
    expect(arco('A', 'B', sinPlazo)).toMatchObject({ detalle: '', titulo: 'A → B' })
  })

  it('el cliente llega con su nombre y su plazo de entrega', () => {
    expect(nodo('CLI1')).toMatchObject({
      clase: CLASES.cliente,
      nombre: 'Cadena de supermercados',
      titulo: 'Cliente: CLI1\nCadena de supermercados',
    })
    expect(arco('ALMACEN', 'CLI1')).toMatchObject({ clase: ARCOS.entrega, detalle: 'Lead time cliente: 3' })
  })

  // Regla 2, la que separa una red que se entiende de un plato de espaguetis.
  it('un proveedor que trae un componente de esa planta SÍ se dibuja', () => {
    expect(nodo('PROV1')).toMatchObject({
      clase: CLASES.proveedor, nombre: 'Proveedor del norte', titulo: 'Proveedor: PROV1\nProveedor del norte',
    })
    expect(arco('PROV1', 'PLANTA1')).toMatchObject({
      clase: ARCOS.suministro, detalle: 'Componentes: MAT [LT:5]',
    })
  })

  it('un proveedor que trae algo que NO está en la receta de esa planta se descarta', () => {
    expect(arco('PROV2', 'PLANTA1')).toBeUndefined()
    expect(nodo('PROV2')).toBeUndefined()
  })

  it('un arco de material que no va a una planta se descarta', () => {
    const suelto = armarRed('EL_PRODUCTO', {
      ...DATOS,
      arcosDeComponentes: [{ LOCFR: 'PROV1', LOCID: 'ALMACEN', PRDID: 'MAT' }],
    })
    expect(suelto.arcos.find((uno) => uno.desde === 'PROV1')).toBeUndefined()
  })

  // Vía 1: alguien vende el producto YA HECHO. Aquí no hay receta que comprobar.
  it('un proveedor del producto terminado se dibuja sin condición, con el texto de v7', () => {
    const comprado = armarRed('EL_PRODUCTO', {
      ...DATOS,
      arcos: [{ LOCFR: 'PROV2', LOCID: 'ALMACEN', PRDID: 'EL_PRODUCTO', TLEADTIME: '4' }],
      arcosDeComponentes: [],
    })
    expect(arco('PROV2', 'ALMACEN', comprado)).toMatchObject({
      clase: ARCOS.suministro, detalle: 'Insumo: EL_PRODUCTO [LT:4]',
    })
  })

  // Regla 3: un proveedor que trae once materiales son once flechas encima de la misma.
  it('los componentes de un mismo proveedor se juntan en UN arco', () => {
    const varios = armarRed('EL_PRODUCTO', {
      ...DATOS,
      componentes: [{ SOURCEID: 'S1', PRDID: 'MAT' }, { SOURCEID: 'S1', PRDID: 'OTRO' }],
      arcosDeComponentes: [
        { LOCFR: 'PROV1', LOCID: 'PLANTA1', PRDID: 'MAT', TLEADTIME: '5' },
        { LOCFR: 'PROV1', LOCID: 'PLANTA1', PRDID: 'OTRO', TLEADTIME: '7' },
      ],
    })

    const suyos = varios.arcos.filter((uno) => uno.desde === 'PROV1')
    expect(suyos).toHaveLength(1)
    expect(suyos[0].detalle).toBe('Componentes: MAT [LT:5], OTRO [LT:7]')
  })

  // Si la receta no trae componentes no se puede filtrar: se dibuja y no se esconde media red.
  it('sin componentes conocidos, el arco de material se dibuja igual', () => {
    const sinComponentes = armarRed('EL_PRODUCTO', { ...DATOS, componentes: [] })
    expect(arco('PROV1', 'PLANTA1', sinComponentes)).toBeDefined()
    expect(arco('PROV2', 'PLANTA1', sinComponentes)).toBeDefined()
  })

  it('un arco repetido no se dibuja dos veces', () => {
    const repetido = armarRed('EL_PRODUCTO', {
      ...DATOS,
      arcos: [
        { LOCFR: 'PLANTA1', LOCID: 'ALMACEN', TLEADTIME: '1' },
        { LOCFR: 'PLANTA1', LOCID: 'ALMACEN', TLEADTIME: '1' },
      ],
    })
    expect(repetido.arcos.filter((uno) => uno.id === 'PLANTA1->ALMACEN')).toHaveLength(1)
  })

  it('lo que no está en el maestro se rotula con su propio código', () => {
    const pelada = armarRed('P', { plantas: [{ LOCID: 'L1' }], ubicaciones: {} })
    expect(nodo('L1', pelada)).toMatchObject({ etiqueta: 'L1', nombre: '' })
  })

  it('una fila sin identificadores no ensucia la red', () => {
    const sucia = armarRed('P', {
      plantas: [{ LOCID: '' }],
      arcos: [{ LOCFR: '', LOCID: 'X' }, { LOCFR: 'Y', LOCID: '' }],
      clientes: [{ LOCID: 'Z', CUSTID: '' }],
    })
    expect(sucia.nodos).toEqual([])
  })

  it('sin datos devuelve una red vacía', () => {
    expect(armarRed('P').nodos).toEqual([])
    expect(armarRed('P').arcos).toEqual([])
  })

  // Un insumo no tiene recetas; la planta a la que llega se pinta como planta gracias a las globales.
  it('en un insumo, una ubicación que SAP dice que es planta se pinta como planta', () => {
    const insumo = armarRed('INSUMO', {
      arcos: [{ LOCFR: 'PROV1', LOCID: 'FABRICA', PRDID: 'INSUMO' }, { LOCFR: 'FABRICA', LOCID: 'CD' }],
      ubicaciones: DATOS.ubicaciones,
      plantasGlobales: ['FABRICA'],
    })
    expect(nodo('FABRICA', insumo).clase).toBe(CLASES.planta)
    expect(nodo('CD', insumo).clase).toBe(CLASES.ubicacion)
  })
})

describe('armarRed — lo que se apaga', () => {
  // v7 marca los nodos `hidden` en el conjunto de datos y no recalcula: la red sigue teniéndolos.
  it('una clase apagada marca sus nodos como ocultos sin quitarlos', () => {
    const sinClientes = armarRed('EL_PRODUCTO', DATOS, {
      visibles: { ...TODAS_VISIBLES, [CLASES.cliente]: false },
    })
    expect(nodo('CLI1', sinClientes).oculto).toBe(true)
    expect(nodo('PLANTA1', sinClientes).oculto).toBe(false)
    expect(sinClientes.resumen.nodos).toBe(red.resumen.nodos)
  })

  // …con una excepción de v7: apagado el proveedor, sus arcos no se crean (ni sus nodos).
  it('con los proveedores apagados no se crean sus arcos ni sus nodos', () => {
    const sinProveedores = armarRed('EL_PRODUCTO', DATOS, {
      visibles: { ...TODAS_VISIBLES, [CLASES.proveedor]: false },
    })
    expect(nodo('PROV1', sinProveedores)).toBeUndefined()
    expect(sinProveedores.arcos.some((uno) => uno.clase === ARCOS.suministro)).toBe(false)
  })

  it('una ubicación apagada en los filtros quita sus arcos de traslado y de cliente', () => {
    const sinAlmacen = armarRed('EL_PRODUCTO', DATOS, { ubicacionesOcultas: new Set(['ALMACEN']) })
    expect(nodo('ALMACEN', sinAlmacen)).toBeUndefined()
    expect(nodo('CLI1', sinAlmacen)).toBeUndefined()
  })

  it('un cliente apagado desaparece y su ubicación sigue en la red por sus otros arcos', () => {
    const sinCliente = armarRed('EL_PRODUCTO', DATOS, { clientesOcultos: new Set(['CLI1']) })
    expect(nodo('CLI1', sinCliente)).toBeUndefined()
    expect(nodo('ALMACEN', sinCliente)).toBeDefined()
  })

  // v7 pone las plantas aunque estén apagadas en los filtros; lo que quita son sus arcos.
  it('una planta apagada en los filtros sigue como nodo, sin sus arcos', () => {
    const sinPlanta = armarRed('EL_PRODUCTO', DATOS, { ubicacionesOcultas: new Set(['PLANTA1']) })
    expect(nodo('PLANTA1', sinPlanta)).toBeDefined()
    expect(arco('PLANTA1', 'ALMACEN', sinPlanta)).toBeUndefined()
  })
})

describe('resumirRed', () => {
  it('cuenta por clase de nodo y por tipo de arco', () => {
    expect(red.resumen).toMatchObject({
      nodos: 4,
      arcos: 3,
      porClase: { PLANTA: 1, UBICACION: 1, PROVEEDOR: 1, CLIENTE: 1 },
      porArco: { TRANSPORTE: 1, SUMINISTRO: 1, ENTREGA: 1 },
    })
  })

  it('una red vacía cuenta cero', () => {
    expect(resumirRed([], [])).toEqual({ nodos: 0, arcos: 0, porClase: {}, porArco: {} })
    expect(resumirRed()).toMatchObject({ nodos: 0, arcos: 0 })
  })
})

describe('texto', () => {
  it('limpia los espacios con los que llegan los identificadores de SAP', () => {
    expect(texto('  X  ')).toBe('X')
    expect(texto(undefined)).toBe('')
  })
})

describe('insumosDeProveedor', () => {
  // Es el «Insumos abastecidos (N):» del detalle de un proveedor.
  it('lista los materiales que trae, sin repetir y en orden', () => {
    const datos = {
      arcosDeComponentes: [
        { LOCFR: 'P', PRDID: 'B' }, { LOCFR: 'P', PRDID: 'A' }, { LOCFR: 'P', PRDID: 'B' },
        { LOCFR: 'OTRO', PRDID: 'Z' },
      ],
      arcos: [{ LOCFR: 'P', PRDID: 'C' }],
    }
    expect(insumosDeProveedor('P', datos)).toEqual(['A', 'B', 'C'])
  })

  it('sin filas no hay insumos', () => {
    expect(insumosDeProveedor('P')).toEqual([])
  })
})

describe('filtros de red', () => {
  const datos = {
    arcos: [{ LOCFR: 'T2', LOCID: 'T1' }, { LOCFR: 'T1', LOCID: 'US1' }],
    clientes: [
      { LOCID: 'US1', CUSTID: 'C2' }, { LOCID: 'T1', CUSTID: 'C1' }, { LOCID: 'T1', CUSTID: 'C1' },
    ],
    ubicaciones: { T1: { LOCDESCR: 'Primera' } },
    maestroDeClientes: { C1: { CUSTDESCR: 'Cliente uno' } },
  }

  it('las ubicaciones salen de los arcos y de los clientes, ordenadas y sin repetir', () => {
    expect(ubicacionesParaFiltro(datos)).toEqual([
      { id: 'T1', descr: 'Primera' }, { id: 'T2', descr: '' }, { id: 'US1', descr: '' },
    ])
  })

  it('los clientes salen de sus arcos, ordenados y sin repetir', () => {
    expect(clientesParaFiltro(datos)).toEqual([
      { id: 'C1', descr: 'Cliente uno' }, { id: 'C2', descr: '' },
    ])
  })

  it('el umbral de clientes es 20', () => {
    expect(UMBRAL_DE_CLIENTES).toBe(20)
  })

  it('hasta 20 clientes no se oculta ninguno', () => {
    const veinte = { clientes: Array.from({ length: 20 }, (_, i) => ({ LOCID: 'L', CUSTID: `C${String(i).padStart(2, '0')}` })) }
    expect(clientesQueSobran(veinte)).toEqual([])
  })

  it('por encima de 20 se ocultan los que pasan, por orden de código', () => {
    const veintitres = { clientes: Array.from({ length: 23 }, (_, i) => ({ LOCID: 'L', CUSTID: `C${String(i).padStart(2, '0')}` })) }
    expect(clientesQueSobran(veintitres)).toEqual(['C20', 'C21', 'C22'])
  })
})

describe('coincideConComodin', () => {
  it('sin patrón todo coincide', () => {
    expect(coincideConComodin('LO QUE SEA', '')).toBe(true)
    expect(coincideConComodin('X', '   ')).toBe(true)
  })

  it('sin asterisco busca el trozo en cualquier parte, sin distinguir mayúsculas', () => {
    expect(coincideConComodin('PLANTA_T1_US', 't1')).toBe(true)
    expect(coincideConComodin('PLANTA_T2', 't1')).toBe(false)
  })

  // Con asterisco el patrón es el texto ENTERO.
  it('*T1 termina en T1, T1* empieza por T1 y *US* lo contiene', () => {
    expect(coincideConComodin('ABC_T1', '*T1')).toBe(true)
    expect(coincideConComodin('T1_ABC', '*T1')).toBe(false)
    expect(coincideConComodin('T1_ABC', 'T1*')).toBe(true)
    expect(coincideConComodin('ABC_T1', 'T1*')).toBe(false)
    expect(coincideConComodin('A_US_B', '*US*')).toBe(true)
  })

  it('los signos de expresión regular se toman literales', () => {
    expect(coincideConComodin('A.B', 'A.B*')).toBe(true)
    expect(coincideConComodin('AXB', 'A.B*')).toBe(false)
  })
})

describe('colocarNodos', () => {
  const nodoDe = (id, clase) => ({ id, clase, nombre: id })

  it('pone cada clase en su columna, de origen a destino', () => {
    const nodos = [
      nodoDe('PROV', CLASES.proveedor),
      nodoDe('PLANTA', CLASES.planta),
      nodoDe('CD', CLASES.ubicacion),
      nodoDe('CLI', CLASES.cliente),
    ]
    const x = Object.fromEntries(colocarNodos(nodos).map((uno) => [uno.id, uno.x]))

    expect(x.PROV).toBeLessThan(x.PLANTA)
    expect(x.PLANTA).toBeLessThan(x.CD)
    expect(x.CD).toBeLessThan(x.CLI)
  })

  // Sin nodo de producto, los clientes quedan una columna después de las ubicaciones — no dos.
  it('los clientes van justo a la derecha de las ubicaciones', () => {
    const puestos = colocarNodos([nodoDe('CD', CLASES.ubicacion), nodoDe('CLI', CLASES.cliente)])
    const x = Object.fromEntries(puestos.map((uno) => [uno.id, uno.x]))
    expect(x.CD).toBe(260)
    expect(x.CLI).toBe(520)
  })

  it('ancla las plantas en x = 0 y las ordena alfabéticamente', () => {
    const puestos = colocarNodos([nodoDe('P2', CLASES.planta), nodoDe('P1', CLASES.planta)])
    expect(puestos.every((uno) => uno.x === 0)).toBe(true)
    expect(puestos.slice().sort((a, b) => a.y - b.y).map((uno) => uno.id)).toEqual(['P1', 'P2'])
  })

  it('ordena los proveedores por la altura de las plantas a las que llegan', () => {
    // Sin esto, dos proveedores alfabéticamente juntos que abastecen plantas opuestas cruzan sus
    // flechas por todo el lienzo. Se lee de las filas de SAP, como en v7.
    const nodos = [
      nodoDe('P1', CLASES.planta), nodoDe('P2', CLASES.planta), nodoDe('P3', CLASES.planta),
      nodoDe('AAA', CLASES.proveedor), nodoDe('ZZZ', CLASES.proveedor),
    ]
    const datos = {
      arcosDeComponentes: [{ LOCFR: 'AAA', LOCID: 'P3' }, { LOCFR: 'ZZZ', LOCID: 'P1' }],
    }
    const y = Object.fromEntries(colocarNodos(nodos, datos).map((uno) => [uno.id, uno.y]))
    expect(y.ZZZ).toBeLessThan(y.AAA)
  })

  it('ordena las ubicaciones por la altura de las plantas de las que les llega material', () => {
    const nodos = [
      nodoDe('P1', CLASES.planta), nodoDe('P2', CLASES.planta),
      nodoDe('A', CLASES.ubicacion), nodoDe('Z', CLASES.ubicacion),
    ]
    const datos = { arcos: [{ LOCFR: 'P2', LOCID: 'A' }, { LOCFR: 'P1', LOCID: 'Z' }] }
    const y = Object.fromEntries(colocarNodos(nodos, datos).map((uno) => [uno.id, uno.y]))
    expect(y.Z).toBeLessThan(y.A)
  })

  it('ordena los clientes por la altura de las ubicaciones que los sirven', () => {
    const nodos = [
      nodoDe('U1', CLASES.ubicacion), nodoDe('U2', CLASES.ubicacion),
      nodoDe('CA', CLASES.cliente), nodoDe('CZ', CLASES.cliente),
    ]
    const datos = { clientes: [{ LOCID: 'U2', CUSTID: 'CA' }, { LOCID: 'U1', CUSTID: 'CZ' }] }
    const y = Object.fromEntries(colocarNodos(nodos, datos).map((uno) => [uno.id, uno.y]))
    expect(y.CZ).toBeLessThan(y.CA)
  })

  it('parte una columna larga en varias en vez de estirarla sin fin', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => nodoDe(`U${i}`, CLASES.ubicacion))
    expect(new Set(colocarNodos(muchas).map((uno) => uno.x)).size).toBe(3)
  })

  it('no toca los nodos que recibe', () => {
    const original = nodoDe('P1', CLASES.planta)
    colocarNodos([original])
    expect(original.x).toBeUndefined()
  })

  it('con una red vacía devuelve una lista vacía', () => {
    expect(colocarNodos([])).toEqual([])
    expect(colocarNodos(undefined)).toEqual([])
  })

  it('armarRed entrega los nodos ya colocados', () => {
    expect(red.nodos.every((uno) => Number.isFinite(uno.x) && Number.isFinite(uno.y))).toBe(true)
  })
})

describe('rutasDeLaRed', () => {
  // Las rutas salen de las FILAS de SAP, como en v7: plantas, arcos entre ubicaciones y clientes.
  const planta = (loc) => ({ SOURCEID: `S-${loc}`, LOCID: loc })
  const traslado = (desde, hasta) => ({ LOCFR: desde, LOCID: hasta })
  const entrega = (desde, cliente) => ({ LOCID: desde, CUSTID: cliente })

  it('una ruta que llega a cliente se marca como buena', () => {
    const { rutas } = rutasDeLaRed({
      plantas: [planta('P1')], arcos: [traslado('P1', 'CD')], clientes: [entrega('CD', 'C1')],
    })
    expect(rutas).toHaveLength(1)
    expect(rutas[0]).toMatchObject({
      planta: 'P1', cliente: 'C1', llegaACliente: true, nodos: ['P1', 'CD'], ultimo: 'CD',
    })
  })

  it('una ruta que muere en un nodo sin salidas se marca «sin salida» (Dead-end)', () => {
    // El material llega ahí y se queda. En el dibujo no se distingue de una buena.
    const { rutas } = rutasDeLaRed({ plantas: [planta('P1')], arcos: [traslado('P1', 'CD')] })
    expect(rutas).toHaveLength(1)
    expect(rutas[0]).toMatchObject({ llegaACliente: false, final: FINALES.sinSalida, ultimo: 'CD' })
  })

  it('una ruta cuyas salidas ya se visitaron se marca como ciclo, no como sin salida', () => {
    // Son cosas distintas: «no manda a nadie» es un dato que falta; «se muerde la cola» es un error.
    const { rutas } = rutasDeLaRed({
      plantas: [planta('P1')], arcos: [traslado('P1', 'A'), traslado('A', 'B'), traslado('B', 'A')],
    })
    expect(rutas).toHaveLength(1)
    expect(rutas[0]).toMatchObject({ final: FINALES.ciclo, ultimo: 'B' })
  })

  it('una planta con varias salidas da una ruta por cada una', () => {
    const { rutas } = rutasDeLaRed({
      plantas: [planta('P1')],
      arcos: [traslado('P1', 'CD1'), traslado('P1', 'CD2')],
      clientes: [entrega('CD1', 'C1')],
    })
    expect(rutas).toHaveLength(2)
    expect(rutas.filter((una) => una.llegaACliente)).toHaveLength(1)
  })

  it('la planta que entrega directo cuenta como ruta con cliente', () => {
    const { rutas } = rutasDeLaRed({ plantas: [planta('P1')], clientes: [entrega('P1', 'C1')] })
    expect(rutas[0]).toMatchObject({ planta: 'P1', cliente: 'C1', llegaACliente: true })
  })

  it('una planta repetida en varias recetas se recorre una sola vez', () => {
    const { rutas } = rutasDeLaRed({ plantas: [planta('P1'), { SOURCEID: 'OTRA', LOCID: 'P1' }] })
    expect(rutas).toHaveLength(1)
  })

  it('avisa cuando corta por el tope, en vez de entregar una lista recortada como completa', () => {
    const { rutas, truncado } = rutasDeLaRed({
      plantas: [planta('P1')],
      arcos: [traslado('P1', 'A')],
      clientes: [entrega('A', 'C1'), entrega('A', 'C2'), entrega('A', 'C3')],
    }, { tope: 2 })
    expect(rutas).toHaveLength(2)
    expect(truncado).toBe(true)
  })

  it('sin plantas no hay rutas', () => {
    expect(rutasDeLaRed({ arcos: [traslado('A', 'B')] }).rutas).toEqual([])
    expect(rutasDeLaRed(undefined).rutas).toEqual([])
  })
})

describe('plantasHuerfanas', () => {
  it('es huérfana la planta cuyo CIEN POR CIEN de rutas muere', () => {
    const rutas = [
      { planta: 'P1', llegaACliente: false },
      { planta: 'P1', llegaACliente: false },
      { planta: 'P2', llegaACliente: true },
    ]
    expect(plantasHuerfanas(rutas)).toEqual(['P1'])
  })

  it('una planta con nueve rutas muertas y UNA buena no es huérfana', () => {
    // Lo que fabrica sale. Marcarla escondería a las que de verdad no llegan a nadie.
    const rutas = [
      ...Array.from({ length: 9 }, () => ({ planta: 'P1', llegaACliente: false })),
      { planta: 'P1', llegaACliente: true },
    ]
    expect(plantasHuerfanas(rutas)).toEqual([])
  })

  it('salen en el orden en que aparecen, como en v7', () => {
    const rutas = [{ planta: 'Z', llegaACliente: false }, { planta: 'A', llegaACliente: false }]
    expect(plantasHuerfanas(rutas)).toEqual(['Z', 'A'])
  })

  it('sin rutas no hay huérfanas', () => {
    expect(plantasHuerfanas([])).toEqual([])
    expect(plantasHuerfanas(undefined)).toEqual([])
  })
})

describe('resumirRutas', () => {
  it('separa las que llegan de las que no, y estas por cómo mueren', () => {
    const rutas = [
      { llegaACliente: true },
      { llegaACliente: false, final: FINALES.sinSalida },
      { llegaACliente: false, final: FINALES.ciclo },
      { llegaACliente: false, final: FINALES.ciclo },
    ]
    expect(resumirRutas(rutas)).toEqual({
      total: 4, conCliente: 1, sinCliente: 3, sinSalida: 1, ciclos: 2,
    })
  })

  it('con nada devuelve ceros, no indefinidos', () => {
    expect(resumirRutas(undefined)).toEqual({
      total: 0, conCliente: 0, sinCliente: 0, sinSalida: 0, ciclos: 0,
    })
  })
})
