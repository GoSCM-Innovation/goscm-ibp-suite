import { describe, it, expect } from 'vitest'

import {
  TIPOS,
  abrirTodo,
  armarHijos,
  armarNodo,
  buscarNodo,
  claveDePlanta,
  indexarCabeceras,
  indexarComponentes,
  indexarMaestro,
  indexarPorReceta,
  indicesVacios,
  invertirArbol,
  profundidad,
  raicesPorPlanta,
  soltarHijos,
  texto,
} from './bom-tree.js'

/**
 * Un tenant de juguete con lo que de verdad muerde:
 *
 *   PLANTA1: TERMINADO (receta S1) ← SEMI (receta S2) ← MATERIA (sin receta: hoja)
 *            La receta S2 produce además COPRODUCTO.
 *   PLANTA2: SEMI tiene su propia receta S3 y ahí es producto terminado, no componente.
 */
function tenantDeJuguete() {
  const indices = indicesVacios()

  indexarCabeceras(indices, [
    { SOURCEID: 'S1', PRDID: 'TERMINADO', LOCID: 'PLANTA1', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
    { SOURCEID: 'S2', PRDID: 'SEMI', LOCID: 'PLANTA1', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
    { SOURCEID: 'S2', PRDID: 'COPRODUCTO', LOCID: 'PLANTA1', SOURCETYPE: 'C', OUTPUTCOEFFICIENT: '0,3' },
    { SOURCEID: 'S3', PRDID: 'SEMI', LOCID: 'PLANTA2', SOURCETYPE: 'P', OUTPUTCOEFFICIENT: '1' },
  ])

  indexarComponentes(indices, [
    { SOURCEID: 'S1', PRDID: 'SEMI', COMPONENTCOEFFICIENT: '2' },
    { SOURCEID: 'S2', PRDID: 'MATERIA', COMPONENTCOEFFICIENT: '5', ISALTITEM: '' },
  ])

  indexarPorReceta(indices.recursosPorSid, [
    { SOURCEID: 'S1', RESID: 'LINEA_A' },
    { SOURCEID: 'S1', RESID: 'HORNO' },
  ], 'RESID')

  indexarMaestro(indices.productos, [
    { PRDID: 'TERMINADO', PRDDESCR: 'Producto terminado', MATTYPEID: 'FERT', UOMDESCR: 'Caja' },
    { PRDID: 'SEMI', PRDDESCR: 'Semielaborado', MATTYPEID: 'HALB', UOMID: 'KG' },
    { PRDID: 'MATERIA', PRDDESCR: 'Materia prima', MATTYPEID: 'ROH', UOMID: 'KG' },
    { PRDID: 'COPRODUCTO', PRDDESCR: 'Subproducto', MATTYPEID: 'HALB', UOMID: 'KG' },
  ], 'PRDID')

  indexarMaestro(indices.ubicaciones, [
    { LOCID: 'PLANTA1', LOCDESCR: 'Planta de Quito' },
    { LOCID: 'PLANTA2', LOCDESCR: 'Planta de Guayaquil' },
  ], 'LOCID')

  return indices
}

describe('texto y claveDePlanta', () => {
  it('los identificadores de SAP llegan con espacios de sobra', () => {
    expect(texto('  S1  ')).toBe('S1')
    expect(texto(null)).toBe('')
    expect(texto(0)).toBe('0')
  })

  it('la clave de planta junta planta y producto', () => {
    expect(claveDePlanta(' PLANTA1 ', ' SEMI ')).toBe('PLANTA1|SEMI')
  })
})

describe('indexarCabeceras', () => {
  // Regla 1: la receta es del SOURCEID, y una receta produce varios productos.
  it('la cabecera principal gana sobre la de coproducto', () => {
    const indices = tenantDeJuguete()
    expect(indices.hdrPorSid.S2.PRDID).toBe('SEMI')
  })

  it('el orden no cambia quién es la principal', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [
      { SOURCEID: 'S9', PRDID: 'CO', LOCID: 'P1', SOURCETYPE: 'C' },
      { SOURCEID: 'S9', PRDID: 'PRINCIPAL', LOCID: 'P1', SOURCETYPE: 'P' },
    ])
    expect(indices.hdrPorSid.S9.PRDID).toBe('PRINCIPAL')
  })

  it('un coproducto queda listado aparte, no como receta propia', () => {
    const indices = tenantDeJuguete()
    expect(indices.coprodPorSid.S2).toEqual([
      { prdid: 'COPRODUCTO', coeficiente: '0,3', tipo: 'C' },
    ])
  })

  // Es lo que permite encontrar la receta de un componente después.
  it('el índice por producto lleva TODAS sus cabeceras', () => {
    const indices = tenantDeJuguete()
    expect(indices.hdrPorPrd.SEMI.map((una) => una.SOURCEID)).toEqual(['S2', 'S3'])
  })

  it('una fila sin receta o sin producto se descarta', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [{ SOURCEID: '', PRDID: 'X' }, { SOURCEID: 'S', PRDID: '' }])
    expect(indices.hdrPorSid).toEqual({})
  })

  it('sin filas no revienta', () => {
    expect(indexarCabeceras(indicesVacios(), undefined).hdrPorSid).toEqual({})
  })
})

