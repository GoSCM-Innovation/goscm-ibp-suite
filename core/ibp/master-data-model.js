// Cómo se arma una consulta de dato maestro y cómo se lee lo que devuelve.
//
// Portado de `services/masterDataApi.js` y `services/filterUtils.js` de v8. Sin dependencias: lo
// necesitan el servidor —para hablar con SAP— y la pantalla —para dibujar los filtros y decidir el
// tamaño de página—. Importarlo del módulo de al lado arrastraría `sapFetch` al navegador.
//
// Varias de las 17 reglas de SAP viven aquí como código y no como comentario. Las que más muerden:
//
//   - Cualquier predicado sobre un campo DESCARTA las filas donde ese campo está vacío. Por eso no
//     hay operador "distinto de": `BRAND ne 'X'` devolvía 3.138 de 8.005 filas en un tenant real —
//     las ~4.900 sin marca desaparecían y ninguna sintaxis las recuperaba. Para excluir, se
//     seleccionan explícitamente los demás valores.
//   - `ne ''` es IGNORADO en silencio por SAP, que devuelve todo. Para "tiene valor" se usa `gt ''`,
//     que aprovecha esa misma regla a propósito.
//   - `$orderby` estable es obligatorio al paginar, o dos páginas se solapan y dejan huecos.

/** Los operadores de filtro, todos de INCLUSIÓN: se migra exactamente lo que nombran. */
export const OPERADORES = Object.freeze([
  { id: 'in', label: 'es igual a', ayuda: 'Uno o varios valores separados por comas.' },
  { id: 'sw', label: 'empieza por', ayuda: 'Un solo valor.' },
  { id: 'nb', label: 'tiene valor', ayuda: 'Descarta las filas con el campo vacío.' },
])

/**
 * Campos que SAP devuelve al leer pero rechaza al escribir.
 *
 * El área y la versión viajan en el contexto de la transacción; las fechas de auditoría las maneja
 * el servidor.
 */
export const CAMPOS_DE_SOLO_LECTURA = Object.freeze(['PlanningAreaID', 'VersionID', 'CREATEDDATE', 'LASTMODIFIEDDATE'])

/** Las claves que identifican el contexto de versión y no son claves de negocio. */
const CLAVES_DE_CONTEXTO = new Set(['PlanningAreaID', 'VersionID'])

/** Una fecha de OData v2: `/Date(1753734272000+0000)/`. */
const FECHA_ODATA = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/

/** Escapa un literal de texto de OData: la comilla simple se duplica. */
const escapar = (valor) => String(valor ?? '').replace(/'/g, "''")

/**
 * El literal de OData de un valor.
 *
 * Una fecha necesita un literal de fecha: comparada como texto entrecomillado, SAP contesta
 * "Invalid parametertype used at function 'eq'". El tenant devuelve el valor con desplazamiento
 * explícito, así que se emite `datetimeoffset`.
 */
export function literalOdata(valor) {
  const texto = String(valor)
  const fecha = FECHA_ODATA.exec(texto)
  if (!fecha) return `'${escapar(texto)}'`

  const iso = new Date(Number.parseInt(fecha[1], 10)).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `datetimeoffset'${iso}'`
}

/** Un valor tal como se le muestra a una persona: las fechas de OData en formato local. */
export function valorLegible(valor) {
  const fecha = FECHA_ODATA.exec(String(valor))
  return fecha ? new Date(Number.parseInt(fecha[1], 10)).toLocaleString('es') : String(valor ?? '')
}

/** Parte una lista escrita a mano en valores limpios. */
export const partirValores = (valor) =>
  String(valor ?? '').split(',').map((uno) => uno.trim()).filter(Boolean)

/**
 * El fragmento de `$filter` que corresponde a unas condiciones de la pantalla.
 *
 * Las condiciones se unen con `and`. Una condición incompleta se ignora en vez de romper la
 * consulta: quien está escribiendo un filtro pasa por estados a medias todo el rato.
 */
export function filtroDeCondiciones(condiciones) {
  const partes = []

  for (const una of condiciones ?? []) {
    if (!una?.field) continue

    if (una.op === 'nb') {
      partes.push(`${una.field} gt ''`)
      continue
    }

    const valores = partirValores(una.value)
    if (valores.length === 0) continue

    if (una.op === 'sw') {
      // `startswith` es una función de texto, así que el valor va entrecomillado sin más.
      partes.push(`startswith(${una.field},'${escapar(valores[0])}')`)
    } else if (valores.length === 1) {
      partes.push(`${una.field} eq ${literalOdata(valores[0])}`)
    } else {
      partes.push(`(${valores.map((uno) => `${una.field} eq ${literalOdata(uno)}`).join(' or ')})`)
    }
  }

  return partes.join(' and ')
}

/** Una etiqueta corta de una condición, para enseñarla al lado de la tabla. */
export function etiquetaDeCondicion(condicion) {
  if (!condicion?.field) return null
  if (condicion.op === 'nb') return `${condicion.field} ≠ ∅`

  const valores = partirValores(condicion.value).map(valorLegible)
  if (valores.length === 0) return null
  if (condicion.op === 'sw') return `${condicion.field} ⌐ ${valores[0]}…`
  if (valores.length === 1) return `${condicion.field} = ${valores[0]}`
  if (valores.length <= 3) return `${condicion.field} ∈ [${valores.join(', ')}]`
  return `${condicion.field} ∈ [${valores.slice(0, 3).join(', ')} +${valores.length - 3}]`
}

/** El `$filter` completo: el contexto de área y versión, más lo que pidió quien mira. */
export function filtroDeDatos({ planningArea, versionId, extraFilter } = {}) {
  const partes = []
  if (planningArea) partes.push(`PlanningAreaID eq '${escapar(planningArea)}'`)
  if (versionId) partes.push(`VersionID eq '${escapar(versionId)}'`)
  // El filtro de quien mira ya es un fragmento válido; entre paréntesis para que el `and` una bien.
  if (extraFilter) partes.push(`(${extraFilter})`)
  return partes.join(' and ')
}

/** Quita el sobre que OData le pone a cada fila. */
export function sinMetadatos(fila) {
  const { __metadata, ...resto } = fila ?? {}
  return resto
}

/** Quita los campos que SAP no acepta al escribir. */
export const sinCamposDeSoloLectura = (filas) => (filas ?? []).map((fila) => {
  const limpia = { ...fila }
  for (const campo of CAMPOS_DE_SOLO_LECTURA) delete limpia[campo]
  return limpia
})

/**
 * Las claves de negocio de una entidad, sacadas de la dirección de una fila.
 *
 * De `.../AS1UOMTO(UOMTOID='2X',PlanningAreaID='ASIBPTS',VersionID='ZPRUEBARED')` salen las claves
 * sin las de contexto. Sirven para ordenar de forma estable al paginar; si no se pueden deducir se
 * devuelve una lista vacía y quien llama lee sin orden, que es peor pero no es un error.
 */
export function clavesDesdeUri(uri) {
  const dentro = /\(([^)]*)\)\s*$/.exec(String(uri ?? ''))
  if (!dentro) return []

  return dentro[1].split(',')
    .map((parte) => parte.split('=')[0].trim())
    .filter((clave) => clave && !CLAVES_DE_CONTEXTO.has(clave))
}

