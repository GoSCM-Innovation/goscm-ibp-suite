// La red de suministro de un producto: de dónde sale, por dónde pasa y a quién llega.
//
// Portado de `visualizer.js` de v7 (`vizBuildGraph`, `vizAssignPositions`, `vizBuildGraphFromData`,
// `vizFindAllRoutes`, `vizOpenFilter`). Aquí está el grafo —quién es quién y qué arco va con qué—, y el
// dibujo queda en la pantalla. v7 mezclaba las dos cosas y además metía los colores y las formas de
// `vis-network` dentro de la lógica, así que no se podía comprobar nada sin montar un lienzo.
//
// IDÉNTICO A v7 (decisión del usuario, 2026-10-01: «Data Tools tiene que ser idéntico a v7»). Una
// versión anterior de este módulo añadió un nodo PRODUCTO en el centro con un arco «fabricación» desde
// cada planta, y los contaba en el resumen. v7 no los dibuja: el producto es de lo que trata la
// pantalla, no un nodo de la red, y «N nodos · M conexiones» tiene que decir lo mismo que en v7.
//
// El grafo tiene cuatro clases de nodo y son cuatro cosas distintas del negocio:
//
//   PLANTA     una ubicación donde ese producto se fabrica (tiene receta ahí).
//   UBICACION  un almacén o centro de distribución por donde pasa.
//   PROVEEDOR  una ubicación marcada `LOCTYPE = V` en SAP. De ahí entra lo que se compra.
//   CLIENTE    a quién se le entrega.
//
// Tres reglas que v7 tenía ganadas y que aquí van con prueba, porque son las que separan una red que
// se entiende de un plato de espaguetis:
//
//   1. Una ubicación NO se clasifica por su nombre ni por dónde aparece, sino por el maestro: si es
//      `LOCTYPE = V` es proveedor; si además fabrica el producto es planta; el resto, ubicación.
//   2. Los arcos de proveedor llegan por DOS vías, y son dos preguntas distintas:
//        - «quién me vende el producto terminado» — los arcos del propio producto que salen de una
//          ubicación de proveedor. Se dibujan sin más.
//        - «quién me vende los materiales» — los arcos de sus COMPONENTES. Estos solo se dibujan si
//          van a una planta Y si el material es de verdad componente de la receta DE ESA planta. Sin
//          esa condición, cualquier proveedor del tenant cuelga de cualquier planta.
//   3. Los arcos de un mismo proveedor a una misma planta se juntan en UNO que lista los componentes.
//      Un proveedor que trae once materiales son once flechas idénticas encima de la misma.

/** Un valor de SAP como texto limpio. */
export const texto = (valor) => String(valor ?? '').trim()

/** Las clases de nodo. Se exportan porque la pantalla les pone color y forma. */
export const CLASES = Object.freeze({
  planta: 'PLANTA',
  ubicacion: 'UBICACION',
  proveedor: 'PROVEEDOR',
  cliente: 'CLIENTE',
})

/** Las clases de arco, por lo que significan. */
export const ARCOS = Object.freeze({
  transporte: 'TRANSPORTE',
  suministro: 'SUMINISTRO',
  entrega: 'ENTREGA',
})

/** El valor con el que SAP marca una ubicación de proveedor. */
export const TIPO_PROVEEDOR = 'V'

/**
 * A partir de cuántos clientes se ocultan solos los que sobran (`VIZ_CUST_THRESHOLD` de v7).
 *
 * Dibujar mil clientes alrededor de una ubicación no se lee. v7 deja los 20 primeros por orden de
 * código y avisa de cuántos ocultó, para que se ajuste con «▼ Filtros».
 */
export const UMBRAL_DE_CLIENTES = 20

/** Con todas las clases a la vista, que es como arranca cada red. */
export const TODAS_VISIBLES = Object.freeze({
  [CLASES.planta]: true,
  [CLASES.ubicacion]: true,
  [CLASES.cliente]: true,
  [CLASES.proveedor]: true,
})

/**
 * Qué es una ubicación.
 *
 * Regla 1. El orden importa: una ubicación de proveedor que además tuviera receta seguiría siendo
 * proveedor, porque es de dónde entra el material y es lo que hay que ver.
 */
