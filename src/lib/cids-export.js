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

import { analizarCampo, expandirExpresion } from './cids-expression.js'

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

/** Cómo nombra CI-DS sus tablas de staging. Es de SAP, no una convención del proyecto. */
const STAGING = { KF: /^SOPDD_STAGING_KFTAB_/, MD: /^SOPMD_STAG_/ }

/**
 * De qué tipo es la integración: dato maestro, key figure, o archivo.
 *
 * Manda la TABLA DESTINO, que es donde SAP lo dice sin ambigüedad: una tabla
 * `SOPDD_STAGING_KFTAB_*` es de key figures y una `SOPMD_STAG_*` es de dato maestro, siempre.
 *
 * El nombre del trabajo queda de reserva para cuando el destino no lo aclara, con la convención que
 * traía v9. v9 se guiaba SOLO por el nombre, y en un proyecto real eso clasificaba mal una de cada
 * cuatro integraciones: ese cliente llama `_TD_` (datos transaccionales) a lo que carga key figures,
 * y quedaban documentadas como dato maestro y sin poder resolver su entidad en IBP.
 */
export function integrationType(jobName, esArchivo, targetTable = '') {
  if (esArchivo) return 'FILE'

  const destino = String(targetTable ?? '').toUpperCase()
  if (STAGING.KF.test(destino)) return 'KF'
  if (STAGING.MD.test(destino)) return 'MD'

  const nombre = String(jobName ?? '').toUpperCase()
  if (/_KF_/.test(nombre)) return 'KF'
  if (/_MD_|_DM_/.test(nombre)) return 'MD'
  if (/_FILE_/.test(nombre)) return 'FILE'
  // Sin ninguna pista, dato maestro: es lo más común.
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

/**
 * Los formatos de archivo plano por posición, igual que los datastores.
 *
 * Hace falta para resolver a qué archivo escribe un dataflow que no escribe a una tabla: la
 * referencia apunta por índice a esta lista y no trae el nombre.
 */
export function buildFileFormatIndex(raiz) {
  const porIndice = {}
  let i = 0
  for (const hijo of raiz.children) {
    const nombre = hijo.localName
    if (nombre === 'FlatFileFormat' || nombre === 'DelimitedFileFormat'
      || nombre === 'FixedWidthFileFormat' || nombre.includes('FileFormat')) {
      porIndice[i] = hijo.getAttribute('name') || `FILE_${i}`
    }
    i += 1
  }
  return porIndice
}

/**
 * Como `buildSchemaMap`, pero incluyendo los lectores de ARCHIVO además de los de tabla.
 *
 * Un dataflow puede leer de un archivo plano, y sin esto esas columnas quedarían sin origen. El
 * datastore se marca como FILE porque un archivo no pertenece a ninguno.
 */
export function buildSchemaMapFull(dataflow, porIndice) {
  const mapa = buildSchemaMap(dataflow, porIndice)

  for (const elemento of dataflow.children) {
    if (elemento.localName !== 'elements') continue
    if (!xmiType(elemento).includes('FileReader')) continue

    const mostrado = elemento.getAttribute('displayName') || ''
    const alias = elemento.getAttribute('outputSchemaName') || mostrado
    mapa[mostrado] = { table: alias, ds: 'FILE' }
    if (alias && alias !== mostrado) mapa[alias] = { table: alias, ds: 'FILE' }
  }

  return mapa
}

/**
 * Descripciones de los campos que SAP siempre deja sin describir en el XMI.
 *
 * Son las claves de IBP, que aparecen en casi toda integración. Portado de v9 tal cual.
 */
const DESCRIPCION_POR_OMISION = {
  PRDID: 'Id de producto',
  CUSTID: 'Id de cliente',
  LOCID: 'Id de centro',
  CURRID: 'Id de divisa',
  ID: 'Id interno',
  KEYFIGUREDATE: 'Fecha',
  DATE: 'Fecha',
}

/**
 * Todas las llamadas `lookup(...)` de un dataflow, con la expresión completa.
 *
 * Se cuentan paréntesis en vez de cortar con una expresión regular porque un lookup puede llevar
 * llamadas anidadas dentro: parar en el primer paréntesis que cierra partiría la expresión al medio.
 */
export function extractLookups(transformaciones) {
  const encontrados = []

  for (const [nombre, transformacion] of Object.entries(transformaciones)) {
    for (const campo of transformacion.fields) {
      if (!campo.proj || !/\blookup\s*\(/i.test(campo.proj)) continue

      const proyeccion = campo.proj
      const enMinuscula = proyeccion.toLowerCase()
      let desde = 0

      for (;;) {
        const inicio = enMinuscula.indexOf('lookup(', desde)
        if (inicio === -1) break

        let profundidad = 0
        let i = inicio + 'lookup('.length - 1
        for (; i < proyeccion.length; i += 1) {
          if (proyeccion[i] === '(') profundidad += 1
          else if (proyeccion[i] === ')') {
            profundidad -= 1
            if (profundidad === 0) break
          }
        }

        encontrados.push({ func: proyeccion.slice(inicio, i + 1), transform: nombre })
        desde = i + 1
      }
    }
  }

  return encontrados
}

/**
 * A dónde escribe un dataflow: a una tabla, o a un archivo plano.
 *
 * Se prefiere el escritor de tabla y se sigue buscando aunque ya se haya encontrado uno de archivo:
 * un dataflow puede tener los dos, y la tabla es el destino que interesa documentar.
 *
 * Devuelve `null` si no escribe a ningún lado.
 */
export function findWriter(dataflow, porIndice, formatos, datastoreDestinoPorOmision) {
  let escritor = null
  let esArchivo = false

  for (const elemento of dataflow.children) {
    if (elemento.localName !== 'elements') continue
    const tipo = xmiType(elemento)
    if (tipo.includes('TableLoader')) { escritor = elemento; esArchivo = false; break }
    if (tipo.includes('FileLoader')) { escritor = elemento; esArchivo = true }
  }
  if (!escritor) return null

  if (!esArchivo) {
    const tabla = escritor.getAttribute('tableName') || escritor.getAttribute('displayName') || ''
    if (!tabla) return null
    return {
      targetTable: tabla,
      targetDS: datastoreFromRef(escritor.getAttribute('referencedDataStore') || '', porIndice)
        || datastoreDestinoPorOmision || '',
      fileLoaderFileName: '',
    }
  }

  const referencia = escritor.getAttribute('referencedFileFormat') || ''
  const numero = referencia.match(/\/(\d+)/)
  const tabla = (numero ? (formatos[+numero[1]] || referencia) : referencia)
    || escritor.getAttribute('displayName') || ''
  if (!tabla) return null

  // El nombre del archivo va como propiedad, y hace falta para emparejar cadenas entre
  // integraciones: una escribe un archivo y otra lo lee.
  return {
    targetTable: tabla,
    targetDS: datastoreDestinoPorOmision || 'FILE_DC',
    fileLoaderFileName: getProp(escritor, 'file_name'),
  }
}

/**
 * Los filtros de un dataflow: los de cada transformación y los de sus uniones.
 *
 * Cada expresión entra como UNA fila con el texto completo: partirla por condiciones perdería el
 * sentido de un `and` de cinco líneas. Se listan las tablas reales que menciona, que es lo que se
 * busca al leer la documentación.
 *
 * Se descartan las repetidas por sus primeros 120 caracteres, como en v9: la misma expresión
 * reaparece en varias transformaciones encadenadas y documentarla cinco veces no aporta nada.
 */
export function extractFilters(dataflow, transformaciones, mapaDeEsquemas) {
  const filtros = []
  const vistos = new Set()

  const agregar = (expresionCruda) => {
    if (!expresionCruda) return
    // El XMI escapa los saltos de línea; devolverlos hace legible una expresión larga.
    const expresion = expandirExpresion(expresionCruda.replace(/&#xA;/g, '\n'), transformaciones)

    const clave = expresion.substring(0, 120)
    if (vistos.has(clave)) return
    vistos.add(clave)

    const tablas = new Set()
    const { srcTable } = analizarCampo(expresion, transformaciones, mapaDeEsquemas)
    for (const nombre of srcTable.split(', ').filter(Boolean)) {
      tablas.add(mapaDeEsquemas[nombre]?.table || nombre)
    }

    filtros.push({
      sourceTable: [...tablas].join(', '),
      sourceField: '',
      expression: expresion,
      description: '',
    })
  }

  for (const transformacion of Object.values(transformaciones)) agregar(transformacion.filterExpr)

  for (const elemento of dataflow.children) {
    if (elemento.localName !== 'elements') continue
    if (!xmiType(elemento).includes('QueryTransform')) continue
    for (const hijo of elemento.children) {
      if (hijo.localName !== 'outputSchema') continue
      for (const union of hijo.children) {
        if (union.localName === 'joins') agregar(union.getAttribute('expression') || '')
      }
    }
  }

  return filtros
}

/**
 * El diagrama del dataflow tal como se ve en CI-DS: sus cajas y las flechas que las unen.
 *
 * Es lo que permite mostrar el paso a paso en vez de solo el origen y el destino. Los nodos van
 * identificados por su POSICIÓN entre los hijos `elements`, porque así es como las conexiones los
 * referencian (`/2/@elements.4`).
 */
export function parseDataflowDiagram(dataflow, porIndice) {
  const elementos = []
  for (const hijo of dataflow.children) {
    if (hijo.localName === 'elements') elementos.push(hijo)
  }

  const nodes = elementos.map((elemento, indice) => {
    // "dataflow:TableReader" → "TableReader".
    const tipo = xmiType(elemento).replace(/^[a-z]+:/i, '')

    const posicion = (elemento.getAttribute('location') || '')
      .match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/)

    const nodo = {
      id: indice,
      xmiType: tipo,
      displayName: elemento.getAttribute('displayName') || elemento.getAttribute('outputSchemaName') || '',
      location: posicion ? { x: +posicion[1], y: +posicion[2] } : null,
    }

    if (tipo.includes('TableReader') || tipo.includes('TableLoader')) {
      nodo.tableName = elemento.getAttribute('tableName') || ''
      nodo.dsName = datastoreFromRef(elemento.getAttribute('referencedDataStore') || '', porIndice)
    }
    if (tipo.includes('FileReader') || tipo.includes('FileLoader')) {
      nodo.dsName = datastoreFromRef(elemento.getAttribute('referencedDataStore') || '', porIndice)
      nodo.fileName = getProp(elemento, 'file_name')
    }
    if (tipo.includes('RowGenerationTransform')) {
      nodo.rowCount = elemento.getAttribute('rowCount') || ''
    }

    if (tipo.includes('QueryTransform') || tipo.includes('XMLMapTransform')) {
      let esquemaSalida = null
      for (const hijo of elemento.children) {
        if (hijo.localName === 'outputSchema') { esquemaSalida = hijo; break }
      }
      if (esquemaSalida) {
        nodo.filterExpression = (esquemaSalida.getAttribute('filterExpression') || '').replace(/&#xA;/g, '\n')
        nodo.inputSchemas = []
        nodo.joins = []
        nodo.fields = []

        for (const hijo of esquemaSalida.children) {
          if (hijo.localName === 'inputSchemas') {
            const nombre = hijo.getAttribute('schemaName') || ''
            if (nombre) nodo.inputSchemas.push(nombre)
          } else if (hijo.localName === 'joins') {
            nodo.joins.push({
              leftSchemaName: hijo.getAttribute('leftSchemaName') || '',
              rightSchemaName: hijo.getAttribute('rightSchemaName') || '',
              expression: (hijo.getAttribute('expression') || '').replace(/&#xA;/g, '\n'),
            })
          } else if (hijo.localName === 'schemaNodes') {
            nodo.fields.push({
              name: hijo.getAttribute('name') || '',
              description: hijo.getAttribute('description') || '',
              projectionExpression: (hijo.getAttribute('projectionExpression') || '').replace(/&#xA;/g, '\n'),
            })
          }
        }
      }
    }

    return nodo
  })

  const edges = []
  for (const hijo of dataflow.children) {
    if (hijo.localName !== 'connections') continue
    const origen = (hijo.getAttribute('sourceElement') || '').match(/elements\.(\d+)/)
    const destino = (hijo.getAttribute('targetElement') || '').match(/elements\.(\d+)/)
    if (!origen || !destino) continue
    edges.push({ from: +origen[1], to: +destino[1], schemaName: hijo.getAttribute('schemaName') || '' })
  }

  return { nodes, edges }
}

/**
 * Un dataflow completo: a dónde escribe, qué mapea, qué filtra, qué busca y cómo se ve.
 *
 * Devuelve `null` si no escribe a ningún lado — un dataflow sin destino no es una integración que
 * haya que documentar.
 */
export function parseDataflow(dataflow, porIndice, formatos, datastoreOrigenPorOmision, datastoreDestinoPorOmision) {
  const destino = findWriter(dataflow, porIndice, formatos, datastoreDestinoPorOmision)
  if (!destino) return null

  const mapaDeEsquemas = buildSchemaMapFull(dataflow, porIndice)
  const transformaciones = parseTransforms(dataflow)

  // La última transformación es la que arma la fila que se escribe. `Target_Query` es el nombre que
  // usan los proyectos cuando existe; si no, la última en el orden del XML.
  const ultima = transformaciones.Target_Query ?? Object.values(transformaciones).at(-1) ?? null

  const mappings = []
  for (const campo of ultima?.fields ?? []) {
    if (!campo.proj) continue
    const origen = analizarCampo(campo.proj, transformaciones, mapaDeEsquemas)
    mappings.push({
      srcDS: origen.srcDS || datastoreOrigenPorOmision || '',
      srcTable: origen.srcTable,
      srcField: origen.srcField,
      dstDS: destino.targetDS,
      dstTable: destino.targetTable,
      dstField: campo.name,
      dstDesc: campo.desc || DESCRIPCION_POR_OMISION[campo.name] || '',
      ops: origen.ops,
    })
  }

  return {
    ...destino,
    mappings,
    filters: extractFilters(dataflow, transformaciones, mapaDeEsquemas),
    lookups: extractLookups(transformaciones),
    dataflowName: dataflow.getAttribute('name') || dataflow.getAttribute('displayName') || '',
    dataflowGuid: dataflow.getAttribute('guid') || '',
    diagram: parseDataflowDiagram(dataflow, porIndice),
  }
}

/**
 * Una integración entera: su trabajo y TODOS los dataflows que escriben a algún lado.
 *
 * Devuelve una lista y no un solo resultado porque un XML puede traer varios dataflows que escriben
 * a tablas distintas.
 */
export function parseIntegration(xmlTexto, entradaDeBatch = null) {
  const raiz = parseXml(xmlTexto)
  if (!raiz) return []

  const trabajo = parseJobMetadata(raiz)
  if (!trabajo?.jobName) return []

  const porIndice = buildDatastoreIndex(raiz)
  const formatos = buildFileFormatIndex(raiz)
  const srcDSName = entradaDeBatch?.src_datastore_Name || ''
  const dstDSName = entradaDeBatch?.target_datastorename || ''

  const integraciones = []

  for (const hijo of raiz.children) {
    if (hijo.localName !== 'DataFlow') continue

    const resultado = parseDataflow(hijo, porIndice, formatos, srcDSName, dstDSName)
    if (!resultado?.targetTable) continue

    const dstFinal = dstDSName || resultado.targetDS || ''

    // Lo que el dataflow no supo resolver se completa con lo que dice el `batch.csv`.
    for (const mapeo of resultado.mappings) {
      if (!mapeo.srcDS && srcDSName) mapeo.srcDS = srcDSName
      if (!mapeo.dstDS && dstFinal) mapeo.dstDS = dstFinal
    }

    integraciones.push({
      ...resultado,
      jobName: trabajo.jobName,
      jobDesc: trabajo.jobDesc,
      planArea: trabajo.planArea,
      variables: trabajo.variables,
      srcDSName,
      dstDSName: dstFinal,
      tipoIntegracion: integrationType(trabajo.jobName, isFileTarget(dstFinal), resultado.targetTable),
    })
  }

  return integraciones
}