/**
 * El catálogo de áreas, versiones y tipos, a partir de las filas planas del tenant.
 *
 * Devuelve `{ [area]: { desc, versions: [{ id, name, mdts }] } }`.
 */
export function catalogoDesdeVsmt(filas) {
  const areas = new Map()

  for (const fila of filas ?? []) {
    const area = fila.PlanningAreaID
    if (!area) continue

    const suya = areas.get(area) ?? { desc: fila.PlanningAreaDescr || area, versions: new Map() }
    const version = suya.versions.get(fila.VersionID) ?? { name: fila.VersionName || fila.VersionID, mdts: new Set() }
    if (fila.MasterDataTypeID) version.mdts.add(fila.MasterDataTypeID)

    suya.versions.set(fila.VersionID, version)
    areas.set(area, suya)
  }

  return Object.fromEntries([...areas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, suya]) => [area, {
      desc: suya.desc,
      versions: [...suya.versions.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, version]) => ({ id, name: version.name, mdts: [...version.mdts].sort() })),
    }]))
}

// ── Tamaño de página ─────────────────────────────────────────────────────────
//
// El límite real no son filas, son BYTES, y leer y escribir tienen presupuestos distintos. Al
// relevar respuestas de varios megas, el cuerpo llegaba cortado a la mitad de una cadena y el JSON
// ya no se podía interpretar; páginas más pequeñas mantienen cada respuesta lejos de esa zona.

/** Techo de una respuesta de lectura, por debajo de donde aparecían los cortes. */
export const PRESUPUESTO_DE_LECTURA = 900_000

/** Techo del cuerpo de una escritura, cómodamente por debajo del límite de la función. */
export const PRESUPUESTO_DE_ESCRITURA = 3_500_000

/** Filas por página cuando no se puede estimar nada mejor. */
export const FILAS_POR_PAGINA = 2000

/** Bytes por fila estimados a partir del número de campos, cuando no hay una muestra que medir. */
export const bytesDeLecturaPorFila = (campos) => 500 + campos * 30

/**
 * Filas por página a partir de los bytes que ocupa una fila de verdad.
 *
 * Medido es mucho mejor que estimado: contar columnas subestima mucho las tablas de pocas columnas
 * con valores largos, que son justo las que revientan.
 */
export function filasPorPagina(bytesPorFila) {
  if (!bytesPorFila || bytesPorFila < 1) return FILAS_POR_PAGINA
  return Math.max(250, Math.min(5000, Math.floor(PRESUPUESTO_DE_LECTURA / bytesPorFila)))
}

/** Lo mismo a partir del número de campos. Es el respaldo para una tabla vacía. */
export function filasPorPaginaSegunCampos(campos) {
  if (!campos || campos < 1) return FILAS_POR_PAGINA
  return Math.max(250, Math.min(5000, Math.floor(PRESUPUESTO_DE_LECTURA / bytesDeLecturaPorFila(campos))))
}

/**
 * Las columnas que se muestran de entrada.
 *
 * Las claves siempre, y detrás el resto hasta doce: una tabla de sesenta columnas abierta entera no
 * se lee, y las claves son lo que identifica cada fila.
 */
export function columnasPorOmision(todas, claves = [], tope = 12) {
  const primeras = (claves ?? []).filter((clave) => todas.includes(clave))
  const resto = todas.filter((columna) => !primeras.includes(columna))
  return [...primeras, ...resto].slice(0, Math.max(primeras.length, tope))
}