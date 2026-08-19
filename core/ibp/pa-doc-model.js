// Qué lleva la documentación de un área de planificación, y de dónde sale cada dato.
//
// Portado de `paDoc.js` de v7. Aquí está el modelo —qué secciones hay, cómo se reconoce cada archivo,
// qué columnas se enseñan de cada una y qué dice el resumen ejecutivo—; el armado del `.docx` está en
// `src/lib/docx.js` y la pantalla en `data/PlanningAreaDoc.jsx`.
//
// El dato de entrada son los CSV que SAP IBP exporta de la configuración de un área. No se leen por
// API porque esa configuración —los niveles de planificación, las definiciones de cálculo, los
// operadores— no está expuesta en los servicios de comunicación: se saca de la pantalla de
// configuración del área. Es una limitación de SAP, no una decisión de esta herramienta, y por eso el
// documento se arma con lo que el consultor exporta.
//
// Lo que sí se puede enriquecer en vivo son los Application Jobs, que SÍ tienen API —la misma de
// `SAP_COM_0326` que usa el monitor de trabajos—, así que el documento puede decir además con qué
// trabajos se carga y se ejecuta el área.

/** Las secciones que SAP exporta, con lo que se sabe de cada una. */
export const SECCIONES = Object.freeze([
  {
    id: 'GENERAL_INFO',
    titulo: 'Información general',
    esencial: true,
    columnas: [],
  },
  {
    id: 'TIMEPROFILE',
    titulo: 'Perfil de tiempo',
    columnas: ['Time Profile ID', 'Time Profile Level', 'Time Profile Level Description', 'Period Type'],
  },
  {
    id: 'MASTERDATATYPES',
    titulo: 'Tipos de dato maestro',
    esencial: true,
    columnas: [
      'Master Data Type ID', 'Attribute ID', 'Attribute Description', 'Data Type', 'Length',
      'Key', 'Required', 'Referenced Master Data Type',
    ],
  },
  {
    id: 'PA_ATTRIBUTES',
    titulo: 'Atributos del área',
    columnas: ['Planning Area Attribute', 'Attribute Description', 'Data Type', 'Length'],
  },
  {
    id: 'PLEVELS_ATTRS',
    titulo: 'Niveles de planificación',
    esencial: true,
    columnas: ['Planning Level', 'Planning Level Description', 'Attribute'],
  },
  {
    id: 'KEYFIGURES',
    titulo: 'Cifras clave',
    esencial: true,
    columnas: [
      'Key Figure', 'Key Figure Description', 'Base Planning Level', 'Stored Key Figure',
      'Calculated Key Figure', 'Aggregation Mode', 'Unit of Measure', 'Hashtags',
    ],
  },
  {
    id: 'ATTRIBUTES_AS_KEYFIGURE',
    titulo: 'Atributos usados como cifra',
    columnas: ['Attribute as Key Figure', 'Description', 'Base Planning Level'],
  },
  {
    id: 'VERSIONS',
    titulo: 'Versiones',
    columnas: ['Version ID', 'Version Name', 'Version Type'],
  },
  {
    id: 'OPERATORS',
    titulo: 'Operadores',
    columnas: ['Operator Profile / Operator Type', 'Operator', 'Description'],
  },
  {
    id: 'SNAPSHOTS',
    titulo: 'Snapshots',
    columnas: ['Snapshot Key Figure', 'Source Key Figure', 'Description'],
  },
  {
    id: 'PLANNING_HORIZONS',
    titulo: 'Horizontes de planificación',
    columnas: ['Planning Horizon', 'Description', 'From', 'To'],
  },
  {
    id: 'UOM_CONVERSIONS',
    titulo: 'Conversiones de unidad',
    columnas: ['Source Unit', 'Target Unit', 'Factor'],
  },
  {
    id: 'CURRENCY_CONVERSIONS',
    titulo: 'Conversiones de moneda',
    columnas: ['Source Currency', 'Target Currency', 'Rate Type'],
  },
])

export const IDS_DE_SECCION = Object.freeze(SECCIONES.map((una) => una.id))

/**
 * Qué sección es un archivo, por su nombre.
 *
 * SAP los exporta como `ASIBPTS_KEYFIGURES.csv`, `ASIBPTS_PLEVELS_ATTRS.csv`… El nombre de la sección
 * va entre separadores, y se busca del más largo al más corto: `PA_ATTRIBUTES` y `ATTRIBUTES_AS_KEYFIGURE`
 * comparten un trozo, y con el orden al revés uno se comería al otro.
 */
