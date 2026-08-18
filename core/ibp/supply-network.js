// La red de suministro de un producto: de dónde sale, por dónde pasa y a quién llega.
//
// Portado de `visualizer.js` de v7. Aquí está el grafo —quién es quién y qué arco va con qué—, y el
// dibujo queda en la pantalla. v7 mezclaba las dos cosas y además metía los colores y las formas de
// `vis-network` dentro de la lógica, así que no se podía comprobar nada sin montar un lienzo.
//
// El grafo tiene cinco clases de nodo y son cinco cosas distintas del negocio:
//
//   PRODUCTO   el que se está mirando. Es el centro: la red es SUYA, no del tenant.
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
//      v7 tenía las dos vías, y en la segunda cortaba a los 100 primeros componentes para no pasarse
//      del largo de una URL de OData. Aquí se lee de la base local, así que no hay tope: v7 perdía en
//      silencio los proveedores de una receta con más de cien materiales.
//   3. Los arcos de un mismo proveedor a una misma planta se juntan en UNO que lista los componentes.
//      Un proveedor que trae once materiales son once flechas idénticas encima de la misma.

/** Un valor de SAP como texto limpio. */
export const texto = (valor) => String(valor ?? '').trim()

/** Las clases de nodo. Se exportan porque la pantalla les pone color y forma. */
export const CLASES = Object.freeze({
  producto: 'PRODUCTO',
  planta: 'PLANTA',
  ubicacion: 'UBICACION',
  proveedor: 'PROVEEDOR',
  cliente: 'CLIENTE',
})

/** Las clases de arco, por lo que significan. */
export const ARCOS = Object.freeze({
  fabricacion: 'FABRICACION',
  transporte: 'TRANSPORTE',
  suministro: 'SUMINISTRO',
  entrega: 'ENTREGA',
})

/** El valor con el que SAP marca una ubicación de proveedor. */
export const TIPO_PROVEEDOR = 'V'

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

/**
 * Un plazo o un coeficiente como se lee.
 *
 * SAP los manda con seis decimales: `10.000000`, `0.142857`. Enseñarlos así hace que un plazo de diez
 * días parezca un número de serie. Es la misma decisión que en el visor de cifras clave.
 */
export function plazoLegible(valor) {
  const crudo = texto(valor)
  if (!crudo) return ''
  const suelto = Number.parseFloat(crudo.replace(',', '.'))
  return Number.isFinite(suelto) ? suelto.toLocaleString('es', { maximumFractionDigits: 3 }) : crudo
}

/** El nombre de algo, o su propio código si el maestro no lo trae. */
const nombreDe = (fila, campo, id) => texto(fila?.[campo]) || texto(id)

/**
 * Arma la red de UN producto.
 *
 * `datos` son las filas ya leídas y filtradas por ese producto:
 *   `plantas`   filas de recetas por planta (LOCID, PLEADTIME)
 *   `arcos`     arcos del PRODUCTO entre ubicaciones (LOCFR → LOCID, TLEADTIME)
 *   `arcosDeComponentes` arcos de sus materiales, que es de donde salen los proveedores
 *   `clientes`  arcos a clientes (LOCID → CUSTID, CLEADTIME)
 *   `componentes` componentes de las recetas (SOURCEID, PRDID) — para la regla 2
 *   `ubicaciones` y `maestroDeClientes`, los maestros por identificador
 *
 * Devuelve nodos y arcos sin repetir, y un resumen de cuántos hay de cada clase.
 */
