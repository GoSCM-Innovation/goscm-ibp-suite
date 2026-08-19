// Qué CAMPO de cada entidad de este tenant corresponde a cada campo que el explorador espera.
//
// Portado de `public/js/fieldmap.js` de v7. Es la capa de abajo del problema que resuelve
// `explorer-entities.js`: una vez sabido qué tabla es el maestro de productos, todavía falta saber
// si la descripción se llama `PRDDESCR` o de otra forma, y si el tiempo de entrega al cliente existe.
//
// Tres casos, y los tres pasan de verdad:
//
//   A) El campo se llama distinto — `CLEADTIME` en un tenant, `LEADTIME` en otro.
//   B) El campo NO existe — hay áreas sin `ISALTITEM`. Pedirlo en el `$select` hace que SAP
//      rechace la consulta entera, así que se omite y el análisis que lo usaba se salta.
//   C) La entidad no tiene equivalente. Ahí no hay campo que mapear y el módulo que dependía de ella
//      se apaga, diciéndolo.
//
// La detección automática acierta casi siempre, y "casi" no alcanza: de esto depende un análisis de
// calidad de datos que alguien va a llevar a una reunión. Por eso lo que no se resuelve se pregunta,
// y lo que se responde se guarda.
//
// Sin dependencias: lo usan el servidor y la pantalla.

/**
 * Qué significa cada campo, para poder preguntar por él sin que quien responde tenga que adivinar.
 *
 * v7 las tenía porque el panel de corrección las necesitaba: "mapeá CLEADTIME" no le dice nada a
 * nadie; "el tiempo de entrega al cliente en días, sirve para detectar arcos sin lead time" sí.
 */
export const DESCRIPCION_DE_CAMPO = Object.freeze({
  CLEADTIME: 'Tiempo de entrega al cliente, en días. Detecta arcos sin lead time hacia clientes.',
  TLEADTIME: 'Tiempo de traslado entre ubicaciones, en días.',
  PLEADTIME: 'Tiempo de producción, en días.',
  ISALTITEM: 'Marca si el componente es un material de reemplazo alternativo (X = sustituto).',
  PRDFR: 'Producto componente de origen, en la tabla de sustituciones.',
  SPRDFR: 'Producto sustituto que reemplaza al componente.',
  TINVALID: 'Marca de arco de traslado inactivo (X = no vale).',
  CINVALID: 'Marca de arco de entrega a cliente inactivo (X = no vale).',
  PINVALID: 'Marca de receta de producción inactiva (X = no vale).',
  LOCVALID: 'Marca de ubicación inactiva.',
  CUSTVALID: 'Marca de cliente inactivo.',
  PRATIO: 'Cuota de producción de esta receta cuando hay varias para el mismo producto y ubicación.',
  OUTPUTCOEFFICIENT: 'Unidades de producto terminado que salen de una corrida.',
  COMPONENTCOEFFICIENT: 'Unidades del componente que se consumen por unidad de producto terminado.',
  SOURCETYPE: 'Tipo de fuente (P = producción primaria, C = co-producto o subproducto).',
  UOMID: 'Código de la unidad de medida del producto.',
  UOMDESCR: 'Descripción de la unidad de medida.',
  LOCDESCR: 'Descripción de la ubicación.',
  LOCTYPE: 'Tipo de ubicación (código de SAP; 1010 es planta).',
  CUSTDESCR: 'Descripción del cliente.',
  PRDDESCR: 'Descripción del producto.',
  MATTYPEID: 'Tipo de material de SAP. De él dependen las categorías de planificación.',
  RESDESCR: 'Descripción del recurso productivo.',
  // El tipo va en Resource Location y no en el maestro de recursos: en IBP el mismo recurso puede ser
  // de un tipo distinto en cada planta.
  RESOURCETYPE: 'Tipo de recurso en esa ubicación (código de SAP).',
  COMPVALIDFR: 'Desde cuándo vale el componente.',
  COMPVALIDTO: 'Hasta cuándo vale el componente.',
})

/** La descripción de un campo, o su nombre si no hay ninguna escrita. */
export const describirCampo = (campo) => DESCRIPCION_DE_CAMPO[campo] ?? campo

/**
 * Marca de que un campo NO existe en esa entidad.
 *
 * Se distingue de "no hay decisión tomada": `null` es una respuesta —alguien miró y confirmó que no
 * está— y por eso no se vuelve a preguntar. `undefined` es que todavía nadie lo revisó.
 */
export const NO_EXISTE = null

/** El nombre real de un campo en esa entidad. `null` si no existe; el canónico si no hay mapeo. */
export function campoReal(mapa, entidad, canonico) {
  const suyo = mapa?.[entidad]
  if (!suyo || !(canonico in suyo)) return canonico
  return suyo[canonico]
}

/** Si alguien ya decidió algo sobre ese campo. */
export const hayDecision = (mapa, entidad, canonico) => Boolean(mapa?.[entidad]) && canonico in mapa[entidad]

/**
 * El `$select` con los nombres de verdad, omitiendo los que no existen.
 *
 * Omitir no es opcional: pedir un campo inexistente hace que SAP rechace la consulta ENTERA, no que
 * devuelva esa columna vacía.
 */
