import { describe, it, expect } from 'vitest'

import {
  ARCOS,
  CLASES,
  COLUMNAS,
  armarRed,
  claseDeUbicacion,
  nodosSueltos,
  repartirEnColumnas,
  resumirRed,
  FINALES,
  plantasHuerfanas,
  plazoLegible,
  posicionesEnLienzo,
  resumirRutas,
  rutasDeLaRed,
  texto,
  vecinosDe,
} from './supply-network.js'

/**
 * Una red de juguete con lo que muerde:
 *
 *   PROV1 (LOCTYPE V) ──trae MAT──▶ PLANTA1 ──fabrica──▶ EL_PRODUCTO
 *   PLANTA1 ──transporte──▶ ALMACEN ──entrega──▶ CLI1
 *   Y un PROV2 que trae AJENO, que no está en la receta de PLANTA1.
 *
 * Los arcos de proveedor llegan por la vía de los COMPONENTES; los del producto van en `arcos`.
 */
const DATOS = {
  producto: { PRDID: 'EL_PRODUCTO', PRDDESCR: 'Lo que se vende' },
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
  plazoDePlanta: { PLANTA1: '2' },
}

const red = armarRed('EL_PRODUCTO', DATOS)
const nodo = (id) => red.nodos.find((uno) => uno.id === id)
const arco = (desde, hasta) => red.arcos.find((uno) => uno.desde === desde && uno.hasta === hasta)

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