describe('indexarComponentes', () => {
  // El componente no dice su planta: la hereda de la receta que lo usa.
  it('marca en qué planta un producto es componente', () => {
    const indices = tenantDeJuguete()
    expect(indices.esComponenteEn['PLANTA1|SEMI']).toBe(true)
    expect(indices.esComponenteEn['PLANTA1|MATERIA']).toBe(true)
  })

  // Regla 3: en PLANTA2 el semielaborado es producto terminado.
  it('ser componente en una planta NO lo marca en las demás', () => {
    const indices = tenantDeJuguete()
    expect(indices.esComponenteEn['PLANTA2|SEMI']).toBeUndefined()
  })

  it('un componente de una receta que no existe no marca nada', () => {
    const indices = indicesVacios()
    indexarComponentes(indices, [{ SOURCEID: 'FANTASMA', PRDID: 'X' }])
    expect(indices.esComponenteEn).toEqual({})
    expect(indices.itemsPorSid.FANTASMA).toHaveLength(1)
  })
})

describe('indexarPorReceta', () => {
  it('con campo guarda solo ese valor', () => {
    const indices = tenantDeJuguete()
    expect(indices.recursosPorSid.S1).toEqual(['LINEA_A', 'HORNO'])
  })

  it('sin campo guarda la fila entera', () => {
    const destino = {}
    indexarPorReceta(destino, [{ SOURCEID: 'S1', PRDFR: 'A', SPRDFR: 'B' }])
    expect(destino.S1[0]).toMatchObject({ PRDFR: 'A' })
  })

  it('descarta lo que no tiene el campo pedido', () => {
    const destino = {}
    indexarPorReceta(destino, [{ SOURCEID: 'S1', RESID: '' }], 'RESID')
    expect(destino.S1).toEqual([])
  })
})