export function seccionDeArchivo(nombre) {
  const arriba = String(nombre ?? '').toUpperCase()
  const porLargo = [...IDS_DE_SECCION].sort((a, b) => b.length - a.length)

  for (const id of porLargo) {
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
 * El separador es el PUNTO Y COMA, que es como los exporta SAP en un sistema en español, y las comillas
 * siguen el RFC 4180 —una comilla dentro de un campo entrecomillado va doblada—. Un salto de línea
 * dentro de un campo entrecomillado es parte del campo: las definiciones de cálculo de una cifra clave
 * los llevan, y partir por líneas antes de mirar las comillas rompe esas filas.
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
export const limpiarEncabezado = (valor) => String(valor ?? '').replace(/^\uFEFF/, '').trim()

/** Convierte filas en objetos por su encabezado. */
export function aObjetos(encabezado, filas) {
  return (filas ?? []).map((fila) => Object.fromEntries(
    (encabezado ?? []).map((columna, indice) => [columna, fila[indice] ?? '']),
  ))
}

/**
 * Ingiere el texto de un CSV y devuelve la sección con sus filas, o `null` si no se reconoce.
 *
 * Las filas vacías se descartan: los exports de SAP acaban con una línea en blanco y contarla haría que
 * el documento dijera «43 cifras clave» donde hay 42.
 */
export function ingerirCsv(nombre, texto) {
  const seccion = seccionDeArchivo(nombre)
  if (!seccion) return null

  const crudas = leerCsv(texto)
  if (crudas.length === 0) return { seccion, encabezado: [], filas: [], objetos: [], archivo: nombre }

  const encabezado = crudas[0].map(limpiarEncabezado)
  const filas = crudas.slice(1).filter((fila) => fila.some((celda) => String(celda ?? '').trim() !== ''))

  return { seccion, encabezado, filas, objetos: aObjetos(encabezado, filas), archivo: nombre }
}

/** Busca un campo por su nombre exacto, y si no, por parecido. Los encabezados de SAP varían. */
export function campo(objeto, nombre) {
  if (!objeto) return ''
  if (objeto[nombre] !== undefined) return String(objeto[nombre] ?? '').trim()

  const buscado = nombre.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [clave, valor] of Object.entries(objeto)) {
    if (clave.toLowerCase().replace(/[^a-z0-9]/g, '').includes(buscado)) return String(valor ?? '').trim()
  }
  return ''
}

/** Los módulos de IBP que se deducen de las etiquetas de las cifras clave. */
export const MODULOS = Object.freeze({
  DP: 'Demand Planning',
  DS: 'Demand Sensing',
  IO: 'Inventory Optimization',
  SOP: 'S&OP',
  SNP: 'Supply Planning',
})

/**
 * El resumen ejecutivo: los números que van en la primera página.
 *
 * Es lo que se lee cuando no se va a leer el resto, así que dice de qué tamaño es el área y qué módulos
 * de IBP usa. Los módulos salen de las etiquetas (`#DP`, `#IO`) de las cifras clave, que es donde SAP
 * los deja: no hay ningún campo que lo diga.
 */
export function resumirArea(datos) {
  const de = (id) => datos?.[id]?.objetos ?? []

  const cifras = de('KEYFIGURES')
  const guardadas = cifras.filter((una) => campo(una, 'Stored Key Figure') === 'X').length
  const calculadas = cifras.filter((una) => campo(una, 'Calculated Key Figure') === 'X').length
  const auxiliares = cifras.filter((una) => campo(una, 'Helper Key Figure') === 'X').length
  const deAlerta = cifras.filter((una) => campo(una, 'Alert Key Figure') === 'X').length

  const maestros = de('MASTERDATATYPES')
  const niveles = new Set(de('PLEVELS_ATTRS').map((una) => campo(una, 'Planning Level')).filter(Boolean))

  const etiquetas = new Set()
  for (const una of cifras) {
    for (const marca of campo(una, 'Hashtags').match(/#([A-Z]+)/g) ?? []) {
      const modulo = marca.slice(1)
      if (MODULOS[modulo]) etiquetas.add(MODULOS[modulo])
    }
  }

  return {
    area: campo(de('GENERAL_INFO')[0], 'Planning Area') || primerValor(datos),
    cifras: cifras.length,
    guardadas,
    calculadas,
    auxiliares,
    deAlerta,
    tiposDeDatoMaestro: new Set(maestros.map((una) => campo(una, 'Master Data Type ID')).filter(Boolean)).size,
    atributosDeMaestro: maestros.length,
    nivelesDePlanificacion: niveles.size,
    versiones: de('VERSIONS').length,
    operadores: de('OPERATORS').length,
    snapshots: de('SNAPSHOTS').length,
    modulos: [...etiquetas].sort(),
  }
}

/** El primer identificador de área que aparezca, por si `GENERAL_INFO` no vino. */
function primerValor(datos) {
  for (const suya of Object.values(datos ?? {})) {
    const area = areaDeArchivo(suya?.archivo)
    if (area) return area
  }
  return ''
}

/** Qué secciones faltan de las que de verdad hacen falta para que el documento diga algo. */
export function seccionesQueFaltan(datos) {
  return SECCIONES
    .filter((una) => una.esencial && !(datos?.[una.id]?.filas?.length > 0))
    .map((una) => una.id)
}

/** Lo que se recibió, para enseñarlo antes de generar. */
export function loRecibido(datos) {
  return SECCIONES.map((una) => ({
    id: una.id,
    titulo: una.titulo,
    esencial: Boolean(una.esencial),
    filas: datos?.[una.id]?.filas?.length ?? 0,
    archivo: datos?.[una.id]?.archivo ?? '',
  }))
}
