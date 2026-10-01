// Qué se va a copiar de un tenant a otro, antes de copiar nada.
//
// Portado de la fase de análisis de `Migration.jsx` de v8. Sin dependencias: lo usan el servidor y
// la pantalla.
//
// Dos problemas que el plan resuelve y que, sin él, aparecen a mitad de una carga:
//
//   1. Las tablas NO se llaman igual en los dos tenants. Cada uno le pone su prefijo al mismo tipo
//      de dato maestro —`GIDPRODUCT` en uno, `AS1PRODUCT` en otro—, así que emparejarlas por nombre
//      exacto no encuentra casi nada.
//   2. Las columnas TAMPOCO coinciden. Mandar un campo que el destino no tiene hace que SAP
//      rechace la carga entera con un 400, así que se manda la intersección — y se dice cuál es,
//      porque los campos que quedan fuera no se copian y eso hay que saberlo ANTES.

/** Lo que hay que dejar del nombre para que un emparejado signifique algo. */
const RAIZ_MINIMA = 4

/** Cuántos caracteres de prefijo se prueban. Los prefijos de tenant son de tres o cuatro. */
const PREFIJO_MAXIMO = 4

/**
 * Las raíces posibles de un nombre: el nombre entero y lo que queda al quitarle prefijos.
 *
 * De `AS1PRODUCT` salen `AS1PRODUCT`, `S1PRODUCT`, `1PRODUCT`, `PRODUCT` y `RODUCT`. La buena es
 * `PRODUCT`, y se descubre porque es la más larga que también aparece en el otro tenant.
 */
export function raicesDe(nombre) {
  const texto = String(nombre ?? '')
  const raices = []
  for (let corte = 0; corte <= PREFIJO_MAXIMO && texto.length - corte >= RAIZ_MINIMA; corte += 1) {
    raices.push(texto.slice(corte))
  }
  return raices
}

/**
 * La tabla del destino que le corresponde a una del origen, o `null` si ninguna.
 *
 * El nombre idéntico gana siempre; si no, la que comparte la raíz más larga. Exigir una raíz de al
 * menos cuatro caracteres evita emparejar `GIDLAG` con `AS1LOCATION` por compartir una letra.
 */
export function emparejarTabla(origen, candidatas) {
  const lista = candidatas ?? []
  if (lista.includes(origen)) return origen

  const suyas = new Set(raicesDe(origen))
  let mejor = null
  let largo = 0

  for (const candidata of lista) {
    for (const raiz of raicesDe(candidata)) {
      if (suyas.has(raiz) && raiz.length > largo) {
        mejor = candidata
        largo = raiz.length
      }
    }
  }

  return mejor
}

/** El emparejado de todas las tablas del origen. Las que no encuentran pareja salen con `null`. */
export const emparejarTablas = (origen, destino) =>
  (origen ?? []).map((una) => ({ origen: una, destino: emparejarTabla(una, destino) }))

/**
 * Qué campos se van a copiar y cuáles no.
 *
 * `verificable` es falso cuando no se pudo leer el esquema de alguno de los dos lados —una tabla
 * vacía no tiene fila de muestra de la que deducirlo—. Ahí no se puede recortar nada y se manda
 * todo, que es lo que hacía v8; pero se marca, porque es justo el caso en el que SAP puede rechazar
 * la carga y conviene saberlo de antemano.
 */
export function compararCampos(camposOrigen, camposDestino, { ignorar = [] } = {}) {
  const limpiar = (lista) => (lista ? lista.filter((uno) => !ignorar.includes(uno)) : null)

  const origen = limpiar(camposOrigen)
  const destino = limpiar(camposDestino)

  if (!origen || !destino) {
    return { verificable: false, comunes: null, soloEnOrigen: [], soloEnDestino: [] }
  }

  const enDestino = new Set(destino)
  const enOrigen = new Set(origen)

  return {
    verificable: true,
    comunes: origen.filter((uno) => enDestino.has(uno)),
    // Están en el origen y no en el destino: NO se copian.
    soloEnOrigen: origen.filter((uno) => !enDestino.has(uno)),
    // Están en el destino y no en el origen: quedan como estén.
    soloEnDestino: destino.filter((uno) => !enOrigen.has(uno)),
  }
}

