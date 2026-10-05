// Qué tablas locales usa el explorador y con qué índices.
//
// Portado del `onupgradeneeded` de `public/js/api.js` de v7, donde eran unas cien líneas de
// condicionales repetidos. Aquí es una lista de datos: las mismas tablas y los mismos índices, pero
// declarados una vez. Eso hace que se puedan comprobar sin abrir una base de datos, y que agregar
// una tabla no sea copiar y pegar un bloque.
//
// Por qué existe todo esto: los conjuntos de dato maestro de un tenant no caben cómodos en memoria.
// v7 los baja a IndexedDB y los recorre POR CURSOR, dejando en el montón de JavaScript solo los
// índices pequeños y el subárbol del producto que se está mirando. Es una decisión de arquitectura
// que se conserva tal cual: meterlos en estado de React degrada el rendimiento y era el motivo por
// el que v7 podía con áreas de decenas de miles de productos.

/**
 * La versión del esquema. Sube cuando cambian las tablas o los índices.
 *
 * 4: se quitaron las tablas de los analizadores anteriores (ver `TABLAS_OBSOLETAS`). Los analizadores
 * ahora usan las tablas de datos de la descarga (`bom_` y `sn_`) y solo guardan aparte las filas
 * ya armadas de las dos hojas de arcos de la red.
 */
export const VERSION_DEL_ESQUEMA = 4

/** Cómo se llama la base local. Una sola, con marca de a qué tenant pertenece lo que hay dentro. */
export const NOMBRE_DE_LA_BASE = 'goscm_explorer'

/**
 * La tabla que dice de dónde salió lo que está guardado.
 *
 * v7 no la necesitaba porque trabajaba contra una sola conexión a la vez. Aquí hay varios tenants, y
 * sin esta marca los datos de uno se mezclarían con los de otro sin que nada lo advirtiera —que es
 * la clase de error que hace desconfiar de toda la pantalla—.
 */
export const TABLA_DE_ORIGEN = 'dataset'

/** Un índice por un campo del propio registro. */
const idx = (nombre, campo) => ({ nombre, campo })

/**
 * Las tablas de datos. `clave` es el campo que identifica cada fila; sin ella, se numeran solas.
 *
 * Los dos grupos son los dos consumidores: el árbol de materiales (`bom_`) y la red de suministro
 * (`sn_`). El Production Analyzer no tiene tablas propias: lee las del árbol y las dos de la red que
 * necesita (`sn_loc_prod` y `sn_loc`), igual que el `prodAnalyzer.js` de v7.
 */
export const TABLAS = Object.freeze([
  // ── Árbol de materiales ────────────────────────────────────────────────────
  { nombre: 'bom_psh', indices: [idx('by_prdid', 'PRDID'), idx('by_sourceid', 'SOURCEID')] },
  { nombre: 'bom_psi', indices: [idx('by_sourceid', 'SOURCEID')] },
  { nombre: 'bom_psr', indices: [idx('by_sourceid', 'SOURCEID')] },
  { nombre: 'bom_psisub', indices: [idx('by_sourceid', 'SOURCEID')] },
  { nombre: 'bom_psi_validity', indices: [idx('by_sourceid', 'SOURCEID')] },
  // Estas dos van por clave propia porque se consultan de a una: el producto y la ubicación que se
  // está mirando. Las demás se recorren por índice.
  { nombre: 'bom_prd', clave: 'PRDID' },
  { nombre: 'bom_loc', clave: 'LOCID' },
  // Los recursos: el maestro y su asignación a ubicaciones. Son las dos tablas que permiten decir que
  // una máquina está asignada a una planta y ninguna receta la usa —capacidad que nadie planifica—,
  // que mirando solo `bom_psr` es invisible: ahí solo salen los recursos que SÍ se usan.
  { nombre: 'bom_res', clave: 'RESID' },
  { nombre: 'bom_resloc', indices: [idx('by_locid', 'LOCID'), idx('by_resid', 'RESID')] },

  // ── Red de suministro ──────────────────────────────────────────────────────
  { nombre: 'sn_loc', indices: [idx('by_prdid', 'PRDID')] },
  { nombre: 'sn_cust', indices: [idx('by_prdid', 'PRDID')] },
  { nombre: 'sn_plant', indices: [idx('by_prdid', 'PRDID')] },
  { nombre: 'sn_psi', indices: [idx('by_prdid', 'PRDID'), idx('by_sourceid', 'SOURCEID')] },
  { nombre: 'sn_loc_prod', indices: [idx('by_prdid', 'PRDID'), idx('by_locid', 'LOCID')] },
  { nombre: 'sn_cust_prod', indices: [idx('by_prdid', 'PRDID'), idx('by_custid', 'CUSTID')] },
  { nombre: 'sn_cust_master', clave: 'CUSTID' },
])

