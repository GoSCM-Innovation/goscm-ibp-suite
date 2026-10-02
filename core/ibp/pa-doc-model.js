// Qué lleva la documentación de un área de planificación, y de dónde sale cada dato.
//
// Portado de `paDoc.js` de v7 (secciones 1 «PARSING DE CSV», 4 «ACCESO A DATOS» y los análisis de la 5),
// con los MISMOS algoritmos: decisión del usuario del 2026-10-01, «Data Tools tiene que ser idéntico a
// v7». El armado del `.docx` está en `src/lib/docx.js` y `src/lib/pa-doc.js`, y la pantalla en
// `data/PlanningAreaDoc.jsx`.
//
// El dato de entrada son los CSV del «Download Configuration File» de un área de planificación de SAP
// IBP. No se leen por API porque esa configuración —niveles de planificación, definiciones de cálculo,
// operadores— no está expuesta en los servicios de comunicación: se saca de la pantalla de
// configuración del área. Es una limitación de SAP, no una decisión de esta herramienta.
//
// LOS ENCABEZADOS SON LOS DE V7. Cada columna que se lee —`ID`, `Name`, `Base Planning Level`,
// `Attribute ID`, `Operator Profile / Operator Type`…— es la que v7 lee del archivo real de SAP. No se
// inventan nombres ni se buscan por parecido amplio: `getLike` hace exactamente lo que hacía v7
// (igualdad sin distinguir mayúsculas y, si no hay, «contiene»), con sus mismas rarezas, porque son las
// que producen el documento que los clientes ya conocen.

/**
 * Las secciones que SAP exporta, EN EL ORDEN DE V7.
 *
 * El orden importa: `seccionDeArchivo` devuelve la primera que encaja. Es el de `KNOWN_SECTIONS` de v7,
 * que pone las más largas y específicas antes, de modo que `ATTRIBUTES_AS_KEYFIGURE` no se la coma
 * `KEYFIGURES`.
 */
export const IDS_DE_SECCION = Object.freeze([
  'ATTRIBUTES_AS_KEYFIGURE', 'CURRENCY_CONVERSIONS', 'PLANNING_HORIZONS',
  'MASTERDATATYPES', 'PLEVELS_ATTRS', 'PA_ATTRIBUTES', 'UOM_CONVERSIONS',
  'GENERAL_INFO', 'TIMEPROFILE', 'KEYFIGURES', 'OPERATORS', 'SNAPSHOTS', 'VERSIONS',
])

/**
 * Qué sección es un archivo, por su nombre.
 *
 * SAP los exporta como `ASIBPTS_KEYFIGURES.csv`, `ASIBPTS_PLEVELS_ATTRS.csv`… El nombre de la sección
 * va entre separadores y no distingue mayúsculas.
 */
export function seccionDeArchivo(nombre) {
  const arriba = String(nombre ?? '').toUpperCase()
  for (const id of IDS_DE_SECCION) {
    if (new RegExp(`(^|_)${id}(_|\\.|$)`).test(arriba)) return id
  }
  return null
}

/** El área que nombra el archivo: lo que va antes del primer guion bajo. */
export function areaDeArchivo(nombre) {
  const base = String(nombre ?? '').replace(/\.[^.]*$/, '')
  const partes = base.match(/^([A-Za-z0-9]+)_/)
  return partes ? partes[1] : ''
}

/**
 * Lee un CSV de SAP.
 *
 * El separador es el PUNTO Y COMA y las comillas siguen el RFC 4180 —una comilla dentro de un campo
 * entrecomillado va doblada—. Un salto de línea dentro de un campo entrecomillado es parte del campo:
 * las definiciones de cálculo de una cifra clave los llevan.
 */