describe('armarNodo', () => {
  const indices = tenantDeJuguete()

  it('un nodo lleva lo que se necesita para leerlo sin abrirlo', () => {
    const nodo = armarNodo('S1', { indices })
    expect(nodo).toMatchObject({
      receta: 'S1',
      prdid: 'TERMINADO',
      descripcion: 'Producto terminado',
      tipoDeMaterial: 'FERT',
      unidad: 'Caja',
      planta: 'PLANTA1',
      nivel: 1,
      tipo: TIPOS.raiz,
      recursos: ['LINEA_A', 'HORNO'],
    })
  })

  // `null` = se puede abrir y no se abrió; `[]` = no tiene. La pantalla dibuja la flecha con eso.
  it('marca si se puede abrir, sin construir los hijos', () => {
    expect(armarNodo('S1', { indices }).hijos).toBe(null)
    expect(armarNodo('S1', { indices }).sePuedeAbrir).toBe(true)
  })

  it('una receta sin componentes es hoja de entrada', () => {
    expect(armarNodo('S3', { indices }).hijos).toEqual([])
    expect(armarNodo('S3', { indices }).sePuedeAbrir).toBe(false)
  })

  it('la unidad cae al código si no hay descripción', () => {
    expect(armarNodo('S2', { indices }).unidad).toBe('KG')
  })

  // Regla 4: el mismo nodo mirado por el coproducto enseña al principal como coproducto suyo.
  it('mostrado por su coproducto, el principal pasa a ser coproducto y va primero', () => {
    const nodo = armarNodo('S2', { indices, prdMostrado: 'COPRODUCTO' })
    expect(nodo.prdid).toBe('COPRODUCTO')
    expect(nodo.coproductos.map((uno) => uno.prdid)).toEqual(['SEMI'])
    expect(nodo.coproductos[0].descripcion).toBe('Semielaborado')
  })

  it('mostrado por el principal, el coproducto se lista con su coeficiente', () => {
    const nodo = armarNodo('S2', { indices })
    expect(nodo.coproductos).toEqual([{
      prdid: 'COPRODUCTO',
      coeficiente: '0,3',
      tipo: 'C',
      descripcion: 'Subproducto',
      tipoDeMaterial: 'HALB',
      unidad: 'KG',
    }])
  })

  it('el tipo de receta es el de la fila de ESE producto', () => {
    expect(armarNodo('S2', { indices }).tipoDeReceta).toBe('P')
    expect(armarNodo('S2', { indices, prdMostrado: 'COPRODUCTO' }).tipoDeReceta).toBe('C')
  })

  it('una receta que no existe no da nodo', () => {
    expect(armarNodo('NOEXISTE', { indices })).toBe(null)
    expect(armarNodo('', { indices })).toBe(null)
  })

  // La planta de la raíz baja por todo el árbol (regla 2).
  it('la planta raíz se hereda y no se pierde', () => {
    const nodo = armarNodo('S1', { indices, locRaiz: 'PLANTA1' })
    expect(nodo.plantaRaiz).toBe('PLANTA1')
  })
})

describe('armarHijos', () => {
  it('un componente con receta en la planta se abre como componente', () => {
    const indices = tenantDeJuguete()
    const raiz = armarNodo('S1', { indices })
    armarHijos(raiz, indices)

    expect(raiz.hijos).toHaveLength(1)
    expect(raiz.hijos[0]).toMatchObject({
      receta: 'S2', prdid: 'SEMI', tipo: TIPOS.componente, nivel: 2, coeficienteDeEntrada: '2',
    })
  })

  // Regla 5: sin receta en esa planta se compra o es materia prima.
  it('un componente sin receta es una hoja, no un error', () => {
    const indices = tenantDeJuguete()
    const semi = armarNodo('S2', { indices })
    armarHijos(semi, indices)

    expect(semi.hijos[0]).toMatchObject({
      tipo: TIPOS.hoja, prdid: 'MATERIA', receta: '', coeficienteDeEntrada: '5', sePuedeAbrir: false,
    })
  })

  // Regla 2, la que más muerde: sin esto el árbol de una planta se llena de recetas de la otra.
  it('NO baja por la receta de otra planta', () => {
    const indices = tenantDeJuguete()
    const raiz = armarNodo('S1', { indices })
    armarHijos(raiz, indices)

    expect(raiz.hijos.map((uno) => uno.receta)).toEqual(['S2'])
    expect(raiz.hijos.map((uno) => uno.receta)).not.toContain('S3')
  })

  it('es idempotente: llamarlo dos veces no duplica hijos', () => {
    const indices = tenantDeJuguete()
    const raiz = armarNodo('S1', { indices })
    armarHijos(raiz, indices)
    armarHijos(raiz, indices)
    expect(raiz.hijos).toHaveLength(1)
  })

  it('sobre una hoja no hace nada', () => {
    const indices = tenantDeJuguete()
    expect(armarHijos(armarNodo('S3', { indices }), indices)).toEqual([])
  })

  it('el componente alternativo queda marcado', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [{ SOURCEID: 'A', PRDID: 'P', LOCID: 'L', SOURCETYPE: 'P' }])
    indexarComponentes(indices, [{ SOURCEID: 'A', PRDID: 'C', COMPONENTCOEFFICIENT: '1', ISALTITEM: 'X' }])

    const nodo = armarNodo('A', { indices })
    armarHijos(nodo, indices)
    expect(nodo.hijos[0].esAlternativo).toBe('X')
  })

  it('dos recetas del mismo componente en la planta salen las dos', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [
      { SOURCEID: 'R', PRDID: 'TERM', LOCID: 'L', SOURCETYPE: 'P' },
      { SOURCEID: 'C1', PRDID: 'COMP', LOCID: 'L', SOURCETYPE: 'P' },
      { SOURCEID: 'C2', PRDID: 'COMP', LOCID: 'L', SOURCETYPE: 'P' },
    ])
    indexarComponentes(indices, [{ SOURCEID: 'R', PRDID: 'COMP', COMPONENTCOEFFICIENT: '1' }])

    const nodo = armarNodo('R', { indices })
    armarHijos(nodo, indices)
    expect(nodo.hijos.map((uno) => uno.receta)).toEqual(['C1', 'C2'])
  })
})

