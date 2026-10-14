// El body de una integración: leerlo, validarlo y rellenar sus variables.
//
// Es la pieza pura (no toca la base ni la red) que comparten el servidor y la pantalla. Una integración
// es lo que hoy se pega en Postman: un solo bloque, con el nombre del bloque como clave de primer nivel
// y lo que el iFlow necesita dentro:
//
//     { "PRODUCT": { "BatchCommand": "INSERT_UPDATE", "PlanningArea": "STARBRANDS", … } }
//
// Decisiones, y por qué:
//
//   - UN solo bloque por integración. El iFlow aceptaría varios y los ejecutaría en fila, pero entonces la
//     suite no podría decir cuál falló ni retomar desde ese. Para encadenar cargas están las
//     orquestaciones: cada paso es una llamada y cada llamada tiene su resultado.
//   - El body se guarda y se envía como el JSON que la persona escribió, sin reordenar claves.
//   - Las variables (`{{FECHA_DESDE}}`) se sustituyen sobre los VALORES de texto ya leídos, nunca sobre el
//     texto crudo: así un valor no puede cerrar una cadena ni abrir otra clave.

/** Tope del body. El de un mapeo de 50 campos pesa 5 KB; medio megabyte es mucho más de lo razonable. */
export const BODY_MAX_BYTES = 512 * 1024

/** Un nombre de variable: letras, números y guion bajo, sin empezar por número. */
const NOMBRE_DE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** `{{NOMBRE}}` dentro de un texto, con espacios opcionales: `{{ NOMBRE }}`. */
const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g

/** Tope del valor de una variable. Una fecha son 8 caracteres; una lista corta, algo más. */
export const VALOR_DE_VARIABLE_MAX = 200

/** Un error de variables, para que quien lo atrapa distinga «falta un valor» de un fallo cualquiera. */
export class VariableError extends Error {
  constructor(message, { faltan = [] } = {}) {
    super(message)
    this.name = 'VariableError'
    this.faltan = faltan
  }
}

/** ¿Es un objeto «de verdad»: no una lista, no `null`? */
const esObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)

/**
 * Lee el texto de un body y devuelve `{ ok: true, clave, bloque, objeto }`, o `{ ok: false, error }` con un
 * mensaje que se pueda mostrar. No lanza: es lo que la pantalla llama en cada pulsación.
 */
export function leerBody(texto) {
  const crudo = String(texto ?? '')
  if (crudo.trim() === '') return { ok: false, error: 'El body está vacío.' }
  // `TextEncoder` y no `Buffer`: este archivo también corre en el navegador.
  if (new TextEncoder().encode(crudo).length > BODY_MAX_BYTES) {
    return { ok: false, error: `El body pesa más de ${BODY_MAX_BYTES / 1024} KB.` }
  }

  let objeto
  try {
    objeto = JSON.parse(crudo)
  } catch (fallo) {
    return { ok: false, error: `El body no es un JSON válido: ${fallo.message}` }
  }

  if (!esObjeto(objeto)) return { ok: false, error: 'El body tiene que ser un objeto: { "NOMBRE_DEL_BLOQUE": { … } }.' }

  const claves = Object.keys(objeto)
  if (claves.length === 0) return { ok: false, error: 'El body no tiene ningún bloque.' }
  if (claves.length > 1) {
    return {
      ok: false,
      error: `El body trae ${claves.length} bloques (${claves.join(', ')}). Una integración lleva un solo bloque: `
        + 'para encadenar varias cargas, crea una integración por bloque y únelas en una orquestación.',
    }
  }

  const [clave] = claves
  if (!esObjeto(objeto[clave])) return { ok: false, error: `El bloque «${clave}» tiene que ser un objeto con sus campos.` }

  return { ok: true, clave, bloque: objeto[clave], objeto }
}

/**
 * Valida un body y lo devuelve normalizado (JSON con sangría de 2, claves en su orden). Lanza con un
 * mensaje que se pueda mostrar si no vale.
 */
export function normalizarBody(texto) {
  const leido = leerBody(texto)
  if (!leido.ok) throw new Error(leido.error)
  return JSON.stringify(leido.objeto, null, 2)
}

/** Recorre todos los valores de texto de un valor JSON, a cualquier profundidad. */
function* textosDe(valor) {
  if (typeof valor === 'string') yield valor
  else if (Array.isArray(valor)) for (const uno of valor) yield* textosDe(uno)
  else if (esObjeto(valor)) for (const uno of Object.values(valor)) yield* textosDe(uno)
}

