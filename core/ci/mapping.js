// El mapeo de campos: de dónde sale cada campo y adónde va en IBP.
//
// En el body, esa información se escribe TRES veces:
//
//     "SourceFieldsfromAddon": "PRDID,LOCID,KFVALUE",
//     "TargetFieldsInSAPIBP":  "PRDID,LOCID,ZFACTURASPOS",
//     "FieldMapping":          "PRDID:PRDID,LOCID:LOCID,KFVALUE:ZFACTURASPOS"
//
// Las tres dicen lo mismo y tienen que coincidir campo a campo y en el mismo orden. Con 46 campos, un
// descuido en una de las tres es una carga que falla (o, peor, que no falla y mapea mal). La pantalla las
// edita como UNA tabla (origen → destino) y las tres listas se generan de ella.
//
// Si un body que se pega trae las tres desalineadas, `leerMapeo` lo dice en vez de arreglarlo en silencio:
// no se sabe cuál de las tres era la correcta.
//
// Pura, sin dependencias.

export const CAMPOS_DEL_MAPEO = Object.freeze({
  origen: 'SourceFieldsfromAddon',
  destino: 'TargetFieldsInSAPIBP',
  mapeo: 'FieldMapping',
})

const partirLista = (texto) => String(texto ?? '').split(',').map((uno) => uno.trim()).filter(Boolean)

let contador = 0
const nuevoId = () => { contador += 1; return `m${contador}` }

/**
 * Lee las tres listas de un bloque y devuelve la tabla.
 *
 * `{ filas: [{ id, origen, destino }], coherente, avisos }`. La tabla sale de `FieldMapping` si lo hay (es la
 * que el iFlow usa para mover los datos) y, si no, de las dos listas. `coherente` es `true` solo si las tres
 * dicen exactamente lo mismo.
 */
export function leerMapeo(bloque = {}) {
  const origenes = partirLista(bloque[CAMPOS_DEL_MAPEO.origen])
  const destinos = partirLista(bloque[CAMPOS_DEL_MAPEO.destino])
  const pares = partirLista(bloque[CAMPOS_DEL_MAPEO.mapeo])
  const avisos = []

  let filas
  if (pares.length > 0) {
    filas = pares.map((par) => {
      const [origen, ...resto] = par.split(':')
      return { id: nuevoId(), origen: origen.trim(), destino: resto.join(':').trim() }
    })
    const sinDestino = filas.filter((fila) => fila.destino === '')
    if (sinDestino.length > 0) {
      avisos.push(`En FieldMapping, ${sinDestino.map((fila) => fila.origen).join(', ')} no dice a qué campo va.`)
    }
  } else {
    const largo = Math.max(origenes.length, destinos.length)
    filas = Array.from({ length: largo }, (_vacio, i) => ({
      id: nuevoId(), origen: origenes[i] ?? '', destino: destinos[i] ?? '',
    }))
  }

  const esperadoOrigen = filas.map((fila) => fila.origen)
  const esperadoDestino = filas.map((fila) => fila.destino)
  const mismoOrden = (a, b) => a.length === b.length && a.every((uno, i) => uno === b[i])

  if (filas.length > 0) {
    if (!mismoOrden(origenes, esperadoOrigen)) {
      avisos.push('SourceFieldsfromAddon no coincide con FieldMapping (campos u orden distintos).')
    }
    if (!mismoOrden(destinos, esperadoDestino)) {
      avisos.push('TargetFieldsInSAPIBP no coincide con FieldMapping (campos u orden distintos).')
    }
  }

  return { filas, coherente: avisos.length === 0, avisos }
}

/** Las tres listas, generadas de la tabla. Las filas incompletas (sin origen o sin destino) no entran. */
export function escribirMapeo(filas) {
  const completas = (filas ?? [])
    .map((fila) => ({ origen: String(fila.origen ?? '').trim(), destino: String(fila.destino ?? '').trim() }))
    .filter((fila) => fila.origen !== '' && fila.destino !== '')

  return {
    [CAMPOS_DEL_MAPEO.origen]: completas.map((fila) => fila.origen).join(','),
    [CAMPOS_DEL_MAPEO.destino]: completas.map((fila) => fila.destino).join(','),
    [CAMPOS_DEL_MAPEO.mapeo]: completas.map((fila) => `${fila.origen}:${fila.destino}`).join(','),
  }
}

/**
 * Lee lo que se pega para llenar la tabla de golpe. Acepta, sin preguntar cuál es:
 *
 *   - una lista separada por comas, `PRDID,LOCID,KFVALUE` (cada campo va a un destino del mismo nombre);
 *   - pares con dos puntos, `PRDID:PRDID,KFVALUE:ZFACTURASPOS` (el formato de `FieldMapping`);
 *   - columnas copiadas de Excel: una línea por campo, con una o dos columnas separadas por tabulador.
 */
export function leerPegado(texto) {
  const filas = []
  const agregar = (origen, destino) => {
    const o = String(origen ?? '').trim()
    if (o === '') return
    const d = String(destino ?? '').trim()
    filas.push({ id: nuevoId(), origen: o, destino: d === '' ? o : d })
  }

  for (const linea of String(texto ?? '').split(/\r?\n/)) {
    if (linea.trim() === '') continue

    if (linea.includes('\t')) {
      const [origen, destino] = linea.split('\t')
      agregar(origen, destino)
    } else if (linea.includes(':')) {
      for (const par of linea.split(',')) {
        const [origen, ...resto] = par.split(':')
        agregar(origen, resto.join(':'))
      }
    } else {
      for (const campo of linea.split(',')) agregar(campo, campo)
    }
  }
  return filas
}
