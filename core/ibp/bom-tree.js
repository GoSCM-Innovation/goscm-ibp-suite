// El árbol de materiales: qué se fabrica con qué, planta por planta.
//
// Portado de `bom.js` de v7 (1.594 líneas de manipulación directa del DOM mezclada con la lógica).
// Aquí está solo la lógica: recibe índices ya armados y devuelve nodos. Quien los arma leyendo
// IndexedDB es `src/lib/bom-load.js`, porque los datasets grandes se recorren por cursor y eso es
// del navegador.
//
// Las cinco reglas de SAP que gobiernan este árbol, ganadas en v7 contra tenants reales:
//
//   1. Una receta se identifica por SOURCEID, no por producto. El mismo producto puede tener varias
//      recetas en la misma planta, y la misma receta puede producir varios productos a la vez.
//   2. La planta MANDA. Los componentes de una receta se buscan solo entre las recetas de la MISMA
//      planta que la raíz. Sin eso, un árbol de la planta A se llena de recetas de la planta B y sale
//      una lista de materiales que no existe en ningún sitio.
//   3. Un producto es RAÍZ en una planta si tiene receta ahí y NO es componente de nadie ahí. Ser
//      componente en otra planta no lo descalifica: en la planta A puede ser el producto terminado y
//      en la B un insumo.
//   4. Una receta se construye UNA vez por planta, aunque figure bajo varios productos. Un SOURCEID
//      aparece en la cabecera una vez como principal (SOURCETYPE distinto de C) y una vez por cada
//      coproducto; construirla por cada uno daría el mismo árbol repetido N veces.
//   5. Un componente sin receta en esa planta es una HOJA: se compra o es materia prima. No es un
//      error ni un dato que falte.
//
// Y una que v7 dejó a medias: los CICLOS. v7 detectaba que un componente volvía a una receta ya
// visitada en el camino y devolvía `null` — el componente desaparecía del árbol sin decir nada, y su
// lista de ciclos se declaraba vacía y nunca se llenaba. Un árbol al que le falta una rama en
// silencio es peor que un error: se entrega como si estuviera completo. Aquí el nodo se devuelve
// MARCADO como ciclo, con a qué receta vuelve, y quien construye recoge la lista.

/** Un valor de SAP como texto limpio. Los identificadores llegan con espacios de sobra. */
export const texto = (valor) => String(valor ?? '').trim()

/** La clave con la que se pregunta «¿es componente en esta planta?». */
export const claveDePlanta = (locid, prdid) => `${texto(locid)}|${texto(prdid)}`

/**
 * El identificador de un nodo es su CAMINO, no su receta.
 *
 * La misma receta cuelga de varios padres a la vez —un semielaborado que usan tres productos— y en el
 * mismo nivel. Con un identificador hecho de receta y nivel, esos nodos son indistinguibles: dos filas
 * distintas de la pantalla con la misma identidad. v7 no lo notaba porque pintaba HTML anidado; en una
 * lista con claves, React reutiliza la fila equivocada y deja filas viejas en pantalla.
 *
 * Se comprobó con datos reales: en el árbol de un producto de tres plantas, 48 nodos daban 36
 * identificadores, uno de ellos repetido cuatro veces.
 */
const idHijo = (idPadre, ranura, propio) => `${idPadre}/${ranura}:${propio}`

/** Los tipos de nodo del árbol. */
export const TIPOS = Object.freeze({
  raiz: 'RAIZ',
  componente: 'COMPONENTE',
  hoja: 'HOJA',
  ciclo: 'CICLO',
})

/**
 * Los índices vacíos, para arrancar.
 *
 * `hdrPorPrd` lleva TODAS las cabeceras de un producto —incluidas las de coproducto— porque es lo que
 * permite encontrar la receta de un componente. `hdrPorSid` guarda la principal de cada receta.
 */
export const indicesVacios = () => ({
  hdrPorPrd: {},
  hdrPorSid: {},
  itemsPorSid: {},
  recursosPorSid: {},
  coprodPorSid: {},
  subsPorSid: {},
  validezPorSid: {},
  productos: {},
  ubicaciones: {},
  esComponenteEn: {},
})

/**
 * Mete las cabeceras de una receta en los índices.
 *
 * La cabecera con `SOURCETYPE` distinto de `C` es la principal: la que dice qué produce la receta de
 * verdad. Las `C` son coproductos, y se guardan aparte para poder enseñarlos en el nodo sin que cada
 * uno abra su propio árbol (regla 4).
 */
