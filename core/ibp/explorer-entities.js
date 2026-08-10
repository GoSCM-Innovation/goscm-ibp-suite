// Qué entidad de ESTE tenant cumple cada papel que el explorador necesita.
//
// Portado de `autoDetectMDTs` y `autoDetectSNMDTs` de `main.js` de v7, que eran la misma función
// escrita dos veces. Aquí es una, usada tres veces, y eso arregla de paso un fallo que solo tenía
// una de las dos copias —ver más abajo—.
//
// EL PROBLEMA QUE RESUELVE, que es el del multi-tenant en su forma más incómoda: el explorador
// necesita "la tabla de productos", "la cabecera de receta de producción", "el maestro de
// ubicaciones". Ninguna se llama igual en dos tenants. En uno son `GIDPRODUCT` y
// `GIDPRODUCTIONSOURCEITM`; en otro `AS1PRODUCT` y `PI3PRODUCTIONSOURCEITM`. Y los campos tampoco:
// un tenant tiene `CLEADTIME` donde otro tiene `LEADTIME`, y hay campos que simplemente no existen.
//
// Así que no se puede codificar ningún nombre. Se deduce, se puntúa, y —esto es lo importante— quien
// mira puede corregirlo: la detección automática acierta casi siempre, pero "casi" no alcanza cuando
// de ello depende un análisis de calidad de datos que alguien va a llevar a una reunión.
//
// Sin dependencias: lo usan el servidor y la pantalla.

/** Las tablas de traducción de SAP, que se parecen a la buena y no lo son. */
const TABLA_DE_TRADUCCION = /(?:Trans|Texts?|Lang)$/i

export const esTablaDeTraduccion = (nombre) => TABLA_DE_TRADUCCION.test(String(nombre ?? ''))

/** Prefijos de entre dos y seis letras: es el rango en que los tenants los ponen. */
const PREFIJO_MIN = 2
const PREFIJO_MAX = 6

/**
 * El prefijo con que este tenant nombra sus tablas.
 *
 * Primero el prefijo común a todas: si el área declara `GIDPRODUCT`, `GIDLOCATION` y `GIDCUSTOMER`,
 * es `GID` y no hay más que discutir.
 *
 * Cuando no hay prefijo común —pasa en la versión base, donde se mezclan tablas de varias versiones—
 * se vota: cada nombre reparte votos entre sus prefijos posibles y gana el de mayor
 * `votos × longitud`, que premia al más específico. Con
 * `['AS1PRODUCT', 'AS1SOURCEPRODUCTION', 'PI3PRODUCTIONSOURCEITM']` gana `AS1` (2×3=6) sobre `PI3`
 * (1×3=3). Los que aparecen una sola vez no cuentan: un prefijo de un solo nombre no es un prefijo.
 */
export function prefijoDelTenant(nombres) {
  const lista = (nombres ?? []).map((uno) => String(uno ?? '').toUpperCase()).filter(Boolean)
  if (lista.length === 0) return ''

  let comun = lista[0]
  for (const nombre of lista) {
    let hasta = 0
    while (hasta < comun.length && hasta < nombre.length && comun[hasta] === nombre[hasta]) hasta += 1
    comun = comun.slice(0, hasta)
    if (!comun) break
  }
  if (comun) return comun

  const votos = new Map()
  for (const nombre of lista) {
    for (let largo = PREFIJO_MIN; largo <= Math.min(PREFIJO_MAX, nombre.length - 1); largo += 1) {
      const prefijo = nombre.slice(0, largo)
      votos.set(prefijo, (votos.get(prefijo) ?? 0) + 1)
    }
  }

  let mejor = ''
  let mejorPuntaje = 0
  for (const [prefijo, cuantos] of votos) {
    if (cuantos < 2) continue
    const puntaje = cuantos * prefijo.length
    if (puntaje > mejorPuntaje) {
      mejor = prefijo
      mejorPuntaje = puntaje
    }
  }
  return mejor
}

/** Cuánto se parece el NOMBRE al papel. Las primeras palabras valen más que las últimas. */
function puntajePorNombre(entidad, palabras) {
  const nombre = String(entidad.name ?? '').toLowerCase()
  for (const [posicion, palabra] of (palabras ?? []).entries()) {
    if (nombre.includes(palabra)) {
      const puntaje = palabras.length - posicion
      return Math.max(0, esTablaDeTraduccion(entidad.name) ? puntaje - 1 : puntaje)
    }
  }
  return 0
}

