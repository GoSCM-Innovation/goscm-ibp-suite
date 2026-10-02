// El enriquecimiento en vivo: el orden de las llamadas y los mensajes de v7.

import { describe, it, expect, vi } from 'vitest'

import { TIPOS_POR_LLAMADA, contarVolumetria, enriquecerDocumento } from './pa-doc-enriquecer.js'

const datosCon = (ids) => ({
  MASTERDATATYPES: { objetos: ids.map((id) => ({ 'Master Data Type ID': id })) },
})

const ENTIDADES = { plantillas: 'JobTemplateSet', pasos: 'JobTemplateSequenceSet' }

function servicios(sobrescribir = {}) {
  return {
    fetchEntidadesDeTipos: vi.fn(async (conexion, ids) => Object.fromEntries(ids.map((id) => [id, id]))),
    fetchVolumetria: vi.fn(async (conexion, ids) => Object.fromEntries(ids.map((id) => [id, 1]))),
    fetchApplicationJobs: vi.fn(async () => ({ entidades: ENTIDADES, jobs: [{ name: 'A', text: 'A', steps: [] }] })),
    ...sobrescribir,
  }
}

const mensajes = (registro) => registro.mock.calls.map((llamada) => llamada[1])

describe('contarVolumetria', () => {
  it('sin tipos no llama a nadie', async () => {
    const s = servicios()
    expect(await contarVolumetria({ conexionId: 'c', ids: [], registro: vi.fn(), servicios: s })).toEqual({})
    expect(s.fetchEntidadesDeTipos).not.toHaveBeenCalled()
  })

  it('solo cuenta los tipos que tienen entidad; los demás quedan en null', async () => {
    const s = servicios({
      fetchEntidadesDeTipos: vi.fn(async () => ({ A: 'A', B: null })),
      fetchVolumetria: vi.fn(async () => ({ A: 9 })),
    })
    const registro = vi.fn()

    expect(await contarVolumetria({ conexionId: 'c', ids: ['A', 'B'], registro, servicios: s }))
      .toEqual({ A: 9, B: null })
    expect(s.fetchVolumetria).toHaveBeenCalledWith('c', ['A'])
    expect(mensajes(registro)).toEqual(['  ↳ Volumetría de 1/2 tipos de datos maestros…'])
  })

  // Un área de cientos de tipos no cabe en el tiempo de una sola función: se manda por tandas.
  it('un área grande se cuenta por tandas, una tras otra', async () => {
    const ids = Array.from({ length: TIPOS_POR_LLAMADA * 2 + 5 }, (nada, i) => `T${i}`)
    const s = servicios()
    const cuentas = await contarVolumetria({ conexionId: 'c', ids, registro: vi.fn(), servicios: s })

    expect(s.fetchVolumetria).toHaveBeenCalledTimes(3)
    expect(s.fetchVolumetria.mock.calls.map((llamada) => llamada[1].length)).toEqual([TIPOS_POR_LLAMADA, TIPOS_POR_LLAMADA, 5])
    expect(Object.keys(cuentas)).toHaveLength(ids.length)
  })
})

describe('enriquecerDocumento', () => {
  it('con los dos acuerdos, devuelve todo y lo dice con los mensajes de v7', async () => {
    const registro = vi.fn()
    const salida = await enriquecerDocumento({
      conexionId: 'c', datos: datosCon(['A', 'B']), registro, servicios: servicios(),
    })

    expect(salida.mdtCounts).toEqual({ A: 1, B: 1 })
    expect(salida.appJobs).toHaveLength(1)
    expect(mensajes(registro)).toEqual([
      'Enriqueciendo: volumetría de datos maestros (SAP_COM_0720)…',
      '  ↳ Volumetría de 2/2 tipos de datos maestros…',
      'SAP_COM_0720 OK: volumetría de 2 tipo(s) de datos maestros.',
      'Enriqueciendo: Application Jobs (SAP_COM_0326)…',
      '  ↳ Plantillas de job (JobTemplateSet)…',
      '  ↳ Pasos (JobTemplateSequenceSet)…',
      'SAP_COM_0326 OK: 1 plantilla(s) de Application Jobs.',
      'Enriquecimiento completo: ambos acuerdos (SAP_COM_0720 + SAP_COM_0326) respondieron.',
    ])
    expect(registro.mock.calls.filter((llamada) => llamada[0] === 'ok')).toHaveLength(3)
  })

  it('el cero cuenta como volumetría leída, el null no', async () => {
    const s = servicios({ fetchVolumetria: vi.fn(async () => ({ A: 0, B: null })) })
    const registro = vi.fn()
    await enriquecerDocumento({ conexionId: 'c', datos: datosCon(['A', 'B']), registro, servicios: s })
    expect(mensajes(registro)).toContain('SAP_COM_0720 OK: volumetría de 1 tipo(s) de datos maestros.')
  })

  it('si falla la volumetría sigue con los jobs: enriquecimiento parcial', async () => {
    const s = servicios({ fetchEntidadesDeTipos: vi.fn(async () => { throw new Error('SAP devolvió 403') }) })
    const registro = vi.fn()
    const salida = await enriquecerDocumento({ conexionId: 'c', datos: datosCon(['A']), registro, servicios: s })

    expect(salida.mdtCounts).toBeNull()
    expect(salida.appJobs).toHaveLength(1)
    expect(mensajes(registro)).toContain('SAP_COM_0720 no disponible con este usuario/tenant (SAP devolvió 403). Se omite la volumetría de maestros.')
    expect(mensajes(registro).at(-1)).toBe('Enriquecimiento parcial: solo respondió SAP_COM_0326. Verifica que ambos acuerdos estén asignados al mismo Communication User.')
  })

  it('si fallan los jobs sigue con la volumetría: parcial, y lo dice al revés', async () => {
    const s = servicios({ fetchApplicationJobs: vi.fn(async () => { throw new Error('boom') }) })
    const registro = vi.fn()
    const salida = await enriquecerDocumento({ conexionId: 'c', datos: datosCon(['A']), registro, servicios: s })

    expect(salida.appJobs).toEqual([])
    expect(salida.mdtCounts).toEqual({ A: 1 })
    expect(mensajes(registro)).toContain('SAP_COM_0326 no disponible con este usuario/tenant (boom). Se omiten los Application Jobs.')
    expect(mensajes(registro).at(-1)).toContain('solo respondió SAP_COM_0720')
  })

  it('si no responde ninguno, el documento se genera sin datos en vivo', async () => {
    const s = servicios({
      fetchEntidadesDeTipos: vi.fn(async () => { throw new Error('x') }),
      fetchApplicationJobs: vi.fn(async () => { throw new Error('y') }),
    })
    const registro = vi.fn()
    const salida = await enriquecerDocumento({ conexionId: 'c', datos: datosCon(['A']), registro, servicios: s })

    expect(salida).toEqual({ appJobs: [], mdtCounts: null })
    expect(mensajes(registro).at(-1)).toBe('Ningún acuerdo respondió; el documento se genera sin datos en vivo.')
    expect(registro.mock.calls.at(-1)[0]).toBe('warn')
  })

  it('sin tipos de dato maestro la volumetría responde vacía y no es un fallo', async () => {
    const registro = vi.fn()
    const salida = await enriquecerDocumento({ conexionId: 'c', datos: {}, registro, servicios: servicios() })
    expect(salida.mdtCounts).toEqual({})
    expect(mensajes(registro)).toContain('SAP_COM_0720 OK: volumetría de 0 tipo(s) de datos maestros.')
  })
})
