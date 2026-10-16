// Lo que la pantalla necesita para editar y mostrar los ajustes de una orquestación de CI Tools.
//
// Las reglas (qué es un ajuste, quién manda, cómo se aplica al body) viven en `core/ci/ajustes.js` y las comparte el servidor: aquí solo
// están los cambios sobre el objeto de ajustes que hace la pantalla y los textos cortos con que se enseña.
//
// Pura, sin React ni red.

import { CAMPOS_DE_AJUSTE, contarAjustes, resolverAjustes } from '../../core/ci/ajustes.js'
import { esFechaAAAAMMDD } from './fechas.js'

/** Los comandos que se vieron en los bodies reales (no se sabe qué otros acepta el iFlow: se pueden escribir a mano). */
export const COMANDOS_CONOCIDOS = Object.freeze(['INSERT_UPDATE', 'REPLACE'])

/**
 * Los valores que ya usan las integraciones de la conexión, para ofrecerlos en las listas de ajustes: elegir uno que ya existe es más
 * rápido y más seguro que escribirlo. `{ version, comando, origen, destino }`, cada uno una lista sin repetir y ordenada.
 */
export function opcionesDeAjustes(integraciones) {
  const juntar = (campo) => [...new Set(
    (integraciones ?? []).map((una) => (una.resumen?.valido ? una.resumen[campo] : '')).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'es'))
  return {
    version: juntar('version'),
    comando: [...new Set([...COMANDOS_CONOCIDOS, ...juntar('comando')])],
    origen: juntar('sistemaOrigen'),
    destino: juntar('sistemaDestino'),
  }
}

// ─── Cambios sobre un objeto de ajustes ─────────────────────────────────────────────────────────────
//
// Todos devuelven un objeto nuevo y quitan lo que queda vacío: unos ajustes sin nada son `{}`, y eso es lo que se guarda.

/** Pone un campo (`version`, `comando`, `origen`, `destino`), o lo quita con `undefined`. La versión `''` es la base: es un valor. */
export function conCampo(ajustes, clave, valor) {
  const resto = Object.fromEntries(Object.entries(ajustes ?? {}).filter(([otra]) => otra !== clave))
  return valor === undefined ? resto : { ...resto, [clave]: valor }
}

/** Pone un lado de las fechas del lote (`desde` o `hasta`), o lo quita con `undefined` o vacío. */
export function conFecha(ajustes, lado, valor) {
  const fechas = { ...(ajustes?.fechas ?? {}) }
  if (valor === undefined || valor === '') delete fechas[lado]
  else fechas[lado] = valor
  const resto = Object.fromEntries(Object.entries(ajustes ?? {}).filter(([clave]) => clave !== 'fechas'))
  return Object.keys(fechas).length === 0 ? resto : { ...resto, fechas }
}

/** Pone el ajuste de una condición del filtro (`{ valores }` o `{ desde, hasta }`), o la quita con `null`. */
export function conFiltro(ajustes, campo, ajusteDeLaCondicion) {
  const filtro = Object.fromEntries(Object.entries(ajustes?.filtro ?? {}).filter(([otro]) => otro !== campo))
  if (ajusteDeLaCondicion) filtro[campo] = ajusteDeLaCondicion
  const resto = Object.fromEntries(Object.entries(ajustes ?? {}).filter(([clave]) => clave !== 'filtro'))
  return Object.keys(filtro).length === 0 ? resto : { ...resto, filtro }
}

// ─── Textos ─────────────────────────────────────────────────────────────────────────────────────────

/** Una fecha como se lee: `01-01-2026`. Una variable (`{{DESDE}}`) o cualquier otro texto, tal cual. */
export const fechaCorta = (valor) => (
  esFechaAAAAMMDD(valor) ? `${valor.slice(6, 8)}-${valor.slice(4, 6)}-${valor.slice(0, 4)}` : String(valor ?? '')
)

/** Un rango de fechas como se lee: `01-01-2026 → 31-12-2027`. */
export const rangoCorto = ({ desde, hasta }) => `${fechaCorta(desde)} → ${fechaCorta(hasta)}`

/** Un valor de un campo de ajustes como se lee: la versión vacía es «base». */
const comoSeLee = (clave, valor) => (valor === '' ? (clave === 'version' ? 'base' : '(vacío)') : valor)

/**
 * Los ajustes del lote en una frase corta para la franja cerrada: `Versión PV2 · Fechas 01-03-2026 → 31-03-2026`. Vacía si no hay
 * ninguno.
 */
export function resumenDeLote(ajustes) {
  const partes = Object.entries(CAMPOS_DE_AJUSTE)
    .filter(([clave]) => typeof ajustes?.[clave] === 'string')
    .map(([clave, { etiqueta }]) => `${etiqueta} ${comoSeLee(clave, ajustes[clave])}`)
  const { desde, hasta } = ajustes?.fechas ?? {}
  if (desde || hasta) partes.push(`Fechas ${desde ? fechaCorta(desde) : '…'} → ${hasta ? fechaCorta(hasta) : '…'}`)
  return partes.join(' · ')
}

/**
 * Qué cambian los ajustes en cada integración de una orquestación, para enseñarlo: una entrada por tarea con lo que resuelve
 * `resolverAjustes` y cuántos cambios vienen de cada nivel. `tareas` son `[{ tarea, numero, enGrupo }]` (ver `tareasDeLosPasos`) y
 * `porId`, las integraciones por identificador.
 */
export function efectosDeLosAjustes(tareas, porId, ajustesDelLote) {
  return tareas.map(({ tarea, numero, enGrupo }) => {
    const integracion = porId.get(tarea.integrationId)
    const nombre = integracion ? integracion.name : tarea.label
    if (!integracion?.resumen?.valido) return { tarea, numero, enGrupo, nombre, integracion, resuelto: null, delPaso: 0, delLote: 0 }
    const resuelto = resolverAjustes(integracion.resumen, { general: ajustesDelLote, paso: tarea.ajustes })
    return {
      tarea,
      numero,
      enGrupo,
      nombre,
      integracion,
      resuelto,
      delPaso: resuelto.cambios.filter((cambio) => cambio.fuente === 'paso').length,
      delLote: resuelto.cambios.filter((cambio) => cambio.fuente === 'orquestacion').length,
    }
  })
}

/** Lo que una integración quedaría diciendo con los ajustes, con la forma del resumen (sirve para `configuracionDeIntegracion`). */
export const resumenConAjustes = (resumen, resuelto) => (resuelto ? {
  ...resumen,
  version: resuelto.version,
  comando: resuelto.comando,
  sistemaOrigen: resuelto.origen,
  sistemaDestino: resuelto.destino,
} : resumen)

export { contarAjustes }