/** Cuánto encaja por CAMPOS. Cero si falta alguno de los obligatorios. */
function puntajePorCampos(entidad, debeTener, ayudan) {
  const campos = entidad.fields ?? []
  if (campos.length === 0) return 0
  if (!(debeTener ?? []).every((campo) => campos.includes(campo))) return 0

  const puntaje = 1 + (ayudan ?? []).filter((campo) => campos.includes(campo)).length
  return Math.max(0, esTablaDeTraduccion(entidad.name) ? puntaje - 1 : puntaje)
}

/**
 * La entidad que mejor cumple un papel, o `null`.
 *
 * Dos pasadas, y el orden importa: **el que encaja por campos SIEMPRE le gana al que solo encaja por
 * nombre.** Sin eso, una tabla de mensajes o de registro —que no tiene ninguna clave— gana por
 * llamarse parecido, y el análisis entero sale de la tabla equivocada.
 *
 * `excluyeSi` descarta entidades que tienen TODOS esos campos, porque son una entidad MÁS ESPECÍFICA
 * que también cumple el filtro. Buscando el maestro de ubicaciones —que solo exige `LOCID`— hay que
 * descartar la tabla de origen-ubicación, que tiene `LOCID` y además `LOCFR` y `PRDID`.
 *
 * Aquí está el fallo que traía v7: esa exclusión estaba implementada en el detector de la red de
 * suministro, y el del árbol de materiales la PASABA como cuarto argumento a una función que solo
 * aceptaba TRES. Se ignoraba en silencio. Los comentarios de v7 describen la exclusión como si
 * funcionara en los dos sitios; en uno no. Al haber una sola función, ya no puede volver a pasar.
 */
export function mejorEntidadPara(entidades, { debeTener = [], ayudan = [], palabras = [], excluyeSi = null } = {}) {
  const candidatas = (entidades ?? []).filter((una) => !(
    excluyeSi?.length && excluyeSi.every((campo) => (una.fields ?? []).includes(campo))
  ))

  const porCampos = candidatas
    .map((una) => ({ una, puntaje: puntajePorCampos(una, debeTener, ayudan) }))
    .filter((cada) => cada.puntaje > 0)

  const ordenar = (lista) => lista.sort((a, b) => (
    b.puntaje - a.puntaje
    || (b.una.fields?.length ?? 0) - (a.una.fields?.length ?? 0)
    // A igualdad de campos, gana la que se llama como el papel: si no, decide el orden en que SAP
    // devolvió los metadatos, y una entidad señuelo con los mismos campos puede colarse por llegar
    // primero.
    || puntajePorNombre(b.una, palabras) - puntajePorNombre(a.una, palabras)
    || String(a.una.name).localeCompare(String(b.una.name))
  ))

  if (porCampos.length > 0) return ordenar(porCampos)[0].una.name

  const porNombre = candidatas
    .map((una) => ({ una, puntaje: puntajePorNombre(una, palabras) }))
    .filter((cada) => cada.puntaje > 0)

  return porNombre.length > 0 ? ordenar(porNombre)[0].una.name : null
}

/**
 * Los papeles del ÁRBOL DE MATERIALES.
 *
 * `debeTener` son las claves que la entidad siempre trae; `ayudan` desempata; `palabras` es el
 * respaldo por nombre cuando ninguna cumple las claves.
 */
