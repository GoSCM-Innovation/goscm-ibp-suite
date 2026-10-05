// Cómo se pinta un dataflow: el color y el icono de cada tipo de nodo, el tooltip de cada caja y el
// recorte del rótulo de las flechas. Portado de `DF_TYPE_STYLE` y `buildDataflowVisData` de v9.
//
// Está aparte del componente para poder probarlo sin montar el lienzo, y porque React Refresh no deja
// exportar constantes desde un archivo de componentes.

/**
 * El color y el icono de cada tipo de nodo, tal cual `DF_TYPE_STYLE` de v9.
 *
 * Paleta sobria, estilo SAP CI-DS Designer: lectores azul pizarra (de dónde viene), transformaciones
 * pizarra oscuro (el trabajo), escritores terracota apagado (a dónde va) y utilidades gris cálido.
 */
export const ESTILO_POR_TIPO = {
  TableReader: { color: '#5b7a99', icono: '📋' },
  TableLoader: { color: '#8a6450', icono: '🎯' },
  FileReader: { color: '#6f7a8a', icono: '📄' },
  FileLoader: { color: '#8a6450', icono: '📄' },
  QueryTransform: { color: '#475569', icono: '▦' },
  XMLMapTransform: { color: '#475569', icono: '⟨⟩' },
  RowGenerationTransform: { color: '#7d7866', icono: '🔢' },
  MergeTransform: { color: '#5a5e6e', icono: '◆' },
  CaseTransform: { color: '#5a5e6e', icono: '◆' },
  ValidationTransform: { color: '#5a5e6e', icono: '✓' },
  SQLTransform: { color: '#5a5e6e', icono: 'SQL' },
  MapOperationTransform: { color: '#5a5e6e', icono: '⟲' },
}

/** El tipo por omisión de v9. */
const ESTILO_POR_OMISION = { color: '#7d9abf', icono: '◇' }

export const estiloDe = (tipo) => ESTILO_POR_TIPO[tipo] ?? ESTILO_POR_OMISION

/** El rótulo largo de una flecha se corta a 14 caracteres (13 y «…»), como en v9. */
export const cortarEtiqueta = (texto) => (texto.length > 14 ? `${texto.slice(0, 13)}…` : texto)

/** El tooltip de una caja: nombre, tipo y lo que tenga (tabla, datastore, archivo, filas). */
export function tooltipDelNodo(nodo) {
  return [
    nodo.displayName || '',
    `Tipo: ${nodo.xmiType}`,
    nodo.tableName ? `Tabla: ${nodo.tableName}` : '',
    nodo.dsName ? `Datastore: ${nodo.dsName}` : '',
    nodo.fileName ? `Archivo: ${nodo.fileName}` : '',
    nodo.rowCount ? `Filas: ${nodo.rowCount}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * El rótulo de una caja del grafo de cadenas, como lo parte v9: hasta 30 caracteres y, si es más
 * largo, en dos líneas cortando por el último `_` o espacio. Lo que pasa de 30 se descarta.
 */
export function etiquetaDelNodoDeCadena(texto) {
  const crudo = String(texto ?? '')
  if (crudo.length <= 30) return crudo
  return crudo.slice(0, 30).replace(/[_\s](?=[^_\s]*$)/, '\n') || `${crudo.slice(0, 15)}\n${crudo.slice(15, 30)}…`
}

/** El rótulo de una flecha del grafo de cadenas: hasta 24 caracteres (22 y «…»). */
export const cortarEtiquetaDeCadena = (texto) => {
  const crudo = String(texto ?? '')
  return crudo.length > 24 ? `${crudo.slice(0, 22)}…` : crudo
}

/** El color de relleno de cada tipo de integración en el grafo; el de omisión es el de v9. */
export const RELLENO_DE_TIPO = { MD: '#F7A800', KF: '#29ABE2', FILE: '#E8622A' }
export const RELLENO_POR_OMISION = '#7d9abf'

/** El tooltip de una caja del grafo: dataflow, job, de dónde a dónde, tabla destino y ZIP. */
export function tooltipDeLaIntegracion(integracion) {
  const dataflow = integracion.dataflowName || integracion.jobName
  return [
    dataflow,
    integracion.dataflowName && integracion.jobName !== integracion.dataflowName ? `Job: ${integracion.jobName}` : '',
    `${integracion.srcDSName || '?'} → ${integracion.dstDSName || '?'}`,
    `Target: ${integracion.targetTable}`,
    `ZIP: ${integracion._zipName}`,
  ].filter(Boolean).join('\n')
}
