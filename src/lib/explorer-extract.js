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

import {
  clavesDe,
  clavesQueOtrosNecesitan,
  descartarInvalidas,
  soloDeClavesVivas,
} from '../../core/ibp/explorer-extract-plan.js'
import { normalizarFilas } from '../../core/ibp/explorer-fields.js'
import { guardar, prepararPara, vaciar } from './explorer-db.js'
import { fetchMasterPage } from './ibp-master-data.js'

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
async function bajarPaso({ conexionId, destino, paso, mapa, onProgreso, cancelado, clavesVivas }) {
  await vaciar(paso.tabla)

  let desde = 0
  let bajadas = 0
  let guardadas = 0
  let enSap = null
  const propias = new Set()

  for (;;) {
    if (cancelado?.()) return resultado(paso, { bajadas, guardadas, enSap, cancelado: true })

    const { filas, total } = await fetchMasterPage(conexionId, {
      entidad: paso.entidad,
      planningArea: destino.planningArea,
      versionId: destino.versionId,
      select: paso.select,
      // El orden estable es obligatorio al paginar: sin él, dos ventanas sobre una tabla que alguien
      // está tocando se solapan y dejan huecos, y aquí un hueco es un producto que no se analiza.
      orderby: paso.select.slice(0, 2),
      skip: desde,
      top: FILAS_POR_PAGINA,
      // El total viene en la MISMA respuesta que la primera página, así que saber cuántas filas hay
      // no cuesta una petición más. Y sin él no habría con qué comparar al final.
      conTotal: desde === 0,
    })

    if (desde === 0 && Number.isFinite(total)) enSap = total

    bajadas += filas.length

    // Primero se traducen los nombres a los canónicos, y DESPUÉS se descarta: la marca de invalidez
    // puede llamarse distinto en este tenant, y el filtro busca el nombre canónico.
    const normalizadas = normalizarFilas(mapa, paso.entidad, filas)
    const validas = descartarInvalidas(normalizadas, paso.descartarSi)
    // Y por último las que su cabecera avala. Después de descartar inválidas, no antes: la cabecera
    // que las avala ya pasó por su propio descarte.
    const utiles = paso.atadoA
      ? soloDeClavesVivas(validas, paso.atadoA.campo, clavesVivas?.get(paso.atadoA.tabla))
      : validas

    guardadas += await guardar(paso.tabla, utiles)
    // Lo que este paso deja para los que dependan de él sale de lo GUARDADO, no de lo bajado.
    if (paso.claveParaOtros) for (const una of clavesDe(utiles, paso.claveParaOtros)) propias.add(una)

    onProgreso?.({ tabla: paso.tabla, etiqueta: paso.etiqueta, bajadas, guardadas })

    // Una página corta NO es prueba de que la tabla se acabó: puede venir recortada por tamaño. Si
    // SAP dijo cuántas filas hay, se sigue pidiendo hasta llegar a ese número; solo una página vacía
    // cierra el asunto. Sin total, no queda más que el criterio de v8 y se anota el riesgo abajo.
    if (filas.length === 0) break
    desde += filas.length
    if (Number.isFinite(enSap) ? desde >= enSap : filas.length < FILAS_POR_PAGINA) break
  }

  return resultado(paso, {
    bajadas,
    guardadas,
    enSap,
    // Lo que SAP dijo que había menos lo que llegó. Se anota siempre que se sepa el total, porque el
    // único caso en que sale distinto de cero es el que antes no se veía.
    faltan: Number.isFinite(enSap) ? Math.max(0, enSap - bajadas) : 0,
    propias,
  })
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
  // Las claves que cada tabla deja para los pasos atados a ella, y si esa tabla se bajó completa.
  const clavesVivas = new Map()
  const tablasFiables = new Set()
  const clavesNecesarias = clavesQueOtrosNecesitan(plan.pasos)

  for (const paso of plan.pasos) {
    if (!paso.sePuede) {
      hechos.push(resultado(paso, { omitido: true, motivo: paso.motivo }))
      continue
    }

    if (cancelado?.()) {
      hechos.push(resultado(paso, { cancelado: true }))
      continue
    }

    // Un paso atado a una tabla que no se bajó entera no se baja: sus claves están incompletas, así
    // que el filtro tiraría filas buenas. Y una tabla a la que le faltan filas buenas se lee igual
    // que una tabla completa — es la clase de hueco que no se ve hasta que alguien decide con ella.
    if (paso.atadoA && !tablasFiables.has(paso.atadoA.tabla)) {
      hechos.push(resultado(paso, {
        omitido: true,
        motivo: 'No se pudo bajar entera la tabla de la que dependen estas filas, así que no hay con '
          + 'qué decidir cuáles valen. Se salta en vez de guardar una parte.',
      }))
      continue
    }

    try {
      const hecho = await bajarPaso({
        conexionId,
        destino,
        paso: { ...paso, claveParaOtros: clavesNecesarias.get(paso.tabla) ?? null },
        mapa,
        onProgreso,
        cancelado,
        clavesVivas,
      })

      const { propias, ...anotado } = hecho
      if (propias) clavesVivas.set(paso.tabla, propias)
      if (!anotado.error && !anotado.cancelado && !anotado.faltan) tablasFiables.add(paso.tabla)
      hechos.push(anotado)
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
    // Una tabla a la que le faltan filas cuenta como problema, no como éxito: es exactamente lo que
    // antes pasaba por «descarga terminada».
    incompletas: hechos.filter((uno) => uno.faltan > 0).length,
    ok: hechos.every((uno) => !uno.error && !uno.cancelado && !uno.faltan),
  }
}
