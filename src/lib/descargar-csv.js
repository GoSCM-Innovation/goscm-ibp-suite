// Volcar a un archivo lo que se está mirando en un visor.
//
// El armado del CSV y los topes son de `core/ibp/export-csv.js`, que se puede probar. Aquí queda lo
// que solo existe en un navegador: pedir las páginas, contar el avance, y provocar la descarga.
//
// Se vuelca TODO el resultado del filtro, no la página que se ve. Lo que se pide de un volcado es el
// conjunto entero; una página son 500 filas y para eso ya está la pantalla.

import {
  FILAS_POR_PETICION, MARCA_DE_CODIFICACION, filasACsv, nombreDeArchivo,
} from '../../core/ibp/export-csv.js'

/** Dispara la descarga de un texto como archivo. */
export function descargarTexto(texto, nombre, tipo = 'text/csv;charset=utf-8;') {
  const enlace = document.createElement('a')
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }))
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  // Sin esto el navegador se queda el archivo en memoria hasta recargar la página.
  URL.revokeObjectURL(url)
}

/**
 * Trae todas las páginas y arma el CSV.
 *
 * `leerPagina({ skip, top, signal })` es de quien llama: el visor de dato maestro y el de cifras
 * piden a sitios distintos y con parámetros distintos, pero pasan de página igual.
 *
 * `tope` corta el recorrido aunque SAP siga dando filas. Existe porque la cuenta previa puede
 * quedarse corta —se cuenta y se lee en dos momentos, y entre medias alguien puede haber cargado
 * datos—, y sin corte un volcado que se creía de 100.000 filas se puede ir al millón.
 */
export async function volcarACsv({
  columnas, comoSeLee, leerPagina, nombre, total, tope = Infinity, signal, onAvance,
}) {
  const todas = []
  let cortado = false

  for (let skip = 0; ; skip += FILAS_POR_PETICION) {
    if (signal?.aborted) return null

    const filas = await leerPagina({ skip, top: FILAS_POR_PETICION, signal })
    todas.push(...filas)
    onAvance?.({ leidas: todas.length, total })

    if (filas.length < FILAS_POR_PETICION) break
    if (todas.length >= tope) { cortado = true; break }
  }

  if (signal?.aborted) return null

  const texto = MARCA_DE_CODIFICACION + filasACsv(columnas, todas, comoSeLee)
  descargarTexto(texto, nombreDeArchivo([...nombre, todas.length]))

  return { filas: todas.length, cortado }
}
