// Lo que CI Tools hace con el catálogo del SAP IBP de destino: pedirlo al servidor y usarlo para sugerir y revisar.
//
// Nada de lo de aquí es obligatorio. Es una ayuda: el formulario se puede llenar entero a mano, y si IBP no
// contesta la pantalla lo dice y sigue funcionando. Por eso las revisiones (`revisarContraIbp`) son AVISOS y nunca
// bloquean guardar ni ejecutar: IBP puede cambiar entre que se lee y que se carga, y un nombre que hoy no está
// puede ser justo lo que otro paso de una orquestación crea.
//
// Lo que se lee de IBP no se guarda en el navegador: vive en memoria mientras la pantalla está abierta
// (`useCatalogoIbp`) y el servidor lo guarda 30 minutos por cliente. Ver `core/ci/ibp-catalogo.js`.

import { CAMPO_DE_PERIODO, CAMPO_DE_VALOR, VERSION_BASE, componerTipo, versionDelBody } from '../../core/ci/ibp-nombres.js'
import { motivoDeValorDeFiltroInvalido } from '../../core/ci/filter.js'
import { api } from './api.js'

// ─── Pedir al servidor ──────────────────────────────────────────────────────────────────────────

/**
 * Pide algo del catálogo de IBP: `resumen`, `campos-maestro`, `cifras` o `valores`. `actualizar` salta lo que el
 * servidor tenía guardado y vuelve a leer de IBP.
 */
export function pedirCatalogoIbp(connectionId, accion, parametros = {}, { actualizar = false } = {}) {
  const params = { connectionId, accion }
  for (const [clave, valor] of Object.entries(parametros)) if (valor) params[clave] = valor
  if (actualizar) params.actualizar = '1'
  return api.get('/api/ci/ibp', params)
}

/** ¿El servidor dijo que la conexión no tiene IBP de destino? Es el único motivo por el que contesta 409. */
export const esFaltaDeVinculo = (fallo) => fallo?.status === 409

// ─── Áreas, versiones y tablas ──────────────────────────────────────────────────────────────────

/** Una variable del body (`{{FECHA}}`): se pide al ejecutar, así que no se puede comparar con IBP. */
export const esVariable = (valor) => /\{\{.*\}\}/.test(String(valor ?? ''))

export const areaDelCatalogo = (areas, id) => (areas ?? []).find((una) => una.id === id) ?? null

/** Las áreas como opciones de un selector. La primera, vacía, es «sin elegir». */
export function opcionesDeAreas(areas) {
  return [
    { value: '', label: '— Elige un área —' },
    ...(areas ?? []).map((una) => ({ value: una.id, label: una.descripcion ? `${una.id} — ${una.descripcion}` : una.id })),
  ]
}

/** Las versiones de un área. La base va primera y vale cadena vacía, que es lo que lleva el body. */
export function opcionesDeVersiones(area) {
  return (area?.versiones ?? []).map((version) => ({
    value: version.id,
    label: version.id === VERSION_BASE || version.nombre === version.id ? version.nombre : `${version.id} — ${version.nombre}`,
  }))
}

/** Las tablas de dato maestro que se pueden cargar en una versión de un área. Una versión que no se conoce usa las de la base. */
export function tablasDeVersion(area, version) {
  if (!area) return []
  const clave = versionDelBody(version)
  return (Object.hasOwn(area.tipos, clave) ? area.tipos[clave] : area.tipos[VERSION_BASE]) ?? []
}

/** Las tablas como opciones de un selector, con «sin elegir» primero. */
export const opcionesDeTablas = (tablas) => [
  { value: '', label: '— Elige una tabla —' },
  ...tablas.map((tabla) => ({ value: tabla, label: tabla })),
]

/**
 * Agrega a las opciones el valor que el body ya tiene si IBP no lo conoce, para que el selector no lo esconda ni lo
 * cambie por otro sin que nadie lo decida.
 */
export function conValorActual(opciones, valor) {
  if (valor === '' || valor == null || opciones.some((una) => una.value === valor)) return opciones
  return [...opciones, { value: valor, label: `${valor} (no está en IBP)` }]
}

// ─── Campos y mapeo ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué dice IBP de un campo DESTINO del mapeo.
 *
 * `detalle` es `{ tipo, campos }` para dato maestro o `{ tipo, cifras }` para cifras clave (lo que devuelve el
 * servidor). Devuelve `{ estado, etiqueta }` con `estado`:
 *   `ok`      existe en IBP (`etiqueta` es su descripción);
 *   `sistema` existe pero lo rellena SAP: no se carga;
 *   `carga`   `KEYFIGUREDATE`: es un campo de la carga, no de IBP;
 *   `falta`   IBP no lo conoce;
 * y `null` si no se sabe (no se leyó, o no hay nada escrito).
 */