export function claseDeUbicacion(locid, { ubicaciones = {}, plantas = new Set() } = {}) {
  const id = texto(locid)
  if (!id) return null
  if (texto(ubicaciones[id]?.LOCTYPE) === TIPO_PROVEEDOR) return CLASES.proveedor
  if (plantas.has(id)) return CLASES.planta
  return CLASES.ubicacion
}

/** La descripción de una ubicación del maestro (`LOCDESCR`, o `LOCNAME` si el tenant la llama así). */
const descripcionDeUbicacion = (fila) => texto(fila?.LOCDESCR || fila?.LOCNAME || '')

/**
 * Las ubicaciones que son planta (`allPlantLocs` de v7).
 *
 * Si el producto tiene recetas propias, son sus plantas. Si no tiene —es un insumo—, v7 pregunta a
 * SAP qué plantas hay en los destinos de sus arcos (`plantasGlobales`), para que un insumo que llega
 * a una planta se pinte como planta y no como una ubicación cualquiera.
 */
export function plantasDetectadas(datos = {}) {
  const propias = new Set()
  for (const fila of datos.plantas ?? []) {
    const loc = texto(fila.LOCID)
    if (loc) propias.add(loc)
  }
  if (propias.size > 0) return propias
  return new Set((datos.plantasGlobales ?? []).map(texto).filter(Boolean))
}

/**
 * Arma la red de UN producto.
 *
 * `datos` son las filas ya leídas y filtradas por ese producto:
 *   `plantas`   filas de recetas por planta (SOURCEID, LOCID, PLEADTIME)
 *   `arcos`     arcos del PRODUCTO entre ubicaciones (LOCFR → LOCID, TLEADTIME)
 *   `arcosDeComponentes` arcos de sus materiales, que es de donde salen los proveedores
 *   `clientes`  arcos a clientes (LOCID → CUSTID, CLEADTIME)
 *   `componentes` componentes de las recetas (SOURCEID, PRDID) — para la regla 2
 *   `ubicaciones` y `maestroDeClientes`, los maestros por identificador
 *   `plantasGlobales` las plantas detectadas cuando el producto no tiene recetas propias
 *
 * `filtros`:
 *   `visibles`            qué clases están encendidas en la leyenda (por defecto, todas)
 *   `ubicacionesOcultas`  ubicaciones que el usuario apagó en «Filtros de red»
 *   `clientesOcultos`     clientes apagados, a mano o por el umbral
 *
 * Una clase apagada en la leyenda NO quita los nodos: los marca `oculto`, para poder volver a
 * encenderlos sin recalcular la disposición. La excepción es el proveedor, cuyos arcos no se crean
 * apagado — es lo que hace v7 y se conserva. Lo que apaga «Filtros de red» sí se quita de la red.
 *
 * Devuelve nodos (con `x` e `y` ya puestos) y arcos sin repetir, y un resumen de cuántos hay.
 */