describe('ciclos', () => {
  /** A usa B, y B usa A. Existe en tenants reales y v7 lo borraba del árbol sin decirlo. */
  function conCiclo() {
    const indices = indicesVacios()
    indexarCabeceras(indices, [
      { SOURCEID: 'SA', PRDID: 'A', LOCID: 'L', SOURCETYPE: 'P' },
      { SOURCEID: 'SB', PRDID: 'B', LOCID: 'L', SOURCETYPE: 'P' },
    ])
    indexarComponentes(indices, [
      { SOURCEID: 'SA', PRDID: 'B', COMPONENTCOEFFICIENT: '1' },
      { SOURCEID: 'SB', PRDID: 'A', COMPONENTCOEFFICIENT: '1' },
    ])
    indexarMaestro(indices.productos, [{ PRDID: 'A', PRDDESCR: 'Ele A' }, { PRDID: 'B', PRDDESCR: 'Ele B' }], 'PRDID')
    return indices
  }

  // Lo que v7 hacía mal: devolvía null y la rama desaparecía en silencio.
  it('el nodo que cierra el ciclo SE VE, marcado', () => {
    const indices = conCiclo()
    const a = armarNodo('SA', { indices })
    armarHijos(a, indices)
    const b = a.hijos[0]
    armarHijos(b, indices)

    expect(b.hijos).toHaveLength(1)
    expect(b.hijos[0]).toMatchObject({ tipo: TIPOS.ciclo, receta: 'SA', prdid: 'A' })
  })

  it('un nodo de ciclo no se puede abrir: cortar es el punto', () => {
    const indices = conCiclo()
    const a = armarNodo('SA', { indices })
    armarHijos(a, indices)
    const b = a.hijos[0]
    armarHijos(b, indices)

    expect(b.hijos[0].sePuedeAbrir).toBe(false)
    expect(armarHijos(b.hijos[0], indices)).toEqual([])
  })

  it('el ciclo se REPORTA, con desde dónde vuelve', () => {
    const indices = conCiclo()
    const a = armarNodo('SA', { indices })
    armarHijos(a, indices)
    const ciclos = armarHijos(a.hijos[0], indices)

    expect(ciclos).toEqual([{ receta: 'SA', prdid: 'A', planta: 'L', desde: 'SB' }])
  })

  it('abrirTodo junta los ciclos de todo el árbol y no se cuelga', () => {
    const indices = conCiclo()
    const ciclos = abrirTodo([armarNodo('SA', { indices })], indices)
    expect(ciclos).toHaveLength(1)
  })

  // Una receta que se usa a sí misma directamente: el caso degenerado.
  it('una receta que se usa a sí misma también se marca', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [{ SOURCEID: 'S', PRDID: 'P', LOCID: 'L', SOURCETYPE: 'P' }])
    indexarComponentes(indices, [{ SOURCEID: 'S', PRDID: 'P', COMPONENTCOEFFICIENT: '1' }])

    const nodo = armarNodo('S', { indices })
    const ciclos = armarHijos(nodo, indices)
    expect(nodo.hijos[0].tipo).toBe(TIPOS.ciclo)
    expect(ciclos).toHaveLength(1)
  })
})

