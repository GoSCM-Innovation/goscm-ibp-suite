// Lo que la interfaz de CI Tools necesita para hablar con el servidor y para mostrar lo que le devuelve.
//
// Todo pasa por nuestra API: el navegador no sabe la dirección del tenant de CPI ni las credenciales. Las
// credenciales viven cifradas en el servidor y no salen nunca; lo que se ve de una conexión es su nombre, su
// dirección y si es productiva.

import { api } from './api.js'

// ─── Conexiones ─────────────────────────────────────────────────────────────────────────────────

/** Las conexiones de Cloud Integration de la empresa. */
export async function listCiConnections() {
  const { connections } = await api.get('/api/connections', { kind: 'ci' })
  return connections
}

// ─── Integraciones ──────────────────────────────────────────────────────────────────────────────

/** Las integraciones de una conexión, sin el body de cada una. */
export async function listIntegraciones(connectionId) {
  const { integrations } = await api.get('/api/ci/integrations', { connectionId })
  return integrations
}

/** Una integración con su body. */
export async function getIntegracion(id) {
  const { integration } = await api.get('/api/ci/integrations', { id })
  return integration
}

export async function crearIntegracion({ connectionId, folder, name, body }) {
  const { integration } = await api.post('/api/ci/integrations', { connectionId, folder, name, body })
  return integration
}

/** Guarda cambios. Lo que no se manda no se toca. */
export async function guardarIntegracion(id, cambios) {
  const { integration } = await api.patch('/api/ci/integrations', { id, ...cambios })
  return integration
}

export async function duplicarIntegracion(id) {
  const { integration } = await api.post('/api/ci/integrations', { action: 'duplicate', id })
  return integration
}

export async function borrarIntegracion(id) {
  await api.del('/api/ci/integrations', { id })
}

export async function renombrarCarpeta(connectionId, desde, hasta) {
  const { renamed } = await api.post('/api/ci/integrations', { action: 'rename-folder', connectionId, from: desde, to: hasta })
  return renamed
}

// ─── Ejecución e historial ──────────────────────────────────────────────────────────────────────

/**
 * Ejecuta UNA integración y espera a CPI. Puede tardar minutos: la petición no tiene tope de tiempo propio, la
 * corta el servidor a los 270 s. Devuelve el resultado aunque la carga haya fallado.
 */
export async function ejecutarIntegracion({ connectionId, integrationId, variables }) {
  const { run } = await api.post('/api/ci/run', { connectionId, integrationId, variables })
  return run
}

export async function listarEjecuciones(connectionId, { integrationId, limit } = {}) {
  const params = { connectionId, ...(integrationId ? { integrationId } : {}), ...(limit ? { limit: String(limit) } : {}) }
  const { runs } = await api.get('/api/ci/runs', params)
  return runs
}

/** Los valores de variables con que se ejecutó por última vez una integración. */
export async function ultimasVariablesDeIntegracion(id) {
  const { variables } = await api.get('/api/ci/runs', { variablesDe: 'integration', id })
  return variables
}

/** Qué lleva una orquestación y qué pide para lanzarse: pasos, variables y los últimos valores. */
export function infoDeOrquestacion(id) {
  return api.get('/api/ci/orchestration-info', { id })
}

// ─── Lo que se muestra ──────────────────────────────────────────────────────────────────────────

/** Cómo se llama cada estado de una ejecución, y de qué color se pinta (la clase `ci-estado-…`). */
export const ESTADOS_DE_EJECUCION = Object.freeze({
  running: { texto: 'En curso', clase: 'en-curso' },
  success: { texto: 'Completada', clase: 'bien' },
  warning: { texto: 'Con advertencias', clase: 'aviso' },
  error: { texto: 'Error', clase: 'mal' },
  unconfirmed: { texto: 'Sin confirmar', clase: 'duda' },
})

/** Y los de un PASO de una orquestación, que son los del motor. */
export const ESTADOS_DE_PASO = Object.freeze({
  pending: { texto: 'Pendiente', clase: 'espera' },
  running: { texto: 'En curso', clase: 'en-curso' },
  success: { texto: 'Completado', clase: 'bien' },
  success_with_errors: { texto: 'Completado con advertencias', clase: 'aviso' },
  error: { texto: 'Error', clase: 'mal' },
  skipped: { texto: 'Omitido', clase: 'espera' },
  cancelled: { texto: 'Cancelado', clase: 'duda' },
})

/** La etiqueta de una integración donde hay que distinguirla de otras: con su carpeta. */
export const etiquetaDeIntegracion = (integracion) => (
  integracion.folder ? `${integracion.folder} / ${integracion.name}` : integracion.name
)