describe('armarRed', () => {
  it('el producto va en el centro, con su descripción', () => {
    expect(nodo('EL_PRODUCTO')).toMatchObject({
      clase: CLASES.producto, nombre: 'Lo que se vende',
    })
  })

  it('la planta llega con su nombre y su plazo', () => {
    expect(nodo('PLANTA1')).toMatchObject({
      clase: CLASES.planta, nombre: 'Planta de Quito', plazo: '2',
    })
  })

  it('la planta apunta al producto: ahí se fabrica', () => {
    expect(arco('PLANTA1', 'EL_PRODUCTO')).toMatchObject({
      clase: ARCOS.fabricacion, detalle: 'Fabricación: 2',
    })
  })

  it('un arco entre ubicaciones es transporte, con su plazo', () => {
    expect(arco('PLANTA1', 'ALMACEN')).toMatchObject({
      clase: ARCOS.transporte, detalle: 'Transporte: 1',
    })
  })

  it('el cliente llega con su nombre y su plazo de entrega', () => {
    expect(nodo('CLI1')).toMatchObject({ clase: CLASES.cliente, nombre: 'Cadena de supermercados' })
    expect(arco('ALMACEN', 'CLI1')).toMatchObject({ clase: ARCOS.entrega, detalle: 'Entrega: 3' })
  })

  // Regla 2, la que separa una red que se entiende de un plato de espaguetis.
  it('un proveedor que trae un componente de esa planta SÍ se dibuja', () => {
    expect(nodo('PROV1')).toMatchObject({ clase: CLASES.proveedor, nombre: 'Proveedor del norte' })
    expect(arco('PROV1', 'PLANTA1')).toMatchObject({ clase: ARCOS.suministro })
  })

  it('un proveedor que trae algo que NO está en la receta de esa planta se descarta', () => {
    expect(arco('PROV2', 'PLANTA1')).toBeUndefined()
  })

  it('un arco de material que no va a una planta se descarta', () => {
    const suelto = armarRed('EL_PRODUCTO', {
      ...DATOS,
      arcosDeComponentes: [{ LOCFR: 'PROV1', LOCID: 'ALMACEN', PRDID: 'MAT' }],
    })
    expect(suelto.arcos.find((uno) => uno.desde === 'PROV1')).toBeUndefined()
  })

  // Vía 1: alguien vende el producto YA HECHO. Aquí no hay receta que comprobar.
  it('un proveedor del producto terminado se dibuja sin condición', () => {
    const comprado = armarRed('EL_PRODUCTO', {
      ...DATOS,
      arcos: [{ LOCFR: 'PROV2', LOCID: 'ALMACEN', PRDID: 'EL_PRODUCTO', TLEADTIME: '4' }],
      arcosDeComponentes: [],
    })
    expect(comprado.arcos.find((uno) => uno.id === 'PROV2->ALMACEN')).toMatchObject({
      clase: ARCOS.suministro, detalle: 'Trae: EL_PRODUCTO (4)',
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
    expect(suyos[0].detalle).toBe('Trae: MAT (5), OTRO (7)')
  })

  // Si la receta no trae componentes no se puede filtrar: se dibuja y no se esconde media red.
  it('sin componentes conocidos, el arco de material se dibuja igual', () => {
    const sinComponentes = armarRed('EL_PRODUCTO', { ...DATOS, componentes: [] })
    expect(sinComponentes.arcos.find((uno) => uno.desde === 'PROV1')).toBeDefined()
    expect(sinComponentes.arcos.find((uno) => uno.desde === 'PROV2')).toBeDefined()
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

  it('lo que no está en el maestro se nombra con su propio código', () => {
    const pelada = armarRed('P', { plantas: [{ LOCID: 'L1' }], ubicaciones: {} })
    expect(pelada.nodos.find((uno) => uno.id === 'L1').nombre).toBe('L1')
  })

  it('una fila sin identificadores no ensucia la red', () => {
    const sucia = armarRed('P', {
      plantas: [{ LOCID: '' }],
      arcos: [{ LOCFR: '', LOCID: 'X' }, { LOCFR: 'Y', LOCID: '' }],
      clientes: [{ LOCID: 'Z', CUSTID: '' }],
    })
    expect(sucia.nodos.map((uno) => uno.id)).toEqual(['P'])
  })

  it('sin datos devuelve solo el producto', () => {
    expect(armarRed('P').nodos).toEqual([{ id: 'P', clase: CLASES.producto, nombre: 'P' }])
  })

  it('sin producto tampoco revienta', () => {
    expect(armarRed('', DATOS).nodos.find((uno) => uno.clase === CLASES.producto)).toBeUndefined()
  })
})

describe('resumirRed', () => {
  it('cuenta por clase de nodo y por tipo de arco', () => {
    expect(red.resumen).toMatchObject({
      nodos: 5,
      porClase: { PRODUCTO: 1, PLANTA: 1, UBICACION: 1, PROVEEDOR: 1, CLIENTE: 1 },
      porArco: { FABRICACION: 1, TRANSPORTE: 1, SUMINISTRO: 1, ENTREGA: 1 },
    })
  })

  it('una red vacía cuenta cero', () => {
    expect(resumirRed([], [])).toEqual({ nodos: 0, arcos: 0, porClase: {}, porArco: {} })
    expect(resumirRed()).toMatchObject({ nodos: 0, arcos: 0 })
  })

  // PROV2 no llega a la red: ni su nodo ni su arco.
  it('lo descartado no se cuenta', () => {
    expect(red.nodos.find((uno) => uno.id === 'PROV2')).toBeUndefined()
  })
})

describe('repartirEnColumnas', () => {
  // Una red de suministro se lee de origen a destino; puesta al azar, treinta nodos no dicen nada.
  it('va de proveedor a cliente, en ese orden', () => {
    expect(repartirEnColumnas(red.nodos).map((una) => una.clase))
      .toEqual([CLASES.proveedor, CLASES.planta, CLASES.ubicacion, CLASES.producto, CLASES.cliente])
  })

  it('las columnas vacías no salen', () => {
    const solo = repartirEnColumnas([{ id: 'A', clase: CLASES.cliente }])
    expect(solo).toHaveLength(1)
    expect(solo[0].clase).toBe(CLASES.cliente)
  })

  it('dentro de una columna van ordenados', () => {
    const columnas = repartirEnColumnas([
      { id: 'Z', clase: CLASES.planta }, { id: 'A', clase: CLASES.planta },
    ])
    expect(columnas[0].nodos.map((uno) => uno.id)).toEqual(['A', 'Z'])
  })

  it('las cinco columnas están declaradas', () => {
    expect(COLUMNAS).toHaveLength(5)
  })

  it('sin nodos no hay columnas', () => {
    expect(repartirEnColumnas()).toEqual([])
  })
})

describe('vecinosDe', () => {
  // La pregunta que se hace de verdad frente a una red grande.
  it('dice de dónde le llega y a dónde manda', () => {
    const { entran, salen } = vecinosDe('PLANTA1', red.arcos)
    expect(entran.map((uno) => uno.desde)).toEqual(['PROV1'])
    expect(salen.map((uno) => uno.hasta).sort()).toEqual(['ALMACEN', 'EL_PRODUCTO'])
  })

  it('un nodo sin vecinos devuelve dos listas vacías', () => {
    expect(vecinosDe('NADIE', red.arcos)).toEqual({ entran: [], salen: [] })
  })

  it('sin arcos no revienta', () => {
    expect(vecinosDe('X')).toEqual({ entran: [], salen: [] })
  })
})

describe('nodosSueltos', () => {
  // En v7 aparecían en una esquina y nadie los nombraba: es un dato incompleto, no un adorno.
  it('encuentra el nodo que no se conecta con nada', () => {
    const nodos = [...red.nodos, { id: 'HUERFANO', clase: CLASES.ubicacion, nombre: 'Sin arcos' }]
    expect(nodosSueltos(nodos, red.arcos).map((uno) => uno.id)).toEqual(['HUERFANO'])
  })

  it('en una red bien conectada no hay ninguno', () => {
    expect(nodosSueltos(red.nodos, red.arcos)).toEqual([])
  })

  it('sin arcos, todos están sueltos', () => {
    expect(nodosSueltos([{ id: 'A' }], [])).toHaveLength(1)
  })
})

describe('plazoLegible', () => {
  // SAP manda 10.000000 y 0.142857: así, un plazo de diez días parece un número de serie.
  it('recorta los seis decimales de SAP', () => {
    expect(plazoLegible('10.000000')).toBe('10')
    expect(plazoLegible('0.142857')).toBe('0,143')
  })

  it('lo que no es un número pasa como está', () => {
    expect(plazoLegible('X')).toBe('X')
  })

  it('sin valor no escribe nada', () => {
    expect(plazoLegible('')).toBe('')
    expect(plazoLegible(undefined)).toBe('')
  })
})

describe('texto', () => {
  it('limpia los espacios con los que llegan los identificadores de SAP', () => {
    expect(texto('  X  ')).toBe('X')
    expect(texto(undefined)).toBe('')
  })
})

describe('posicionesEnLienzo', () => {
  const nodo = (id, clase) => ({ id, clase, nombre: id })
  const arco = (desde, hasta) => ({ id: `${desde}->${hasta}`, desde, hasta, clase: ARCOS.transporte })

  it('pone cada clase en su columna, de origen a destino', () => {
    const nodos = [
      nodo('PROV', CLASES.proveedor),
      nodo('PLANTA', CLASES.planta),
      nodo('CD', CLASES.ubicacion),
      nodo('PRD', CLASES.producto),
      nodo('CLI', CLASES.cliente),
    ]
    const puestos = posicionesEnLienzo(nodos, [])
    const x = Object.fromEntries(puestos.map((uno) => [uno.id, uno.x]))

    expect(x.PROV).toBeLessThan(x.PLANTA)
    expect(x.PLANTA).toBeLessThan(x.CD)
    expect(x.CD).toBeLessThan(x.PRD)
    expect(x.PRD).toBeLessThan(x.CLI)
  })

  it('ancla las plantas en x = 0 y las ordena alfabéticamente', () => {
    const puestos = posicionesEnLienzo(
      [nodo('P2', CLASES.planta), nodo('P1', CLASES.planta)],
      [],
    )
    expect(puestos.filter((uno) => uno.clase === CLASES.planta).every((uno) => uno.x === 0)).toBe(true)
    const porAltura = puestos.slice().sort((a, b) => a.y - b.y).map((uno) => uno.id)
    expect(porAltura).toEqual(['P1', 'P2'])
  })

  it('ordena los proveedores por la altura de las plantas a las que llegan', () => {
    // Sin esto, dos proveedores alfabéticamente juntos que abastecen plantas opuestas cruzan sus
    // flechas por todo el lienzo. Es lo único que hace legible una red de treinta nodos.
    const nodos = [
      nodo('P1', CLASES.planta), nodo('P2', CLASES.planta), nodo('P3', CLASES.planta),
      nodo('AAA', CLASES.proveedor), nodo('ZZZ', CLASES.proveedor),
    ]
    // AAA abastece la planta de más abajo; ZZZ, la de más arriba.
    const arcos = [arco('AAA', 'P3'), arco('ZZZ', 'P1')]

    const puestos = posicionesEnLienzo(nodos, arcos)
    const y = Object.fromEntries(puestos.map((uno) => [uno.id, uno.y]))
    expect(y.ZZZ).toBeLessThan(y.AAA)
  })

  it('parte una columna larga en varias en vez de estirarla sin fin', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => nodo(`U${i}`, CLASES.ubicacion))
    const puestos = posicionesEnLienzo(muchas, [])
    const columnas = new Set(puestos.map((uno) => uno.x))
    expect(columnas.size).toBe(3)
  })

  it('no toca los nodos que recibe', () => {
    // Los comparte con la lista de arcos de la pantalla: mutarlos aquí los cambiaría también allí.
    const original = nodo('P1', CLASES.planta)
    posicionesEnLienzo([original], [])
    expect(original.x).toBeUndefined()
  })

  it('con una red vacía devuelve una lista vacía', () => {
    expect(posicionesEnLienzo([], [])).toEqual([])
    expect(posicionesEnLienzo(undefined, undefined)).toEqual([])
  })
})

describe('rutasDeLaRed', () => {
  const nodo = (id, clase) => ({ id, clase, nombre: id })
  const traslado = (desde, hasta) => ({ id: `${desde}->${hasta}`, desde, hasta, clase: ARCOS.transporte })
  const entrega = (desde, hasta) => ({ id: `${desde}->${hasta}`, desde, hasta, clase: ARCOS.entrega })

  it('una ruta que llega a cliente se marca como buena', () => {
    const nodos = [nodo('P1', CLASES.planta), nodo('CD', CLASES.ubicacion), nodo('C1', CLASES.cliente)]
    const arcos = [traslado('P1', 'CD'), entrega('CD', 'C1')]

    const { rutas } = rutasDeLaRed(nodos, arcos)
    expect(rutas).toHaveLength(1)
    expect(rutas[0]).toMatchObject({
      planta: 'P1', cliente: 'C1', llegaACliente: true, nodos: ['P1', 'CD'],
    })
  })

  it('una ruta que muere en un nodo sin salidas se marca «sin salida»', () => {
    // El material llega ahí y se queda. En el dibujo no se distingue de una buena.
    const nodos = [nodo('P1', CLASES.planta), nodo('CD', CLASES.ubicacion)]
    const { rutas } = rutasDeLaRed(nodos, [traslado('P1', 'CD')])

    expect(rutas).toHaveLength(1)
    expect(rutas[0]).toMatchObject({ llegaACliente: false, final: FINALES.sinSalida, ultimo: 'CD' })
  })

  it('una ruta cuyas salidas ya se visitaron se marca como ciclo, no como sin salida', () => {
    // Son cosas distintas: «no manda a nadie» es un dato que falta; «se muerde la cola» es un error.
    const nodos = [nodo('P1', CLASES.planta), nodo('A', CLASES.ubicacion), nodo('B', CLASES.ubicacion)]
    const arcos = [traslado('P1', 'A'), traslado('A', 'B'), traslado('B', 'A')]

    const { rutas } = rutasDeLaRed(nodos, arcos)
    expect(rutas).toHaveLength(1)
    expect(rutas[0]).toMatchObject({ final: FINALES.ciclo, ultimo: 'B' })
  })

  it('una planta con varias salidas da una ruta por cada una', () => {
    const nodos = [
      nodo('P1', CLASES.planta), nodo('CD1', CLASES.ubicacion), nodo('CD2', CLASES.ubicacion),
      nodo('C1', CLASES.cliente),
    ]
    const arcos = [traslado('P1', 'CD1'), traslado('P1', 'CD2'), entrega('CD1', 'C1')]

    const { rutas } = rutasDeLaRed(nodos, arcos)
    expect(rutas).toHaveLength(2)
    expect(rutas.filter((una) => una.llegaACliente)).toHaveLength(1)
  })

  it('la planta que entrega directo cuenta como ruta con cliente', () => {
    const nodos = [nodo('P1', CLASES.planta), nodo('C1', CLASES.cliente)]
    const { rutas } = rutasDeLaRed(nodos, [entrega('P1', 'C1')])
    expect(rutas[0]).toMatchObject({ planta: 'P1', cliente: 'C1', llegaACliente: true })
  })

  it('los arcos de suministro y de fabricación no son rutas: no llevan producto a nadie', () => {
    const nodos = [nodo('P1', CLASES.planta), nodo('PROV', CLASES.proveedor), nodo('PRD', CLASES.producto)]
    const arcos = [
      { id: 'a', desde: 'PROV', hasta: 'P1', clase: ARCOS.suministro },
      { id: 'b', desde: 'P1', hasta: 'PRD', clase: ARCOS.fabricacion },
    ]
    const { rutas } = rutasDeLaRed(nodos, arcos)
    expect(rutas).toHaveLength(1)
    expect(rutas[0].final).toBe(FINALES.sinSalida)
  })

  it('avisa cuando corta por el tope, en vez de entregar una lista recortada como completa', () => {
    const nodos = [
      nodo('P1', CLASES.planta), nodo('A', CLASES.ubicacion),
      nodo('C1', CLASES.cliente), nodo('C2', CLASES.cliente), nodo('C3', CLASES.cliente),
    ]
    const arcos = [traslado('P1', 'A'), entrega('A', 'C1'), entrega('A', 'C2'), entrega('A', 'C3')]

    const { rutas, truncado } = rutasDeLaRed(nodos, arcos, { tope: 2 })
    expect(rutas).toHaveLength(2)
    expect(truncado).toBe(true)
  })

  it('sin plantas no hay rutas', () => {
    expect(rutasDeLaRed([nodo('CD', CLASES.ubicacion)], []).rutas).toEqual([])
    expect(rutasDeLaRed(undefined, undefined).rutas).toEqual([])
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