describe('raicesPorPlanta', () => {
  const arbol = raicesPorPlanta(tenantDeJuguete())

  it('agrupa por planta, ordenadas', () => {
    expect(arbol.plantas).toEqual(['PLANTA1', 'PLANTA2'])
  })

  // Regla 3: el semielaborado es componente en PLANTA1 y producto terminado en PLANTA2.
  it('un producto que es componente en su planta NO es raíz ahí', () => {
    expect(arbol.porPlanta.PLANTA1.map((uno) => uno.prdid)).not.toContain('SEMI')
  })

  // Sorprende, y es correcto: la receta S2 produce SEMI —que se consume— y COPRODUCTO —que no—. Como
  // SEMI no puede encabezarla, la encabeza el coproducto: es algo que sale de la planta y nadie usa.
  it('un coproducto que nadie consume SÍ encabeza su receta', () => {
    expect(arbol.porPlanta.PLANTA1.map((uno) => uno.prdid)).toEqual(['COPRODUCTO', 'TERMINADO'])
    const suyo = arbol.porPlanta.PLANTA1.find((uno) => uno.prdid === 'COPRODUCTO')
    expect(suyo.receta).toBe('S2')
    expect(suyo.coproductos.map((uno) => uno.prdid)).toEqual(['SEMI'])
  })

  it('el mismo producto SÍ es raíz en la planta donde no es componente', () => {
    expect(arbol.porPlanta.PLANTA2.map((uno) => uno.prdid)).toEqual(['SEMI'])
  })

  // Regla 4: S2 figura bajo SEMI y bajo COPRODUCTO; si SEMI no fuera componente saldría una sola vez.
  it('una receta con coproductos se construye UNA vez por planta', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [
      { SOURCEID: 'S', PRDID: 'PRINCIPAL', LOCID: 'L', SOURCETYPE: 'P' },
      { SOURCEID: 'S', PRDID: 'CO', LOCID: 'L', SOURCETYPE: 'C' },
    ])
    const solo = raicesPorPlanta(indices)
    expect(solo.porPlanta.L).toHaveLength(1)
    expect(solo.porPlanta.L[0].coproductos.map((uno) => uno.prdid)).toEqual(['CO'])
  })

  it('el resumen lleva la descripción de la planta', () => {
    expect(arbol.resumen.PLANTA1).toEqual({ raices: 2, descripcion: 'Planta de Quito' })
    expect(arbol.resumen.PLANTA2).toEqual({ raices: 1, descripcion: 'Planta de Guayaquil' })
  })

  it('sin descripción usa el propio código', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [{ SOURCEID: 'S', PRDID: 'P', LOCID: 'SINNOMBRE', SOURCETYPE: 'P' }])
    expect(raicesPorPlanta(indices).resumen.SINNOMBRE.descripcion).toBe('SINNOMBRE')
  })

  it('un tenant sin recetas da un árbol vacío, no un fallo', () => {
    expect(raicesPorPlanta(indicesVacios())).toMatchObject({ plantas: [], porPlanta: {} })
  })
})

describe('abrirTodo, profundidad y soltarHijos', () => {
  it('abre el árbol entero y la profundidad se puede medir', () => {
    const indices = tenantDeJuguete()
    const raices = raicesPorPlanta(indices).porPlanta.PLANTA1
    abrirTodo(raices, indices)

    // TERMINADO -> SEMI -> MATERIA son tres niveles; el del coproducto, S2 -> MATERIA, son dos.
    expect(profundidad(raices.find((uno) => uno.prdid === 'TERMINADO'))).toBe(3)
    expect(profundidad(raices.find((uno) => uno.prdid === 'COPRODUCTO'))).toBe(2)
  })

  it('una hoja tiene profundidad uno', () => {
    const indices = tenantDeJuguete()
    expect(profundidad(armarNodo('S3', { indices }))).toBe(1)
  })

  // Un árbol de veinte niveles abierto entero no cabe en memoria: colapsar tiene que liberar.
  it('soltar deja el nodo abrible otra vez', () => {
    const indices = tenantDeJuguete()
    const raiz = armarNodo('S1', { indices })
    armarHijos(raiz, indices)
    soltarHijos(raiz)

    expect(raiz.hijos).toBe(null)
    expect(raiz.sePuedeAbrir).toBe(true)
    armarHijos(raiz, indices)
    expect(raiz.hijos).toHaveLength(1)
  })

  it('soltar una hoja no la rompe', () => {
    const indices = tenantDeJuguete()
    const hoja = armarNodo('S3', { indices })
    soltarHijos(hoja)
    expect(hoja.hijos).toEqual([])
  })
})

