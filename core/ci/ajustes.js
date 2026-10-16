// Los AJUSTES de una orquestación de CI Tools: lo que una orquestación cambia de las integraciones que ejecuta, sin tocarlas.
//
// Una integración dice versión, comando, origen, destino y filtro. Una orquestación puede querer otros valores para su carga
// (otra versión, otras fechas) sin crear una copia de cada integración. Los ajustes viven en la orquestación y se aplican al body
// SOLO al enviarlo: la integración original no se modifica nunca.
//
// Hay dos niveles, y manda el más específico:
//
//     integración  <  ajustes de la orquestación (todo el lote)  <  ajustes del paso
//
//   - Del LOTE: `version`, `comando`, `origen`, `destino` y `fechas` (un Desde y un Hasta para toda condición `KEYFIGUREDATE BT`).
//   - Del PASO: lo mismo, y además `filtro`: los valores de cada condición del filtro de ESA integración.
//
// Forma (todo opcional; lo que no está, no se cambia):
//
//     {
//       version: 'PV2',                  // '' es la versión BASE (es un valor, no «sin cambio»)
//       comando: 'REPLACE',
//       origen: 'QAS',                   // «Destino del add-on» (DestinationforAddon): de qué sistema sale la carga
//       destino: 'IBP',                  // «Destino en SAP IBP» (DestinationforSAPIBP)
//       fechas: { desde: '20260101', hasta: '{{HASTA}}' },     // solo en los del lote
//       filtro: { MATTYPEID: { valores: ['ZFER'] }, KEYFIGUREDATE: { desde: '20260101', hasta: '20261231' } },   // solo en los del paso
//     }
//
// Un valor puede ser una VARIABLE entera (`{{FECHA_DESDE}}`): se sigue pidiendo al ejecutar.
//
// Pura, sin red ni base: la comparten el servidor (que valida lo que se guarda y aplica lo que se envía) y la pantalla (que enseña,
// antes de ejecutar, qué cambia en cada paso). Una sola implementación: lo que se ve es lo que se envía.

import { leerBody, motivoDeValorInvalido } from './body.js'
import { esFechaAAAAMMDD } from './fechas.js'
import { condicionesDeFiltro, escribirFiltro, leerFiltro, motivoDeValorDeFiltroInvalido } from './filter.js'

/** Qué campo del body cambia cada ajuste, y cómo se llama en pantalla. */
export const CAMPOS_DE_AJUSTE = Object.freeze({
  version: { campo: 'PlanningAreaVersion', etiqueta: 'Versión', enVista: 'version' },
  comando: { campo: 'BatchCommand', etiqueta: 'Comando', enVista: 'comando' },
  origen: { campo: 'DestinationforAddon', etiqueta: 'Origen', enVista: 'sistemaOrigen' },
  destino: { campo: 'DestinationforSAPIBP', etiqueta: 'Destino', enVista: 'sistemaDestino' },
})

const CLAVES = Object.keys(CAMPOS_DE_AJUSTE)

/** El campo del filtro que lleva fechas. */
export const CAMPO_DE_FECHA = 'KEYFIGUREDATE'

/** Topes: un filtro real tiene unas pocas condiciones y, cada una, algunas decenas de valores. */
const MAX_CONDICIONES = 50
const MAX_VALORES = 100

const NOMBRE_DE_CAMPO = /^[A-Za-z0-9_/]+$/
const VARIABLE_ENTERA = /^\{\{\s*[A-Za-z_][A-Za-z0-9_]{0,63}\s*\}\}$/

const esObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)
const esCampoDeFecha = (campo) => String(campo ?? '').trim().toUpperCase() === CAMPO_DE_FECHA

/** Una fecha de un ajuste: una fecha real o una variable entera. Devuelve el motivo si no. */
const motivoDeFecha = (valor) => (
  esFechaAAAAMMDD(valor) || VARIABLE_ENTERA.test(valor) ? null : 'tiene que ser una fecha (AAAAMMDD) o una variable ({{NOMBRE}})'
)