export function indexarCabeceras(indices, filas) {
  for (const fila of filas ?? []) {
    const sid = texto(fila.SOURCEID)
    const prd = texto(fila.PRDID)
    if (!sid || !prd) continue

    const tipo = texto(fila.SOURCETYPE) || 'P'

    // La principal gana: si ya hay una y esta es coproducto, no la pisa.
    if (!indices.hdrPorSid[sid] || tipo !== 'C') indices.hdrPorSid[sid] = fila

    if (tipo === 'C') {
      indices.coprodPorSid[sid] = indices.coprodPorSid[sid] ?? []
      indices.coprodPorSid[sid].push({ prdid: prd, coeficiente: fila.OUTPUTCOEFFICIENT ?? '', tipo })
    }

    indices.hdrPorPrd[prd] = indices.hdrPorPrd[prd] ?? []
    indices.hdrPorPrd[prd].push(fila)
  }
  return indices
}

/**
 * Mete los componentes de una receta, y marca qué producto es componente en qué planta.
 *
 * Esa marca es la que decide las raíces (regla 3), y se saca de aquí porque el componente no dice su
 * planta: la hereda de la receta que lo usa. Por eso las cabeceras se indexan ANTES.
 */
export function indexarComponentes(indices, filas) {
  for (const fila of filas ?? []) {
    const sid = texto(fila.SOURCEID)
    const prd = texto(fila.PRDID)
    if (!sid || !prd) continue

    indices.itemsPorSid[sid] = indices.itemsPorSid[sid] ?? []
    indices.itemsPorSid[sid].push(fila)

    const cabecera = indices.hdrPorSid[sid]
    if (cabecera) indices.esComponenteEn[claveDePlanta(cabecera.LOCID, prd)] = true
  }
  return indices
}

/**
 * Agrupa filas por su `SOURCEID`.
 *
 * Con `campo`, guarda solo ese valor —los recursos son una lista de identificadores, no de filas—; sin
 * él, la fila entera.
 */
export function indexarPorReceta(destino, filas, campo) {
  for (const fila of filas ?? []) {
    const sid = texto(fila.SOURCEID)
    if (!sid) continue

    destino[sid] = destino[sid] ?? []
    if (!campo) {
      destino[sid].push(fila)
      continue
    }

    const valor = texto(fila[campo])
    if (valor) destino[sid].push(valor)
  }
  return destino
}

/** El maestro de productos o de ubicaciones, por su identificador. */
export function indexarMaestro(destino, filas, clave) {
  for (const fila of filas ?? []) {
    const id = texto(fila[clave])
    if (id) destino[id] = fila
  }
  return destino
}

/** Lo que se sabe de un producto, con los huecos como cadena vacía y no como undefined. */
function datosDelProducto(indices, prdid) {
  const info = indices.productos[prdid] ?? {}
  return {
    descripcion: texto(info.PRDDESCR),
    tipoDeMaterial: texto(info.MATTYPEID),
    unidad: texto(info.UOMDESCR) || texto(info.UOMID),
  }
}

/**
 * Un nodo del árbol, SIN sus hijos.
 *
 * `hijos: null` quiere decir «se puede abrir y todavía no se abrió»; `[]`, «no tiene». La diferencia
 * importa: un árbol de veinte niveles construido de una vez no cabe en memoria, y v7 ya lo resolvía
 * así. Con `null` la pantalla sabe que hay flecha; con `[]`, que es una hoja.
 *
 * `visitados` son las recetas del camino desde la raíz. Si `sid` ya está, es un ciclo: se devuelve un
 * nodo marcado en vez de `null`, para que se VEA.
 */