export const ROLES_DEL_ARBOL = Object.freeze({
  header: {
    etiqueta: 'Cabecera de receta',
    debeTener: ['LOCID', 'PRDID', 'SOURCEID'],
    ayudan: ['SOURCETYPE', 'OUTPUTCOEFFICIENT'],
    palabras: ['sourceprod', 'sourceproduction', 'prodhead'],
  },
  item: {
    etiqueta: 'Componentes de la receta',
    // `COMPONENTCOEFFICIENT` no es decorativo: es lo que distingue el componente de la cabecera,
    // que comparte `PRDID` y `SOURCEID`.
    debeTener: ['PRDID', 'SOURCEID', 'COMPONENTCOEFFICIENT'],
    palabras: ['sourceitem', 'proditem', 'sourceproditem', 'productionsourceitm'],
  },
  itemValidity: {
    etiqueta: 'Validez de los componentes',
    debeTener: ['SOURCEID', 'PRDID', 'COMPVALIDFR', 'COMPVALIDTO'],
    palabras: ['productionsourceitmvalidity', 'sourceitemvalidity', 'itemvalidity', 'proditemvalidity'],
  },
  itemSub: {
    etiqueta: 'Sustitutos de componentes',
    debeTener: ['SOURCEID', 'PRDFR', 'SPRDFR'],
    palabras: ['sourceitemsub', 'proditemsub', 'itemsub', 'productionsourceitmsubstitution', 'itmsubstitution'],
  },
  resource: {
    etiqueta: 'Recursos de la receta',
    debeTener: ['RESID', 'SOURCEID'],
    palabras: ['sourceres', 'prodres', 'sourceresource', 'productionresource'],
  },
  product: {
    etiqueta: 'Maestro de productos',
    debeTener: ['PRDID'],
    ayudan: ['PRDDESCR', 'MATTYPEID'],
    palabras: ['product', 'material'],
  },
  locMaster: {
    etiqueta: 'Maestro de ubicaciones',
    debeTener: ['LOCID'],
    ayudan: ['LOCDESCR', 'LOCTYPE'],
    palabras: ['location', 'loc'],
    excluyeSi: ['LOCFR', 'PRDID', 'SOURCEID'],
  },
  resMaster: {
    etiqueta: 'Maestro de recursos',
    debeTener: ['RESID'],
    ayudan: ['RESDESCR'],
    palabras: ['resource', 'res'],
    excluyeSi: ['SOURCEID'],
  },
  resLoc: {
    etiqueta: 'Recurso por ubicación',
    debeTener: ['RESID', 'LOCID'],
    palabras: ['resourcelocation', 'reslocation', 'resloc', 'locationresource'],
  },
})

/** Los papeles de la RED DE SUMINISTRO. */
export const ROLES_DE_RED = Object.freeze({
  location: {
    etiqueta: 'Arcos entre ubicaciones',
    debeTener: ['LOCID', 'LOCFR', 'PRDID'],
    ayudan: ['TLEADTIME'],
    palabras: ['sourcelocation'],
  },
  customer: {
    etiqueta: 'Arcos hacia clientes',
    debeTener: ['LOCID', 'PRDID', 'CUSTID'],
    ayudan: ['CLEADTIME'],
    palabras: ['sourcecustomer', 'customer'],
  },
  product: {
    etiqueta: 'Maestro de productos',
    debeTener: ['PRDID'],
    ayudan: ['PRDDESCR', 'MATTYPEID'],
    palabras: ['product', 'material'],
  },
  sourceProd: {
    etiqueta: 'Cabecera de receta',
    debeTener: ['LOCID', 'PRDID', 'SOURCEID'],
    ayudan: ['SOURCETYPE', 'OUTPUTCOEFFICIENT'],
    palabras: ['sourceproduction', 'sourceprod', 'prodhead'],
  },
  locMaster: {
    etiqueta: 'Maestro de ubicaciones',
    debeTener: ['LOCID'],
    ayudan: ['LOCTYPE', 'LOCDESCR'],
    palabras: ['location', 'loc'],
    excluyeSi: ['LOCFR', 'PRDID'],
  },
  custMaster: {
    etiqueta: 'Maestro de clientes',
    debeTener: ['CUSTID'],
    ayudan: ['CUSTDESCR'],
    palabras: ['customer', 'cust'],
    excluyeSi: ['LOCID', 'PRDID'],
  },
  sourceItem: {
    etiqueta: 'Componentes de la receta',
    debeTener: ['PRDID', 'SOURCEID', 'COMPONENTCOEFFICIENT'],
    ayudan: ['UOMID'],
    palabras: ['sourceitem', 'proditem', 'sourceproditem', 'productionsourceitm'],
  },
  locProd: {
    etiqueta: 'Producto por ubicación',
    debeTener: ['LOCID', 'PRDID'],
    palabras: ['locationproduct', 'locproduct', 'locprod'],
    excluyeSi: ['LOCFR'],
  },
  custProd: {
    etiqueta: 'Producto por cliente',
    debeTener: ['CUSTID', 'PRDID'],
    palabras: ['customerproduct', 'custproduct', 'custprod'],
    excluyeSi: ['LOCID'],
  },
})