/** Un valor de una condición del filtro: texto sin comillas, comas ni caracteres de control. Devuelve el motivo si no. */
function motivoDeValorDeCondicion(valor) {
  const motivo = motivoDeValorInvalido(valor)
  if (motivo) return motivo
  return motivoDeValorDeFiltroInvalido(valor) ? 'no puede llevar comillas simples ni comas' : null
}

/**
 * Valida y limpia unos ajustes. Lanza con un mensaje que se pueda mostrar si algo no vale: es lo que se guarda, y quien lo guarda
 * puede arreglarlo. Devuelve SOLO lo que dice algo (sin claves vacías ni desconocidas).
 */
export function normalizarAjustes(crudo) {
  if (crudo === undefined || crudo === null) return {}
  if (!esObjeto(crudo)) throw new Error('Los ajustes tienen que ser un objeto.')

  const salida = {}

  for (const clave of CLAVES) {
    const entrada = crudo[clave]
    if (entrada === undefined || entrada === null) continue
    const { etiqueta } = CAMPOS_DE_AJUSTE[clave]
    if (typeof entrada !== 'string') throw new Error(`${etiqueta}: tiene que ser un texto.`)
    const valor = entrada.trim()
    // La versión vacía es la BASE: es un valor, no «sin cambio».
    if (clave === 'version' && valor === '') { salida.version = ''; continue }
    const motivo = motivoDeValorInvalido(valor)
    if (motivo) throw new Error(`${etiqueta}: ${motivo}.`)
    salida[clave] = valor
  }

  if (crudo.fechas !== undefined && crudo.fechas !== null) {
    if (!esObjeto(crudo.fechas)) throw new Error('Fechas: tienen que ser un objeto con «desde» y «hasta».')
    const fechas = {}
    for (const lado of ['desde', 'hasta']) {
      const entrada = crudo.fechas[lado]
      if (entrada === undefined || entrada === null || entrada === '') continue
      if (typeof entrada !== 'string') throw new Error(`Fecha ${lado}: tiene que ser un texto.`)
      const valor = entrada.trim()
      const motivo = motivoDeFecha(valor)
      if (motivo) throw new Error(`Fecha ${lado}: ${motivo}.`)
      fechas[lado] = valor
    }
    if (Object.keys(fechas).length > 0) salida.fechas = fechas
  }

  if (crudo.filtro !== undefined && crudo.filtro !== null) {
    if (!esObjeto(crudo.filtro)) throw new Error('Filtro: tiene que ser un objeto con una entrada por condición.')
    const campos = Object.keys(crudo.filtro)
    if (campos.length > MAX_CONDICIONES) throw new Error(`Filtro: demasiadas condiciones (el máximo es ${MAX_CONDICIONES}).`)
    const filtro = {}

    for (const campo of campos) {
      if (!NOMBRE_DE_CAMPO.test(campo)) throw new Error(`Filtro: «${campo}» no es un nombre de campo válido.`)
      const ajuste = crudo.filtro[campo]
      if (!esObjeto(ajuste)) throw new Error(`Filtro «${campo}»: tiene que ser un objeto.`)

      if (Array.isArray(ajuste.valores)) {
        if (ajuste.valores.length > MAX_VALORES) throw new Error(`Filtro «${campo}»: demasiados valores (el máximo es ${MAX_VALORES}).`)
        const valores = []
        for (const entrada of ajuste.valores) {
          if (typeof entrada !== 'string') throw new Error(`Filtro «${campo}»: los valores tienen que ser texto.`)
          const valor = entrada.trim()
          if (valor === '') continue
          const motivo = motivoDeValorDeCondicion(valor)
          if (motivo) throw new Error(`Filtro «${campo}»: «${valor}» ${motivo}.`)
          valores.push(valor)
        }
        if (valores.length > 0) filtro[campo] = { valores }
      } else if ('desde' in ajuste || 'hasta' in ajuste) {
        const rango = {}
        for (const lado of ['desde', 'hasta']) {
          const entrada = ajuste[lado]
          if (entrada === undefined || entrada === null || entrada === '') continue
          if (typeof entrada !== 'string') throw new Error(`Filtro «${campo}»: «${lado}» tiene que ser un texto.`)
          const valor = entrada.trim()
          const motivo = esCampoDeFecha(campo) ? motivoDeFecha(valor) : motivoDeValorDeCondicion(valor)
          if (motivo) throw new Error(`Filtro «${campo}», ${lado}: ${motivo}.`)
          rango[lado] = valor
        }
        if (Object.keys(rango).length > 0) filtro[campo] = rango
      } else {
        throw new Error(`Filtro «${campo}»: falta «valores» (o «desde» y «hasta»).`)
      }
    }
    if (Object.keys(filtro).length > 0) salida.filtro = filtro
  }

  return salida
}