export function armarRed(prdid, datos = {}, filtros = {}) {
  const producto = texto(prdid)
  const ubicaciones = datos.ubicaciones ?? {}
  const clientesMaestro = datos.maestroDeClientes ?? {}
  const visibles = { ...TODAS_VISIBLES, ...(filtros.visibles ?? {}) }
  const ubicacionesOcultas = filtros.ubicacionesOcultas ?? new Set()
  const clientesOcultos = filtros.clientesOcultos ?? new Set()
  const plantas = plantasDetectadas(datos)

  const nodos = new Map()
  const arcos = new Map()

  /** El primero gana: una planta que ya está no se vuelve ubicación por aparecer en un arco. */
  const ponerNodo = (id, clase, etiqueta, titulo, nombre) => {
    if (nodos.has(id)) return
    nodos.set(id, {
      id, clase, nombre, etiqueta, titulo, oculto: visibles[clase] === false,
    })
  }

  const ponerArco = (desde, hasta, clase, detalle) => {
    const id = `${desde}->${hasta}`
    if (arcos.has(id)) return
    arcos.set(id, { id, desde, hasta, clase, detalle, titulo: detalle || `${desde} → ${hasta}` })
  }

  const claseDe = (id) => claseDeUbicacion(id, { ubicaciones, plantas })
  const NOMBRE = {
    [CLASES.proveedor]: 'Proveedor',
    [CLASES.planta]: 'Planta',
    [CLASES.ubicacion]: 'Ubicación',
    [CLASES.cliente]: 'Cliente',
  }

  /** Pone una ubicación con la etiqueta y el globo de ayuda de v7. */
  const ponerUbicacion = (id, clase) => {
    const descr = descripcionDeUbicacion(ubicaciones[id])
    ponerNodo(
      id, clase,
      id + (descr ? `\n${descr}` : ''),
      `${NOMBRE[clase] ?? NOMBRE[CLASES.ubicacion]}: ${id}${descr ? `\n${descr}` : ''}`,
      descr,
    )
  }

  // Las plantas, con su plazo de producción.
  for (const fila of datos.plantas ?? []) {
    const loc = texto(fila.LOCID)
    if (!loc) continue
    const descr = descripcionDeUbicacion(ubicaciones[loc])
    const plazo = texto(fila.PLEADTIME)
    ponerNodo(
      loc, CLASES.planta,
      loc + (descr ? `\n${descr}` : ''),
      `Planta: ${loc}${descr ? `\n${descr}` : ''}${plazo ? `\nLead time producción: ${plazo}` : ''}`,
      descr,
    )
  }

  // Los arcos entre ubicaciones (LOCFR → LOCID). Si salen de un proveedor, son de suministro.
  for (const fila of datos.arcos ?? []) {
    const desde = texto(fila.LOCFR)
    const hasta = texto(fila.LOCID)
    // Un arco necesita sus dos extremos. Con uno solo no es un arco, es una fila incompleta.
    if (!desde || !hasta) continue
    if (ubicacionesOcultas.has(desde) || ubicacionesOcultas.has(hasta)) continue

    const claseDesde = claseDe(desde)
    const claseHasta = claseDe(hasta)
    const plazo = texto(fila.TLEADTIME)

    // Se decide ANTES de crear los nodos: un arco descartado que ya hubiera creado su nodo deja un
    // proveedor colgado en una esquina sin ninguna flecha.
    if (claseDesde === CLASES.proveedor && visibles[CLASES.proveedor] === false) continue

    ponerUbicacion(desde, claseDesde)
    ponerUbicacion(hasta, claseHasta)

    if (claseDesde === CLASES.proveedor) {
      const insumo = texto(fila.PRDID)
      ponerArco(desde, hasta, ARCOS.suministro,
        (insumo ? `Insumo: ${insumo}` : '') + (plazo ? `${insumo ? ' ' : ''}[LT:${plazo}]` : ''))
    } else {
      ponerArco(desde, hasta, ARCOS.transporte, plazo ? `Lead time transporte: ${plazo}` : '')
    }
  }

  // Los clientes (LOCID → CUSTID).
  for (const fila of datos.clientes ?? []) {
    const loc = texto(fila.LOCID)
    const cliente = texto(fila.CUSTID)
    if (!loc || !cliente) continue
    if (clientesOcultos.has(cliente) || ubicacionesOcultas.has(loc)) continue

    const descr = texto(clientesMaestro[cliente]?.CUSTDESCR)
    const plazo = texto(fila.CLEADTIME)

    ponerUbicacion(loc, claseDe(loc))
    ponerNodo(
      cliente, CLASES.cliente,
      cliente + (descr ? `\n${descr}` : ''),
      `Cliente: ${cliente}${descr ? `\n${descr}` : ''}`,
      descr,
    )
    ponerArco(loc, cliente, ARCOS.entrega, plazo ? `Lead time cliente: ${plazo}` : '')
  }

  // Vía 2 de la regla 2: los arcos de los materiales, agrupados por proveedor y planta.
  if ((datos.arcosDeComponentes ?? []).length > 0) {
    const plantasPropias = new Set((datos.plantas ?? []).map((fila) => texto(fila.LOCID)).filter(Boolean))

    // Qué componentes lleva la receta de cada planta. Con esto se descarta el proveedor de un material
    // que esa planta no usa.
    const recetaDePlanta = {}
    for (const fila of datos.plantas ?? []) {
      const receta = texto(fila.SOURCEID)
      const loc = texto(fila.LOCID)
      if (receta && loc) recetaDePlanta[receta] = loc
    }
    const componentesDePlanta = {}
    for (const fila of datos.componentes ?? []) {
      const planta = recetaDePlanta[texto(fila.SOURCEID)]
      const componente = texto(fila.PRDID)
      if (!planta || !componente) continue
      componentesDePlanta[planta] = componentesDePlanta[planta] ?? {}
      componentesDePlanta[planta][componente] = true
    }

    const grupos = new Map()
    for (const fila of datos.arcosDeComponentes) {
      const proveedor = texto(fila.LOCFR)
      const destino = texto(fila.LOCID)
      const material = texto(fila.PRDID)
      if (!proveedor || !destino) continue
      if (texto(ubicaciones[proveedor]?.LOCTYPE) !== TIPO_PROVEEDOR) continue
      // Solo hacia una planta que fabrique este producto…
      if (!plantasPropias.has(destino)) continue
      // …y solo si el material es de la receta DE ESA planta.
      if (material && componentesDePlanta[destino] && !componentesDePlanta[destino][material]) continue
      if (visibles[CLASES.proveedor] === false) continue

      const clave = `${proveedor}->${destino}`
      if (!grupos.has(clave)) grupos.set(clave, { proveedor, destino, trae: [] })
      const plazo = texto(fila.TLEADTIME)
      grupos.get(clave).trae.push(material + (plazo ? ` [LT:${plazo}]` : ''))
    }

    for (const grupo of grupos.values()) {
      ponerUbicacion(grupo.proveedor, CLASES.proveedor)
      ponerArco(grupo.proveedor, grupo.destino, ARCOS.suministro, `Componentes: ${grupo.trae.join(', ')}`)
    }
  }

  const listaDeNodos = colocarNodos([...nodos.values()], datos)
  const listaDeArcos = [...arcos.values()]

  return {
    producto,
    nodos: listaDeNodos,
    arcos: listaDeArcos,
    resumen: resumirRed(listaDeNodos, listaDeArcos),
  }
}

