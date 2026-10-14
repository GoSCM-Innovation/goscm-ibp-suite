// Cómo habla IBP de sus cosas, en lo que CI Tools necesita para sugerir y validar.
//
// Pura, sin dependencias: la comparten el servidor y la pantalla. Las lecturas a IBP (`ibp-catalogo.js`) y el
// análisis de su `$metadata` (`ibp-campos.js`) son del servidor; aquí solo vive lo que las dos mitades tienen que
// entender igual.

/** La versión base de IBP se escribe como CADENA VACÍA en el body (`"PlanningAreaVersion": ""`). */
export const VERSION_BASE = ''

/** Cómo se enseña la versión base: es la que en el body va vacía y en IBP se llama `__BASELINE`. */
export const NOMBRE_DE_VERSION_BASE = 'Versión base (vacío)'

/** Cómo llama el servicio de cifras clave a la versión base. */
export const ID_DE_VERSION_BASE_EN_IBP = '__BASELINE'

/**
 * Los campos con los que el iFlow carga una cifra clave y que NO existen en IBP: son los de la tabla de staging.
 * `KEYFIGUREDATE` lleva el periodo y `KFVALUE` el valor (en el destino se llama como la cifra).
 *
 * Esto se vio en los bodies reales (`PRDID,LOCID,CUSTID,KEYFIGUREDATE,KFVALUE` → `…,ZFACTURASPOS`) y en el código
 * de la suite: «los campos de la tabla de staging —`KEYFIGUREDATE` y compañía— no existen en la entidad».
 */
export const CAMPO_DE_PERIODO = 'KEYFIGUREDATE'
export const CAMPO_DE_VALOR = 'KFVALUE'

/**
 * Los campos que SAP rellena solo y rechaza al escribir (los de `CAMPOS_DE_SOLO_LECTURA` de dato maestro). Salen en
 * el catálogo de la tabla, pero no son para cargar: se marcan para no ofrecerlos por omisión.
 */
const CAMPOS_DE_SISTEMA = new Set(['PLANNINGAREAID', 'VERSIONID', 'CREATEDDATE', 'LASTMODIFIEDDATE'])

export const esCampoDeSistema = (campo) => CAMPOS_DE_SISTEMA.has(String(campo ?? '').toUpperCase())

/** Los campos de periodo del servicio de cifras clave: `PERIODID0_TSTAMP`, `PERIODID1_TSTAMP`… */
const CAMPO_DE_TIEMPO = /^PERIODID\d+_TSTAMP$/i

export const esCampoDeTiempo = (campo) => CAMPO_DE_TIEMPO.test(String(campo ?? ''))

/**
 * Parte el identificador de un tipo de dato maestro en prefijo y tipo: `SBPRODUCT` con prefijo `SB` es
 * `{ prefijo: 'SB', tipo: 'PRODUCT' }`, que es como los pide el body (`MasterDataPrefix` y `MasterDataType`).
 *
 * Sin prefijo, o si el identificador no empieza por él, el identificador entero es el tipo.
 */
export function descomponerTipo(id, prefijo) {
  const entero = String(id ?? '')
  const p = String(prefijo ?? '')
  if (p !== '' && entero.length > p.length && entero.toUpperCase().startsWith(p.toUpperCase())) {
    return { prefijo: entero.slice(0, p.length), tipo: entero.slice(p.length) }
  }
  return { prefijo: '', tipo: entero }
}

/** Lo contrario: el identificador de la tabla a partir de lo que dice el body. */
export const componerTipo = (prefijo, tipo) => `${String(prefijo ?? '')}${String(tipo ?? '')}`

/**
 * La versión como la entiende el body: la base es cadena vacía. Acepta lo que llega de cualquiera de los dos
 * servicios (`__BASELINE`, vacío o `null`).
 */
export const versionDelBody = (id) => (id === ID_DE_VERSION_BASE_EN_IBP || id === null || id === undefined ? VERSION_BASE : String(id))
