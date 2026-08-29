// El ancho de una columna de la tabla: a mano o ajustado al contenido.
//
// Portado de `startResize`, `autoFit` y `widthStyle` de `DataViewer/DataGrid.jsx` de v8. Era el
// último control de su visor que faltaba aquí.
//
// Para qué sirve: una tabla de dato maestro tiene columnas de código de seis caracteres al lado de
// descripciones de ochenta. Sin poder tocar el ancho, o las descripciones salen cortadas o los
// códigos ocupan media pantalla. v8 dejaba arrastrar el borde de la cabecera, y con doble clic la
// ajustaba a lo más ancho que haya en ella.
//
// Lo medible vive aquí y lo del ratón en el componente: el cálculo del ancho se puede probar, y
// arrastrar no.

/** Los topes de v8, en píxeles. */
export const ANCHO_MINIMO = 60
export const ANCHO_MAXIMO_AUTOMATICO = 600
export const ANCHO_MAXIMO_AJUSTADO = 800

/** El hueco que hay que sumar a lo medido: relleno de la celda y la flecha de orden. */
const HOLGURA = 28

/** El hueco extra de una columna clave, que además lleva su icono. */
const HOLGURA_DE_CLAVE = 22

/**
 * El estilo de ancho de una columna.
 *
 * Con ancho fijado se clava; sin él se deja crecer hasta un tope, que es lo que evita que UNA
 * descripción larga empuje el resto de las columnas fuera de la pantalla.
 */
export function estiloDeAncho(ancho) {
  if (!ancho) return { maxWidth: ANCHO_MAXIMO_AUTOMATICO }
  return { width: ancho, minWidth: ancho, maxWidth: ancho }
}

/** El ancho que resulta de arrastrar: el de partida más lo que se movió, sin bajar del mínimo. */
export const anchoArrastrado = (anchoInicial, desplazamiento) => Math.max(
  ANCHO_MINIMO,
  anchoInicial + desplazamiento,
)

/**
 * El ancho que cabe a lo más ancho de la columna: su nombre o cualquiera de sus celdas.
 *
 * `medir` devuelve el ancho en píxeles de un texto. Se inyecta porque medir de verdad necesita un
 * lienzo del navegador, y lo que hay que poder probar es el cálculo: qué se compara, qué holgura se
 * suma y entre qué topes queda.
 */
export function anchoAjustado(columna, textos, medir, { esClave = false } = {}) {
  let mayor = medir(String(columna ?? '')) + (esClave ? HOLGURA_DE_CLAVE : 0)
  for (const texto of textos ?? []) {
    const suyo = medir(String(texto ?? ''))
    if (suyo > mayor) mayor = suyo
  }
  return Math.min(ANCHO_MAXIMO_AJUSTADO, Math.max(ANCHO_MINIMO, Math.ceil(mayor) + HOLGURA))
}
