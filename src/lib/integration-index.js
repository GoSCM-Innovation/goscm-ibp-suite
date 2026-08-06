// Qué hay dentro de un export de CI-DS y cómo se encadenan sus integraciones.
//
// Portado de `public/legacy/js/explorer.js` de v9. Encima del parser de `cids-export.js`, esta capa
// arma los índices que hacen navegable un proyecto de cientos de dataflows y descubre qué
// integración alimenta a cuál — que es la pregunta que nadie puede contestar mirando CI-DS.
//
// Va en el navegador porque el ZIP nunca sale del equipo.

import JSZip from 'jszip'

import { parseBatchCsv, parseIntegration } from './cids-export.js'

/** ¿Este nombre de datastore es de archivos? */
const esDatastoreDeArchivo = (nombre) => /(FILE|ARCHIVOS)/i.test(nombre || '')

/**
 * La clave con la que se compara una tabla entre integraciones.
 *
 * No se recorta ninguna ruta: los nombres de tabla de SAP con namespace de ABAP (`/SPMEAT/CUTK`,
 * `/BIC/AZPP_RVO022`) tienen que quedar enteros o dos tablas distintas colapsarían en una.
 */
export const normTableKey = (datastore, tabla) => `${(datastore || '').trim().toUpperCase()}::${(tabla || '').trim().toUpperCase()}`

/** La clave de un archivo: solo el nombre, sin la ruta — cada lado lo escribe con la suya. */
export function normFileKey(archivo) {
  if (!archivo) return ''
  return `FILE::${archivo.replace(/^.*[\\/]/, '').toUpperCase()}`
}

/** Solo el nombre del archivo, en mayúsculas, sin la ruta. */
const soloNombre = (ruta) => (ruta || '').replace(/^.*[\\/]/, '').toUpperCase()

/** El nombre sin la extensión: el productor y el consumidor no siempre usan la misma. */
const sinExtension = (nombre) => nombre.replace(/\.[^.]+$/, '')

/**
 * Palabras de SQL y funciones que aparecen en toda expresión y no son campos.
 *
 * Sin esta lista, buscar por campo devolvería medio proyecto en cada término.
 */
const PALABRAS_DE_SQL = new Set([
  'AND', 'OR', 'NOT', 'IS', 'NULL', 'IN', 'LIKE', 'BETWEEN', 'EXISTS', 'SELECT',
  'FROM', 'WHERE', 'JOIN', 'ON', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'TRIM', 'UPPER', 'LOWER', 'SUBSTR', 'LENGTH', 'CONVERT', 'CAST', 'COALESCE',
  'IFTHENELSE', 'ISNULL', 'IFNULL', 'IIF', 'SYSDATE', 'GEN_UUID',
])

/**
 * Los campos que menciona una expresión de filtro, para poder buscarlos.
 *
 * De `TABLA.CAMPO` se queda con el campo: quien busca "MATNR" quiere todos los filtros que lo
 * tocan, sin importar en qué tabla.
 *
 * Se descarta lo que está entre comillas antes de mirar nada. v9 no lo hacía, y el valor de
 * `MTART = 'FERT'` terminaba listado como si fuera un campo del filtro.
 */