export function infoDeDestino(destino, detalle) {
  const nombre = String(destino ?? '').trim()
  if (nombre === '' || !detalle) return null
  const buscado = nombre.toUpperCase()
  const igual = (uno) => uno.campo.toUpperCase() === buscado

  if (detalle.tipo === 'MASTERDATA' && detalle.campos) {
    const campo = detalle.campos.find(igual)
    if (!campo) return { estado: 'falta', etiqueta: '' }
    return { estado: campo.sistema ? 'sistema' : 'ok', etiqueta: campo.etiqueta }
  }

  if (detalle.tipo === 'KEYFIGURES' && detalle.cifras) {
    if (buscado === CAMPO_DE_PERIODO) return { estado: 'carga', etiqueta: '' }
    const campo = [...detalle.cifras.dims, ...detalle.cifras.cifras].find(igual)
    return campo ? { estado: 'ok', etiqueta: campo.etiqueta } : { estado: 'falta', etiqueta: '' }
  }

  return null
}

/**
 * Qué campos de la tabla quedan marcados al abrir el selector: los que la tabla ya tiene como destino. Con la
 * tabla vacía se marcan todos menos los de sistema, que es lo que casi siempre se quiere y se desmarca en un clic.
 */
export function camposPreseleccionados(filas, campos) {
  const marcados = []
  for (const fila of filas) {
    const campo = campos.find((uno) => uno.campo.toUpperCase() === fila.destino.trim().toUpperCase())
    if (campo && !marcados.includes(campo.campo)) marcados.push(campo.campo)
  }
  if (marcados.length > 0) return marcados
  const hayAlgo = filas.some((fila) => fila.origen.trim() !== '' || fila.destino.trim() !== '')
  return hayAlgo ? [] : campos.filter((uno) => !uno.sistema).map((uno) => uno.campo)
}

/**
 * Aplica lo elegido en el selector de campos a la tabla de mapeo, sin pisar lo que ya había:
 *
 *   - las filas cuyo destino NO es un campo de la tabla de IBP (un campo propio del origen) se quedan;
 *   - las que sí lo son se quedan si siguen elegidas (con su origen, que puede ser otro nombre) y se quitan si no;
 *   - lo elegido que no tenía fila se agrega al final, en el orden en que se marcó, con el mismo nombre de
 *     origen y de destino.
 */
export function aplicarCamposDeMaestro(filas, campos, elegidos) {
  const nombreEnIbp = new Map(campos.map((uno) => [uno.campo.toUpperCase(), uno.campo]))
  const queSigue = new Set(elegidos.map((uno) => uno.toUpperCase()))
  const resultado = []
  const puestos = new Set()

  for (const fila of filas) {
    const clave = fila.destino.trim().toUpperCase()
    if (!nombreEnIbp.has(clave)) resultado.push(fila)
    else if (queSigue.has(clave)) { resultado.push(fila); puestos.add(clave) }
  }
  for (const campo of elegidos) {
    if (!puestos.has(campo.toUpperCase())) resultado.push({ id: `ibp-${campo}`, origen: campo, destino: campo })
  }
  return resultado
}

/**
 * Las filas de una carga de cifras clave: las dimensiones, la fecha del periodo y el valor de la cifra.
 *
 *     PRDID:PRDID, LOCID:LOCID, KEYFIGUREDATE:KEYFIGUREDATE, KFVALUE:ZFACTURAS
 *
 * `KEYFIGUREDATE` y `KFVALUE` son los campos de la carga (el iFlow los espera con esos nombres), no campos de IBP.
 * El origen de cada dimensión empieza igual que su destino: si en el sistema de origen se llama distinto, se
 * cambia en la tabla.
 */
export function filasDeCifra({ dimensiones, cifra }) {
  return [
    ...dimensiones.map((campo) => ({ id: `ibp-${campo}`, origen: campo, destino: campo })),
    { id: 'ibp-periodo', origen: CAMPO_DE_PERIODO, destino: CAMPO_DE_PERIODO },
    { id: 'ibp-valor', origen: CAMPO_DE_VALOR, destino: cifra },
  ]
}