/** Cuántos nodos de cada clase y cuántos arcos de cada tipo. */
export function resumirRed(nodos, arcos) {
  const porClase = {}
  for (const nodo of nodos ?? []) porClase[nodo.clase] = (porClase[nodo.clase] ?? 0) + 1

  const porArco = {}
  for (const arco of arcos ?? []) porArco[arco.clase] = (porArco[arco.clase] ?? 0) + 1

  return { nodos: (nodos ?? []).length, arcos: (arcos ?? []).length, porClase, porArco }
}

// ── Lo que alimenta el detalle del nodo y los «Filtros de red» ───────────────────────────────────

/**
 * Los materiales que un proveedor abastece: los de sus arcos de componentes y de los del producto.
 *
 * Es el «Insumos abastecidos (N):» del detalle de un proveedor en v7. Se lee de las filas y no del
 * dibujo, así que sale aunque el arco del material no haya pasado la regla 2.
 */
export function insumosDeProveedor(id, datos = {}) {
  const proveedor = texto(id)
  const vistos = new Set()
  for (const fila of [...(datos.arcosDeComponentes ?? []), ...(datos.arcos ?? [])]) {
    if (texto(fila.LOCFR) !== proveedor) continue
    const material = texto(fila.PRDID)
    if (material) vistos.add(material)
  }
  return [...vistos].sort()
}

/** Las ubicaciones que se pueden apagar: las de los arcos y las que sirven a clientes. */
export function ubicacionesParaFiltro(datos = {}) {
  const ids = new Set()
  for (const fila of datos.arcos ?? []) {
    if (fila.LOCFR) ids.add(texto(fila.LOCFR))
    if (fila.LOCID) ids.add(texto(fila.LOCID))
  }
  for (const fila of datos.clientes ?? []) if (fila.LOCID) ids.add(texto(fila.LOCID))
  return [...ids].sort().map((id) => ({
    id, descr: texto(datos.ubicaciones?.[id]?.LOCDESCR),
  }))
}

/** Los clientes que se pueden apagar. */
export function clientesParaFiltro(datos = {}) {
  const ids = new Set()
  for (const fila of datos.clientes ?? []) if (fila.CUSTID) ids.add(texto(fila.CUSTID))
  return [...ids].sort().map((id) => ({
    id, descr: texto(datos.maestroDeClientes?.[id]?.CUSTDESCR),
  }))
}

/**
 * Los clientes que se ocultan solos: los que pasan del umbral, por orden de código.
 *
 * Devuelve la lista (vacía si no se pasa del umbral). La cuenta de ocultos es su largo.
 */
export function clientesQueSobran(datos = {}, umbral = UMBRAL_DE_CLIENTES) {
  const todos = clientesParaFiltro(datos).map((uno) => uno.id)
  return todos.length > umbral ? todos.slice(umbral) : []
}

