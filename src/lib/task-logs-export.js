// Descargar en Excel los logs de todas las ejecuciones que deja ver el filtro del Task Monitor.
//
// No existía en v9: allí los logs se leían de a una ejecución, en el visor. Lo que se reutiliza es lo
// de siempre: la operación `getTaskLogs`, el fin y la duración de `fetchTaskDetails`, y el tope de
// seis consultas a la vez que v9 usaba contra CI-DS.
//
// Tres cosas que salen de cómo funciona SAP y no son preferencias:
//
//   - SAP entrega cada log por páginas y no deja pedir la última directamente: según la guía de web
//     services de CI-DS, un `pageNum` mayor que el total devuelve la PRIMERA. Por eso va una consulta
//     con la página 1 de los tres logs, que trae `maxPage`, y solo si alguno tiene más de una sale
//     una segunda con la última de esos. Se guardan la primera y la última página de cada log.
//   - Excel no admite más de 32.767 caracteres por celda. Un log que no cabe se reparte en varias
//     filas de la misma ejecución; las de continuación llevan «#2», «#3»… delante del nombre de la
//     task y repiten el resto de los datos.
//   - El XML del `.xlsx` no admite algunos caracteres de control que un log puede traer. Se quitan
//     antes de escribir: con uno solo, Excel da el archivo entero por dañado.

import { runPool } from '../../core/cids/pool.js'
import { SheetBuilder, assembleXlsx } from './xlsx.js'

/** El máximo de caracteres de una celda de Excel. */
export const LIMITE_DE_CELDA = 32767

/** Por encima de cuántas ejecuciones se pide confirmación antes de descargar. */
export const TOPE_SIN_CONFIRMAR = 500

/** Cuántas consultas de logs van a la vez. El mismo tope que v9 usaba contra CI-DS. */
export const CONCURRENCIA_DE_LOGS = 6

/** Los tres logs, en el orden de las pestañas del visor. */
export const TIPOS_DE_LOG = Object.freeze([
  { key: 'monitorLog', titulo: 'Log Monitor' },
  { key: 'traceLog', titulo: 'Log Trace' },
  { key: 'errorLog', titulo: 'Log Error' },
])

export const ENCABEZADOS = Object.freeze([
  'Task', 'Inicio', 'Fin', 'Estado', 'Duración', ...TIPOS_DE_LOG.map((tipo) => tipo.titulo),
])

/** Caracteres que el XML 1.0 no admite, y mitades sueltas de un par sustituto. */
// eslint-disable-next-line no-control-regex
const NO_ADMITIDOS_EN_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function limpiarParaXml(valor) {
  return String(valor ?? '').replace(NO_ADMITIDOS_EN_XML, '')
}

/**
 * Parte un texto en trozos que quepan en una celda.
 *
 * Se corta en un salto de línea cuando hay uno en la segunda mitad del trozo, para no partir una
 * línea del log por la mitad; si no, se corta en el límite, sin separar un par sustituto.
 */
export function partirTexto(texto, limite = LIMITE_DE_CELDA) {
  const partes = []
  let resto = texto
  while (resto.length > limite) {
    const salto = resto.lastIndexOf('\n', limite)
    if (salto >= limite / 2) {
      partes.push(resto.slice(0, salto))
      resto = resto.slice(salto + 1)
      continue
    }
    let corte = limite
    const codigo = resto.charCodeAt(corte - 1)
    if (codigo >= 0xD800 && codigo <= 0xDBFF) corte -= 1
    partes.push(resto.slice(0, corte))
    resto = resto.slice(corte)
  }
  partes.push(resto)
  return partes
}

const paginasDe = (bloque) => Number.parseInt(bloque?.maxPage, 10) || 1
const lineasDe = (bloque) => (bloque?.messageLines ?? []).join('\n')

/**
 * El texto de un log a partir de su primera página y, si tiene más de una, de la última.
 *
 * Cuando hay varias páginas cada parte lleva su marca: sin ella, quien lea la celda creería que el
 * log está entero.
 */
export function textoDeLog(primera, ultima) {
  if (!primera) return ''
  const total = paginasDe(primera)
  if (total <= 1) return lineasDe(primera)

  const final = ultima?.error
    ? `[No se pudo leer la página ${total} de ${total}: ${ultima.error}]`
    : `[Página ${total} de ${total}]\n${lineasDe(ultima)}`
  return `[Página 1 de ${total}]\n${lineasDe(primera)}\n\n${final}`
}

/**
 * Los tres logs de una ejecución, ya como texto.
 *
 * `llamar(operacion, parametros)` es quien habla con CI-DS; se recibe para poder probarlo sin red.
 * Si la primera consulta falla, la excepción sube: la decide quien recorre las ejecuciones.
 */
export async function leerLogsDeEjecucion(llamar, runId) {
  const todos = Object.fromEntries(TIPOS_DE_LOG.map((tipo) => [tipo.key, { getLog: true }]))
  const primera = await llamar('getTaskLogs', { runId, ...todos })

  const conMasPaginas = TIPOS_DE_LOG.filter((tipo) => paginasDe(primera?.[tipo.key]) > 1)
  let ultima = {}
  if (conMasPaginas.length > 0) {
    const pedidos = Object.fromEntries(conMasPaginas.map((tipo) => (
      [tipo.key, { getLog: true, pageNum: paginasDe(primera[tipo.key]) }]
    )))
    try {
      ultima = await llamar('getTaskLogs', { runId, ...pedidos })
    } catch (fallo) {
      ultima = Object.fromEntries(conMasPaginas.map((tipo) => [tipo.key, { error: fallo.message }]))
    }
  }

  return Object.fromEntries(TIPOS_DE_LOG.map((tipo) => (
    [tipo.key, textoDeLog(primera?.[tipo.key], ultima?.[tipo.key])]
  )))
}

