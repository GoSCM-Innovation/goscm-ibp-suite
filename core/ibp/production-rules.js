// Qué se le exige a un producto según lo que ES.
//
// Portado de `mattype-config.js` de v7. Es la pieza con más criterio de negocio de todo el proyecto y
// la que menos código tiene: la matriz de abajo es el juicio de un consultor puesto en una tabla.
//
// El problema que resuelve: un análisis de calidad de datos que trate a todos los materiales igual no
// sirve. Exigirle una receta a una materia prima da miles de errores falsos; no exigírsela a un
// producto terminado deja pasar el error de verdad. Así que primero se dice QUÉ es cada tipo de
// material del tenant —y eso lo dice el consultor, no se adivina— y de ahí sale qué se le exige.
//
// Los tipos de material son del cliente (`FERT`, `HALB`, `ROH`, `ZEMP`…), así que la clasificación se
// hace una vez por área de planificación y se guarda.

/** Las cuatro categorías, con lo que significan y lo que se les exige. */
export const CATEGORIAS = Object.freeze([
  {
    id: 'finished',
    etiqueta: 'Producto terminado',
    descripcion: 'Se fabrica internamente y se entrega al cliente.',
    exige: [
      'Receta completa: cabecera y componentes',
      'Recurso productivo asignado',
      'Su planta tiene que ser origen en la red',
      'Plazo de producción distinto de cero',
      'Cobertura en Location Product',
    ],
  },
  {
    id: 'semi',
    etiqueta: 'Semiterminado',
    descripcion: 'Se fabrica internamente para alimentar otro proceso; no se entrega al cliente.',
    exige: [
      'Receta completa y recurso',
      'Producir y consumir en la misma planta está bien',
      'Producir en una planta y transferir a otra que lo consume, también',
      'Producir sin consumo local ni transferencia es un problema',
      'Plazo de producción en cero es un aviso, no un error',
    ],
  },
  {
    id: 'rawmat',
    etiqueta: 'Materia prima o insumo',
    descripcion: 'Se compra fuera; no se fabrica ni se transforma.',
    exige: [
      'NO necesita receta ni recurso',
      'Tiene que existir un arco de proveedor hacia cada planta que lo consume',
      'No se le mira el plazo de producción',
      'Que tenga receta es un aviso: algo está mal clasificado',
    ],
  },
  {
    id: 'trading',
    etiqueta: 'Mercadería',
    descripcion: 'Se compra y se revende sin transformarlo.',
    exige: [
      'NO necesita receta ni recurso',
      'Tiene que tener arcos en la red: origen y destino',
      'No se le mira el plazo de producción',
      'Que tenga receta es un aviso',
    ],
  },
])

export const IDS_DE_CATEGORIA = Object.freeze(CATEGORIAS.map((una) => una.id))

/** Las severidades, de la más grave a «no se mira». */
export const SEVERIDADES = Object.freeze(['red', 'yel', 'info', 'none'])

/**
 * La matriz: qué severidad tiene cada comprobación para cada categoría.
 *
 * `none` quiere decir «a este tipo de material no se le pide esto», y es tan importante como el rojo:
 * es lo que evita que una materia prima salga con veinte errores por no tener receta.
 *
 * Los nombres de las comprobaciones son los de v7 para que se pueda seguir el rastro.
 */
export const MATRIZ = Object.freeze({
  // finished, semi, rawmat, trading
  requiresPSH: ['red', 'red', 'none', 'none'],
  requiresPSI: ['red', 'red', 'none', 'none'],
  requiresPSR: ['red', 'red', 'none', 'none'],
  requiresPlantAsOrigin: ['red', 'none', 'none', 'none'],
  requiresVendorArc: ['none', 'none', 'red', 'none'],
  requiresAnyOriginDest: ['none', 'none', 'none', 'red'],
  pleadtimeZero: ['red', 'yel', 'none', 'none'],
  outputCoeffZero: ['red', 'yel', 'none', 'none'],
  isCoproductOnly: ['yel', 'yel', 'none', 'none'],
  hasPSHUnexpected: ['none', 'none', 'yel', 'yel'],
  notConsumedInBOM: ['none', 'yel', 'yel', 'none'],
  tleadtimeZero: ['yel', 'yel', 'yel', 'yel'],
  semiSinSalida: ['none', 'red', 'none', 'none'],
})