/**
 * Las tablas que existieron en versiones anteriores del esquema y ya no se usan: son de los analizadores
 * que reemplazó la migración a v7 (la tabla de calidad propia de la suite). Al abrir la base se borran
 * SOLO estas, por su nombre: una tabla que este código no conoce no se toca.
 */
export const TABLAS_OBSOLETAS = Object.freeze([
  'pa_psh', 'pa_psi', 'pa_psisub', 'pa_psr', 'pa_loc_prod', 'pa_loc_src',
  'pa_psi_web', 'pa_product_web', 'pa_location_web', 'pa_resource_web',
  'pa_resloc_web', 'pa_psh_web', 'pa_psr_web',
  'sn_product_web', 'sn_location_web', 'sn_customer_web',
])

/**
 * Las tablas de FILAS YA ARMADAS para mostrar, con su severidad: las dos hojas de arcos de la red
 * (Location Source y Customer Source), que son las que pueden tener cientos de miles de filas.
 *
 * Guardar la fila calculada y no solo el dato crudo es lo que permite paginar un informe de cien mil
 * filas desde el disco sin retenerlo en memoria: la pantalla pide un tramo y lo dibuja. El campo `s`
 * es la severidad y lleva índice porque filtrar "solo los errores" es lo primero que hace cualquiera.
 * Es lo que hacía v7 con `sn_loc_web` y `sn_cust_web`.
 *
 * Cada registro es `{ c: [celdas], s: 'red' | 'yel' | 'ok' }`. Los nombres cortos no son descuido:
 * se repiten en cada una de esas cien mil filas.
 */
export const TABLAS_DE_VISTA = Object.freeze(['sn_loc_web', 'sn_cust_web'])

/** El campo de severidad de una tabla de vista. */
export const CAMPO_DE_SEVERIDAD = 's'

/** El índice por severidad, que todas las tablas de vista tienen. */
export const INDICE_DE_SEVERIDAD = 'by_severity'

/** Todas las tablas, de datos y de vista, con la forma que espera quien crea la base. */
export function todasLasTablas() {
  return [
    { nombre: TABLA_DE_ORIGEN, clave: 'id' },
    ...TABLAS.map((una) => ({ nombre: una.nombre, clave: una.clave ?? null, indices: una.indices ?? [] })),
    ...TABLAS_DE_VISTA.map((nombre) => ({
      nombre,
      clave: null,
      indices: [idx(INDICE_DE_SEVERIDAD, CAMPO_DE_SEVERIDAD)],
    })),
  ]
}

/** Si esa tabla existe en el esquema. Sirve para no abrir una transacción condenada a fallar. */
export function existeLaTabla(nombre) {
  return todasLasTablas().some((una) => una.nombre === nombre)
}

/**
 * Cómo se identifica el conjunto de datos guardado.
 *
 * El tenant, el área y la versión. Si cambia cualquiera de los tres, lo guardado ya no sirve: son
 * datos de otro sitio, no una versión vieja de los mismos.
 */
export const marcaDeOrigen = ({ connectionId, planningArea, versionId = '' }) =>
  `${connectionId ?? ''}|${planningArea ?? ''}|${versionId}`

/** Si lo guardado corresponde a lo que se quiere mirar. */
export const mismoOrigen = (guardada, pedido) =>
  Boolean(guardada) && guardada === marcaDeOrigen(pedido)