/**
 * Las filas de Excel de una ejecución: una, o varias si algún log no cabe en una celda.
 *
 * Se siguen agregando filas hasta escribir el log más largo. En las de continuación, los logs que ya
 * terminaron quedan vacíos: repetirlos haría pensar que el log aparece dos veces.
 */
export function filasDeEjecucion({ nombre, inicio, fin, estado, duracion, logs }, limite = LIMITE_DE_CELDA) {
  const datos = [nombre, inicio, fin, estado, duracion].map(limpiarParaXml)
  const partes = TIPOS_DE_LOG.map((tipo) => partirTexto(limpiarParaXml(logs?.[tipo.key]), limite))
  const cuantas = Math.max(...partes.map((una) => una.length))

  return Array.from({ length: cuantas }, (_, i) => [
    i === 0 ? datos[0] : `#${i + 1} ${datos[0]}`,
    ...datos.slice(1),
    ...partes.map((una) => una[i] ?? ''),
  ])
}

/** Los estilos del libro: normal, encabezado, dato arriba, y log arriba con ajuste de texto. */
const XF_ENCABEZADO = 1
const XF_DATO = 2
const XF_LOG = 3

const ESTILOS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2">'
  + '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
  + '</fonts>'
  + '<fills count="3">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF223962"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>'

const ANCHOS = [40, 20, 20, 14, 12, 80, 80, 80]
const COLUMNAS_DE_DATOS = 5

/** La hoja con el encabezado y las filas. Separada del armado del ZIP para poder probarla. */
export function hojaDeLogs(filas) {
  const hoja = new SheetBuilder().setColWidths(ANCHOS)
  hoja.addRow(ENCABEZADOS.map((titulo) => ({ v: titulo, s: XF_ENCABEZADO })), 20)
  for (const fila of filas) {
    hoja.addRow(fila.map((valor, c) => ({ v: valor, s: c < COLUMNAS_DE_DATOS ? XF_DATO : XF_LOG })))
  }
  return hoja
}

export function armarLibroDeLogs(filas) {
  return assembleXlsx([{ name: 'Logs', sb: hojaDeLogs(filas) }], ESTILOS_XML)
}

/**
 * Recorre las ejecuciones, trae fin, duración y logs, y arma las filas en el orden recibido.
 *
 * - `pedirDetalles(runIds)`: fin y duración de las que falten (`fetchTaskDetails`).
 * - `detallesPrevios`: los que el monitor ya tiene; se reusan los de estados terminales.
 * - `esTerminal(codigo)`: si un estado ya no cambia.
 * - `comoSeLee(fila, detalle)`: los cinco datos tal como se ven en la pantalla.
 * - `debeParar()`: se consulta antes de cada consulta; si da verdadero, devuelve `null`.
 * - `onAvance({ fase, hechas, total })`: `fase` es `detalles` o `logs`.
 *
 * Una ejecución cuyos logs no se pudieron leer no corta la descarga: sus celdas lo dicen y se cuenta
 * en `fallidas`, con el primer motivo en `primerError`.
 */
export async function reunirLogs({
  ejecuciones, llamar, pedirDetalles, detallesPrevios = {}, esTerminal, comoSeLee,
  debeParar = () => false, onAvance = () => {},
}) {
  const total = ejecuciones.length

  const faltan = ejecuciones
    .filter((fila) => fila.runId && (!detallesPrevios[fila.runId] || !esTerminal(fila.statusCode)))
    .map((fila) => fila.runId)
  onAvance({ fase: 'detalles', hechas: 0, total: faltan.length })
  const nuevos = faltan.length > 0 ? await pedirDetalles(faltan, { shouldStop: debeParar }) : {}
  if (debeParar()) return null
  const detalles = { ...detallesPrevios, ...nuevos }

  const logs = new Array(total)
  let hechas = 0
  let fallidas = 0
  let primerError = ''
  onAvance({ fase: 'logs', hechas, total })

  await runPool(ejecuciones.map((fila, indice) => ({ fila, indice })), CONCURRENCIA_DE_LOGS, async ({ fila, indice }) => {
    if (debeParar()) return
    try {
      logs[indice] = await leerLogsDeEjecucion(llamar, fila.runId)
    } catch (fallo) {
      fallidas += 1
      primerError ||= fallo.message
      const aviso = `[No se pudo leer el log: ${fallo.message}]`
      logs[indice] = Object.fromEntries(TIPOS_DE_LOG.map((tipo) => [tipo.key, aviso]))
    }
    hechas += 1
    onAvance({ fase: 'logs', hechas, total })
  })
  if (debeParar()) return null

  const filas = ejecuciones.flatMap((fila, indice) => filasDeEjecucion({
    ...comoSeLee(fila, detalles[fila.runId]),
    logs: logs[indice],
  }))

  return { filas, detalles: nuevos, total, fallidas, primerError }
}

/** El nombre del archivo: destino, rango de fechas y cuántas ejecuciones lleva. */
export function nombreDelLibro({ destino, desde, hasta, total }) {
  const dia = (iso) => String(iso ?? '').slice(0, 10)
  const limpio = ['logs', destino, dia(desde), dia(hasta), total]
    .map((parte) => String(parte ?? '').trim().replace(/[^\w.-]+/g, '_'))
    .filter((parte) => parte !== '' && parte !== '_')
    .join('_')
  return `${limpio}.xlsx`
}
