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
  plazoLegible,
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