/** De la tabla actual: qué cifra y qué dimensiones tiene ya, para proponerlas al abrir el constructor. */
export function leerCifraDeFilas(filas, cifras) {
  const conocida = (lista, nombre) => lista.find((uno) => uno.campo.toUpperCase() === nombre.trim().toUpperCase())?.campo
  const valor = filas.find((fila) => fila.origen.trim().toUpperCase() === CAMPO_DE_VALOR)
  const cifra = valor ? (conocida(cifras.cifras, valor.destino) ?? '') : ''
  const dimensiones = []
  for (const fila of filas) {
    const dim = conocida(cifras.dims, fila.destino)
    if (dim && !dimensiones.includes(dim)) dimensiones.push(dim)
  }
  return { cifra, dimensiones }
}

// ─── Valores del filtro ─────────────────────────────────────────────────────────────────────────

/**
 * Deja los valores de IBP que se pueden escribir en el filtro. Uno con comilla simple o coma lo cortaría (ver
 * `core/ci/filter.js`): se descarta y se cuenta, para avisar.
 */
export function valoresParaFiltro(valores) {
  const usables = []
  let descartados = 0
  for (const valor of valores ?? []) {
    if (motivoDeValorDeFiltroInvalido(valor)) descartados += 1
    else usables.push(valor)
  }
  return { usables, descartados }
}

// ─── Revisión contra IBP ────────────────────────────────────────────────────────────────────────

/**
 * Compara el body con lo que IBP tiene y devuelve una lista de avisos en español (vacía si todo cuadra o si no se
 * pudo comparar). Solo revisa lo que se leyó de IBP: lo que falta por leer no genera aviso.
 *
 * @param {object} p
 * @param {object} p.bloque        El bloque del body.
 * @param {Array}  p.areas         El resumen de áreas de IBP.
 * @param {string} p.ibpNombre
 * @param {Array}  p.filas         La tabla de mapeo (`{ origen, destino }`).
 * @param {object|null} p.detalle  `{ tipo, campos }` o `{ tipo, cifras }`, o `null` si no se leyó.
 */
export function revisarContraIbp({ bloque, areas, ibpNombre = '', filas = [], detalle = null }) {
  const avisos = []
  const texto = (campo) => (typeof bloque?.[campo] === 'string' ? bloque[campo].trim() : '')
  const donde = ibpNombre ? `en «${ibpNombre}»` : 'en IBP'

  const idArea = texto('PlanningArea')
  const version = texto('PlanningAreaVersion')
  const area = idArea && !esVariable(idArea) ? areaDelCatalogo(areas, idArea) : null

  if (idArea && !esVariable(idArea) && areas.length > 0 && !area) {
    avisos.push(`El área «${idArea}» no existe ${donde}.`)
  }

  if (version === '__BASELINE') {
    avisos.push('«__BASELINE» es el nombre que IBP le da a la versión base: en el body va vacía.')
  } else if (area && version && !esVariable(version) && !area.versiones.some((una) => una.id === version)) {
    avisos.push(`La versión «${version}» no existe en el área «${idArea}».`)
  }

  const tipo = texto('TypeOfData')
  if (tipo === 'MASTERDATA') {
    const tabla = componerTipo(texto('MasterDataPrefix'), texto('MasterDataType'))
    const tablas = area && !esVariable(version) ? tablasDeVersion(area, version) : []
    if (tabla && !esVariable(tabla) && tablas.length > 0 && !tablas.some((una) => una.toUpperCase() === tabla.toUpperCase())) {
      avisos.push(`La tabla «${tabla}» no está entre las que se pueden cargar en esa versión del área.`)
    }
  }

  // Los campos del mapeo, uno por uno, contra lo que IBP dice de la tabla o del área.
  const vistos = new Set()
  for (const fila of filas) {
    const destino = fila.destino.trim()
    if (destino === '' || fila.origen.trim() === '' || vistos.has(destino.toUpperCase())) continue
    vistos.add(destino.toUpperCase())

    const info = infoDeDestino(destino, detalle)
    if (!info) continue
    if (info.estado === 'falta') {
      avisos.push(detalle.tipo === 'MASTERDATA'
        ? `El campo «${destino}» no existe en la tabla ${componerTipo(texto('MasterDataPrefix'), texto('MasterDataType'))} ${donde}.`
        : `«${destino}» no es una dimensión ni una cifra clave del área «${idArea}» ${donde}.`)
    } else if (info.estado === 'sistema') {
      avisos.push(`«${destino}» lo rellena SAP: no se carga.`)
    }
  }

  return avisos
}
