// El emparejamiento del modo «ZIP + Jobs» y los pasos del avance.

import { describe, expect, it } from 'vitest'

import { PASOS_DEL_MODO } from './documentador-pasos.js'
import { emparejarConJobs } from './documentador-zipjobs.js'

const entrada = (jobName) => ({ sheetName: jobName, parsed: { jobName }, paramRow: { jobName, atlGroup: '' } })

const INDICE = {
  CARGA_PRODUCTO: [
    { jobName: 'Carga diaria', template: 'T1', stepName: 'Producto', stepPos: 2, stepType: 'DATA INTEGRATION' },
    { jobName: 'Carga semanal', template: 'T2', stepName: 'Producto', stepPos: 9, stepType: 'DATA INTEGRATION' },
  ],
}

describe('emparejarConJobs', () => {
  it('pone el job, el paso y el tipo de paso en el paramRow, y deja el grupo vacío', () => {
    const { entradas } = emparejarConJobs([entrada('CARGA_PRODUCTO')], INDICE)
    expect(entradas[0].paramRow).toMatchObject({
      ibpJobName: 'Carga diaria', ibpStepName: 'Producto', ibpStepType: 'DATA INTEGRATION', atlGroup: '',
    })
  })

  it('se queda con el primer uso (el de menor posición) cuando la tarea está en varios pasos', () => {
    const { entradas } = emparejarConJobs([entrada('CARGA_PRODUCTO')], INDICE)
    expect(entradas[0].paramRow.ibpJobName).toBe('Carga diaria')
  })

  it('compara sin importar mayúsculas ni espacios', () => {
    const { emparejadas } = emparejarConJobs([entrada('  carga_producto ')], INDICE)
    expect(emparejadas).toBe(1)
  })

  it('lo que no empareja queda como estaba y se cuenta aparte', () => {
    const sola = entrada('OTRA')
    const { entradas, emparejadas, sinEmparejar } = emparejarConJobs([sola], INDICE)
    expect(entradas[0]).toBe(sola)
    expect([emparejadas, sinEmparejar]).toEqual([0, 1])
  })

  it('el log lleva los textos de v9', () => {
    const { registro } = emparejarConJobs([entrada('CARGA_PRODUCTO'), entrada('OTRA')], INDICE)
    expect(registro.map((una) => una.texto)).toEqual([
      '  📌 "CARGA_PRODUCTO" → Job: "Carga diaria" (pos 2)',
      '  ⚠ "OTRA" sin match en IBP',
      '✔ Match: 1 encontrados · 1 sin match',
    ])
  })

  it('si ninguna empareja el resumen es un aviso', () => {
    const { registro } = emparejarConJobs([entrada('OTRA')], INDICE)
    expect(registro.at(-1).tipo).toBe('aviso')
  })

  it('sin índice no revienta', () => {
    expect(emparejarConJobs([entrada('X')], null).sinEmparejar).toBe(1)
  })
})

describe('los pasos del avance', () => {
  it('son los de v9 en cada modo', () => {
    expect(PASOS_DEL_MODO.zip).toEqual(['Subir ZIPs', 'ATL opcional', 'Seleccionar', 'Generar Excel'])
    expect(PASOS_DEL_MODO.jobs).toEqual(['Obtener Jobs', 'Seleccionar', 'Generar Excel'])
    expect(PASOS_DEL_MODO.zipjobs).toEqual(['Subir ZIPs', 'Analizar', 'Seleccionar', 'Generar Excel'])
  })
})