/** Lo que se le exige a TODOS, sin importar la categoría. */
export const SIEMPRE = Object.freeze({ requiresLocPrd: 'red' })

/** Qué dice cada comprobación cuando falla. En español, que es lo que se lee en el informe. */
export const TEXTOS = Object.freeze({
  requiresLocPrd: 'Sin cobertura en Location Product',
  requiresPSH: 'Sin receta propia (no tiene cabecera de producción)',
  requiresPSI: 'Tiene receta pero sin componentes',
  requiresPSR: 'Tiene receta pero sin recurso productivo asignado',
  requiresPlantAsOrigin: 'Su planta productora no es origen en la red',
  requiresVendorArc: 'Sin arco de abastecimiento hacia la planta que lo consume',
  requiresAnyOriginDest: 'Sin arcos en la red: ni origen ni destino',
  pleadtimeZero: 'Plazo de producción en cero',
  outputCoeffZero: 'Coeficiente de salida en cero',
  isCoproductOnly: 'Solo existe como coproducto de otra receta',
  hasPSHUnexpected: 'Tiene receta y por su tipo no debería',
  notConsumedInBOM: 'No lo consume ninguna receta',
  tleadtimeZero: 'Plazo de transporte en cero',
  semiSinSalida: 'Se produce y no se consume ni se transfiere a ninguna parte',
})

/**
 * La severidad más PERMISIVA de varias.
 *
 * Un tipo de material puede estar en más de una categoría —hay tenants donde `HALB` es a la vez
 * semiterminado y mercadería— y entonces gana la exigencia más suave. Es a propósito: marcar en rojo
 * algo que en una de sus lecturas es correcto llena el informe de ruido, y un informe con ruido no se
 * lee. v7 tomaba la misma decisión.
 */
export function laMasPermisiva(severidades) {
  let mejor = 'red'
  for (const una of severidades ?? []) {
    if (SEVERIDADES.indexOf(una) > SEVERIDADES.indexOf(mejor)) mejor = una
  }
  return mejor
}

/**
 * Las reglas que aplican a un tipo de material, según las categorías que se le hayan puesto.
 *
 * Sin categoría, todo lo que alguna categoría exigiría pasa a ser AVISO. No se calla —un tipo sin
 * clasificar puede esconder los peores problemas— pero tampoco se marca en rojo, porque nadie ha
 * dicho todavía qué es ese material y un rojo sin fundamento se ignora.
 */
export function reglasDe(categorias) {
  const suyas = (categorias ?? []).filter((una) => IDS_DE_CATEGORIA.includes(una))
  const sinClasificar = suyas.length === 0

  const reglas = { ...SIEMPRE }

  for (const [comprobacion, porCategoria] of Object.entries(MATRIZ)) {
    if (sinClasificar) {
      const alguienLaPide = porCategoria.some((una) => una !== 'none')
      reglas[comprobacion] = alguienLaPide ? 'yel' : 'none'
      continue
    }
    reglas[comprobacion] = laMasPermisiva(
      suyas.map((cat) => porCategoria[IDS_DE_CATEGORIA.indexOf(cat)]),
    )
  }

  return reglas
}

/**
 * La configuración inicial de los tipos de material de un tenant.
 *
 * Se arranca con todos INCLUIDOS y sin categoría: excluir algo o clasificarlo es una decisión, y
 * tomarla por el consultor sería justo el error que este módulo existe para evitar.
 */
export function configuracionInicial(cuentaPorTipo) {
  const salida = {}
  for (const [tipo, cuantos] of Object.entries(cuentaPorTipo ?? {})) {
    if (!tipo) continue
    salida[tipo] = { excluido: false, categorias: [], productos: cuantos }
  }
  return salida
}

/** Los tipos que se van a analizar, y los que se dejaron fuera. */
export function repartirTipos(configuracion) {
  const dentro = []
  const fuera = []
  for (const [tipo, suya] of Object.entries(configuracion ?? {})) {
    (suya?.excluido ? fuera : dentro).push(tipo)
  }
  return { dentro: dentro.sort(), fuera: fuera.sort() }
}

/** Cuántos tipos hay sin clasificar. Es lo primero que hay que saber antes de leer un informe. */
export function sinClasificar(configuracion) {
  return Object.entries(configuracion ?? {})
    .filter(([, suya]) => !suya?.excluido && (suya?.categorias?.length ?? 0) === 0)
    .map(([tipo]) => tipo)
    .sort()
}