/** Los ajustes del LOTE: sin filtro (el filtro es de cada integración, y se ajusta en cada paso). */
export function ajustesDelLote(crudo) {
  const ajustes = normalizarAjustes(crudo)
  if (ajustes.filtro) throw new Error('Los ajustes de la orquestación no llevan filtro: el filtro se ajusta en cada paso.')
  return ajustes
}

/** Los ajustes de un PASO: sin «fechas» (las fechas de un paso son las condiciones de su filtro). */
export function ajustesDePaso(crudo) {
  const ajustes = normalizarAjustes(crudo)
  if (ajustes.fechas) throw new Error('Los ajustes de un paso no llevan «fechas»: sus fechas son las condiciones de su filtro.')
  return ajustes
}

/** ¿Los ajustes no dicen nada? */
export const sinAjustes = (ajustes) => !esObjeto(ajustes) || Object.keys(ajustes).length === 0

/** Cuántas cosas cambian unos ajustes: cada campo, cada lado de las fechas y cada condición del filtro. */
export function contarAjustes(ajustes) {
  if (!esObjeto(ajustes)) return 0
  let total = CLAVES.filter((clave) => typeof ajustes[clave] === 'string').length
  total += ['desde', 'hasta'].filter((lado) => typeof ajustes.fechas?.[lado] === 'string' && ajustes.fechas[lado] !== '').length
  total += Object.keys(esObjeto(ajustes.filtro) ? ajustes.filtro : {}).length
  return total
}

/**
 * Lo que una integración declara en su body y que los ajustes pueden cambiar. Es lo mismo que `resumenDeBody` trae en `resumen`
 * (`version`, `comando`, `sistemaOrigen`, `sistemaDestino`, `condiciones`), así que la pantalla puede pasar el resumen tal cual.
 */
export function vistaDeBloque(bloque) {
  const texto = (campo) => (typeof bloque?.[campo] === 'string' ? bloque[campo] : '')
  return {
    areaDePlanificacion: texto('PlanningArea'),
    version: texto('PlanningAreaVersion'),
    comando: texto('BatchCommand'),
    sistemaOrigen: texto('DestinationforAddon'),
    sistemaDestino: texto('DestinationforSAPIBP'),
    condiciones: condicionesDeFiltro(texto('FilterForTheDataSource')),
  }
}

/** ¿Es un valor que dice algo? La versión puede ser vacía (la base); los demás campos, no. */
const dice = (clave, valor) => typeof valor === 'string' && (clave === 'version' || valor.trim() !== '')
const hayTexto = (valor) => typeof valor === 'string' && valor.trim() !== ''

const textoDeCondicion = (condicion) => (
  condicion.tipo === 'entre' ? `${condicion.desde} → ${condicion.hasta}` : condicion.valores.join(', ')
)

/**
 * Qué quedaría de una integración con los ajustes del lote y del paso. NO valida (la pantalla lo llama con lo que se está
 * escribiendo): ignora lo que no tiene forma de ajuste. Valida `aplicarAjustes`, que es lo que de verdad se envía.
 *
 *   {
 *     version, comando, origen, destino,        lo que valdrá (los originales si no se cambian)
 *     condiciones: [{ campo, tipo, valores|desde+hasta, original, cambiada, fuente }],
 *     fechas: [{ campo, original: { desde, hasta }, efectivo: { desde, hasta }, cambia, fuente }],   los rangos de KEYFIGUREDATE
 *     cambios: [{ clave, campo?, etiqueta, de, a, fuente }],      solo lo que de verdad cambia (un ajuste igual al original no cuenta)
 *     avisos: [texto],                                        ajustes del paso que ya no tienen a qué aplicarse
 *   }
 *
 * `fuente` es `'paso'` u `'orquestacion'`: de quién viene el cambio.
 */