export function leerCsv(texto) {
  const filas = []
  let fila = []
  let campo = ''
  let dentroDeComillas = false

  const crudo = String(texto ?? '')

  for (let i = 0; i < crudo.length; i += 1) {
    const letra = crudo[i]

    if (dentroDeComillas) {
      if (letra !== '"') { campo += letra; continue }
      if (crudo[i + 1] === '"') { campo += '"'; i += 1; continue }
      dentroDeComillas = false
      continue
    }

    if (letra === '"') { dentroDeComillas = true; continue }
    if (letra === ';') { fila.push(campo); campo = ''; continue }
    if (letra === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue }
    if (letra === '\r') continue
    campo += letra
  }

  if (campo.length > 0 || fila.length > 0) { fila.push(campo); filas.push(fila) }
  return filas
}

/** Limpia un encabezado: quita la marca de bytes que Excel deja al principio y los espacios. */
export const limpiarEncabezado = (valor) => String(valor || '').replace(/^\uFEFF/, '').trim()

/** Convierte filas en objetos por su encabezado. */
export function aObjetos(encabezado, filas) {
  return (filas ?? []).map((fila) => {
    const objeto = {}
    ;(encabezado ?? []).forEach((columna, indice) => {
      objeto[columna] = fila[indice] !== undefined ? fila[indice] : ''
    })
    return objeto
  })
}

/** Un valor como texto recortado; lo que no hay es cadena vacía. `str` de v7. */
export const str = (valor) => ((valor === null || valor === undefined) ? '' : String(valor).trim())

/** El valor de una columna por su nombre EXACTO. `get` de v7. */
export const get = (objeto, columna) => (objeto && objeto[columna] !== undefined ? str(objeto[columna]) : '')

/**
 * El valor de una columna por su nombre sin distinguir mayúsculas y, si no hay, por la primera cuyo
 * nombre CONTIENE lo buscado. `getLike` de v7, tal cual.
 */
export function getLike(objeto, buscado) {
  if (!objeto) return ''
  const claves = Object.keys(objeto)
  const minuscula = String(buscado).toLowerCase()
  let clave = claves.find((una) => una.toLowerCase() === minuscula)
  if (!clave) clave = claves.find((una) => una.toLowerCase().includes(minuscula))
  return clave ? str(objeto[clave]) : ''
}

/**
 * Ingiere el texto de un CSV y devuelve la sección con sus filas, o `null` si no se reconoce.
 *
 * Las filas vacías se descartan: los exports de SAP acaban con una línea en blanco y contarla haría que
 * el documento dijera «43 cifras clave» donde hay 42. Un archivo sin ninguna línea devuelve
 * `{ seccion, vacio: true }`: se reconoce, pero no aporta nada y v7 no lo registra.
 */
export function ingerirCsv(nombre, texto) {
  const seccion = seccionDeArchivo(nombre)
  if (!seccion) return null

  const crudas = leerCsv(texto)
  if (crudas.length === 0) return { seccion, vacio: true, encabezado: [], filas: [], objetos: [], archivo: nombre }

  const encabezado = crudas[0].map(limpiarEncabezado)
  const filas = crudas.slice(1).filter((fila) => fila.some((celda) => celda && celda.trim() !== ''))

  return { seccion, vacio: false, encabezado, filas, objetos: aObjetos(encabezado, filas), archivo: nombre }
}

/** Lo que se ha leído hasta ahora: las secciones y el identificador del área. */
export const estadoInicial = () => ({ datos: {}, paId: '' })

/**
 * Suma un CSV al estado. Devuelve el estado nuevo y qué sección era (`null` si no se reconoció).
 *
 * El identificador del área se fija UNA vez, con el primer archivo que lo permita: de la primera fila de
 * `GENERAL_INFO` (su primera columna) o, si no, del prefijo del nombre del archivo. Es el orden de v7,
 * incluido que depende del orden en que se sueltan los archivos.
 */