// ── La corrida, como la hacía v8 ─────────────────────────────────────────────────────────────────
//
// Lo de aquí abajo es la forma de la carga de `Migration.jsx` de v8 (`runMigration`), sacada a
// funciones puras para que la pantalla y el servidor digan lo mismo y para poder probarla. Los
// números son los de v8, medidos allí contra tenants reales; lo que cambia es DÓNDE se ejecuta cada
// paso: v8 lo hacía todo en el navegador a través de un proxy, aquí cada lectura y cada escritura a
// SAP es una llamada a nuestro servidor, y el navegador solo encadena.

/**
 * El identificador de la versión base al CONTAR en el destino.
 *
 * v8 contaba el destino «antes» y «después» con `versionId || '__BASELINE'`. Ojo: para LEER y para
 * ESCRIBIR la versión base sigue siendo la versión vacía —la transacción se mienta sin área ni
 * versión—; este identificador es solo el de la cuenta, como en v8.
 */
export const BASE_VERSION_ID = '__BASELINE'

/** Filas por segmento confirmado. Cada segmento es su propia transacción (v8: `SEGMENT_SIZE`). */
export const FILAS_POR_SEGMENTO = 20_000

/**
 * Cuántos segmentos se copian a la vez (v8: `CONCURRENT_SEGMENTS`).
 *
 * Son transacciones independientes sobre rangos de claves distintos, así que mientras una escribe
 * otra lee. v8 lo midió: 4 → 821 filas/s, 6 → 1.505 filas/s, sin errores. Aquí cada segmento es una
 * llamada a nuestro servidor, y es el navegador el que tiene seis en vuelo.
 */
export const SEGMENTOS_A_LA_VEZ = 6

/** Páginas que se leen a la vez dentro de un segmento (v8: `PARALLEL_R`). */
export const PAGINAS_A_LA_VEZ = 6

/** Envíos a staging a la vez dentro de un segmento (v8: `PARALLEL_W`). */
export const ENVIOS_A_LA_VEZ = 4

/**
 * Cuántas veces se intenta un segmento, contando el primero (v8: `MAX_SEGMENT_ATTEMPTS`).
 *
 * Cada intento es una transacción NUEVA: la que falló se queda sin confirmar y SAP la descarta. Un
 * envío ya mandado a staging no se repite nunca dentro de la misma transacción.
 */
export const INTENTOS_POR_SEGMENTO = 5

/** La espera antes del intento `n` (v8: `1500 * attempt`). */
export const esperaAntesDeReintentar = (intento) => 1500 * intento

/**
 * Cuántas rondas de lectura en paralelo caben en UNA llamada al servidor.
 *
 * Esto no existía en v8, que no tenía funciones con límite de tiempo. Un segmento de veinte mil filas
 * con páginas de 250 —una tabla de filas muy pesadas— son ochenta páginas: trece rondas de seis, más
 * de un minuto solo leyendo, y luego hay que escribirlo. Con tres rondas como mucho, una llamada lee
 * a lo sumo dieciocho páginas (tres veces el costo fijo de ~6 s por petición, más lo que tarde cada
 * una) y escribe lo leído en dos rondas de envíos, lejos del tiempo de la función.
 */
export const RONDAS_DE_LECTURA_POR_LLAMADA = 3

/**
 * El tamaño de segmento para una tabla, sabiendo cuántas filas caben en una página.
 *
 * El de v8 —veinte mil— salvo cuando las páginas son tan pequeñas que el segmento no cabría en una
 * llamada: entonces se achica a lo que se lee en `RONDAS_DE_LECTURA_POR_LLAMADA` rondas. Sin claves
 * se lee de una página en una (ver `paginasALaVez`), y el tope se calcula con eso.
 */
export function filasPorSegmento(porPagina, { paralelo = PAGINAS_A_LA_VEZ } = {}) {
  const pagina = Math.max(1, Number(porPagina) || 0)
  return Math.max(pagina, Math.min(FILAS_POR_SEGMENTO, pagina * Math.max(1, paralelo) * RONDAS_DE_LECTURA_POR_LLAMADA))
}

