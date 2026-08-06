// Leer un export de proyecto de SAP CI-DS: el ZIP con su `batch.csv` y sus XML de integración.
//
// Portado de `public/legacy/js/docs.js` de v9. Esta capa es la estructura del documento —qué
// datastores hay, qué transformaciones, qué trabajo y qué variables—; encima de ella va el extractor
// de mapeos de cada dataflow.
//
// Lo comparten el explorador de integraciones y el documentador. En v9 vivía dentro de `docs.js` y
// `explorer.js` lo tomaba prestado de ahí, con lo que el explorador no funcionaba si no se cargaba
// primero el documentador.
//
// Todo pasa en el navegador: el ZIP no sale del equipo. Un export de CI-DS lleva las definiciones de
// integración del cliente y conviene que siga así.

/**
 * El tipo XMI de un elemento.
 *
 * Se prueban las dos formas porque depende de cómo el parser resuelva el espacio de nombres: con el
 * prefijo literal o por URI. Un XML válido puede venir de cualquiera de las dos maneras.
 */
export function xmiType(elemento) {
  return elemento.getAttribute('xmi:type')
    || elemento.getAttributeNS('http://www.omg.org/XMI', 'type')
    || ''
}

/** Una propiedad de un elemento: en el XMI van como hijos `<properties name= value=>`. */
export function getProp(elemento, nombre) {
  for (const hijo of elemento.children) {
    if (hijo.localName === 'properties' && hijo.getAttribute('name') === nombre) {
      return hijo.getAttribute('value') || ''
    }
  }
  return ''
}

/**
 * Los datastores por POSICIÓN entre los hijos de la raíz.
 *
 * Se indexa por posición y no por nombre porque las referencias del XMI apuntan por índice —
 * `//@DataStore.3`— y ese número cuenta TODOS los hijos, no solo los datastores. Contar únicamente
 * los datastores desalinearía las referencias.
 */
export function buildDatastoreIndex(raiz) {
  const porIndice = {}
  let i = 0
  for (const hijo of raiz.children) {
    if (hijo.localName === 'DataStore') porIndice[i] = hijo.getAttribute('name') || `DS_${i}`
    i += 1
  }
  return porIndice
}

/** Resuelve una referencia tipo `//@DataStore.3` al nombre del datastore. */
export function datastoreFromRef(referencia, porIndice) {
  if (!referencia) return ''
  const numero = String(referencia).match(/\/(\d+)/)
  return numero ? (porIndice[+numero[1]] || referencia) : referencia
}

/**
 * De qué tabla real sale cada esquema de lectura: `nombre mostrado → { table, ds }`.
 *
 * Solo los lectores de tabla. El nombre que se ve en el dataflow no es el de la tabla, así que sin
 * este mapa la documentación diría "Query_1" donde debería decir "MARA".
 */
export function buildSchemaMap(dataflow, porIndice) {
  const mapa = {}

  for (const elemento of dataflow.children) {
    if (elemento.localName !== 'elements') continue
    if (!xmiType(elemento).includes('TableReader')) continue

    const mostrado = elemento.getAttribute('displayName') || ''
    const tabla = elemento.getAttribute('tableName') || elemento.getAttribute('outputSchemaName') || mostrado
    const datastore = datastoreFromRef(elemento.getAttribute('referencedDataStore') || '', porIndice)

    mapa[mostrado] = { table: tabla, ds: datastore }

    // El esquema de salida puede llamarse distinto de lo que se muestra, y las expresiones lo
    // referencian por cualquiera de los dos nombres.
    const salida = elemento.getAttribute('outputSchemaName')
    if (salida && salida !== mostrado) mapa[salida] = { table: tabla, ds: datastore }
  }

  return mapa
}

/**
 * Las transformaciones del dataflow: `nombre → { fields, filterExpr }`.
 *
 * Se incluyen las de tipo XMLMap además de las Query porque las salidas de RFC y BAPI pasan por
 * ellas: sin eso, la cadena de expresiones se corta ahí y no se llega a la tabla real.
 */
