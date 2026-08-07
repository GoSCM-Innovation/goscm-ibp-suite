// Por qué una tarea aparece en dos pasos distintos del mismo job.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './load-env.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadLocalEnv(ROOT)

const { listConnections, getConnectionTarget, getCredentials } = await import('../core/connections/index.js')
const { readAllPages } = await import('../core/ibp/app-jobs.js')

const clientId = 'ab82598a-1f03-4195-a97e-365985650bf1'
const [ibp] = (await listConnections(clientId)).filter((u) => u.kind === 'ibp')
const destino = await getConnectionTarget(clientId, ibp.id)
const credentials = await getCredentials(clientId, ibp.id, 'SAP_COM_0068')

const params = await readAllPages({
  baseUrl: destino.baseUrl,
  credentials,
  entity: 'JobTemplateParameterValueDataSet',
  query: `$filter=${encodeURIComponent("startswith(JobTemplateParameterName,'P_TSKID') eq true")}`,
  maxPages: 40,
})
console.log('campos de un parametro:', Object.keys(params[0]).filter((k) => !k.startsWith('__')).join(', '))
console.log('ejemplo:', JSON.stringify(Object.fromEntries(
  Object.entries(params[0]).filter(([k]) => !k.startsWith('__')),
)))

const conProducto = params.filter((p) => (p.Low || '').includes('PRODUCTO_SMX'))
console.log(`\nparametros con PRODUCTO_SMX: ${conProducto.length}`)
for (const p of conProducto) {
  console.log(`  tpl=${p.JobTemplateName} v=${p.JobTemplateVersion} nombre="${p.JobTemplateParameterName}" low=${p.Low}`)
}

const secuencias = await readAllPages({ baseUrl: destino.baseUrl, credentials, entity: 'JobTemplateSequenceSet', maxPages: 40 })
console.log('\ncampos de una secuencia:', Object.keys(secuencias[0]).filter((k) => !k.startsWith('__')).join(', '))

const plantilla = conProducto[0]?.JobTemplateName
const suyas = secuencias.filter((s) => s.JobTemplateName === plantilla)
console.log(`\nsecuencias de ${plantilla}: ${suyas.length}`)
for (const s of suyas.slice(0, 6)) {
  console.log(`  pos=${s.JobSequencePosition} nombre="${s.JobSequenceName}" texto="${s.JobSequenceText}"`)
}

const nombres = suyas.map((s) => s.JobSequenceName)
console.log('nombres de secuencia repetidos:', nombres.length - new Set(nombres).size)
console.log('nombres vacios:', nombres.filter((n) => !n).length)