export function extractFilterFields(expresion) {
  const campos = new Set()
  const sinLiterales = String(expresion ?? '').replace(/'[^']*'|"[^"]*"/g, ' ')
  const buscador = /\b([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\b/g

  let coincidencia = buscador.exec(sinLiterales)
  while (coincidencia !== null) {
    const izquierda = coincidencia[1].toUpperCase()
    const derecha = coincidencia[2] ? coincidencia[2].toUpperCase() : null

    if (derecha) {
      if (!PALABRAS_DE_SQL.has(derecha)) campos.add(derecha)
    } else if (!PALABRAS_DE_SQL.has(izquierda) && izquierda.length >= 2) {
      // Una sola letra suele ser el alias de una tabla, no un campo.
      campos.add(izquierda)
    }

    coincidencia = buscador.exec(sinLiterales)
  }

  return [...campos]
}

/**
 * Qué archivo lee cada `lookup(...)`: `{ ds, file }` por cada uno.
 *
 * `ds` es lo que va antes del punto —que en los lookups a archivo es el nombre del FORMATO, no el
 * de un datastore— y `file` el archivo físico. Se guardan los dos porque el productor puede
 * nombrar su formato distinto del csv que escribe, y entonces solo empareja uno de los dos.
 */
export function extractLookupPairs(lookups) {
  const pares = []
  const buscador = /lookup\s*\(\s*([A-Za-z_][A-Za-z0-9_/]*)\s*\.\s*(?:"([^"]+)"|([A-Za-z0-9_][A-Za-z0-9_./-]*))/gi

  for (const lookup of lookups || []) {
    buscador.lastIndex = 0
    let coincidencia = buscador.exec(lookup.func)
    while (coincidencia !== null) {
      const ds = (coincidencia[1] || '').toUpperCase()
      if (ds) pares.push({ ds, file: soloNombre(coincidencia[2] || coincidencia[3] || '') })
      coincidencia = buscador.exec(lookup.func)
    }
  }

  return pares
}

/** Agrega `valor` a `mapa[clave]` sin repetir. */
function agregar(mapa, clave, valor) {
  if (!clave) return
  if (!mapa[clave]) mapa[clave] = []
  if (!mapa[clave].includes(valor)) mapa[clave].push(valor)
}

/** Agrega una referencia a una fila concreta (un mapeo o un filtro dentro de una integración). */
function agregarFila(mapa, clave, fila) {
  if (!clave) return
  if (!mapa[clave]) mapa[clave] = []
  mapa[clave].push(fila)
}

/**
 * Todos los índices que necesita el explorador, en un solo recorrido.
 *
 * Los `by*Key` son para encadenar integraciones; los `by*Table`/`by*Field` son las dimensiones por
 * las que se puede explorar el proyecto (ver una tabla y todas las integraciones que la escriben,
 * por ejemplo); `searchTokens` es el texto de cada integración para la búsqueda global.
 */
export function buildIndexes(integraciones) {
  const indices = {
    byTargetKey: {},
    bySourceKey: {},
    byFileWritten: {},
    byFileRead: {},
    searchTokens: [],
    byDstTable: {},
    bySrcTable: {},
    byDstField: {},
    bySrcField: {},
    byFilterTable: {},
    byFilterField: {},
  }

  for (const integracion of integraciones) {
    const i = integracion._idx

    agregar(indices.byTargetKey, normTableKey(integracion.dstDSName, integracion.targetTable), i)
    if (integracion.fileLoaderFileName) {
      agregar(indices.byFileWritten, normFileKey(integracion.fileLoaderFileName), i)
    }
    // Cuando el destino es un datastore de archivos, la "tabla" destino ES el archivo.
    if (esDatastoreDeArchivo(integracion.dstDSName)) {
      agregar(indices.byFileWritten, normFileKey(integracion.targetTable), i)
    }

    integracion.mappings.forEach((mapeo, mIdx) => {
      agregar(indices.bySourceKey, normTableKey(mapeo.srcDS, mapeo.srcTable), i)
      if (esDatastoreDeArchivo(mapeo.srcDS)) {
        agregar(indices.byFileRead, normFileKey(mapeo.srcTable), i)
      }

      agregarFila(
        indices.byDstTable,
        normTableKey(mapeo.dstDS || integracion.dstDSName, mapeo.dstTable || integracion.targetTable),
        { intIdx: i, mIdx },
      )

      // Un campo puede salir de varias tablas: `srcTable` viene como "MARA, MAKT".
      for (const tabla of (mapeo.srcTable || '').split(/,\s*/)) {
        if (tabla.trim()) agregarFila(indices.bySrcTable, normTableKey(mapeo.srcDS, tabla.trim()), { intIdx: i, mIdx })
      }

      if (mapeo.dstField) agregarFila(indices.byDstField, mapeo.dstField.toUpperCase(), { intIdx: i, mIdx })

      // `srcField` puede venir como "MARA.MATNR, MAKT.MAKTX" o como "MATNR" a secas.
      for (const campo of (mapeo.srcField || '').split(/,\s*/)) {
        const solo = campo.trim().replace(/^[^.]+\./, '')
        if (solo) agregarFila(indices.bySrcField, solo.toUpperCase(), { intIdx: i, mIdx })
      }
    })

    integracion.filters.forEach((filtro, fIdx) => {
      for (const tabla of (filtro.sourceTable || '').split(/,\s*/)) {
        if (tabla.trim()) agregarFila(indices.byFilterTable, normTableKey('', tabla.trim()), { intIdx: i, fIdx })
      }
      for (const campo of extractFilterFields(filtro.expression)) {
        agregarFila(indices.byFilterField, campo, { intIdx: i, fIdx })
      }
    })

    const tablasDeLookup = extractLookupPairs(integracion.lookups).map((par) => par.file || par.ds)
    indices.searchTokens.push({
      idx: i,
      tokens: [
        integracion.jobName, integracion.dataflowName, integracion.srcDSName,
        integracion.dstDSName, integracion.targetTable,
        ...integracion.mappings.flatMap((m) => [m.dstField, m.dstDesc, m.srcField, m.srcTable, m.ops]),
        ...integracion.filters.map((f) => f.expression),
        ...integracion.variables.map((v) => v.name),
        ...tablasDeLookup,
        ...integracion.lookups.map((l) => l.func),
      ].filter(Boolean).join(' ').toLowerCase(),
    })
  }

  return indices
}

/**
 * Un nombre demasiado corto empareja con cualquier cosa. De v9.
 *
 * Con menos de cuatro caracteres, los falsos positivos superan a los aciertos.
 */
const LARGO_MINIMO = 4

/** ¿La integración `b` lee la tabla que escribe `a`? */
function leeLaTabla(b, a) {
  const claveDestino = normTableKey(a.dstDSName, a.targetTable)
  const claveDestinoSinDS = normTableKey('', a.targetTable)
  const aEsArchivo = a.tipoIntegracion === 'FILE'

  return b.mappings.some((mapeo) => {
    if (!mapeo.srcTable) return false

    // Nivel 1: coincide el datastore Y la tabla. No hay duda posible.
    if (normTableKey(mapeo.srcDS, mapeo.srcTable) === claveDestino) return true

    // Nivel 2: coincide solo la tabla. Se acepta únicamente entre integraciones de base de datos:
    // entre archivos, dos formatos con el mismo nombre no significan que uno alimente al otro.
    if (aEsArchivo) return false
    if (esDatastoreDeArchivo(mapeo.srcDS) || (mapeo.srcDS || '').toUpperCase() === 'FILE') return false

    const claveOrigenSinDS = normTableKey('', mapeo.srcTable)
    return claveOrigenSinDS === claveDestinoSinDS
      && claveOrigenSinDS.replace('::', '').length >= LARGO_MINIMO
  })
}

/** ¿La integración `b` lee el archivo que escribe `a`? */
function leeElArchivo(b, formatoDeA, archivoDeA) {
  return b.mappings.some((mapeo) => {
    if (!mapeo.srcTable) return false

    // El lector expone el nombre del FORMATO, no el del archivo físico.
    const formatoDeB = soloNombre(mapeo.srcTable)
    if (formatoDeB !== formatoDeA) return false

    const datastoreDeB = (mapeo.srcDS || '').toUpperCase()
    if (datastoreDeB && datastoreDeB !== 'FILE' && !esDatastoreDeArchivo(datastoreDeB)) return false

    if (archivoDeA.length >= LARGO_MINIMO) {
      return sinExtension(archivoDeA) === formatoDeB || formatoDeB === formatoDeA
    }
    return true
  })
}

/** ¿Algún `lookup(...)` de `b` apunta a lo que escribe `a`? Devuelve el par que emparejó. */
function buscaConLookup(b, formatoDeA, archivoDeA) {
  const baseDeA = sinExtension(archivoDeA)

  return extractLookupPairs(b.lookups).find((par) => {
    const baseDelLookup = sinExtension(par.file)

    // (a) El lookup nombra el formato que escribe A.
    if (par.ds === formatoDeA) {
      // Si los dos lados dicen qué archivo es, tienen que ser el mismo.
      if (archivoDeA.length >= LARGO_MINIMO && par.file.length >= LARGO_MINIMO) return baseDeA === baseDelLookup
      return true
    }

    // (b) El productor llamó a su formato distinto del csv que escribe, y el lookup nombra el csv.
    return baseDeA.length >= LARGO_MINIMO && baseDelLookup.length >= LARGO_MINIMO && baseDeA === baseDelLookup
  })
}

/**
 * Qué integración alimenta a cuál: la pregunta que no se puede contestar mirando CI-DS.
 *
 * Hay tres formas de que una integración dependa de otra, y se prueban en orden de confianza:
 * por tabla, por archivo, y por `lookup`. Una vez que dos integraciones quedaron unidas por una
 * vía, no se vuelven a unir por otra — la primera es la más fiable.
 */
export function detectChains(integraciones) {
  const aristas = []
  const unidas = new Set()

  for (const a of integraciones) {
    const formatoDeA = soloNombre(a.targetTable)
    const archivoDeA = soloNombre(a.fileLoaderFileName)
    const aEsArchivo = a.tipoIntegracion === 'FILE'

    for (const b of integraciones) {
      if (b._idx === a._idx) continue
      const par = `${a._idx}→${b._idx}`
      if (unidas.has(par)) continue

      if (leeLaTabla(b, a)) {
        unidas.add(par)
        aristas.push({ from: a._idx, to: b._idx, via: 'table', label: a.targetTable })
        continue
      }

      if (aEsArchivo && formatoDeA.length >= LARGO_MINIMO && leeElArchivo(b, formatoDeA, archivoDeA)) {
        unidas.add(par)
        aristas.push({ from: a._idx, to: b._idx, via: 'file', label: a.targetTable })
        continue
      }

      if (b.lookups.length > 0 && (formatoDeA.length >= LARGO_MINIMO || archivoDeA.length >= LARGO_MINIMO)) {
        const lookup = buscaConLookup(b, formatoDeA, archivoDeA)
        if (lookup) {
          unidas.add(par)
          aristas.push({ from: a._idx, to: b._idx, via: 'lookup', label: lookup.file || formatoDeA })
        }
      }
    }
  }

  return aristas
}

/**
 * Lee los ZIP de export y devuelve una integración por cada dataflow con destino.
 *
 * Cada una lleva de qué ZIP salió y su número de orden, que es como la referencian los índices y
 * las cadenas. Un ZIP que no se puede leer se salta con su error anotado: un archivo corrupto entre
 * diez no puede dejar sin explorar a los otros nueve.
 */
export async function analyzeZips(archivos) {
  const integraciones = []
  const errores = []

  for (const archivo of archivos) {
    try {
      const zip = await JSZip.loadAsync(archivo.data)
      const porArchivo = await parseBatchCsv(zip)

      // Solo los XML de la raíz: los de subcarpetas son plantillas, no integraciones.
      const nombres = Object.keys(zip.files).filter((uno) => uno.endsWith('.xml') && !uno.includes('/'))

      for (const nombre of nombres) {
        const xml = await zip.file(nombre).async('string')
        for (const integracion of parseIntegration(xml, porArchivo[nombre])) {
          integraciones.push({ ...integracion, _zipName: archivo.name, _idx: integraciones.length })
        }
      }
    } catch (error) {
      errores.push({ archivo: archivo.name, mensaje: error?.message || String(error) })
    }
  }

  return { integraciones, errores }
}

/**
 * Analiza los ZIP y deja todo listo para explorar: integraciones, índices y cadenas.
 */
export async function analyzeProject(archivos) {
  const { integraciones, errores } = await analyzeZips(archivos)
  return {
    integraciones,
    errores,
    indices: buildIndexes(integraciones),
    cadenas: detectChains(integraciones),
  }
}