export function agregarCsv(estado, nombre, texto) {
  const leido = ingerirCsv(nombre, texto)
  if (!leido) return { estado, seccion: null }
  if (leido.vacio) return { estado, seccion: leido.seccion }

  const { seccion, encabezado, filas, objetos } = leido
  const datos = { ...estado.datos, [seccion]: { encabezado, filas, objetos, archivo: nombre } }

  let { paId } = estado
  if (!paId) {
    if (seccion === 'GENERAL_INFO' && filas.length > 0) {
      paId = str(filas[0][0])
    } else {
      const delNombre = areaDeArchivo(nombre)
      if (delNombre) paId = delNombre
    }
  }

  return { estado: { datos, paId }, seccion }
}

// ── Análisis ─────────────────────────────────────────────────────────────────────────────────────

const objetosDe = (datos, id) => datos?.[id]?.objetos ?? []

/** Cuántas cifras clave son guardadas, calculadas, auxiliares y de alerta. `kfClassify` de v7. */
export function clasificarCifras(datos) {
  let guardadas = 0
  let calculadas = 0
  let auxiliares = 0
  let deAlerta = 0
  for (const cifra of objetosDe(datos, 'KEYFIGURES')) {
    if (get(cifra, 'Stored Key Figure') === 'X') guardadas += 1
    if (get(cifra, 'Calculated Key Figure') === 'X') calculadas += 1
    if (getLike(cifra, 'Helper Key Figure') === 'X') auxiliares += 1
    if (getLike(cifra, 'Alert Key Figure') === 'X') deAlerta += 1
  }
  return { stored: guardadas, calc: calculadas, helper: auxiliares, alert: deAlerta }
}

/** Cuántos niveles de planificación distintos hay, o `null` si la sección no vino. */
export function nivelesDistintos(datos) {
  const niveles = objetosDe(datos, 'PLEVELS_ATTRS')
  if (niveles.length === 0) return null
  return new Set(niveles.map((una) => getLike(una, 'Planning Level'))).size
}

/** Tipos de dato maestro distintos y total de atributos, o `null` si la sección no vino. */
export function tiposDeDatoMaestro(datos) {
  const tipos = objetosDe(datos, 'MASTERDATATYPES')
  if (tipos.length === 0) return null
  return {
    count: new Set(tipos.map((una) => getLike(una, 'Master Data Type ID'))).size,
    attrs: tipos.length,
  }
}

/** Los identificadores de los tipos de dato maestro del área, sin repetir: los que se cuentan en vivo. */
export const idsDeTiposDeDatoMaestro = (datos) => [
  ...new Set(objetosDe(datos, 'MASTERDATATYPES').map((una) => getLike(una, 'Master Data Type ID')).filter(Boolean)),
]

/** Las categorías (perfiles) de operador que hay, sin repetir. */
export const categoriasDeOperador = (datos) => [
  ...new Set(objetosDe(datos, 'OPERATORS').map((una) => getLike(una, 'Operator Profile / Operator Type'))),
]

/** Los módulos de IBP que se deducen de las etiquetas (`#DP`, `#IO`…) de las cifras clave. */
export const MODULOS = Object.freeze({
  DP: 'Demand Planning',
  DS: 'Demand Sensing',
  IO: 'Inventory Optimization',
  SOP: 'S&OP',
  SNP: 'Supply Planning',
})

export function modulosDetectados(datos) {
  const encontrados = new Set()
  for (const cifra of objetosDe(datos, 'KEYFIGURES')) {
    for (const marca of getLike(cifra, 'Hashtags').match(/#([A-Z]+)/g) ?? []) {
      const modulo = marca.slice(1)
      if (Object.keys(MODULOS).includes(modulo)) encontrados.add(modulo)
    }
  }
  return [...encontrados].map((una) => MODULOS[una] || una)
}

/**
 * El estado de las 13 secciones para la cuadrícula de la pantalla: en orden alfabético y con
 * «N filas» o «no provisto». Es `renderStatus` de v7.
 */
export function estadoDeSecciones(datos) {
  return [...IDS_DE_SECCION].sort().map((id) => {
    const filas = datos?.[id] ? datos[id].filas.length : null
    return {
      id,
      presente: filas !== null,
      texto: filas !== null ? `${filas} filas` : 'no provisto',
    }
  })
}