export function armarRed(prdid, datos = {}) {
  const producto = texto(prdid)
  const ubicaciones = datos.ubicaciones ?? {}
  const clientesMaestro = datos.maestroDeClientes ?? {}

  const nodos = new Map()
  const arcos = new Map()

  // Las plantas donde este producto se fabrica. Es lo que decide la clase de cada ubicación (regla 1)
  // y a qué destinos se permite un arco de proveedor (regla 2).
  const plantas = new Set()
  const recetaDePlanta = {}
  for (const fila of datos.plantas ?? []) {
    const loc = texto(fila.LOCID)
    const receta = texto(fila.SOURCEID)
    if (!loc) continue
    plantas.add(loc)
    if (receta) recetaDePlanta[receta] = loc
  }

  // Regla 2: qué componentes lleva la receta de cada planta.
  const componentesDePlanta = {}
  for (const fila of datos.componentes ?? []) {
    const planta = recetaDePlanta[texto(fila.SOURCEID)]
    const componente = texto(fila.PRDID)
    if (!planta || !componente) continue
    componentesDePlanta[planta] = componentesDePlanta[planta] ?? new Set()
    componentesDePlanta[planta].add(componente)
  }

  const ponerNodo = (id, clase, extra = {}) => {
    const clave = texto(id)
    if (!clave || nodos.has(clave)) return clave
    nodos.set(clave, { id: clave, clase, nombre: clave, ...extra })
    return clave
  }

  const ponerUbicacion = (locid) => {
    const id = texto(locid)
    if (!id) return null
    const clase = claseDeUbicacion(id, { ubicaciones, plantas })
    const fila = ubicaciones[id]
    if (!nodos.has(id)) {
      nodos.set(id, {
        id,
        clase,
        nombre: nombreDe(fila, 'LOCDESCR', id),
        plazo: clase === CLASES.planta ? plazoLegible(datos.plazoDePlanta?.[id]) : '',
      })
    }
    return id
  }

  const ponerArco = (desde, hasta, clase, detalle) => {
    if (!desde || !hasta) return
    const clave = `${desde}->${hasta}`
    // El primero gana: un arco de suministro no se degrada a transporte por aparecer dos veces.
    if (arcos.has(clave)) return
    arcos.set(clave, { id: clave, desde, hasta, clase, detalle: detalle ?? '' })
  }

  // El producto, en el centro.
  if (producto) {
    ponerNodo(producto, CLASES.producto, {
      nombre: nombreDe(datos.producto, 'PRDDESCR', producto),
    })
  }

  // Las plantas, y su arco al producto: ahí se fabrica.
  for (const loc of [...plantas].sort()) {
    ponerUbicacion(loc)
    const plazo = datos.plazoDePlanta?.[loc] ?? ''
    if (producto) {
      ponerArco(loc, producto, ARCOS.fabricacion,
        plazo ? `Fabricación: ${plazoLegible(plazo)}` : 'Fabricación')
    }
  }

  // Los arcos entre ubicaciones. Si vienen de un proveedor, son de suministro y llevan otra regla.
  //
  // Se decide ANTES de crear los nodos, no después: un arco descartado que ya hubiera creado su nodo
  // deja un proveedor colgado en una esquina sin ninguna flecha. Eso es justo el ruido que v7 dibujaba
  // y nadie sabía de dónde salía.
  const suministros = new Map()

  /** Anota un arco de suministro, juntando lo que trae ese proveedor a esa planta (regla 3). */
  const anotarSuministro = (desde, hasta, material, plazo) => {
    const clave = `${desde}->${hasta}`
    const suyo = suministros.get(clave) ?? { desde, hasta, trae: [] }
    if (material) suyo.trae.push(plazo ? `${material} (${plazoLegible(plazo)})` : material)
    suministros.set(clave, suyo)
  }

  // Vía 1: los arcos del propio producto. Si vienen de un proveedor, es que alguien lo VENDE ya hecho.
  for (const fila of datos.arcos ?? []) {
    const desde = texto(fila.LOCFR)
    const hasta = texto(fila.LOCID)
    // Un arco necesita sus dos extremos. Con uno solo no es un arco, es una fila incompleta.
    if (!desde || !hasta) continue

    const plazo = texto(fila.TLEADTIME)

    if (claseDeUbicacion(desde, { ubicaciones, plantas }) === CLASES.proveedor) {
      anotarSuministro(desde, hasta, texto(fila.PRDID) || producto, plazo)
      continue
    }

    ponerUbicacion(desde)
    ponerUbicacion(hasta)
    ponerArco(desde, hasta, ARCOS.transporte, plazo ? `Transporte: ${plazoLegible(plazo)}` : '')
  }

  // Vía 2: los arcos de sus materiales. Aquí sí muerde la condición de la planta.
  for (const fila of datos.arcosDeComponentes ?? []) {
    const desde = texto(fila.LOCFR)
    const hasta = texto(fila.LOCID)
    if (!desde || !hasta) continue
    if (claseDeUbicacion(desde, { ubicaciones, plantas }) !== CLASES.proveedor) continue

    // Solo hacia una planta que fabrique este producto, y solo si el material está en SU receta.
    if (!plantas.has(hasta)) continue
    const material = texto(fila.PRDID)
    const suyos = componentesDePlanta[hasta]
    if (material && suyos && !suyos.has(material)) continue

    anotarSuministro(desde, hasta, material, texto(fila.TLEADTIME))
  }

  for (const uno of suministros.values()) {
    ponerUbicacion(uno.desde)
    ponerUbicacion(uno.hasta)
    ponerArco(uno.desde, uno.hasta, ARCOS.suministro,
      uno.trae.length > 0 ? `Trae: ${uno.trae.join(', ')}` : 'Suministro')
  }

  // Los clientes.
  for (const fila of datos.clientes ?? []) {
    const cliente = texto(fila.CUSTID)
    if (!texto(fila.LOCID) || !cliente) continue
    const desde = ponerUbicacion(fila.LOCID)

    ponerNodo(cliente, CLASES.cliente, {
      nombre: nombreDe(clientesMaestro[cliente], 'CUSTDESCR', cliente),
    })
    const plazo = texto(fila.CLEADTIME)
    ponerArco(desde, cliente, ARCOS.entrega, plazo ? `Entrega: ${plazoLegible(plazo)}` : '')
  }

  return {
    producto,
    nodos: [...nodos.values()],
    arcos: [...arcos.values()],
    resumen: resumirRed([...nodos.values()], [...arcos.values()]),
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

/**
 * Reparte los nodos en columnas, de origen a destino.
 *
 * Es la misma idea que en v7: proveedores a la izquierda, después las plantas, después las ubicaciones
 * por las que pasa, el producto, y los clientes a la derecha. Una red de suministro se lee así y no
 * como una nube: puesta al azar, una red de treinta nodos no dice nada.
 */
export const COLUMNAS = Object.freeze([
  CLASES.proveedor, CLASES.planta, CLASES.ubicacion, CLASES.producto, CLASES.cliente,
])

export function repartirEnColumnas(nodos) {
  const columnas = COLUMNAS.map((clase) => ({
    clase,
    nodos: (nodos ?? []).filter((uno) => uno.clase === clase)
      .sort((a, b) => a.id.localeCompare(b.id)),
  }))
  return columnas.filter((una) => una.nodos.length > 0)
}

/**
 * Los vecinos de un nodo, en los dos sentidos.
 *
 * Sirve para lo que en v7 era el panel de detalle: al pulsar una ubicación, de dónde le llega y a
 * dónde manda. Es la pregunta que se hace de verdad frente a una red grande.
 */
export function vecinosDe(id, arcos) {
  const clave = texto(id)
  const entran = []
  const salen = []

  for (const arco of arcos ?? []) {
    if (arco.hasta === clave) entran.push(arco)
    if (arco.desde === clave) salen.push(arco)
  }

  return { entran, salen }
}

/**
 * Los nodos que no se conectan con nada.
 *
 * En v7 aparecían y nadie los nombraba. Un nodo suelto en una red de suministro es un dato incompleto
 * —una ubicación sin arcos, un cliente sin ubicación que le sirva— y decirlo es más útil que dibujarlo
 * en una esquina.
 */
export function nodosSueltos(nodos, arcos) {
  const tocados = new Set()
  for (const arco of arcos ?? []) { tocados.add(arco.desde); tocados.add(arco.hasta) }
  return (nodos ?? []).filter((uno) => !tocados.has(uno.id))
}
