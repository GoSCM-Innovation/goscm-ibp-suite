// @vitest-environment jsdom
//
// El nombre de las hojas del documento y los eventos con que se lee un ZIP. La tabla destino se
// agrega cuando ESE XML trae varios dataflows —no cuando la tarea se repite en otro ZIP—, como
// `multiDF` de v9.

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { scanForDocument } from './cids-doc.js'
import { analyzeZips } from './integration-index.js'

const dataflow = (nombre, tabla) => `<DataFlow name="${nombre}">
  <elements xmi:type="dataflow:TableLoader" displayName="L" tableName="${tabla}" referencedDataStore="//@DataStore/1"/>
</DataFlow>`

const xml = (job, ...dataflows) => `<p xmlns:xmi="http://www.omg.org/XMI"><DataStore name="ERP"/><DataStore name="IBP"/>
  <Job name="${job}"/>${dataflows.join('')}</p>`

async function zipCon(archivos) {
  const zip = new JSZip()
  for (const [nombre, contenido] of Object.entries(archivos)) zip.file(nombre, contenido)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('scanForDocument: nombre de las hojas', () => {
  it('un XML con un solo dataflow lleva solo el nombre de la tarea', async () => {
    const data = await zipCon({ 'a.xml': xml('TAREA_A', dataflow('DF', 'T1')) })
    const { entradas } = await scanForDocument([{ name: 'p.zip', data }])
    expect(entradas.map((una) => una.sheetName)).toEqual(['TAREA_A'])
  })

  it('un XML con varios dataflows agrega la tabla destino', async () => {
    const data = await zipCon({ 'a.xml': xml('TAREA_A', dataflow('DF1', 'T1'), dataflow('DF2', 'T2')) })
    const { entradas } = await scanForDocument([{ name: 'p.zip', data }])
    expect(entradas.map((una) => una.sheetName)).toEqual(['TAREA_A_T1', 'TAREA_A_T2'])
  })

  it('la misma tarea en dos ZIP NO agrega la tabla: se desempata con un número', async () => {
    const uno = await zipCon({ 'a.xml': xml('TAREA_A', dataflow('DF', 'T1')) })
    const dos = await zipCon({ 'a.xml': xml('TAREA_A', dataflow('DF', 'T1')) })
    const { entradas } = await scanForDocument([{ name: 'uno.zip', data: uno }, { name: 'dos.zip', data: dos }])
    expect(entradas.map((una) => una.sheetName)).toEqual(['TAREA_A', 'TAREA_A_1'])
  })

  it('cada entrada recuerda su ZIP en `pkg`, para la lista de selección', async () => {
    const data = await zipCon({ 'a.xml': xml('TAREA_A', dataflow('DF', 'T1')) })
    const { entradas } = await scanForDocument([{ name: 'proyecto.zip', data }])
    expect(entradas[0].pkg).toBe('proyecto.zip')
  })
})

describe('analyzeZips avisa de lo que va leyendo', () => {
  it('manda los eventos del log y el avance', async () => {
    const data = await zipCon({
      'bueno.xml': xml('TAREA_A', dataflow('DF', 'T1')),
      'vacio.xml': '<p xmlns:xmi="http://www.omg.org/XMI"><Job name=""/></p>',
    })

    const eventos = []
    const avances = []
    await analyzeZips([{ name: 'p.zip', data }], {
      alRegistrar: (evento) => eventos.push(evento.tipo),
      alAvanzar: (fraccion) => avances.push(fraccion),
    })

    expect(eventos).toContain('zip')
    expect(eventos).toContain('xmls')
    expect(eventos).toContain('sinDataflows')
    expect(avances.at(-1)).toBe(1)
  })

  it('cada integración recuerda de qué XML salió, para nombrar las hojas', async () => {
    const data = await zipCon({ 'uno.xml': xml('TAREA_A', dataflow('DF', 'T1')) })
    const { integraciones } = await analyzeZips([{ name: 'p.zip', data }])
    expect(integraciones[0]._xml).toBe('uno.xml')
  })
})