describe('buscarNodo', () => {
  it('encuentra un nodo hondo por su identificador', () => {
    const indices = tenantDeJuguete()
    const raices = raicesPorPlanta(indices).porPlanta.PLANTA1
    abrirTodo(raices, indices)

    const raiz = raices.find((uno) => uno.prdid === 'TERMINADO')
    expect(buscarNodo(raices, raiz.id)?.prdid).toBe('TERMINADO')
    expect(buscarNodo(raices, raiz.hijos[0].id)?.prdid).toBe('SEMI')
  })

  it('lo que no está devuelve null', () => {
    expect(buscarNodo([], 'X')).toBe(null)
    expect(buscarNodo(undefined, 'X')).toBe(null)
  })
})

describe('identidad de los nodos', () => {
  /** Un semielaborado compartido: lo usan DOS productos terminados de la misma planta. */
  function compartido() {
    const indices = indicesVacios()
    indexarCabeceras(indices, [
      { SOURCEID: 'T1', PRDID: 'TERM1', LOCID: 'L', SOURCETYPE: 'P' },
      { SOURCEID: 'T2', PRDID: 'TERM2', LOCID: 'L', SOURCETYPE: 'P' },
      { SOURCEID: 'SS', PRDID: 'SEMI', LOCID: 'L', SOURCETYPE: 'P' },
    ])
    indexarComponentes(indices, [
      { SOURCEID: 'T1', PRDID: 'SEMI', COMPONENTCOEFFICIENT: '1' },
      { SOURCEID: 'T2', PRDID: 'SEMI', COMPONENTCOEFFICIENT: '3' },
      { SOURCEID: 'SS', PRDID: 'MAT', COMPONENTCOEFFICIENT: '2' },
    ])
    return indices
  }

  const todos = (nodos, salida = []) => {
    for (const nodo of nodos ?? []) { salida.push(nodo); todos(nodo.hijos, salida) }
    return salida
  }

  // El fallo que esto evita: con el identificador hecho de receta y nivel, la misma receta bajo dos
  // padres daba dos filas con la misma identidad, React reutilizaba la equivocada y dejaba filas
  // viejas en pantalla. Se vio con datos reales: 48 nodos daban 36 identificadores.
  it('la misma receta bajo dos padres NO comparte identificador', () => {
    const indices = compartido()
    const raices = raicesPorPlanta(indices).porPlanta.L
    abrirTodo(raices, indices)

    const ids = todos(raices).map((uno) => uno.id)
    expect(ids).toHaveLength(new Set(ids).size)
    expect(todos(raices).filter((uno) => uno.receta === 'SS')).toHaveLength(2)
  })

  it('el identificador es el camino, y empieza por la planta', () => {
    const indices = compartido()
    const raices = raicesPorPlanta(indices).porPlanta.L
    abrirTodo(raices, indices)

    const term1 = raices.find((uno) => uno.prdid === 'TERM1')
    expect(term1.id).toBe('L/T1')
    expect(term1.hijos[0].id).toBe('L/T1/1:SS')
    expect(term1.hijos[0].hijos[0].id).toBe('L/T1/1:SS/1:hoja-MAT')
  })

  // El mismo producto dos veces en la misma receta —dos alternativas— son dos filas distintas.
  it('dos veces el mismo componente en una receta da dos identificadores', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [{ SOURCEID: 'R', PRDID: 'P', LOCID: 'L', SOURCETYPE: 'P' }])
    indexarComponentes(indices, [
      { SOURCEID: 'R', PRDID: 'C', COMPONENTCOEFFICIENT: '1', ISALTITEM: '' },
      { SOURCEID: 'R', PRDID: 'C', COMPONENTCOEFFICIENT: '2', ISALTITEM: 'X' },
    ])

    const nodo = armarNodo('R', { indices })
    armarHijos(nodo, indices)
    const ids = nodo.hijos.map((uno) => uno.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('la misma receta en dos plantas da raíces distintas', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [
      { SOURCEID: 'S', PRDID: 'P', LOCID: 'L1', SOURCETYPE: 'P' },
      { SOURCEID: 'S', PRDID: 'P', LOCID: 'L2', SOURCETYPE: 'P' },
    ])
    const arbol = raicesPorPlanta(indices)
    expect(arbol.porPlanta.L1[0].id).not.toBe(arbol.porPlanta.L2[0].id)
  })

  it('un nodo de ciclo también tiene identificador propio', () => {
    const indices = indicesVacios()
    indexarCabeceras(indices, [{ SOURCEID: 'S', PRDID: 'P', LOCID: 'L', SOURCETYPE: 'P' }])
    indexarComponentes(indices, [{ SOURCEID: 'S', PRDID: 'P', COMPONENTCOEFFICIENT: '1' }])

    const nodo = armarNodo('S', { indices })
    armarHijos(nodo, indices)
    expect(nodo.hijos[0].id).toBe('L/S/1:ciclo-S')
  })
})