export function resolverAjustes(vista, { general = {}, paso = {} } = {}) {
  const delLote = esObjeto(general) ? general : {}
  const delPaso = esObjeto(paso) ? paso : {}
  const resultado = { condiciones: [], fechas: [], cambios: [], avisos: [] }

  for (const clave of CLAVES) {
    const { etiqueta, enVista } = CAMPOS_DE_AJUSTE[clave]
    const original = typeof vista?.[enVista] === 'string' ? vista[enVista] : ''
    let valor = original
    let fuente = null
    if (dice(clave, delPaso[clave])) { valor = delPaso[clave].trim(); fuente = 'paso' }
    else if (dice(clave, delLote[clave])) { valor = delLote[clave].trim(); fuente = 'orquestacion' }
    resultado[clave] = valor
    if (fuente && valor !== original) resultado.cambios.push({ clave, etiqueta, de: original, a: valor, fuente })
  }

  const filtroDelPaso = esObjeto(delPaso.filtro) ? delPaso.filtro : {}
  const fechasDelLote = esObjeto(delLote.fechas) ? delLote.fechas : {}
  // Una condición del paso se aplica a UNA fila del filtro (la primera de ese campo y esa forma): repetir el campo no la duplica.
  const usadas = new Set()

  for (const condicion of vista?.condiciones ?? []) {
    const original = condicion.tipo === 'entre' ? { desde: condicion.desde, hasta: condicion.hasta } : { valores: [...condicion.valores] }
    const salida = { ...condicion, original, cambiada: false, fuente: null }
    if (condicion.tipo === 'igual') salida.valores = [...condicion.valores]

    const ajusteDelPaso = filtroDelPaso[condicion.campo]
    const clave = `${condicion.tipo}:${condicion.campo}`
    const delPasoAplica = esObjeto(ajusteDelPaso) && !usadas.has(clave)

    if (condicion.tipo === 'igual') {
      const valores = delPasoAplica && Array.isArray(ajusteDelPaso.valores) ? ajusteDelPaso.valores.filter(hayTexto).map((v) => v.trim()) : []
      if (valores.length > 0) {
        usadas.add(clave)
        salida.valores = valores
        salida.fuente = 'paso'
      }
    } else {
      const pasoDiceDesde = delPasoAplica && hayTexto(ajusteDelPaso.desde)
      const pasoDiceHasta = delPasoAplica && hayTexto(ajusteDelPaso.hasta)
      if (pasoDiceDesde || pasoDiceHasta) usadas.add(clave)
      const esFecha = esCampoDeFecha(condicion.campo)
      let delLoteAporta = false

      // Cada lado lo decide el paso; si no, las fechas del lote (solo en las condiciones sobre fechas); si no, la integración.
      if (pasoDiceDesde) salida.desde = ajusteDelPaso.desde.trim()
      else if (esFecha && hayTexto(fechasDelLote.desde)) { salida.desde = fechasDelLote.desde.trim(); delLoteAporta = true }
      if (pasoDiceHasta) salida.hasta = ajusteDelPaso.hasta.trim()
      else if (esFecha && hayTexto(fechasDelLote.hasta)) { salida.hasta = fechasDelLote.hasta.trim(); delLoteAporta = true }

      if (pasoDiceDesde || pasoDiceHasta) salida.fuente = 'paso'
      else if (delLoteAporta) salida.fuente = 'orquestacion'
    }

    salida.cambiada = condicion.tipo === 'entre'
      ? salida.desde !== condicion.desde || salida.hasta !== condicion.hasta
      : textoDeCondicion(salida) !== textoDeCondicion(condicion)
    // Un ajuste igual al original no cambia nada: no cuenta como cambio.
    if (!salida.cambiada) salida.fuente = null

    resultado.condiciones.push(salida)

    if (salida.cambiada) {
      resultado.cambios.push({
        clave: 'filtro', campo: condicion.campo, etiqueta: condicion.campo, de: textoDeCondicion(condicion), a: textoDeCondicion(salida), fuente: salida.fuente,
      })
    }
    if (condicion.tipo === 'entre' && esCampoDeFecha(condicion.campo)) {
      resultado.fechas.push({
        campo: condicion.campo,
        original: { desde: condicion.desde, hasta: condicion.hasta },
        efectivo: { desde: salida.desde, hasta: salida.hasta },
        cambia: salida.cambiada,
        fuente: salida.fuente,
      })
    }
  }

  for (const campo of Object.keys(filtroDelPaso)) {
    if (!usadas.has(`igual:${campo}`) && !usadas.has(`entre:${campo}`)) {
      resultado.avisos.push(`El ajuste del filtro «${campo}» no se aplica: la integración ya no tiene esa condición.`)
    }
  }

  return resultado
}

