// Bajar el dato maestro del tenant a la base local.
//
// Portado de `fetchAndIndex` de v7, que era el corazón de sus dos descargas. Lo que hace esta función
// y por qué está escrita así:
//
// Cada página que llega de SAP se filtra, se escribe en IndexedDB y SE SUELTA. Nunca hay más de una
// página en memoria. Es la razón de existir de toda esta capa: v7 podía con áreas de decenas de miles
// de productos porque el montón de JavaScript nunca crecía con el tamaño de la tabla, y acumular las
// páginas para escribirlas al final tiraría eso por la borda sin que se note hasta el primer tenant
// grande.
//
// El avance se informa por página y no al final, porque una descarga de seis minutos sin señales de
// vida se lee como un cuelgue.

import { descartarInvalidas } from '../../core/ibp/explorer-extract-plan.js'
import { normalizarFilas } from '../../core/ibp/explorer-fields.js'
import { guardar, prepararPara, vaciar } from './explorer-db.js'
import { fetchMasterRows } from './ibp-master-data.js'

/**
 * Filas por página.
 *
 * Es el tope del endpoint. Pocas páginas grandes y no muchas chicas: el costo de una petición a IBP
 * es casi todo latencia fija, así que partirla en pedacitos multiplica la espera sin ahorrar memoria
 * —lo que la acota es escribir y soltar, no el tamaño de la página—.
 */
export const FILAS_POR_PAGINA = 5000

/** Un paso terminado, con lo que se bajó y lo que se descartó. */
const resultado = (paso, extra) => ({
  tabla: paso.tabla,
  entidad: paso.entidad,
  etiqueta: paso.etiqueta,
  bajadas: 0,
  guardadas: 0,
  ...extra,
})

/**
 * Baja una tabla, página por página, y la escribe en la base local.
 *
 * Devuelve cuántas filas llegaron y cuántas se guardaron: la diferencia son las que SAP marca como
 * inválidas, y decirla importa porque «bajé 8.000 y guardé 5.100» es información, mientras que
 * «guardé 5.100» a secas parece un error.
 */
async function bajarPaso({ conexionId, destino, paso, mapa, onProgreso, cancelado }) {
  await vaciar(paso.tabla)

  let desde = 0
  let bajadas = 0
  let guardadas = 0

  for (;;) {
    if (cancelado?.()) return resultado(paso, { bajadas, guardadas, cancelado: true })

    const filas = await fetchMasterRows(conexionId, {
      entidad: paso.entidad,
      planningArea: destino.planningArea,
      versionId: destino.versionId,
      select: paso.select,
      // El orden estable es obligatorio al paginar: sin él, dos ventanas sobre una tabla que alguien
      // está tocando se solapan y dejan huecos, y aquí un hueco es un producto que no se analiza.
      orderby: paso.select.slice(0, 2),
      skip: desde,
      top: FILAS_POR_PAGINA,
    })

    bajadas += filas.length

    // Primero se traducen los nombres a los canónicos, y DESPUÉS se descarta: la marca de invalidez
    // puede llamarse distinto en este tenant, y el filtro busca el nombre canónico.
    const utiles = descartarInvalidas(normalizarFilas(mapa, paso.entidad, filas), paso.descartarSi)
    guardadas += await guardar(paso.tabla, utiles)

    onProgreso?.({ tabla: paso.tabla, etiqueta: paso.etiqueta, bajadas, guardadas })

    // Menos filas de las pedidas quiere decir que la tabla se acabó, no que haya que insistir.
    if (filas.length < FILAS_POR_PAGINA) break
    desde += filas.length
  }

  return resultado(paso, { bajadas, guardadas })
}

/**
 * Baja todo el plan.
 *
 * Un paso que falla NO detiene a los demás: se anota y se sigue. Después de esperar varios minutos,
 * perder la descarga entera porque una tabla accesoria dio error sería inaceptable — y si lo que
 * falló era esencial, el plan ya lo había dicho antes de empezar.
 */
export async function extraer({ conexionId, destino, plan, mapa = {}, onProgreso, cancelado }) {
  // Deja la base lista: si lo guardado era de otro tenant, área o versión, se borra.
  const { seVacio } = await prepararPara({ ...destino, connectionId: conexionId })

  const hechos = []

  for (const paso of plan.pasos) {
    if (!paso.sePuede) {
      hechos.push(resultado(paso, { omitido: true, motivo: paso.motivo }))
      continue
    }

    if (cancelado?.()) {
      hechos.push(resultado(paso, { cancelado: true }))
      continue
    }

    try {
      hechos.push(await bajarPaso({ conexionId, destino, paso, mapa, onProgreso, cancelado }))
    } catch (fallo) {
      hechos.push(resultado(paso, { error: fallo.message }))
    }
  }

  return {
    seVacio,
    hechos,
    guardadas: hechos.reduce((suma, uno) => suma + uno.guardadas, 0),
    descartadas: hechos.reduce((suma, uno) => suma + (uno.bajadas - uno.guardadas), 0),
    conError: hechos.filter((uno) => uno.error).length,
    ok: hechos.every((uno) => !uno.error && !uno.cancelado),
  }
}