export function parseTransforms(dataflow) {
  const transformaciones = {}

  for (const elemento of dataflow.children) {
    if (elemento.localName !== 'elements') continue
    const tipo = xmiType(elemento)
    if (!tipo.includes('QueryTransform') && !tipo.includes('XMLMapTransform')) continue

    let esquemaSalida = null
    for (const hijo of elemento.children) {
      if (hijo.localName === 'outputSchema') { esquemaSalida = hijo; break }
    }
    if (!esquemaSalida) continue

    const campos = []
    for (const nodo of esquemaSalida.children) {
      if (nodo.localName !== 'schemaNodes') continue
      campos.push({
        name: nodo.getAttribute('name') || '',
        desc: nodo.getAttribute('description') || '',
        proj: nodo.getAttribute('projectionExpression') || '',
      })
    }

    transformaciones[elemento.getAttribute('displayName') || ''] = {
      fields: campos,
      filterExpr: esquemaSalida.getAttribute('filterExpression') || '',
    }
  }

  return transformaciones
}

/**
 * El `batch.csv` del ZIP: los metadatos de datastore de cada XML, indexados por nombre de archivo.
 *
 * Es lo que dice de qué datastore lee y a cuál escribe cada integración — un dato que no está en el
 * XML y que sin esto habría que adivinar.
 */
export async function parseBatchCsv(zip) {
  const archivo = zip.file('batch.csv')
  if (!archivo) return {}

  const filas = (await archivo.async('string')).trim().split(/\r?\n/)
  if (filas.length < 2) return {}

  const cabeceras = filas[0].split(',').map((una) => una.trim())
  const porArchivo = {}

  for (const fila of filas.slice(1)) {
    const celdas = fila.split(',').map((una) => una.trim())
    const entrada = Object.fromEntries(cabeceras.map((cabecera, i) => [cabecera, celdas[i] || '']))
    if (entrada.Xmlfilename) porArchivo[entrada.Xmlfilename] = entrada
  }

  return porArchivo
}

/**
 * De qué tipo es la integración: dato maestro, key figure, o archivo.
 *
 * Se deduce del nombre del trabajo porque el XML no lo dice en ningún lado. Es la convención de
 * nombres de los proyectos reales, portada tal cual de v9 — incluido que sin coincidencia se asuma
 * dato maestro, que es lo más común.
 */
export function integrationType(jobName, esArchivo) {
  if (esArchivo) return 'FILE'
  const nombre = String(jobName ?? '').toUpperCase()
  if (/_KF_/.test(nombre)) return 'KF'
  if (/_MD_|_DM_/.test(nombre)) return 'MD'
  if (/_FILE_/.test(nombre)) return 'FILE'
  return 'MD'
}

/** ¿El destino es un archivo? Se mira el nombre del datastore, como en v9. */
export function isFileTarget(datastoreDestino) {
  const nombre = String(datastoreDestino ?? '')
  return nombre.toLowerCase().includes('file')
    || nombre.toUpperCase() === 'FILE_DC'
    || nombre.toUpperCase() === 'ARCHIVOS'
}

/**
 * Los datos del trabajo: su nombre, su descripción, sus variables globales y el área de planificación.
 *
 * El área sale de `$G_PLAN_AREA`, que viene entrecomillada en el XMI y hay que desnudar.
 */
export function parseJobMetadata(raiz) {
  let job = null
  for (const hijo of raiz.children) {
    if (hijo.localName === 'Job') { job = hijo; break }
  }
  if (!job) return null

  const variables = []
  for (const hijo of job.children) {
    if (hijo.localName !== 'globalVariables') continue
    const name = hijo.getAttribute('name') || ''
    if (name) variables.push({ name, value: hijo.getAttribute('defaultValue') || '' })
  }

  const area = variables.find((una) => una.name === '$G_PLAN_AREA')

  return {
    jobName: job.getAttribute('name') || '',
    jobDesc: getProp(job, 'Description') || job.getAttribute('description') || '',
    variables,
    planArea: area ? area.value.replace(/^'|'$/g, '') : '',
  }
}

/** Lee el XML de una integración a un documento. Devuelve `null` si no es XML válido. */
export function parseXml(texto) {
  const documento = new DOMParser().parseFromString(String(texto ?? ''), 'application/xml')
  // El parser del navegador no lanza: mete un elemento `parsererror` dentro del resultado.
  if (documento.getElementsByTagName('parsererror').length > 0) return null
  return documento.documentElement
}