export function armarSelect(mapa, entidad, canonicos) {
  const reales = (canonicos ?? [])
    .map((uno) => campoReal(mapa, entidad, uno))
    .filter((uno) => uno !== null && uno !== undefined && uno !== '')

  return [...new Set(reales)]
}

/**
 * Agrega a cada fila el nombre CANÓNICO junto al real.
 *
 * Así todo lo que viene después —los analizadores, los informes— habla un solo idioma y no tiene que
 * consultar el mapa en cada acceso. Es la razón por la que el mapeo no ensucia las 5.600 líneas de
 * los dos analizadores.
 */
export function normalizarFilas(mapa, entidad, filas) {
  const suyo = mapa?.[entidad]
  if (!suyo) return filas ?? []

  const renombrados = Object.entries(suyo).filter(([canonico, real]) => real && real !== canonico)
  if (renombrados.length === 0) return filas ?? []

  return (filas ?? []).map((fila) => {
    const salida = { ...fila }
    for (const [canonico, real] of renombrados) salida[canonico] = fila[real]
    return salida
  })
}

/** Los prefijos de tipo que SAP le pone a un mismo concepto según de qué hable. */
const PREFIJO_DE_TIPO = /^[CTPL](?=[A-Z][A-Z])/

/**
 * Qué campo de la entidad podría ser el canónico que falta.
 *
 * Tres intentos, de más seguro a menos: el nombre exacto; el nombre sin el prefijo de tipo
 * —`CLEADTIME` y `TLEADTIME` son los dos el `LEADTIME` de algo—; y que uno contenga al otro.
 *
 * Es una SUGERENCIA. Se ofrece para que quien decide no tenga que leer sesenta nombres, no para
 * aplicarla sola: acertar por parecido de nombre en el campo equivocado da un análisis creíble y
 * falso, que es peor que uno que falta.
 */
export function sugerirCampo(canonico, camposReales) {
  const campos = camposReales ?? []
  if (campos.includes(canonico)) return canonico

  const sinPrefijo = String(canonico).replace(PREFIJO_DE_TIPO, '')
  if (sinPrefijo !== canonico && campos.includes(sinPrefijo)) return sinPrefijo

  const buscado = String(canonico).toLowerCase()
  return campos.find((uno) => {
    const suyo = String(uno).toLowerCase()
    return suyo.includes(buscado) || buscado.includes(suyo)
  }) ?? null
}

/**
 * Revisa una entidad ANTES de consultarla y devuelve qué falta decidir y qué ya está decidido.
 *
 * Antes de la llamada y no después: un `$select` con un campo inexistente no devuelve una columna
 * vacía, devuelve un error, y el mensaje de SAP nombra un campo pero no dice qué hacer con él.
 *
 *   `faltan`     — campos sin decisión que no están en la entidad. Hay que preguntar.
 *   `decididas`  — lo que ya se resolvió antes y se está aplicando. Se muestra para que se vea que
 *                  el análisis corre con un mapeo, no con los nombres de fábrica.
 *   `perdidos`   — campos confirmados como inexistentes. El análisis que los usaba se salta.
 */
export function revisarCampos({ entidad, canonicos, camposReales, mapa }) {
  const faltan = []
  const decididas = []
  const perdidos = []

  for (const canonico of canonicos ?? []) {
    if (hayDecision(mapa, entidad, canonico)) {
      const real = campoReal(mapa, entidad, canonico)
      if (real === NO_EXISTE) perdidos.push(canonico)
      else if (real !== canonico) decididas.push({ canonico, real })
      continue
    }

    // Sin decisión: si el nombre canónico está en la entidad, no hay nada que preguntar.
    if ((camposReales ?? []).includes(canonico)) continue

    faltan.push({
      canonico,
      descripcion: describirCampo(canonico),
      sugerencia: sugerirCampo(canonico, camposReales),
    })
  }

  return { entidad, faltan, decididas, perdidos, listo: faltan.length === 0 }
}

/** Revisa varias entidades de una vez. */
export function revisarTodo(revisiones, mapa) {
  const porEntidad = (revisiones ?? []).map((una) => revisarCampos({ ...una, mapa }))
  return {
    porEntidad,
    listo: porEntidad.every((una) => una.listo),
    cuantosFaltan: porEntidad.reduce((suma, una) => suma + una.faltan.length, 0),
  }
}

/**
 * Aplica una decisión al mapa y devuelve uno nuevo.
 *
 * `real` puede ser `NO_EXISTE` para dejar constancia de que el campo no está. No se modifica el mapa
 * recibido: quien lo guarda decide cuándo, y así una decisión a medias no queda aplicada.
 */
export function decidir(mapa, entidad, canonico, real) {
  return { ...(mapa ?? {}), [entidad]: { ...(mapa?.[entidad] ?? {}), [canonico]: real } }
}

/** Olvida una decisión, para poder volver a preguntar. */
export function olvidar(mapa, entidad, canonico) {
  const suyo = { ...(mapa?.[entidad] ?? {}) }
  delete suyo[canonico]

  const salida = { ...(mapa ?? {}) }
  if (Object.keys(suyo).length === 0) delete salida[entidad]
  else salida[entidad] = suyo
  return salida
}
