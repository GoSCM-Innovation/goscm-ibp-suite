// Copiar dato maestro de un tenant a otro: los pasos de la carga, uno por llamada.
//
// Portado de `runMigration` de `Migration.jsx` de v8, que lo hacía todo en el navegador a través de un
// proxy, con las credenciales en el `localStorage`. Aquí cada paso que habla con SAP es una función
// de esta capa, y la pantalla los ENCADENA llamando a nuestro servidor —nunca a SAP—. La forma y los
// números son los de v8 (ver `migration-plan.js`):
//
//   preparar   → contar el destino ANTES y medir cuántos bytes pesa una fila del origen;
//   borrar     → (reemplazo completo) mandar a staging un trozo de claves con `DeleteEntries: true`;
//   cargar     → leer un segmento del origen y mandarlo a staging, en una transacción NUEVA;
//   confirmar  → confirmar esa transacción;
//   estado     → preguntar UNA vez si SAP ya la procesó;
//   mensajes   → una página de los mensajes de las filas rechazadas.
//
// Por qué cargar y confirmar van en llamadas SEPARADAS: es lo que mantiene la promesa de «⊘ Cancelar»
// de v8 —«la transacción actual no se confirmará»—. El servidor no se entera de que el navegador
// canceló; si la llamada de carga confirmara ella misma, una cancelación a mitad dejaría confirmado el
// segmento en vuelo. Separadas, el navegador simplemente no pide la confirmación y SAP descarta la
// transacción sola.
//
// NADA de aquí reintenta un envío. Si algo falla, la transacción se queda sin confirmar y quien llama
// repite el segmento ENTERO en una transacción nueva. Repetir un envío dentro de la misma
// transacción duplica claves, y al confirmar SAP rechaza las dos copias: el registro se pierde.

import { sapFetch } from '../transport/sap-fetch.js'
import { countEntity, masterDataRoot, readEntityPage } from './master-data.js'
import {
  abrirSesionDeEscritura,
  commitTransaction,
  getExportResult,
  getTransactionId,
  initiateParallelProcess,
  partirEnEnvios,
  postTransChunk,
} from './master-data-write.js'
import { filasPorPagina, filasPorPaginaSegunCampos, filtroDeDatos } from './master-data-model.js'
import { BASE_VERSION_ID, ENVIOS_A_LA_VEZ, PAGINAS_A_LA_VEZ, esRechazo } from './migration-plan.js'

/** Filas de la muestra con que se mide el peso de una fila (v8: `measureRowBytes`, 200). */
export const FILAS_DE_MUESTRA = 200

/** Mensajes por página. Con `$expand` cada mensaje trae su fila, y la respuesta tiene un límite. */
export const MENSAJES_POR_PAGINA = 1000

/** Los nombres de transacción de v8, cuando quien llama no pone uno. */
export const NOMBRE_DE_CARGA = 'IBP-ControlTower-MD'
export const NOMBRE_DE_BORRADO = 'IBP-ControlTower-DEL'

/** Un literal de texto de OData dentro de una dirección. */
const literal = (valor) => `%27${encodeURIComponent(String(valor ?? ''))}%27`

/** Manda `envios` de `ENVIOS_A_LA_VEZ` en `ENVIOS_A_LA_VEZ`, sin repetir ninguno. */
async function mandarEnTandas(envios, mandar) {
  for (let i = 0; i < envios.length; i += ENVIOS_A_LA_VEZ) {
    await Promise.all(envios.slice(i, i + ENVIOS_A_LA_VEZ).map(mandar))
  }
}

/**
 * Abre la transacción: el identificador y, si el tenant lo admite, el proceso en paralelo.
 *
 * `InitiateParallelProcess` es lo ÚNICO que le pone nombre visible a la ejecución en SAP. Es una
 * mejora y no un requisito: v8 ignoraba cualquier fallo suyo, y aquí también.
 */
async function abrirTransaccion({ destino, entidad, nombre, csrf }) {
  const contexto = { ...destino, entidad, planningArea: destino.planningArea, versionId: destino.versionId, csrf }
  const transactionId = await getTransactionId(contexto)
  try {
    await initiateParallelProcess({ ...contexto, transactionId, nombre })
  } catch {
    // Sin proceso en paralelo la carga sigue igual, solo sin la etiqueta.
  }
  return transactionId
}

