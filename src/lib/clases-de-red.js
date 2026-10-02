// Cómo se ve cada clase de nodo en la red: su color, su forma, su tamaño y su nombre.
//
// Copiado de `COLORS` y `shapes` de `vizBuildGraph` en `visualizer.js` de v7, valor por valor. Vive
// aparte del lienzo porque lo usan dos: el lienzo para dibujar y la leyenda para decir qué es cada
// color. Que la leyenda tuviera sus propios colores es la forma de que un día dejen de coincidir.
//
// Son colores literales y no variables del tema a propósito: el lienzo los pinta sobre su propio
// fondo y con texto blanco encima, así que tienen que ser los mismos en claro y en oscuro. Es lo que
// hacía v7.

import { CLASES } from '../../core/ibp/supply-network.js'

/** El color de cada clase, en el formato que espera el lienzo. */
export const COLORES = {
  [CLASES.planta]: { background: '#F59E0B', border: '#FBBF24', hover: { background: '#FBBF24' }, highlight: { background: '#FBBF24', border: '#fff' } },
  [CLASES.ubicacion]: { background: '#0E8FAD', border: '#06B6D4', hover: { background: '#06B6D4' }, highlight: { background: '#06B6D4', border: '#fff' } },
  [CLASES.cliente]: { background: '#0B8A63', border: '#10B981', hover: { background: '#10B981' }, highlight: { background: '#10B981', border: '#fff' } },
  [CLASES.proveedor]: { background: '#5B21B6', border: '#a78bfa', hover: { background: '#7C3AED' }, highlight: { background: '#7C3AED', border: '#fff' } },
}

/** Las formas de v7. El diamante marca el proveedor. */
export const FORMAS = {
  [CLASES.planta]: 'box',
  [CLASES.ubicacion]: 'ellipse',
  [CLASES.cliente]: 'box',
  [CLASES.proveedor]: 'diamond',
}

/** El tamaño de los nodos que no van al tamaño por defecto. */
export const TAMANOS = {
  [CLASES.planta]: 18,
}

/** El tamaño de los demás. */
export const TAMANO_POR_DEFECTO = 14

/** Cómo se nombra cada clase en la leyenda y en el detalle del nodo. */
export const NOMBRE_DE_CLASE = {
  [CLASES.planta]: 'Planta',
  [CLASES.ubicacion]: 'Ubicación',
  [CLASES.cliente]: 'Cliente',
  [CLASES.proveedor]: 'Proveedor',
}

/** La insignia del detalle de un nodo (las `badge-*` de v7). */
export const INSIGNIA_DE_CLASE = {
  [CLASES.planta]: 'badge-main',
  [CLASES.ubicacion]: 'badge-comp',
  [CLASES.cliente]: 'badge-leaf',
  [CLASES.proveedor]: 'badge-coprod',
}

/**
 * La leyenda de v7: el cuadrito de cada clase, con su color, su forma, y el globo de ayuda.
 *
 * Los colores del cuadrito NO son los del nodo —son los del borde, más claros—: así estaba en
 * `index.html` de v7 y así se copia.
 */
export const LEYENDA = [
  { clase: CLASES.planta, color: '#F59E0B', forma: 'cuadrado', ayuda: 'Mostrar/ocultar plantas' },
  { clase: CLASES.ubicacion, color: '#06B6D4', forma: 'circulo', ayuda: 'Mostrar/ocultar ubicaciones' },
  { clase: CLASES.cliente, color: '#10B981', forma: 'cuadrado', ayuda: 'Mostrar/ocultar clientes' },
  { clase: CLASES.proveedor, color: '#a78bfa', forma: 'rombo', ayuda: 'Mostrar/ocultar proveedores' },
]
