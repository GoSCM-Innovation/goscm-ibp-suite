// El enriquecimiento en vivo del documento: volumetría y Application Jobs.
//
// Es la fase 2 de `generate()` de `paDoc.js` de v7, con sus mismos mensajes. Cada fuente es
// INDEPENDIENTE y su fallo no aborta la generación: se documenta lo que se tiene y se avisa en el
// registro. Cada acuerdo de comunicación es un servicio distinto sobre la misma conexión, y si solo hay
// uno activo (0720 sin 0326, o al revés) el otro falla aislado.

import { idsDeTiposDeDatoMaestro } from '../../core/ibp/pa-doc-model.js'
import {
  fetchApplicationJobs, fetchEntidadesDeTipos, fetchVolumetria,
} from './ibp-pa-doc.js'

/**
 * Cuántos tipos van en cada llamada al servidor. Dentro de cada llamada se cuenta de a seis a la vez
 * (el pool de v7); las llamadas van una tras otra para que una función no se pase de tiempo con un área
 * de cientos de tipos.
 */
export const TIPOS_POR_LLAMADA = 48

const SERVICIOS_REALES = { fetchApplicationJobs, fetchEntidadesDeTipos, fetchVolumetria }

/** Parte una lista en tandas. */
function tandas(lista, tamano) {
  const salida = []
  for (let i = 0; i < lista.length; i += tamano) salida.push(lista.slice(i, i + tamano))
  return salida
}

/** Cuenta registros por tipo de dato maestro: `{ ID: número | null }`. `fetchMdtCounts` de v7. */
export async function contarVolumetria({ conexionId, ids, registro, servicios = SERVICIOS_REALES }) {
  if (ids.length === 0) return {}

  const entidades = await servicios.fetchEntidadesDeTipos(conexionId, ids)
  const conEntidad = ids.filter((id) => entidades[id])
  registro('info', `  ↳ Volumetría de ${conEntidad.length}/${ids.length} tipos de datos maestros…`)

  const cuentas = Object.fromEntries(ids.map((id) => [id, null]))
  for (const tanda of tandas(conEntidad, TIPOS_POR_LLAMADA)) {
    Object.assign(cuentas, await servicios.fetchVolumetria(conexionId, tanda))
  }
  return cuentas
}

/**
 * Pide los datos en vivo. Devuelve `{ appJobs, mdtCounts }` y deja en el registro lo que pasó.
 *
 * `mdtCounts` queda en `null` si la volumetría falló y `appJobs` en `[]` si fallaron los jobs.
 */
export async function enriquecerDocumento({ conexionId, datos, registro, servicios = SERVICIOS_REALES }) {
  const enriquecimiento = { appJobs: [], mdtCounts: null }
  let responde720 = false
  let responde326 = false

  // (a) Volumetría de datos maestros — SAP_COM_0720
  try {
    registro('info', 'Enriqueciendo: volumetría de datos maestros (SAP_COM_0720)…')
    enriquecimiento.mdtCounts = await contarVolumetria({
      conexionId, ids: idsDeTiposDeDatoMaestro(datos), registro, servicios,
    })
    const contados = Object.values(enriquecimiento.mdtCounts).filter((valor) => typeof valor === 'number').length
    registro('ok', `SAP_COM_0720 OK: volumetría de ${contados} tipo(s) de datos maestros.`)
    responde720 = true
  } catch (fallo) {
    enriquecimiento.mdtCounts = null
    registro('warn', `SAP_COM_0720 no disponible con este usuario/tenant (${fallo.message}). Se omite la volumetría de maestros.`)
  }

  // (b) Application Jobs — SAP_COM_0326
  try {
    registro('info', 'Enriqueciendo: Application Jobs (SAP_COM_0326)…')
    const { entidades, jobs } = await servicios.fetchApplicationJobs(conexionId)
    registro('info', `  ↳ Plantillas de job (${entidades.plantillas})…`)
    registro('info', `  ↳ Pasos (${entidades.pasos})…`)
    enriquecimiento.appJobs = jobs
    registro('ok', `SAP_COM_0326 OK: ${jobs.length} plantilla(s) de Application Jobs.`)
    responde326 = true
  } catch (fallo) {
    enriquecimiento.appJobs = []
    registro('warn', `SAP_COM_0326 no disponible con este usuario/tenant (${fallo.message}). Se omiten los Application Jobs.`)
  }

  // Resumen: qué acuerdos respondieron con esta conexión.
  if (responde720 && responde326) {
    registro('ok', 'Enriquecimiento completo: ambos acuerdos (SAP_COM_0720 + SAP_COM_0326) respondieron.')
  } else if (responde720 || responde326) {
    registro('warn', `Enriquecimiento parcial: solo respondió ${responde720 ? 'SAP_COM_0720' : 'SAP_COM_0326'}. Verifica que ambos acuerdos estén asignados al mismo Communication User.`)
  } else {
    registro('warn', 'Ningún acuerdo respondió; el documento se genera sin datos en vivo.')
  }

  return enriquecimiento
}