/**
 * Si un texto coincide con lo que se escribió en el buscador de los filtros.
 *
 * Sin `*` busca el trozo en cualquier parte; con `*`, el patrón es el texto ENTERO (`*T1` termina en
 * T1, `T1*` empieza por T1, `*US*` lo contiene). No distingue mayúsculas. Es `vizGlobMatch` de v7.
 */
export function coincideConComodin(valor, patron) {
  if (!patron) return true
  const t = String(valor ?? '').toLowerCase()
  const p = String(patron ?? '').toLowerCase().trim()
  if (!p) return true
  if (!p.includes('*')) return t.includes(p)
  const expresion = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  try {
    return new RegExp(`^${expresion}$`).test(t)
  } catch {
    return t.includes(p.replace(/\*/g, ''))
  }
}

// ── Dónde va cada nodo en el lienzo ──────────────────────────────────────────────────────────────
//
// Portado de `vizAssignPositions` de `visualizer.js` de v7, con sus mismas medidas Y SUS MISMOS
// CRITERIOS de orden.
//
// v7 dibujaba con una librería de red pero con la física APAGADA: las posiciones se calculan aquí y
// el lienzo solo las pinta. Es una decisión suya y es la correcta — una red con física se recoloca
// sola cada vez que se abre, así que dos personas mirando el mismo producto ven dibujos distintos y
// ninguna puede señalar «el nodo de arriba a la izquierda».
//
// Dentro de cada columna las filas se ordenan por BARICENTRO: cada nodo se pone a la altura media de
// los nodos con los que está conectado en la columna anterior. Es lo que evita que la red se
// convierta en una maraña de líneas cruzadas. Se hace en cadena —plantas primero, después los
// proveedores, después las ubicaciones, después los clientes— porque cada paso necesita que el
// anterior ya esté colocado. Las conexiones se leen de las FILAS de SAP y no del dibujo, como en v7.

/** El ancho de una columna, en píxeles del lienzo. */
export const ANCHO_DE_COLUMNA = 260

/** El alto de una fila. */
export const ALTO_DE_FILA = 80

/** Cuántas filas caben en una columna antes de partirla en dos. */
export const FILAS_POR_COLUMNA = 8

/** Reparte una lista en columnas, centradas verticalmente. */
function colocar(lista, xInicial, cuantasColumnas) {
  if (lista.length === 0) return
  const porColumna = Math.ceil(lista.length / cuantasColumnas)
  lista.forEach((nodo, indice) => {
    const columna = Math.floor(indice / porColumna)
    const fila = indice % porColumna
    const enEsta = Math.min(porColumna, lista.length - columna * porColumna)
    nodo.x = xInicial + columna * ANCHO_DE_COLUMNA
    nodo.y = (fila - (enEsta - 1) / 2) * ALTO_DE_FILA
  })
}

/** La altura media de los `destinos` que ya están colocados; cero si no tiene ninguno. */
function alturaMedia(destinos, alturas) {
  if (destinos.length === 0) return 0
  return destinos.reduce((suma, id) => suma + (alturas.get(id) || 0), 0) / destinos.length
}

/**
 * Devuelve los nodos con `x` e `y`, listos para el lienzo.
 *
 * No muta lo que recibe: se trabaja sobre copias.
 */