// Sin acotar, las raíces salen de TODO el índice que se le pase, que es lo correcto para un tenant
// entero. Pero la pantalla carga el subárbol de UN producto —el producto, sus componentes, y los
// componentes de esos— y con ese índice las raíces salen de más.
//
// `tenantDeJuguete` es justo ese caso: si se pide el árbol de TERMINADO, el índice trae también la
// receta S3 de SEMI en PLANTA2, donde SEMI no es componente de nadie. Así que PLANTA2 aparecía como
// planta del árbol de TERMINADO, y TERMINADO no se fabrica ahí.
//
// Medido en un tenant real: el producto `1020085` tiene 18 recetas —10 en la planta 1702 y 8 en la
// 1901, ninguna en P042— y la pantalla ofrecía las tres con 127, 139 y 127 raíces.
describe('raíces acotadas a un producto', () => {
  it('sin acotar, las plantas son las de todo el índice', () => {
    const todo = raicesPorPlanta(tenantDeJuguete())
    expect(todo.plantas).toEqual(['PLANTA1', 'PLANTA2'])
  })

  it('acotado, desaparece la planta donde ese material no se fabrica', () => {
    const solo = raicesPorPlanta(tenantDeJuguete(), { soloDe: 'TERMINADO' })
    expect(solo.plantas).toEqual(['PLANTA1'])
    expect(solo.porPlanta.PLANTA1.map((uno) => uno.prdid)).toEqual(['TERMINADO'])
  })

  // SEMI se produce en las dos plantas, pero en PLANTA1 ADEMÁS se consume, y la regla 3 dice que ahí
  // no es raíz: aparece como hijo de TERMINADO, no como cabeza de árbol. Así que acotando a SEMI queda
  // PLANTA2, que es donde sí encabeza.
  //
  // Queda una pregunta de producto que esto deja a la vista y que no se decide sola: si al pedir el
  // árbol de un semiterminado conviene ofrecer también la planta donde se fabrica Y se consume. Hoy no
  // se ofrece, y antes tampoco —solo aparecía de rebote, porque otros productos eran raíz ahí—.
  it('un material que además se consume en una planta no encabeza árbol ahí', () => {
    const solo = raicesPorPlanta(tenantDeJuguete(), { soloDe: 'SEMI' })
    expect(solo.plantas).toEqual(['PLANTA2'])
  })

  // Esconder una receta donde el material es coproducto sería esconder de dónde sale.
  it('una receta donde el material es COPRODUCTO también cuenta', () => {
    const solo = raicesPorPlanta(tenantDeJuguete(), { soloDe: 'COPRODUCTO' })
    expect(solo.plantas).toEqual(['PLANTA1'])
    // La encabeza COPRODUCTO porque su principal, SEMI, es componente en esa planta.
    expect(solo.porPlanta.PLANTA1.map((uno) => uno.prdid)).toEqual(['COPRODUCTO'])
  })

  it('un material que no se fabrica en ninguna parte no ofrece plantas', () => {
    expect(raicesPorPlanta(tenantDeJuguete(), { soloDe: 'MATERIA' }).plantas).toEqual([])
    expect(raicesPorPlanta(tenantDeJuguete(), { soloDe: 'NO_EXISTE' }).plantas).toEqual([])
  })

  it('acotar con vacío es no acotar', () => {
    expect(raicesPorPlanta(tenantDeJuguete(), { soloDe: '' }).plantas).toEqual(['PLANTA1', 'PLANTA2'])
  })
})