export function armarNodo(sid, {
  nivel = 1, visitados = {}, prdMostrado = '', locRaiz = '', indices, idPadre = '', ranura = 0,
}) {
  const receta = texto(sid)
  if (!receta) return null

  const cabecera = indices.hdrPorSid[receta]
  if (!cabecera) return null

  const planta = texto(cabecera.LOCID)
  const plantaRaiz = texto(locRaiz) || planta
  const prd = texto(prdMostrado) || texto(cabecera.PRDID)

  if (visitados[receta]) {
    return {
      id: idPadre ? idHijo(idPadre, ranura, `ciclo-${receta}`) : `${planta}/${receta}`,
      tipo: TIPOS.ciclo,
      receta,
      prdid: prd,
      ...datosDelProducto(indices, prd),
      planta,
      plantaRaiz,
      nivel,
      coeficienteDeSalida: '',
      coeficienteDeEntrada: '',
      recursos: [],
      coproductos: [],
      hijos: [],
      sePuedeAbrir: false,
      camino: visitados,
    }
  }

  const camino = { ...visitados, [receta]: true }

  // El SOURCETYPE del nodo es el de la fila de ESTE producto, no el de la receta: la misma receta es
  // principal para uno y coproducto para otro.
  const suya = (indices.hdrPorPrd[prd] ?? []).find((una) => texto(una.SOURCEID) === receta)
  const tieneComponentes = (indices.itemsPorSid[receta] ?? []).length > 0

  const principal = texto(cabecera.PRDID)
  const coproductos = (indices.coprodPorSid[receta] ?? [])
    .filter((uno) => uno.prdid !== prd)
    .map((uno) => ({ ...uno, ...datosDelProducto(indices, uno.prdid) }))

  // Si el nodo se está mostrando por un coproducto, el producto principal de la receta es a su vez un
  // coproducto DESDE ESTE NODO: sale primero, porque es el que manda en la receta.
  const conPrincipal = principal && principal !== prd
    ? [{
      prdid: principal,
      coeficiente: cabecera.OUTPUTCOEFFICIENT ?? '',
      tipo: texto(cabecera.SOURCETYPE),
      ...datosDelProducto(indices, principal),
    }, ...coproductos]
    : coproductos

  return {
    // En la raíz, la planta y la receta ya la identifican: cada receta se construye una vez por planta.
    id: idPadre ? idHijo(idPadre, ranura, receta) : `${plantaRaiz}/${receta}`,
    tipo: nivel === 1 ? TIPOS.raiz : TIPOS.componente,
    receta,
    prdid: prd,
    ...datosDelProducto(indices, prd),
    planta,
    plantaRaiz,
    nivel,
    coeficienteDeSalida: cabecera.OUTPUTCOEFFICIENT ?? '',
    coeficienteDeEntrada: '',
    tipoDeReceta: texto((suya ?? cabecera).SOURCETYPE),
    recursos: indices.recursosPorSid[receta] ?? [],
    coproductos: conPrincipal,
    hijos: tieneComponentes ? null : [],
    sePuedeAbrir: tieneComponentes,
    camino,
  }
}

/**
 * Construye los hijos directos de un nodo. Idempotente: si ya están, no hace nada.
 *
 * Devuelve los ciclos que encontró, para que quien construye los pueda juntar y contar. Un ciclo no se
 * arregla solo y hay que decirlo: significa que en SAP hay una receta que acaba usándose a sí misma.
 */
export function armarHijos(nodo, indices) {
  if (!nodo?.sePuedeAbrir || nodo.hijos !== null) return []

  const ciclos = []
  const hijos = []
  const plantaRaiz = nodo.plantaRaiz || nodo.planta
  const recetasYaPuestas = {}

  // La ranura es la posición del componente en la receta. Entra en el identificador porque el mismo
  // producto puede figurar dos veces como componente —dos alternativas— y serían dos filas distintas.
  let ranura = 0

  for (const item of indices.itemsPorSid[nodo.receta] ?? []) {
    const compPrd = texto(item.PRDID)
    if (!compPrd) continue
    ranura += 1

    const datos = datosDelProducto(indices, compPrd)
    const coeficiente = item.COMPONENTCOEFFICIENT ?? ''
    const esAlternativo = texto(item.ISALTITEM)

    // Regla 2: solo las recetas de la MISMA planta que la raíz.
    const suyas = (indices.hdrPorPrd[compPrd] ?? [])
      .filter((una) => texto(una.LOCID) === plantaRaiz)
      .filter((una) => {
        const cSid = texto(una.SOURCEID)
        if (!cSid || recetasYaPuestas[cSid]) return false
        recetasYaPuestas[cSid] = true
        return true
      })

    const hoja = {
      id: idHijo(nodo.id, ranura, `hoja-${compPrd}`),
      tipo: TIPOS.hoja,
      receta: '',
      prdid: compPrd,
      ...datos,
      planta: plantaRaiz,
      plantaRaiz,
      nivel: nodo.nivel + 1,
      coeficienteDeSalida: '',
      coeficienteDeEntrada: coeficiente,
      esAlternativo,
      recetaDelPadre: nodo.receta,
      recursos: [],
      coproductos: [],
      hijos: [],
      sePuedeAbrir: false,
    }

    const puestos = []
    for (const una of suyas) {
      const hijo = armarNodo(texto(una.SOURCEID), {
        nivel: nodo.nivel + 1,
        visitados: nodo.camino ?? {},
        prdMostrado: compPrd,
        locRaiz: plantaRaiz,
        indices,
        idPadre: nodo.id,
        ranura,
      })
      if (!hijo) continue

      hijo.coeficienteDeEntrada = coeficiente
      hijo.unidad = datos.unidad
      hijo.esAlternativo = esAlternativo
      hijo.recetaDelPadre = nodo.receta

      if (hijo.tipo === TIPOS.ciclo) {
        ciclos.push({ receta: hijo.receta, prdid: hijo.prdid, planta: plantaRaiz, desde: nodo.receta })
      } else {
        hijo.tipo = TIPOS.componente
      }
      puestos.push(hijo)
    }

    // Regla 5: sin receta en esta planta, es una hoja. También si ninguna de sus recetas se pudo armar.
    hijos.push(...(puestos.length > 0 ? puestos : [hoja]))
  }

  nodo.hijos = hijos
  return ciclos
}

