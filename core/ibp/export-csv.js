// Volcar a CSV lo que se está mirando, y decidir cuándo un volcado es demasiado grande.
//
// Portado de `utils/csv.js` y `config/migrationLimits.js` de v8.
//
// Dos cosas que parecen detalles y no lo son:
//
//   - El separador es el PUNTO Y COMA y el archivo lleva una marca de orden de bytes. Excel en
//     español abre así el archivo en columnas y con los acentos bien; con coma y sin marca, todo
//     cae en la primera columna y las tildes salen rotas. No es una preferencia: es la diferencia
//     entre un archivo que se usa y uno que hay que arreglar a mano.
//   - Las celdas se escriben como se LEEN en la pantalla, no como vienen de SAP. Una fecha de OData
//     es `/Date(1753734272000+0000)/`; en el CSV va la fecha. Si el archivo no coincide con lo que
//     se ve, no sirve para comprobar nada.
//
// Y los topes existen porque un volcado son páginas de 5.000 filas contra SAP a ~6 s cada una, y el
// tráfico pasa por nuestro servidor: medio millón de filas no es una espera larga, es una función
// que se corta por la mitad y un archivo incompleto que parece completo.

import { valorLegible } from './master-data-model.js'

/** El separador que Excel en español espera. */
export const SEPARADOR = ';'

/**
 * La marca de orden de bytes.
 *
 * Sin ella Excel lee el archivo con la codificación del sistema y «Camión» sale «CamiÃ³n».
 */
export const MARCA_DE_CODIFICACION = '﻿'

/** Filas por petición al volcar. Pocas páginas grandes: el costo de SAP es por petición, no por fila. */
export const FILAS_POR_PETICION = 5000

/** Topes de volumen de un volcado, por tipo de dato. */
export const TOPES = Object.freeze({
  maestro: { aviso: 120_000, maximo: 200_000 },
  cifras: { aviso: 250_000, maximo: 400_000 },
})

/**
 * Qué hacer con un volcado de `total` filas.
 *
 * Devuelve el estado y el texto, en vez de un booleano, porque los tres casos son distintos: uno se
 * hace sin más, otro hay que confirmarlo, y el tercero no se hace. Un solo booleano obligaría a la
 * pantalla a redactar el motivo, y entonces cada pantalla lo diría distinto.
 */
export function revisarVolumen(total, topes) {
  const filas = Number(total ?? 0)
  const { aviso, maximo } = topes ?? TOPES.maestro
  const n = (valor) => valor.toLocaleString('es')

  if (filas > maximo) {
    return {
      estado: 'bloqueado',
      mensaje: `Son ${n(filas)} filas y el tope de un volcado es ${n(maximo)}. `
        + 'Acotá el filtro y volvé a intentarlo.',
    }
  }
  if (filas > aviso) {
    return {
      estado: 'aviso',
      mensaje: `Son ${n(filas)} filas: el volcado va a tardar varios minutos y se puede cortar. `
        + '¿Seguimos?',
    }
  }
  return { estado: 'ok', mensaje: '' }
}

/**
 * Una celda de CSV.
 *
 * Se entrecomilla solo cuando hace falta —si el valor lleva el separador, una comilla o un salto de
 * línea—, que es lo que dice el RFC 4180. Entrecomillar todo también sería válido, pero deja un
 * archivo peor de leer cuando alguien lo abre con un editor de texto.
 */
export function celdaCsv(valor, comoSeLee = valorLegible) {
  const texto = comoSeLee(valor)
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * El CSV entero: la fila de encabezados y una línea por fila.
 *
 * `comoSeLee(valor, columna)` es de quien llama porque cada visor escribe distinto: el de dato
 * maestro convierte fechas de OData, y el de cifras enseña un periodo como `2026-08-01` y un número
 * con tres decimales. Si el archivo no dice lo mismo que la pantalla no vale para comprobar nada, y
 * la única forma de garantizarlo es que use la MISMA función.
 */
export function filasACsv(columnas, filas, comoSeLee = valorLegible) {
  const lista = columnas ?? []
  // Los encabezados son nombres de columna, no valores: no pasan por el formateador.
  const lineas = [lista.map((columna) => celdaCsv(columna)).join(SEPARADOR)]

  for (const fila of filas ?? []) {
    lineas.push(lista
      .map((columna) => celdaCsv(fila?.[columna], (valor) => comoSeLee(valor, columna)))
      .join(SEPARADOR))
  }

  // CRLF: es lo que espera Excel en Windows, que es donde se abre esto.
  return lineas.join('\r\n')
}

/**
 * El nombre del archivo.
 *
 * Lleva la cuenta de filas a propósito: al comparar dos volcados, la diferencia de nombre dice a la
 * primera si se está mirando lo mismo. Y lo vacío se descarta para no dejar guiones sueltos.
 */
export function nombreDeArchivo(partes) {
  const limpio = (partes ?? [])
    .map((parte) => String(parte ?? '').trim().replace(/[^\w.-]+/g, '_'))
    .filter((parte) => parte !== '' && parte !== '_')
    .join('_')
  return `${limpio || 'volcado'}.csv`
}
