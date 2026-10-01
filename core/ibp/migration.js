// El análisis de campos de una migración de dato maestro: qué se copia, qué se omite y cuántas filas.
//
// Portado de `analyzeFields` de `Migration.jsx` de v8. Solo lee. Son TRES lecturas por tabla, las
// mismas de v8 y ni una más —cada petición a SAP cuesta unos seis segundos fijos—:
//
//   1. Cuántas filas tiene el ORIGEN con el filtro de esa tabla. Es la cifra del tope de volumen y
//      la que luego se usa como total al copiar, sin volver a contar.
//   2. Una fila de muestra del origen, para saber sus columnas y sus claves.
//   3. Una fila de muestra del destino, para saber las suyas.
//
// Las muestras se leen SIN filtro de versión a propósito: las columnas no dependen de la versión, y
// una lectura filtrada por versión se midió en más de sesenta segundos en algunos tenants. Sin esa
// fila de muestra —tabla vacía o lectura fallida— el esquema no se puede verificar, y entonces se
// mandan todas las columnas del origen, como hacía v8.

import { sapFetch } from '../transport/sap-fetch.js'
import { masterDataRoot } from './master-data.js'
import { CAMPOS_DE_SOLO_LECTURA, clavesDesdeUri, filtroDeDatos, sinMetadatos } from './master-data-model.js'
import { compararCampos } from './migration-plan.js'

/** Intentos de una lectura del análisis (v8: `fetchFieldNames` con dos reintentos). */
const INTENTOS_DE_LECTURA = 3

/** La espera entre intentos (v8: 1,5 s). */
const ESPERA_ENTRE_INTENTOS_MS = 1500

/** v8 le daba a la cuenta del análisis un minuto y un reintento: falla rápido en vez de en ocho. */
const ESPERA_DE_LA_CUENTA_MS = 60_000

const dormir = (ms) => new Promise((listo) => { setTimeout(listo, ms) })

/** Repite una lectura cuando el fallo es pasajero; uno de datos se devuelve a la primera. */
async function conReintentos(leer, { intentos = INTENTOS_DE_LECTURA, esperar = dormir } = {}) {
  let ultimo
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      return await leer()
    } catch (error) {
      ultimo = error
      if (error?.retryable === false || intento === intentos) break
      await esperar(ESPERA_ENTRE_INTENTOS_MS)
    }
  }
  throw ultimo
}

/**
 * Las columnas y las claves de una tabla, de UNA fila de muestra del área (sin versión).
 *
 * Devuelve `null` si la tabla está vacía: no hay fila de la que deducirlo. Lanza si no se pudo leer.
 */
export async function leerCampos({ baseUrl, credentials, entidad, planningArea, esperar }) {
  const filtro = filtroDeDatos({ planningArea })
  const url = `${masterDataRoot(baseUrl)}/${entidad}?$format=json&$top=1&$skip=0`
    + (filtro ? `&$filter=${encodeURIComponent(filtro)}` : '')

  const { json } = await conReintentos(() => sapFetch({ url, credentials, kind: 'ibp' }), { esperar })
  const muestra = (json?.d?.results ?? [])[0]
  if (!muestra) return null

  return {
    columnas: Object.keys(sinMetadatos(muestra)),
    claves: clavesDesdeUri(muestra.__metadata?.uri),
  }
}

/** Cuántas filas tiene el origen con el filtro de la tabla. `null` si no se pudo contar. */
async function contar({ baseUrl, credentials, entidad, planningArea, versionId, extraFilter, esperar }) {
  const filtro = filtroDeDatos({ planningArea, versionId, extraFilter })
  const url = `${masterDataRoot(baseUrl)}/${entidad}?$format=json&$top=0&$inlinecount=allpages`
    + (filtro ? `&$filter=${encodeURIComponent(filtro)}` : '')

  try {
    const { json } = await conReintentos(
      () => sapFetch({ url, credentials, kind: 'ibp', timeoutMs: ESPERA_DE_LA_CUENTA_MS }),
      { intentos: 2, esperar },
    )
    return Number.parseInt(json?.d?.__count ?? '0', 10)
  } catch {
    return null
  }
}

/** Una muestra que falla se trata como una tabla vacía: el esquema queda sin verificar. */
const camposOVacio = (opciones) => leerCampos(opciones).catch(() => null)

/**
 * El análisis de UNA tabla, con los nombres de v8:
 *
 *   - `count`: filas del origen con el filtro, o `null` si no se pudieron contar;
 *   - `verifiable`: si se leyeron las columnas de los dos lados;
 *   - `common`, `omitted`, `unfilled`: se copian, se omiten (no existen en el destino) y quedan
 *     vacías en el destino;
 *   - `srcFields`: todas las columnas del origen que se pueden escribir —lo que se manda cuando el
 *     esquema no se pudo verificar—;
 *   - `srcKeys` / `dstKeys`: las claves de cada lado, para ordenar al leer y para el borrado.
 *
 * Se analiza una tabla por llamada a propósito: quien llama encadena, y así ninguna llamada
 * acumula el tiempo de veinte tablas.
 */
export async function analizarTabla({ origen, destino, entidad, entidadDestino, extraFilter, esperar }) {
  const [count, deOrigen, deDestino] = await Promise.all([
    contar({
      ...origen, entidad, planningArea: origen.planningArea, versionId: origen.versionId, extraFilter, esperar,
    }),
    camposOVacio({ ...origen, entidad, planningArea: origen.planningArea, esperar }),
    camposOVacio({ ...destino, entidad: entidadDestino, planningArea: destino.planningArea, esperar }),
  ])

  const comparacion = compararCampos(deOrigen?.columnas, deDestino?.columnas, { ignorar: CAMPOS_DE_SOLO_LECTURA })
  const srcFields = (deOrigen?.columnas ?? []).filter((uno) => !CAMPOS_DE_SOLO_LECTURA.includes(uno))

  return {
    entidad,
    entidadDestino,
    count,
    verifiable: comparacion.verificable,
    common: comparacion.comunes,
    omitted: comparacion.soloEnOrigen,
    unfilled: comparacion.soloEnDestino,
    srcFields,
    srcKeys: deOrigen?.claves ?? [],
    dstKeys: deDestino?.claves ?? [],
  }
}