/**
 * Cuántas filas del origen caben en una página, MIDIENDO una muestra (v8: `measureRowBytes`).
 *
 * Se mide con el mismo `$select` y el mismo filtro que la carga, y se mide la respuesta entera —lo
 * que de verdad viaja—, no el número de columnas: hay tablas de pocas columnas con valores enormes, y
 * contarlas subestima justo las que revientan. `null` si la tabla está vacía.
 */
export async function medirPorPagina({ origen, entidad, columnas, extraFilter, muestra = FILAS_DE_MUESTRA }) {
  const filtro = filtroDeDatos({ planningArea: origen.planningArea, versionId: origen.versionId, extraFilter })
  const partes = [`$top=${muestra}`, '$skip=0']
  if (columnas?.length) partes.push(`$select=${encodeURIComponent(columnas.join(','))}`)
  if (filtro) partes.push(`$filter=${encodeURIComponent(filtro)}`)

  const { text, json } = await sapFetch({
    url: `${masterDataRoot(origen.baseUrl)}/${entidad}?$format=json&${partes.join('&')}`,
    credentials: origen.credentials,
    kind: 'ibp',
  })

  const filas = json?.d?.results ?? []
  if (filas.length === 0) return null
  return filasPorPagina(Math.ceil(Buffer.byteLength(text) / filas.length))
}

/**
 * Lo que se hace una vez por tabla antes de copiar: contar el destino y medir el origen.
 *
 * Las dos cosas a la vez, y ninguna tumba la carga: sin la cuenta del destino el resultado dice «—»,
 * y sin la medida se usa la estimación por número de columnas, como en v8.
 */
export async function prepararTabla({ origen, destino, entidad, entidadDestino, columnas, campos, extraFilter }) {
  const [dstBefore, medido] = await Promise.all([
    countEntity({
      ...destino,
      entidad: entidadDestino,
      planningArea: destino.planningArea,
      versionId: destino.versionId || BASE_VERSION_ID,
    }).catch(() => null),
    medirPorPagina({ origen, entidad, columnas, extraFilter }).catch(() => null),
  ])

  return {
    dstBefore,
    porPagina: medido ?? filasPorPaginaSegunCampos(campos || columnas?.length || 60),
    medido: medido != null,
  }
}

/**
 * Lee un segmento del origen: páginas de `porPagina`, `paralelo` a la vez, con orden estable.
 *
 * Una tanda que llega vacía es el fin de la tabla (v8). Sin claves, quien llama pasa `paralelo: 1`:
 * sin un `$orderby` estable dos ventanas leídas a la vez se solapan o dejan huecos.
 */
async function leerSegmento({ origen, entidad, columnas, claves, desde, cuantas, porPagina, paralelo, extraFilter }) {
  const fin = desde + cuantas
  const filas = []

  for (let inicio = desde; inicio < fin; inicio += porPagina * paralelo) {
    const paginas = Math.min(paralelo, Math.ceil((fin - inicio) / porPagina))
    const tanda = await Promise.all(Array.from({ length: paginas }, (_, i) => {
      const skip = inicio + i * porPagina
      return readEntityPage({
        ...origen,
        entidad,
        skip,
        top: Math.min(porPagina, fin - skip),
        planningArea: origen.planningArea,
        versionId: origen.versionId,
        // Sin columnas —esquema sin verificar— se leen todas, como en v8.
        select: columnas?.length ? columnas : undefined,
        orderby: claves,
        extraFilter,
      })
    }))

    const leidas = tanda.flat()
    if (leidas.length === 0) break
    filas.push(...leidas)
  }

  return filas
}

/**
 * Carga UN segmento en staging, en una transacción NUEVA, y la deja SIN confirmar.
 *
 * Devuelve el identificador para que quien llama la confirme con `confirmarTransaccion`. Si algo
 * falla, lanza: la transacción queda sin confirmar, SAP la descarta, y lo que se repite es la llamada
 * entera —leer otra vez y mandar a otra transacción—, nunca un envío suelto.
 */