export function colocarNodos(nodos, datos = {}) {
  const copias = (nodos ?? []).map((uno) => ({ ...uno }))
  const de = (clase) => copias.filter((uno) => uno.clase === clase)

  const plantas = de(CLASES.planta)
  const proveedores = de(CLASES.proveedor)
  const ubicaciones = de(CLASES.ubicacion)
  const clientes = de(CLASES.cliente)

  const columnasProveedor = Math.max(1, Math.ceil(proveedores.length / FILAS_POR_COLUMNA))
  const columnasUbicacion = Math.max(1, Math.ceil(ubicaciones.length / FILAS_POR_COLUMNA))

  // Paso 1: las plantas son la columna ancla, en x = 0, por orden alfabético.
  plantas.sort((a, b) => a.id.localeCompare(b.id))
  colocar(plantas, 0, 1)
  const alturaDePlanta = new Map(plantas.map((uno) => [uno.id, uno.y]))
  const esPlanta = new Set(plantas.map((uno) => uno.id))

  // Paso 2: los proveedores, por la altura media de las plantas a las que abastecen.
  if (proveedores.length > 0 && plantas.length > 0) {
    const aPlantas = {}
    for (const fila of [...(datos.arcosDeComponentes ?? []), ...(datos.arcos ?? [])]) {
      const desde = texto(fila.LOCFR)
      const hasta = texto(fila.LOCID)
      if (desde && hasta && esPlanta.has(hasta) && !esPlanta.has(desde)) {
        (aPlantas[desde] ??= new Set()).add(hasta)
      }
    }
    proveedores.sort((a, b) => alturaMedia([...(aPlantas[a.id] ?? [])], alturaDePlanta)
      - alturaMedia([...(aPlantas[b.id] ?? [])], alturaDePlanta))
  }
  colocar(proveedores, -(columnasProveedor * ANCHO_DE_COLUMNA), columnasProveedor)

  // Paso 3: las ubicaciones, por la altura media de las plantas de las que les llega material.
  if (ubicaciones.length > 0 && plantas.length > 0) {
    const entran = {}
    for (const fila of datos.arcos ?? []) {
      const desde = texto(fila.LOCFR)
      const hasta = texto(fila.LOCID)
      if (desde && hasta) (entran[hasta] ??= new Set()).add(desde)
    }
    const deEstas = (id) => [...(entran[id] ?? [])].filter((origen) => alturaDePlanta.has(origen))
    ubicaciones.sort((a, b) => alturaMedia(deEstas(a.id), alturaDePlanta)
      - alturaMedia(deEstas(b.id), alturaDePlanta))
  }
  colocar(ubicaciones, ANCHO_DE_COLUMNA, columnasUbicacion)

  // Paso 4: los clientes, por la altura media de las ubicaciones que los sirven. Las plantas no
  // cuentan aquí —una planta que entrega directo suma cero—, como en v7.
  if (clientes.length > 0 && ubicaciones.length > 0) {
    const alturaDeUbicacion = new Map(ubicaciones.map((uno) => [uno.id, uno.y]))
    const sirven = {}
    for (const fila of datos.clientes ?? []) {
      const loc = texto(fila.LOCID)
      const cliente = texto(fila.CUSTID)
      if (loc && cliente) (sirven[cliente] ??= new Set()).add(loc)
    }
    clientes.sort((a, b) => alturaMedia([...(sirven[a.id] ?? [])], alturaDeUbicacion)
      - alturaMedia([...(sirven[b.id] ?? [])], alturaDeUbicacion))
  }
  colocar(clientes, ANCHO_DE_COLUMNA * (1 + columnasUbicacion), 1)

  return copias
}

// ── Las rutas de la red ──────────────────────────────────────────────────────────────────────────
//
// Portado de `vizBuildGraphFromData`, `vizFindAllRoutes` y `_vizOrphanPlants` de `visualizer.js`.
//
// QUÉ CONTESTA: el dibujo enseña la red; esto enseña si la red LLEVA A ALGUNA PARTE. Se recorre desde
// cada planta siguiendo los arcos de traslado hasta que la ruta termina, y cada final se clasifica:
//
//   - con cliente     — la ruta acaba entregando a alguien. Es la única que vale.
//   - sin salida      — el último nodo no manda a nadie («Dead-end»). El material llega ahí y se queda.
//   - ciclo           — todas las salidas que quedaban ya se habían visitado: la ruta se muerde la cola.
//
// Y de ahí sale lo que de verdad se busca: la PLANTA HUÉRFANA, aquella cuyo cien por cien de rutas
// termina sin cliente. Se fabrica y no llega a nadie, y en el dibujo no se ve —una planta huérfana
// tiene sus flechas como cualquier otra—.
//
// Como en v7, las rutas se calculan de las FILAS de SAP y no de lo que está dibujado: lo que se apaga
// en la leyenda o en los filtros no cambia el análisis.

/** El tope de rutas que se recorren. Una red con ciclos puede tener un número absurdo. */
export const TOPE_DE_RUTAS = 50_000

/** Cómo termina una ruta que no llega a ningún cliente. */
export const FINALES = Object.freeze({
  sinSalida: 'SIN_SALIDA',
  ciclo: 'CICLO',
})