/** Fecha y hora como se leen en el historial: día, mes abreviado y hora, sin segundos. */
export function fechaLegible(iso) {
  if (!iso) return '—'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  return fecha.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** ¿Una integración contiene lo buscado? En su nombre, carpeta, lote, área, tipo de maestro, destino o clave. */
function coincideConFiltro(filtro) {
  const buscado = normalizar(filtro).trim()
  return (integracion) => {
    if (buscado === '') return true
    const r = integracion.resumen ?? {}
    return [integracion.name, integracion.folder, r.nombreDeLote, r.areaDePlanificacion, r.tipoDeMaestro, r.destino, r.clave]
      .some((campo) => normalizar(campo).includes(buscado))
  }
}

/**
 * El árbol de carpetas de una lista de integraciones.
 *
 * Una carpeta es una ruta («STARBRANDS/Maestros») y su árbol sale de partirla por «/». Cada nodo:
 * `{ ruta, nombre, carpetas: [...], integraciones: [...] }`; el de la raíz tiene `ruta: ''` y lleva las
 * integraciones sin carpeta.
 *
 * Con `filtro` quedan solo las integraciones que lo contienen (en su nombre, carpeta, lote, área o tipo de
 * maestro) y solo las carpetas que tienen alguna. Todo en minúsculas y sin distinguir acentos.
 */
export function arbolDeCarpetas(integraciones, filtro = '') {
  const coincide = coincideConFiltro(filtro)

  const raiz = { ruta: '', nombre: '', carpetas: [], integraciones: [] }

  const carpetaDe = (ruta) => {
    let actual = raiz
    let acumulada = ''
    for (const tramo of ruta.split('/').filter(Boolean)) {
      acumulada = acumulada ? `${acumulada}/${tramo}` : tramo
      let hija = actual.carpetas.find((una) => una.ruta === acumulada)
      if (!hija) {
        hija = { ruta: acumulada, nombre: tramo, carpetas: [], integraciones: [] }
        actual.carpetas.push(hija)
      }
      actual = hija
    }
    return actual
  }

  for (const integracion of integraciones) {
    if (coincide(integracion)) carpetaDe(integracion.folder ?? '').integraciones.push(integracion)
  }

  const ordenar = (nodo) => {
    nodo.carpetas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    nodo.integraciones.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    nodo.carpetas.forEach(ordenar)
  }
  ordenar(raiz)

  return raiz
}

/**
 * Las carpetas como opciones de un selector: «Sin carpeta» primero (vale vacío) y después las que ya existen, con las
 * intermedias. Crear una nueva es escribirla a mano.
 */
export const opcionesDeCarpeta = (carpetas) => [
  { value: '', label: 'Sin carpeta' },
  ...carpetas.map((ruta) => ({ value: ruta, label: ruta })),
]

/** Lo que dicen los controles de carpeta: una carpeta que no existe todavía no es un error, es una carpeta nueva. */
export const TEXTOS_DE_CARPETA = Object.freeze({
  lista: 'Existentes', mano: '+', aviso: '', sufijo: 'carpeta nueva',
  tituloDeLista: 'Elegir una carpeta que ya existe', tituloDeMano: 'Escribir una carpeta nueva, con «/» para anidar',
})

/** Los grupos de la vista por destino, en el orden en que se enseñan. */
export const GRUPOS_POR_DESTINO = Object.freeze([
  { id: 'tabla', titulo: 'Tablas de dato maestro' },
  { id: 'cifra', titulo: 'Cifras clave' },
  { id: 'sin', titulo: 'Sin destino' },
])

/**
 * Las integraciones agrupadas por A QUÉ CARGAN (ver `destinoDeBloque` en `core/ci/body.js`): primero las tablas de dato
 * maestro, después las cifras clave y, al final, las que todavía no tienen destino.
 *
 * `{ grupos: [{ id, titulo, destinos: [{ destino, integraciones }] }] }`. Los destinos van en orden alfabético y las
 * integraciones de cada uno, por nombre. Un destino se agrupa sin distinguir mayúsculas (`sbproduct` y `SBPRODUCT` son la
 * misma tabla) y se enseña como lo escribió la primera. Con `filtro` quedan solo las integraciones que lo contienen y no se
 * enseñan grupos ni destinos vacíos: sin filtro tampoco, un grupo sin nada no aporta.
 */
export function arbolPorDestino(integraciones, filtro = '') {
  const coincide = coincideConFiltro(filtro)
  const comparar = (a, b) => a.localeCompare(b, 'es')

  const porGrupo = { tabla: new Map(), cifra: new Map(), sin: new Map() }
  for (const integracion of integraciones) {
    if (!coincide(integracion)) continue
    const { destino = '', claseDeDestino = '' } = integracion.resumen ?? {}
    const grupo = destino !== '' && (claseDeDestino === 'tabla' || claseDeDestino === 'cifra') ? claseDeDestino : 'sin'
    const clave = grupo === 'sin' ? '' : destino.toUpperCase()
    if (!porGrupo[grupo].has(clave)) porGrupo[grupo].set(clave, { destino: grupo === 'sin' ? '' : destino, integraciones: [] })
    porGrupo[grupo].get(clave).integraciones.push(integracion)
  }

  const grupos = GRUPOS_POR_DESTINO.map((grupo) => ({
    ...grupo,
    destinos: [...porGrupo[grupo.id].values()]
      .sort((a, b) => comparar(a.destino, b.destino))
      .map((uno) => ({ ...uno, integraciones: [...uno.integraciones].sort((a, b) => comparar(a.name, b.name)) })),
  }))
  return { grupos: grupos.filter((grupo) => grupo.destinos.length > 0) }
}

/** Todas las rutas de carpeta que hay en una lista (incluidas las intermedias), para ofrecerlas al elegir. */
export function carpetasExistentes(integraciones) {
  const rutas = new Set()
  for (const integracion of integraciones) {
    let acumulada = ''
    for (const tramo of (integracion.folder ?? '').split('/').filter(Boolean)) {
      acumulada = acumulada ? `${acumulada}/${tramo}` : tramo
      rutas.add(acumulada)
    }
  }
  return [...rutas].sort((a, b) => a.localeCompare(b, 'es'))
}