/** Los nombres de variable que usa un body, sin repetir y en orden alfabético. Solo cuentan los VALORES. */
export function variablesDeBody(texto) {
  const leido = leerBody(texto)
  if (!leido.ok) return []
  const nombres = new Set()
  for (const cadena of textosDe(leido.objeto)) {
    for (const coincidencia of cadena.matchAll(TOKEN)) nombres.add(coincidencia[1])
  }
  return [...nombres].sort()
}

/**
 * ¿Vale este valor para una variable? Devuelve el motivo si no.
 *
 * Se rechazan las comillas y la barra invertida porque el filtro del iFlow las usa como sintaxis
 * (`CAMPO EQ 'valor'`): un valor con una comilla abriría otra condición dentro del filtro.
 */
export function motivoDeValorInvalido(valor) {
  if (typeof valor !== 'string') return 'tiene que ser un texto'
  if (valor === '') return 'está vacío'
  if (valor.length > VALOR_DE_VARIABLE_MAX) return `pasa de ${VALOR_DE_VARIABLE_MAX} caracteres`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(valor)) return 'lleva caracteres de control'
  if (/['"\\]/.test(valor)) return 'lleva comillas o barras invertidas'
  return null
}

/** ¿Es un nombre de variable válido? */
export const esNombreDeVariable = (nombre) => NOMBRE_DE_VARIABLE.test(String(nombre ?? ''))

/**
 * Reemplaza cada `{{NOMBRE}}` por su valor y devuelve el JSON listo para enviar (compacto).
 *
 * Revienta con `VariableError` si falta algún valor o alguno no vale: NUNCA se envía un body con un
 * `{{…}}` sin resolver, porque el iFlow lo cargaría tal cual como filtro o como nombre.
 *
 * Los valores sobrantes (variables que este body no usa) se ignoran: una orquestación manda las de todos
 * sus pasos a cada uno.
 */
export function aplicarVariables(texto, valores = {}) {
  const leido = leerBody(texto)
  if (!leido.ok) throw new Error(leido.error)

  const faltan = []
  const invalidas = []

  const sustituir = (valor) => {
    if (typeof valor === 'string') {
      return valor.replace(TOKEN, (_entero, nombre) => {
        const puesto = Object.hasOwn(valores, nombre) ? valores[nombre] : undefined
        if (puesto === undefined || puesto === null || puesto === '') {
          if (!faltan.includes(nombre)) faltan.push(nombre)
          return ''
        }
        const motivo = motivoDeValorInvalido(puesto)
        if (motivo) {
          invalidas.push(`«${nombre}» ${motivo}`)
          return ''
        }
        return puesto
      })
    }
    if (Array.isArray(valor)) return valor.map(sustituir)
    if (esObjeto(valor)) return Object.fromEntries(Object.entries(valor).map(([clave, uno]) => [clave, sustituir(uno)]))
    return valor
  }

  const resultado = sustituir(leido.objeto)

  if (faltan.length > 0) {
    throw new VariableError(
      `Falta el valor de ${faltan.map((nombre) => `{{${nombre}}}`).join(', ')}.`,
      { faltan },
    )
  }
  if (invalidas.length > 0) throw new VariableError(`Valor no válido: ${invalidas.join('; ')}.`)

  return JSON.stringify(resultado)
}

/**
 * Lo que una lista enseña de una integración sin abrirla. Sale del propio body, así que no puede quedar
 * desactualizado respecto a lo que se enviaría.
 */
export function resumenDeBody(texto) {
  const leido = leerBody(texto)
  if (!leido.ok) return { valido: false, error: leido.error }
  const { clave, bloque } = leido
  const texto1 = (campo) => (typeof bloque[campo] === 'string' ? bloque[campo] : '')
  return {
    valido: true,
    clave,
    tipo: texto1('TypeOfData'),
    comando: texto1('BatchCommand'),
    areaDePlanificacion: texto1('PlanningArea'),
    version: texto1('PlanningAreaVersion'),
    tipoDeMaestro: texto1('MasterDataType'),
    nombreDeLote: texto1('BatchName'),
    variables: variablesDeBody(texto),
  }
}

/**
 * Saca de un mensaje de error el identificador del log de mensajes de Cloud Integration (MPL ID), que es lo
 * que se busca después en el monitor de CPI. Llega en frases como «The MPL ID for the failed message is :
 * AGrOoIkGv-d7sJej0DVu0bhXLV8K». Devuelve `null` si el mensaje no lo trae.
 */
export function extraerMplId(texto) {
  const coincidencia = String(texto ?? '').match(/MPL\s*ID[^:\n]{0,60}:\s*([A-Za-z0-9_-]{10,})/i)
  return coincidencia ? coincidencia[1] : null
}