export async function cargarSegmento({
  origen, destino, entidad, entidadDestino, columnas, claves, desde = 0, cuantas,
  porPagina, paralelo = PAGINAS_A_LA_VEZ, extraFilter, nombre = NOMBRE_DE_CARGA,
}) {
  const tiempos = {}
  let marca = Date.now()

  const filas = await leerSegmento({
    origen, entidad, columnas, claves, desde, cuantas, porPagina, paralelo: Math.max(1, paralelo), extraFilter,
  })
  tiempos.reading = Date.now() - marca

  // Menos filas de las pedidas quiere decir que la tabla se acabó.
  const agotado = filas.length < cuantas
  if (filas.length === 0) return { transactionId: null, filas: 0, agotado: true, tiempos }

  marca = Date.now()
  const csrf = await abrirSesionDeEscritura(destino)
  const transactionId = await abrirTransaccion({ destino, entidad: entidadDestino, nombre, csrf })

  await mandarEnTandas(partirEnEnvios(filas), (envio) => postTransChunk({
    ...destino,
    entidad: entidadDestino,
    transactionId,
    filas: envio,
    borrar: false,
    planningArea: destino.planningArea,
    versionId: destino.versionId,
    csrf,
  }))
  tiempos.writing = Date.now() - marca

  return { transactionId, filas: filas.length, agotado, tiempos }
}

/**
 * Manda a staging un trozo de claves para BORRARLAS, en su propia transacción, sin confirmar.
 *
 * Es la primera mitad del reemplazo completo. Va en una transacción aparte de la carga porque SAP no
 * deja mezclar `DeleteEntries: true` y `false` en la misma.
 */
export async function cargarBorrado({ destino, entidadDestino, claves, nombre = NOMBRE_DE_BORRADO }) {
  if (!claves?.length) return { transactionId: null, filas: 0 }

  const csrf = await abrirSesionDeEscritura(destino)
  const transactionId = await abrirTransaccion({ destino, entidad: entidadDestino, nombre, csrf })

  await mandarEnTandas(partirEnEnvios(claves), (envio) => postTransChunk({
    ...destino,
    entidad: entidadDestino,
    transactionId,
    filas: envio,
    borrar: true,
    planningArea: destino.planningArea,
    versionId: destino.versionId,
    csrf,
  }))

  return { transactionId, filas: claves.length }
}

/** Confirma una transacción. A partir de aquí lo mandado se guarda de verdad. */
export async function confirmarTransaccion({ destino, transactionId }) {
  const csrf = await abrirSesionDeEscritura(destino)
  await commitTransaction({ ...destino, transactionId, csrf })
  return { transactionId }
}

/**
 * Pregunta UNA vez cómo va una transacción confirmada.
 *
 * Una sola pregunta por llamada: la espera de v8 era de hasta dos minutos por transacción, y esa
 * espera la lleva el navegador, que vuelve a preguntar cada dos segundos.
 */
export async function estadoDeTransaccion({ destino, transactionId }) {
  const resultado = await getExportResult({ ...destino, transactionId })
  if (resultado === null) return 'SIN_SOPORTE'
  if (resultado?.Status === 'PROCESSED') return 'PROCESADA'
  if (resultado?.Status === 'ERROR') return 'CON_ERROR'
  return 'PROCESANDO'
}

/**
 * Una página de los mensajes de una transacción, quedándose SOLO con los rechazos (E y A).
 *
 * Paginado aquí y no de una vez porque, con `$expand`, cada mensaje trae su fila, y una tabla con
 * miles de rechazos no cabe en una respuesta. `leidos` son los mensajes que llegaron —de cualquier
 * gravedad—: menos que `top` quiere decir que no hay más. Hay tenants que rechazan el `$expand`; ahí
 * se pide sin él, y `conExpand` le dice a quien llama cómo seguir.
 */
export async function leerMensajes({
  destino, entidad, transactionId, skip = 0, top = MENSAJES_POR_PAGINA, conExpand = true,
}) {
  const base = `${masterDataRoot(destino.baseUrl)}/${entidad}Message?$format=json`
    + `&$filter=TransactionID eq ${literal(transactionId)}&$top=${top}&$skip=${skip}`

  const pedir = async (expandir) => {
    const { json } = await sapFetch({
      url: `${base}${expandir ? `&$expand=Nav${entidad}` : ''}`,
      credentials: destino.credentials,
      kind: 'ibp',
    })
    return json?.d?.results ?? []
  }

  let usado = conExpand
  let pagina
  try {
    pagina = await pedir(usado)
  } catch (error) {
    if (!usado || skip > 0) throw error
    usado = false
    pagina = await pedir(false)
  }

  const rechazos = pagina.filter(esRechazo).map(({ __metadata, ...resto }) => resto)
  return { rechazos, leidos: pagina.length, conExpand: usado }
}
