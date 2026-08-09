// Qué se va a copiar de un tenant a otro, antes de copiar nada.
//
// Portado de la fase de análisis de `Migration.jsx` de v8. Sin dependencias: lo usan el servidor y
// la pantalla.
//
// Dos problemas que el plan resuelve y que, sin él, aparecen a mitad de una carga:
//
//   1. Las tablas NO se llaman igual en los dos tenants. Cada uno le pone su prefijo al mismo tipo
//      de dato maestro —`GIDPRODUCT` en uno, `AS1PRODUCT` en otro—, así que emparejarlas por nombre
//      exacto no encuentra casi nada.
//   2. Las columnas TAMPOCO coinciden. Mandar un campo que el destino no tiene hace que SAP
//      rechace la carga entera con un 400, así que se manda la intersección — y se dice cuál es,
//      porque los campos que quedan fuera no se copian y eso hay que saberlo ANTES.

/** Lo que hay que dejar del nombre para que un emparejado signifique algo. */
const RAIZ_MINIMA = 4

/** Cuántos caracteres de prefijo se prueban. Los prefijos de tenant son de tres o cuatro. */
const PREFIJO_MAXIMO = 4

/**
 * Las raíces posibles de un nombre: el nombre entero y lo que queda al quitarle prefijos.
 *
 * De `AS1PRODUCT` salen `AS1PRODUCT`, `S1PRODUCT`, `1PRODUCT`, `PRODUCT` y `RODUCT`. La buena es
 * `PRODUCT`, y se descubre porque es la más larga que también aparece en el otro tenant.
 */
export function raicesDe(nombre) {
  const texto = String(nombre ?? '')
  const raices = []
  for (let corte = 0; corte <= PREFIJO_MAXIMO && texto.length - corte >= RAIZ_MINIMA; corte += 1) {
    raices.push(texto.slice(corte))
  }
  return raices
}

/**
 * La tabla del destino que le corresponde a una del origen, o `null` si ninguna.
 *
 * El nombre idéntico gana siempre; si no, la que comparte la raíz más larga. Exigir una raíz de al
 * menos cuatro caracteres evita emparejar `GIDLAG` con `AS1LOCATION` por compartir una letra.
 */
export function emparejarTabla(origen, candidatas) {
  const lista = candidatas ?? []
  if (lista.includes(origen)) return origen

  const suyas = new Set(raicesDe(origen))
  let mejor = null
  let largo = 0

  for (const candidata of lista) {
    for (const raiz of raicesDe(candidata)) {
      if (suyas.has(raiz) && raiz.length > largo) {
        mejor = candidata
        largo = raiz.length
      }
    }
  }

  return mejor
}

/** El emparejado de todas las tablas del origen. Las que no encuentran pareja salen con `null`. */
export const emparejarTablas = (origen, destino) =>
  (origen ?? []).map((una) => ({ origen: una, destino: emparejarTabla(una, destino) }))

/**
 * Qué campos se van a copiar y cuáles no.
 *
 * `verificable` es falso cuando no se pudo leer el esquema de alguno de los dos lados —una tabla
 * vacía no tiene fila de muestra de la que deducirlo—. Ahí no se puede recortar nada y se manda
 * todo, que es lo que hacía v8; pero se marca, porque es justo el caso en el que SAP puede rechazar
 * la carga y conviene saberlo de antemano.
 */
export function compararCampos(camposOrigen, camposDestino, { ignorar = [] } = {}) {
  const limpiar = (lista) => (lista ? lista.filter((uno) => !ignorar.includes(uno)) : null)

  const origen = limpiar(camposOrigen)
  const destino = limpiar(camposDestino)

  if (!origen || !destino) {
    return { verificable: false, comunes: null, soloEnOrigen: [], soloEnDestino: [] }
  }

  const enDestino = new Set(destino)
  const enOrigen = new Set(origen)

  return {
    verificable: true,
    comunes: origen.filter((uno) => enDestino.has(uno)),
    // Están en el origen y no en el destino: NO se copian.
    soloEnOrigen: origen.filter((uno) => !enDestino.has(uno)),
    // Están en el destino y no en el origen: quedan como estén.
    soloEnDestino: destino.filter((uno) => !enOrigen.has(uno)),
  }
}

/**
 * Si una entrada del plan merece que alguien la mire antes de seguir.
 *
 * No es lo mismo un aviso que un impedimento: sin pareja no se puede copiar, y sin campos comunes
 * tampoco. Lo demás se puede copiar sabiendo qué se pierde.
 */
export function revisarEntrada(entrada) {
  if (!entrada.destino) return { estado: 'sin-pareja', mensaje: 'No hay ninguna tabla equivalente en el destino.' }
  if (entrada.verificable && entrada.comunes.length === 0) {
    return { estado: 'sin-campos', mensaje: 'Las dos tablas existen pero no comparten ninguna columna.' }
  }
  if (!entrada.verificable) {
    return { estado: 'a-ciegas', mensaje: 'Alguna de las dos está vacía: no se pudo comparar y se mandarían todas las columnas.' }
  }
  // Antes que la pérdida de columnas: si no hay filas no va a pasar nada, y eso es lo que hay que
  // leer primero.
  if ((entrada.filas ?? 0) === 0) return { estado: 'vacia', mensaje: 'No hay nada que copiar.' }
  if (entrada.soloEnOrigen.length > 0) {
    return {
      estado: 'con-perdida',
      mensaje: `${entrada.soloEnOrigen.length} ${entrada.soloEnOrigen.length === 1 ? 'columna del origen no existe' : 'columnas del origen no existen'} en el destino y no se copian.`,
    }
  }
  return { estado: 'ok', mensaje: '' }
}

/** Los estados que impiden copiar una tabla, frente a los que solo avisan. */
export const ESTADOS_QUE_IMPIDEN = Object.freeze(['sin-pareja', 'sin-campos'])

/** Si esa entrada se puede copiar tal como está. */
export const sePuedeCopiar = (entrada) =>
  !ESTADOS_QUE_IMPIDEN.includes(revisarEntrada(entrada).estado) && (entrada.filas ?? 0) > 0

/**
 * El resumen del plan: cuántas tablas y filas, y qué hay que mirar.
 *
 * Las filas se suman solo de las tablas que se pueden copiar: contar las que no van daría una cifra
 * que no se corresponde con lo que va a pasar.
 */
export function resumirPlan(entradas) {
  const lista = entradas ?? []
  const copiables = lista.filter(sePuedeCopiar)

  const porEstado = {}
  for (const entrada of lista) {
    const { estado } = revisarEntrada(entrada)
    porEstado[estado] = (porEstado[estado] ?? 0) + 1
  }

  return {
    tablas: lista.length,
    copiables: copiables.length,
    filas: copiables.reduce((suma, una) => suma + (una.filas ?? 0), 0),
    porEstado,
    hayQueMirar: lista.some((una) => revisarEntrada(una).estado !== 'ok'),
  }
}