/** Suelta el subárbol de un nodo colapsado, para que el recolector se lo lleve. */
export function soltarHijos(nodo) {
  if (!nodo?.sePuedeAbrir) return
  for (const hijo of nodo.hijos ?? []) soltarHijos(hijo)
  nodo.hijos = null
}

/**
 * Las raíces del árbol, agrupadas por planta.
 *
 * Reglas 3 y 4: un producto es raíz en su planta si no es componente de nadie ahí, y cada receta se
 * construye una sola vez por planta aunque figure bajo varios productos.
 */
export function raicesPorPlanta(indices) {
  const porPlanta = {}

  // Primero se junta, por receta y planta, con qué productos podría encabezarse. Después se elige uno.
  // v7 recorría los productos en orden alfabético y se quedaba con el primero que pillaba, así que la
  // raíz de una receta con coproductos la decidía el nombre: una receta cuyo producto principal es
  // `TERMINADO` y su coproducto `ASERRIN` salía encabezada por el aserrín. La información era la
  // misma —el otro aparecía como coproducto— pero al revés, y cambiaba al renombrar un material.
  const candidatas = new Map()

  for (const prd of Object.keys(indices.hdrPorPrd).sort()) {
    for (const cabecera of indices.hdrPorPrd[prd]) {
      const planta = texto(cabecera.LOCID)
      const receta = texto(cabecera.SOURCEID)
      if (!planta || !receta) continue

      // Regla 3, por producto y planta: ser componente aquí lo descalifica como raíz aquí.
      if (indices.esComponenteEn[claveDePlanta(planta, prd)]) continue

      const clave = `${planta}|${receta}`
      const suya = candidatas.get(clave) ?? { planta, receta, principal: '', coproductos: [] }

      if (texto(cabecera.SOURCETYPE) === 'C') suya.coproductos.push(prd)
      else if (!suya.principal) suya.principal = prd

      candidatas.set(clave, suya)
    }
  }

  for (const { planta, receta, principal, coproductos } of candidatas.values()) {
    // El producto principal encabeza si él mismo puede ser raíz. Si no —es componente aquí—, encabeza
    // el primer coproducto que sí pueda: la receta produce algo que nadie consume, y eso es una raíz.
    const prdMostrado = principal || coproductos[0]
    if (!prdMostrado) continue

    const nodo = armarNodo(receta, { nivel: 1, prdMostrado, locRaiz: planta, indices })
    if (!nodo) continue

    porPlanta[planta] = porPlanta[planta] ?? []
    porPlanta[planta].push(nodo)
  }

  // El orden de las raíces es el del producto que las encabeza, que es como se buscan.
  for (const planta of Object.keys(porPlanta)) {
    porPlanta[planta].sort((a, b) => a.prdid.localeCompare(b.prdid))
  }

  const plantas = Object.keys(porPlanta).sort()
  return {
    plantas,
    porPlanta,
    resumen: Object.fromEntries(plantas.map((planta) => [planta, {
      raices: porPlanta[planta].length,
      descripcion: texto(indices.ubicaciones[planta]?.LOCDESCR) || planta,
    }])),
  }
}

/** Abre un subárbol entero. Devuelve todos los ciclos encontrados por el camino. */
export function abrirTodo(nodos, indices, ciclos = []) {
  for (const nodo of nodos ?? []) {
    ciclos.push(...armarHijos(nodo, indices))
    if (nodo.hijos?.length) abrirTodo(nodo.hijos, indices, ciclos)
  }
  return ciclos
}

/** Cuántos niveles tiene un subárbol ya abierto. */
export function profundidad(nodo) {
  if (!nodo?.hijos?.length) return 1
  return 1 + Math.max(...nodo.hijos.map(profundidad))
}

/** Busca un nodo por su identificador dentro de un bosque ya abierto. */
export function buscarNodo(nodos, id) {
  for (const nodo of nodos ?? []) {
    if (nodo.id === id) return nodo
    const dentro = buscarNodo(nodo.hijos, id)
    if (dentro) return dentro
  }
  return null
}
