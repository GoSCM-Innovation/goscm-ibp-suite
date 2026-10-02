// El buscador de material del Network Visualizer.
//
// Portado de `vizInitAutocomplete` de `visualizer.js` de v7. Sin texto no ofrece nada: con ocho mil
// materiales, una lista abierta de entrada no se usa. Con texto, busca en el código Y en la
// descripción, sin distinguir mayúsculas, y ordena por relevancia: primero los que EMPIEZAN por lo
// escrito (por código), después los que empiezan por la descripción, y al final los que lo contienen.

/** Cuántos materiales se ofrecen como máximo. */
export const MAXIMO_DE_SUGERENCIAS = 40

/**
 * `catalogo` es `[{ prdid, descripcion }]`. Devuelve las coincidencias en orden de relevancia.
 */
export function buscarMateriales(catalogo, texto) {
  const q = String(texto ?? '').trim().toLowerCase()
  if (!q || !catalogo) return []

  const porCodigo = []
  const porDescripcion = []
  const contenidos = []

  for (const uno of catalogo) {
    const codigo = uno.prdid.toLowerCase()
    const descripcion = (uno.descripcion ?? '').toLowerCase()
    if (codigo.startsWith(q)) porCodigo.push(uno)
    else if (descripcion.startsWith(q)) porDescripcion.push(uno)
    else if (codigo.includes(q) || descripcion.includes(q)) contenidos.push(uno)
  }

  return [...porCodigo, ...porDescripcion, ...contenidos].slice(0, MAXIMO_DE_SUGERENCIAS)
}
