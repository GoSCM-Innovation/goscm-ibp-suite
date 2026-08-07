// ¿Se puede armar el índice tarea → job/paso sin una consulta por plantilla?
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './load-env.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadLocalEnv(ROOT)

const { listConnections, getConnectionTarget, getCredentials } = await import('../core/connections/index.js')
const { readAllPages, readTaskIds, stepKey } = await import('../core/ibp/app-jobs.js')

const clientId = 'ab82598a-1f03-4195-a97e-365985650bf1'
const [ibp] = (await listConnections(clientId)).filter((u) => u.kind === 'ibp')
const destino = await getConnectionTarget(clientId, ibp.id)
const credentials = await getCredentials(clientId, ibp.id, 'SAP_COM_0068')

let t = Date.now()
const tareas = await readTaskIds({ baseUrl: destino.baseUrl, credentials })
console.log(`P_TSKID: ${Object.keys(tareas).length} en ${Date.now() - t} ms`)

t = Date.now()
const secuencias = await readAllPages({
  baseUrl: destino.baseUrl, credentials, entity: 'JobTemplateSequenceSet', maxPages: 40,
})
console.log(`secuencias SIN filtro: ${secuencias.length} en ${Date.now() - t} ms`)

t = Date.now()
const plantillas = await readAllPages({ baseUrl: destino.baseUrl, credentials, entity: 'JobTemplateSet', maxPages: 40 })
console.log(`plantillas: ${plantillas.length} en ${Date.now() - t} ms`)

// El cruce.
const textoDePlantilla = new Map(plantillas.map((u) => [u.JobTemplateName, u.JobTemplateText || u.JobTemplateName]))
const indice = {}
for (const s of secuencias) {
  const tarea = tareas[stepKey(s.JobTemplateName, s.JobTemplateVersion, s.JobSequenceName)]
  if (!tarea) continue
  const clave = tarea.toUpperCase()
  indice[clave] = [...(indice[clave] ?? []), {
    jobName: textoDePlantilla.get(s.JobTemplateName) || s.JobTemplateName,
    stepName: s.JobSequenceText || s.JceText || '',
    stepPos: s.JobSequencePosition || 0,
    stepType: s.JceText || '',
  }]
}

console.log(`\ntareas de CI-DS indexadas: ${Object.keys(indice).length}`)
for (const [tarea, usos] of Object.entries(indice).slice(0, 6)) {
  console.log(`  ${tarea}`)
  for (const u of usos) console.log(`      ${u.jobName} · paso ${u.stepPos} "${u.stepName}"`)
}

const enVarios = Object.entries(indice).filter(([, u]) => u.length > 1)
console.log(`\ntareas usadas por más de un job: ${enVarios.length}`)
if (enVarios[0]) console.log(`  ${enVarios[0][0]} → ${enVarios[0][1].map((u) => u.jobName).join(' · ')}`)