/**
 * Páginas a la vez y segmentos a la vez, según haya o no claves para ordenar.
 *
 * Sin un `$orderby` estable, dos ventanas de `$skip` leídas a la vez se solapan o dejan huecos, y un
 * hueco es un registro que no se copia. v8 lo resolvía leyendo en serie: una página y un segmento.
 */
export function paralelismo(claves) {
  const conOrden = (claves ?? []).length > 0
  return {
    paginas: conOrden ? PAGINAS_A_LA_VEZ : 1,
    segmentos: conOrden ? SEGMENTOS_A_LA_VEZ : 1,
  }
}

/** Dónde empieza cada segmento de una tabla de `total` filas. */
export function iniciosDeSegmento(total, tamano = FILAS_POR_SEGMENTO) {
  const inicios = []
  const paso = Math.max(1, Number(tamano) || FILAS_POR_SEGMENTO)
  for (let desde = 0; desde < (Number(total) || 0); desde += paso) inicios.push(desde)
  return inicios
}

/**
 * Si un fallo merece otro intento (v8: `status === 403 || status == null || status >= 500`).
 *
 * El 403 cuenta porque en v8 era el token de escritura caducado; aquí cada llamada pide el suyo, así
 * que repetir es justo lo que lo renueva. Un 400 es un dato que SAP no acepta, y repetirlo no cambia
 * nada.
 */
export function esFalloTransitorio(error) {
  const estado = error?.status
  return estado == null || estado === 0 || estado === 403 || estado >= 500
}

/** Un mensaje de SAP que significa una fila RECHAZADA. Solo la gravedad E y la A. */
export const esRechazo = (mensaje) => ['E', 'A'].includes(mensaje?.Severity)

/**
 * El estado de una tabla al terminar (v8, en este orden):
 *
 *   - alguna transacción terminó en ERROR → `error`;
 *   - SAP rechazó filas → `warning` («Procesado con errores»);
 *   - alguna no se llegó a confirmar como procesada → `processing` (sigue aplicándose en SAP);
 *   - si no, `ok`.
 */
export function estadoDeTabla({ conError = false, rechazadas = 0, sinConfirmar = false } = {}) {
  if (conError) return 'error'
  if (rechazadas > 0) return 'warning'
  if (sinConfirmar) return 'processing'
  return 'ok'
}

/** El estado de la corrida entera, para el historial (v8: el peor de las tablas, en este orden). */
export function estadoDeCorrida(resultados) {
  const estados = (resultados ?? []).map((uno) => uno.status)
  for (const estado of ['cancelled', 'error', 'processing', 'warning']) {
    if (estados.includes(estado)) return estado
  }
  return 'ok'
}

/**
 * Parte filas en trozos de como mucho `maxFilas` y `maxBytes`.
 *
 * Para las claves del borrado: v8 las leía TODAS antes de borrar —una foto, para que confirmar un
 * segmento de borrado no corriera las ventanas de `$skip` de los siguientes— y las borraba de veinte
 * mil en veinte mil. Aquí esa foto viaja del navegador al servidor, y el cuerpo de una petición tiene
 * un límite de unos 4,5 MB, así que el trozo se corta también por bytes.
 */
export function partirPorBytes(filas, { maxFilas = FILAS_POR_SEGMENTO, maxBytes = 3_000_000 } = {}) {
  const trozos = []
  let actual = []
  let bytes = 0

  for (const fila of filas ?? []) {
    const suyos = JSON.stringify(fila).length + 1
    if (actual.length > 0 && (bytes + suyos > maxBytes || actual.length >= maxFilas)) {
      trozos.push(actual)
      actual = []
      bytes = 0
    }
    actual.push(fila)
    bytes += suyos
  }

  if (actual.length > 0) trozos.push(actual)
  return trozos
}

/**
 * Cuánto se espera a que SAP procese una transacción (v8:
 * `Math.min(1800000, Math.max(120000, SEGMENT_SIZE * 4))`).
 */
export const ESPERA_DE_PROCESO_MS = Math.min(1_800_000, Math.max(120_000, FILAS_POR_SEGMENTO * 4))