/** Un valor como se lee en un cambio: la versión vacía es «base»; cualquier otro vacío, «(vacío)». */
const comoSeLee = (clave, valor) => (valor === '' ? (clave === 'version' ? 'base' : '(vacío)') : valor)

/** Los cambios como frases cortas: `Versión: PVSMD → PV2`. */
export const textosDeCambios = (cambios) => (cambios ?? []).map(
  (cambio) => `${cambio.etiqueta}: ${comoSeLee(cambio.clave, cambio.de)} → ${comoSeLee(cambio.clave, cambio.a)}`,
)

/**
 * Aplica los ajustes de un paso (y los del lote) a un body y devuelve `{ texto, cambios, avisos }`. Si nada cambia, `texto` es
 * EXACTAMENTE el que entró (sin reordenar ni reescribir nada). Si algo cambia, es el mismo bloque con esos campos distintos y el
 * resto intacto; del filtro solo se tocan las condiciones ajustadas.
 *
 * Valida: lanza con un mensaje que se pueda mostrar si los ajustes no valen o el body no se puede leer. Es lo que se ejecuta ANTES
 * de enviar, así que un ajuste malo no envía nada.
 */
export function aplicarAjustes(texto, { general, paso } = {}) {
  const delLote = normalizarAjustes(general)
  const delPaso = normalizarAjustes(paso)
  if (sinAjustes(delLote) && sinAjustes(delPaso)) return { texto, cambios: [], avisos: [] }

  const leido = leerBody(texto)
  if (!leido.ok) throw new Error(leido.error)
  const { clave, bloque } = leido

  const resuelto = resolverAjustes(vistaDeBloque(bloque), { general: delLote, paso: delPaso })
  if (resuelto.cambios.length === 0) return { texto, cambios: [], avisos: resuelto.avisos }

  const nuevo = { ...bloque }
  for (const cambio of resuelto.cambios) {
    if (cambio.clave !== 'filtro') nuevo[CAMPOS_DE_AJUSTE[cambio.clave].campo] = cambio.a
  }

  if (resuelto.cambios.some((cambio) => cambio.clave === 'filtro')) {
    const filas = leerFiltro(typeof bloque.FilterForTheDataSource === 'string' ? bloque.FilterForTheDataSource : '')
    // Las condiciones resueltas siguen el orden de las filas que se entienden; las de texto se conservan tal cual.
    let siguiente = 0
    for (const fila of filas) {
      if (fila.tipo === 'texto') continue
      const condicion = resuelto.condiciones[siguiente]
      siguiente += 1
      if (!condicion.cambiada) continue
      if (fila.tipo === 'entre') {
        fila.desde = condicion.desde
        fila.hasta = condicion.hasta
      } else {
        fila.valores = condicion.valores
      }
    }
    nuevo.FilterForTheDataSource = escribirFiltro(filas)
  }

  return { texto: JSON.stringify({ [clave]: nuevo }, null, 2), cambios: resuelto.cambios, avisos: resuelto.avisos }
}