/** Lo que el recorrido necesita de las filas: plantas, y a dónde va cada ubicación. */
function grafoParaRutas(datos = {}) {
  const plantas = []
  const vistas = new Set()
  for (const fila of datos.plantas ?? []) {
    const loc = texto(fila.LOCID)
    if (!loc || vistas.has(loc)) continue
    vistas.add(loc)
    plantas.push(loc)
  }

  const traslados = {}
  for (const fila of datos.arcos ?? []) {
    const desde = texto(fila.LOCFR)
    const hasta = texto(fila.LOCID)
    if (!desde || !hasta) continue
    const salidas = (traslados[desde] ??= [])
    if (!salidas.includes(hasta)) salidas.push(hasta)
  }

  const entregas = {}
  for (const fila of datos.clientes ?? []) {
    const desde = texto(fila.LOCID)
    const hasta = texto(fila.CUSTID)
    if (!desde || !hasta) continue
    const salidas = (entregas[desde] ??= [])
    if (!salidas.includes(hasta)) salidas.push(hasta)
  }

  return { plantas, traslados, entregas }
}

/**
 * Todas las rutas desde cada planta, clasificadas por cómo terminan.
 *
 * Devuelve `{ rutas, truncado, plantasHuerfanas }`. `truncado` avisa de que se llegó al tope: una
 * lista recortada presentada como completa diría que no hay más rutas cuando sí las hay.
 */
export function rutasDeLaRed(datos, { tope = TOPE_DE_RUTAS } = {}) {
  const { plantas, traslados, entregas } = grafoParaRutas(datos)

  const rutas = []
  let truncado = false

  const recorrer = (nodo, camino, visitados) => {
    if (rutas.length >= tope) { truncado = true; return }

    const aClientes = entregas[nodo] ?? []
    const todasLasSalidas = traslados[nodo] ?? []
    const salidas = todasLasSalidas.filter((otro) => !visitados.has(otro))

    if (aClientes.length === 0 && salidas.length === 0) {
      rutas.push({
        planta: camino[0],
        nodos: [...camino],
        cliente: null,
        llegaACliente: false,
        // Que quedaran salidas y todas estuvieran visitadas es un ciclo, no un final.
        final: todasLasSalidas.length > 0 ? FINALES.ciclo : FINALES.sinSalida,
        ultimo: nodo,
      })
      return
    }

    for (const cliente of aClientes) {
      if (rutas.length >= tope) { truncado = true; return }
      rutas.push({
        planta: camino[0],
        nodos: [...camino],
        cliente,
        llegaACliente: true,
        final: null,
        ultimo: nodo,
      })
    }

    for (const otro of salidas) {
      if (rutas.length >= tope) { truncado = true; return }
      visitados.add(otro)
      camino.push(otro)
      recorrer(otro, camino, visitados)
      camino.pop()
      visitados.delete(otro)
    }
  }

  for (const planta of plantas) {
    if (rutas.length >= tope) { truncado = true; break }
    recorrer(planta, [planta], new Set([planta]))
  }

  return { rutas, truncado, plantasHuerfanas: plantasHuerfanas(rutas) }
}

/**
 * Las plantas cuyo CIEN POR CIEN de rutas termina sin cliente.
 *
 * Una planta con nueve rutas muertas y una buena no es huérfana: lo que fabrica sale. La que no tiene
 * ninguna buena, sí. Salen en el orden en que aparecen sus rutas, como en v7.
 */
export function plantasHuerfanas(rutas) {
  const porPlanta = new Map()
  for (const ruta of rutas ?? []) {
    const suya = porPlanta.get(ruta.planta) ?? { total: 0, sinCliente: 0 }
    suya.total += 1
    if (!ruta.llegaACliente) suya.sinCliente += 1
    porPlanta.set(ruta.planta, suya)
  }

  return [...porPlanta.entries()]
    .filter(([, suya]) => suya.total > 0 && suya.total === suya.sinCliente)
    .map(([planta]) => planta)
}

/** Cuántas rutas hay de cada clase. Es el resumen de una línea del panel. */
export function resumirRutas(rutas) {
  const conCliente = (rutas ?? []).filter((una) => una.llegaACliente).length
  const sinSalida = (rutas ?? []).filter((una) => !una.llegaACliente && una.final === FINALES.sinSalida).length
  const ciclos = (rutas ?? []).filter((una) => !una.llegaACliente && una.final === FINALES.ciclo).length
  return { total: (rutas ?? []).length, conCliente, sinCliente: sinSalida + ciclos, sinSalida, ciclos }
}