describe('invertirArbol', () => {
  /** Un nodo del árbol ya construido, con lo que mira la inversión. */
  const nodo = (prdid, hijos = []) => ({
    id: `n-${prdid}`,
    tipo: hijos.length > 0 ? TIPOS.componente : TIPOS.hoja,
    receta: hijos.length > 0 ? `S-${prdid}` : '',
    prdid,
    planta: 'P1',
    nivel: 1,
    hijos,
    sePuedeAbrir: hijos.length > 0,
  })

  /** TERMINADO ← SEMI ← MP. Tres niveles, una sola rama. */
  const conUnaRama = () => nodo('TERMINADO', [nodo('SEMI', [nodo('MP')])])

  it('la materia prima pasa a colgar de la raíz', () => {
    // Es lo que contesta la pregunta: «esta materia prima, ¿dónde se usa?».
    const [raiz] = invertirArbol([conUnaRama()])
    expect(raiz.prdid).toBe('TERMINADO')
    expect(raiz.hijos.map((uno) => uno.prdid)).toEqual(['MP'])
  })

  it('debajo de la hoja cuelga quien la consume, subiendo hasta la raíz', () => {
    // La raíz NO se repite abajo: ya es la cabecera del árbol. La cadena termina en su hijo directo.
    const [raiz] = invertirArbol([conUnaRama()])
    const mp = raiz.hijos[0]
    expect(mp.hijos.map((uno) => uno.prdid)).toEqual(['SEMI'])
    expect(mp.hijos[0].hijos).toEqual([])
  })

  it('un insumo usado en dos ramas sale UNA vez, con sus dos consumidores debajo', () => {
    // Es el caso que hace útil la vista: el tornillo que está en media planta.
    const arbol = nodo('TERMINADO', [
      nodo('SEMI_A', [nodo('TORNILLO')]),
      nodo('SEMI_B', [nodo('TORNILLO')]),
    ])

    const [raiz] = invertirArbol([arbol])
    expect(raiz.hijos.map((uno) => uno.prdid)).toEqual(['TORNILLO'])
    expect(raiz.hijos[0].hijos.map((uno) => uno.prdid).sort()).toEqual(['SEMI_A', 'SEMI_B'])
  })

  it('una hoja que además es hoja de otra rama no se duplica', () => {
    const arbol = nodo('TERMINADO', [nodo('MP1'), nodo('MP2'), nodo('MP1')])
    const [raiz] = invertirArbol([arbol])
    expect(raiz.hijos.map((uno) => uno.prdid).sort()).toEqual(['MP1', 'MP2'])
  })

  it('los niveles se recalculan: la hoja queda en el 2', () => {
    const [raiz] = invertirArbol([conUnaRama()])
    expect(raiz.nivel).toBe(1)
    expect(raiz.hijos[0].nivel).toBe(2)
    expect(raiz.hijos[0].hijos[0].nivel).toBe(3)
  })

  it('marca como abribles solo los que tienen algo debajo', () => {
    const [raiz] = invertirArbol([conUnaRama()])
    expect(raiz.sePuedeAbrir).toBe(true)
    expect(raiz.hijos[0].sePuedeAbrir).toBe(true)
    expect(raiz.hijos[0].hijos[0].sePuedeAbrir).toBe(false)
  })

  it('NO toca el árbol original: los dos conviven en la misma pestaña', () => {
    const arbol = conUnaRama()
    invertirArbol([arbol])
    expect(arbol.hijos[0].prdid).toBe('SEMI')
    expect(arbol.id).toBe('n-TERMINADO')
  })

  it('los identificadores no chocan con los del árbol normal', () => {
    // Comparten el estado de qué está abierto; con identificadores iguales, abrir uno abriría el otro.
    const [raiz] = invertirArbol([conUnaRama()])
    expect(raiz.id).not.toBe('n-TERMINADO')
    expect(raiz.id.startsWith('inv_')).toBe(true)
  })

  it('una raíz sin hijos se queda como está', () => {
    const [raiz] = invertirArbol([nodo('COMPRADO')])
    expect(raiz.prdid).toBe('COMPRADO')
    expect(raiz.hijos).toEqual([])
  })

  it('con un bosque vacío devuelve vacío', () => {
    expect(invertirArbol([])).toEqual([])
    expect(invertirArbol(undefined)).toEqual([])
  })
})