/**
 * Acota las entidades a las de este tenant, por su prefijo.
 *
 * Si el prefijo no deja ninguna, se usan todas: es mejor detectar sobre el conjunto completo que
 * quedarse sin nada porque el prefijo se dedujo mal.
 */
export function entidadesDelTenant(entidades, prefijo) {
  const todas = entidades ?? []
  if (!prefijo) return todas

  const suyas = todas.filter((una) => String(una.name ?? '').toUpperCase().startsWith(prefijo.toUpperCase()))
  return suyas.length > 0 ? suyas : todas
}

/**
 * Qué entidad cumple cada papel, con la certeza de cada decisión.
 *
 * Devuelve `{ [papel]: { entidad, etiqueta, seguro, alternativas } }`. `seguro` dice si se decidió
 * por campos —fiable— o solo por nombre —hay que mirarlo—, y `alternativas` son las otras que
 * también encajaban, para poder cambiarla sin buscar entre seiscientas.
 */
export function detectarRoles(entidades, roles, prefijo = '') {
  const candidatas = entidadesDelTenant(entidades, prefijo)

  return Object.fromEntries(Object.entries(roles).map(([papel, definicion]) => {
    const elegida = mejorEntidadPara(candidatas, definicion)

    const porCampos = candidatas.filter((una) => puntajePorCampos(una, definicion.debeTener, definicion.ayudan) > 0)
    const excluidas = definicion.excluyeSi?.length
      ? porCampos.filter((una) => !definicion.excluyeSi.every((campo) => (una.fields ?? []).includes(campo)))
      : porCampos

    return [papel, {
      etiqueta: definicion.etiqueta,
      entidad: elegida,
      // Decidido por campos es fiable; por nombre es una corazonada que conviene revisar.
      seguro: excluidas.some((una) => una.name === elegida),
      alternativas: excluidas.map((una) => una.name).filter((nombre) => nombre !== elegida),
    }]
  }))
}

/**
 * La respuesta DEFINITIVA de qué entidad cumple cada papel: lo detectado, con lo corregido encima.
 *
 * Existe para que haya UNA sola respuesta. Sin esto, la extracción combinaría detección y
 * correcciones por su cuenta, los analizadores lo harían por la suya, y bastaría que uno de ellos se
 * olvidara de mirar las correcciones para que dos pantallas del mismo tenant leyeran tablas
 * distintas y nadie entendiera por qué no cuadran.
 *
 * **Una corrección a mano vale como certeza.** Alguien miró el tenant y decidió; no hay señal más
 * fuerte que eso, y la puntuación de la máquina no tiene por qué ganarle.
 */
export function rolesEfectivos(detectados, corregidos = {}) {
  return Object.fromEntries(Object.entries(detectados ?? {}).map(([papel, uno]) => {
    const corregido = corregidos?.[papel]
    if (!corregido || corregido === uno.entidad) return [papel, { ...uno, corregido: false }]

    return [papel, {
      ...uno,
      entidad: corregido,
      seguro: true,
      corregido: true,
      // La que la máquina había elegido pasa a ser una alternativa: si la corrección resulta estar
      // mal, se puede volver sin volver a detectar.
      alternativas: [...new Set([uno.entidad, ...uno.alternativas].filter(Boolean))]
        .filter((nombre) => nombre !== corregido),
    }]
  }))
}

/** Lo mismo para varios grupos de papeles a la vez —el árbol y la red—. */
export const gruposEfectivos = (detectadosPorGrupo, corregidosPorGrupo = {}) =>
  Object.fromEntries(Object.entries(detectadosPorGrupo ?? {})
    .map(([grupo, roles]) => [grupo, rolesEfectivos(roles, corregidosPorGrupo?.[grupo])]))

/** Los papeles que quedaron sin resolver o resueltos solo por el nombre. */
export const rolesPorRevisar = (detectados) =>
  Object.entries(detectados ?? {})
    .filter(([, uno]) => !uno.entidad || !uno.seguro)
    .map(([papel, uno]) => ({ papel, etiqueta: uno.etiqueta, entidad: uno.entidad }))
