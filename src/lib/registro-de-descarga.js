// Lo que la descarga escribe mientras corre: la línea de estado y el registro técnico.
//
// Portado de `log()` y `setStatus()` de `utils.js` y `main.js` de v7, y de las llamadas que las dos
// descargas —la del árbol en `doFetchAll` y la fase 1 de `analyzer.js`— hacían a lo largo del camino.
//
// POR QUÉ ESTO ES UN MÓDULO Y NO TEXTO SUELTO DENTRO DE LA PANTALLA. Aquí vive lo que antes decía la
// tabla «Qué se baja» y ya no existe: contra qué tabla de este tenant resolvió cada papel, cuántas
// filas se descartaron, y —lo importante— si SAP dijo que hay más filas de las que llegaron. Ese
// último aviso es la diferencia entre una tabla completa y una a medias, y las dos se leen igual si
// nadie lo dice. Estando aquí se puede comprobar sin montar la pantalla.
//
// El formato es el de v7 y no se cambia: `13:52:07 · Header: 2437 registros → IDB`. La clase —`ok`,
// `err`, `warn`, `info`— es la que le da color en `.log-area`, que también está portada tal cual.

import { nombresDe } from '../../core/ibp/explorer-extract-plan.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** La hora que va delante de cada línea. v7 usaba `toLocaleTimeString()` a secas. */
export const horaDe = (cuando) => new Date(cuando).toLocaleTimeString('es', { hour12: false })

/**
 * Una línea del registro. `clase` es la de v7 y decide el color.
 *
 * El `id` es para dibujarlas: dos líneas seguidas pueden tener el mismo texto y la misma hora —una
 * descarga rápida escribe varias en el mismo milisegundo—, y sin algo propio la lista se redibuja
 * mal al crecer.
 */
let siguienteId = 0
export const linea = (clase, texto, cuando = Date.now()) => {
  siguienteId += 1
  return { id: siguienteId, clase, texto, cuando }
}

// ── La línea de estado ───────────────────────────────────────────────────────────────────────────
//
// Los textos son los de `es.json` de v7, literales. No se retocan: son los que el cliente lleva años
// leyendo mientras espera.

export const PREPARANDO = 'Preparando base de datos local...'
export const INDEXANDO = 'Indexando lista de productos...'

/** «Descargando Production Source Header...», con el nombre largo que usaba v7. */
export const descargando = (paso) => `Descargando ${nombresDe(paso).sap}...`

// ── El registro ──────────────────────────────────────────────────────────────────────────────────

/**
 * La línea de antes de pedir una tabla.
 *
 * v7 escribía la URL entera. Aquí no se puede y no es un recorte de información: el navegador nunca
 * sabe la dirección del tenant —las credenciales y la URL viven cifradas en el servidor, que es la
 * regla de seguridad de esta plataforma—. Lo que la línea tiene que decir es QUÉ tabla se pidió y si
 * iba acotada al área y la versión, y eso sí está.
 */
export function lineaDePeticion(paso, destino, cuando = Date.now()) {
  const acotado = destino?.planningArea ? ' [filtro PA/Ver]' : ''
  return linea('info', `GET → ${paso.entidad}${acotado}`, cuando)
}

/**
 * Las líneas de una tabla ya terminada. Son varias porque una tabla puede salir bien Y estar coja.
 *
 * El orden importa: primero qué pasó, después los peros. Un aviso antes del resultado se lee como si
 * el resultado no hubiera llegado.
 */
export function lineasDeTabla(paso, hecho, cuando = Date.now()) {
  const { corto } = nombresDe(paso)
  const salida = []

  if (!paso.sePuede) {
    // v7: «Item Validity: sin entidad configurada».
    salida.push(linea('warn', `${corto}: sin entidad configurada`, cuando))
    return salida
  }

  if (hecho?.error) {
    salida.push(linea('err', `${corto}: error — ${hecho.error}`, cuando))
    return salida
  }

  if (hecho?.cancelado) {
    salida.push(linea('warn', `${corto}: cancelada`, cuando))
    return salida
  }

  if (hecho?.omitido) {
    salida.push(linea('warn', `${corto}: saltada — ${hecho.motivo ?? 'sin motivo'}`, cuando))
    return salida
  }

  const guardadas = hecho?.guardadas ?? 0
  const descartadas = Math.max(0, (hecho?.bajadas ?? 0) - guardadas)

  let texto = `${corto}: ${numero(guardadas)} registros → IDB`
  if (descartadas > 0) texto += ` (${numero(descartadas)} descartadas: SAP las marca inválidas)`
  else if (guardadas === 0 && !paso.esencial) texto += ' (sin datos)'
  salida.push(linea('ok', texto, cuando))

  // Los campos que este tenant no tiene. No impiden bajar, pero el informe sale sin ellos.
  if (paso.omitidos?.length > 0) {
    salida.push(linea(
      'warn',
      `${corto}: este tenant no tiene ${paso.omitidos.join(', ')}. Se baja sin ${paso.omitidos.length === 1 ? 'ese campo' : 'esos campos'}.`,
      cuando,
    ))
  }

  // El aviso que antes vivía en la columna «Estado» de la tabla. Es el único de todos estos que
  // invalida lo que se analice después, así que va en rojo y no en ámbar.
  if (hecho?.faltan > 0) {
    salida.push(linea(
      'err',
      `✕ ${corto}: incompleta — SAP dice ${numero(hecho.enSap)} filas y llegaron ${numero(hecho.bajadas)}`,
      cuando,
    ))
  }

  return salida
}

/**
 * Cómo termina la línea de estado cuando acabaron todas las tablas.
 *
 * Lo que sigue después —indexar productos, arrancar el análisis— lo dice quien montó la descarga,
 * porque cambia según la aplicación: v7 decía «N productos en caché local» en el árbol y «Iniciando
 * análisis...» en los analizadores.
 */
export function estadoAlTerminar(salida) {
  if (!salida) return { tipo: 'info', texto: '' }

  if (salida.conError > 0) {
    return {
      tipo: 'err',
      texto: salida.conError === 1
        ? 'Una tabla falló. Mira los logs técnicos.'
        : `${numero(salida.conError)} tablas fallaron. Mira los logs técnicos.`,
    }
  }

  if (salida.incompletas > 0) {
    return {
      tipo: 'err',
      texto: salida.incompletas === 1
        ? 'A una tabla le faltan filas: no conviene analizar con esto.'
        : `A ${numero(salida.incompletas)} tablas les faltan filas: no conviene analizar con esto.`,
    }
  }

  return { tipo: 'ok', texto: `${numero(salida.guardadas)} filas guardadas.` }
}

/** El resumen del árbol, literal de `main.bom.loadedSummary` de v7. */
export const resumenDelArbol = (cuantos) =>
  `✓ ${numero(cuantos)} productos en caché local. Selecciona uno para ver su BOM.`
