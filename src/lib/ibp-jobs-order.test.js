import { describe, it, expect } from 'vitest'

import { buscarPaso, ordenarPorJobs } from './ibp-jobs-order.js'

const paso = (pos, text, extra = {}) => ({
  pos,
  text,
  jceText: 'CI-DS DATA INTEGRATION',
  seqName: `S${pos}`,
  taskId: '',
  ...extra,
})

const entrada = (sheetName, jobName, dataflowGuid) => ({
  sheetName,
  parsed: { jobName, dataflowName: sheetName, dataflowGuid, mappings: [], filters: [], lookups: [], variables: [] },
  paramRow: { sheetName, jobName },
})

const atl = (sessionName, guids) => ({
  sessionName,
  groups: [{ name: 'P', displayName: 'FLOWof_Grupo', parallel: false, dataflows: guids.map((guid) => ({ guid, displayName: guid })) }],
})

describe('buscarPaso', () => {
  const pasos = [[paso(1, 'Cargar maestros', { taskId: 'PROC_MD' }), paso(2, 'Otro')]]

  // El texto del paso lo edita cualquiera desde IBP; el identificador técnico no.
  it('empareja por el identificador técnico de la tarea', () => {
    expect(buscarPaso(pasos, 'PROC_MD')).toMatchObject({ jobIdx: 0, paso: { pos: 1 } })
  })

  it('si no hay identificador, empareja por el texto', () => {
    expect(buscarPaso(pasos, 'Otro').paso.pos).toBe(2)
  })

  // Con nombres largos y parecidos, buscar por "contiene" desde el principio empareja el equivocado.
  it('la coincidencia exacta gana a la parcial', () => {
    const dos = [[paso(1, 'PROC', { taskId: 'PROC' }), paso(2, 'PROC_MD', { taskId: 'PROC_MD' })]]
    expect(buscarPaso(dos, 'PROC_MD').paso.pos).toBe(2)
  })

  it('solo si nada coincide exacto prueba por partes', () => {
    expect(buscarPaso([[paso(1, 'Cargar PROC_MD diario')]], 'PROC_MD').paso.pos).toBe(1)
  })

  it('busca en todos los jobs elegidos', () => {
    expect(buscarPaso([[paso(1, 'A')], [paso(1, 'B')]], 'B').jobIdx).toBe(1)
  })

  it('sin coincidencia devuelve null', () => {
    expect(buscarPaso(pasos, 'NO_EXISTE')).toBeNull()
    expect(buscarPaso(pasos, '')).toBeNull()
  })
})

describe('ordenarPorJobs', () => {
  const jobs = [{ nombre: 'Carga nocturna' }]

  it('pone cada integración en el paso que la ejecuta, en el orden del job', () => {
    const { filas } = ordenarPorJobs({
      atls: [atl('PROC_MD', ['g1'])],
      entradas: [entrada('HOJA_A', 'TAREA_A', 'g1'), entrada('HOJA_B', 'TAREA_B', 'g2')],
      jobs,
      pasosPorJob: [[paso(1, 'Maestros', { taskId: 'PROC_MD' }), paso(2, 'TAREA_B')]],
    })

    expect(filas.map((una) => una.sheetName)).toEqual(['HOJA_A', 'HOJA_B'])
    expect(filas[0]).toMatchObject({ ibpJobName: 'Carga nocturna', ibpStepName: 'Maestros', ibpStepPos: 1 })
    expect(filas[1]).toMatchObject({ ibpStepName: 'TAREA_B', ibpStepPos: 2, atlGroup: '' })
  })

  it('el grupo del ATL viaja con la integración, sin el prefijo del plan', () => {
    const { filas } = ordenarPorJobs({
      atls: [atl('PROC_MD', ['g1'])],
      entradas: [entrada('HOJA_A', 'TAREA_A', 'g1')],
      jobs,
      pasosPorJob: [[paso(1, 'Maestros', { taskId: 'PROC_MD' })]],
    })
    expect(filas[0].atlGroup).toBe('Grupo')
  })

  // Aparecen para que el orden del job se lea completo, pero no hay dataflow que documentar.
  it('un paso que no es de integración entra como fila informativa, sin hoja', () => {
    const { filas } = ordenarPorJobs({
      atls: [],
      entradas: [],
      jobs,
      pasosPorJob: [[paso(1, 'Copiar versión', { jceText: 'VERSION COPY' })]],
    })

    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ isNonDI: true, sheetName: '' })
    expect(filas[0].paramRow.tipoIntegracion).toBe('VERSION COPY')
  })

  it('ordena por job, después por posición del paso', () => {
    const { filas } = ordenarPorJobs({
      atls: [],
      entradas: [entrada('A', 'T_A'), entrada('B', 'T_B'), entrada('C', 'T_C')],
      jobs: [{ nombre: 'Job 1' }, { nombre: 'Job 2' }],
      pasosPorJob: [[paso(2, 'T_B'), paso(1, 'T_A')], [paso(1, 'T_C')]],
    })
    expect(filas.map((una) => una.sheetName)).toEqual(['A', 'B', 'C'])
  })

  // Una integración que ningún paso reclama sigue existiendo y hay que documentarla.
  it('lo que ningún paso reclama queda al final', () => {
    const { filas, avisos } = ordenarPorJobs({
      atls: [],
      entradas: [entrada('HUERFANA', 'NADIE')],
      jobs,
      pasosPorJob: [[]],
    })

    expect(filas.map((una) => una.sheetName)).toEqual(['HUERFANA'])
    expect(filas[0].ibpJobName).toBe('')
    expect(avisos).toEqual([])
  })

  it('avisa del paso que no encontró su tarea en los ZIP', () => {
    const { avisos } = ordenarPorJobs({
      atls: [],
      entradas: [],
      jobs,
      pasosPorJob: [[paso(1, 'TAREA_QUE_NO_ESTA')]],
    })
    expect(avisos[0]).toContain('TAREA_QUE_NO_ESTA')
  })

  it('avisa del proceso que ningún paso ejecuta, pero igual lo documenta', () => {
    const { filas, avisos } = ordenarPorJobs({
      atls: [atl('PROC_SUELTO', ['g1'])],
      entradas: [entrada('HOJA_A', 'TAREA_A', 'g1')],
      jobs,
      pasosPorJob: [[]],
    })

    expect(avisos[0]).toContain('PROC_SUELTO')
    expect(filas.map((una) => una.sheetName)).toEqual(['HOJA_A'])
  })

  it('una integración no se documenta dos veces aunque dos procesos la nombren', () => {
    const { filas } = ordenarPorJobs({
      atls: [atl('P1', ['g1']), atl('P2', ['g1'])],
      entradas: [entrada('HOJA_A', 'TAREA_A', 'g1')],
      jobs,
      pasosPorJob: [[paso(1, 'P1'), paso(2, 'P2')]],
    })
    expect(filas).toHaveLength(1)
  })

  it('sin nada que ordenar devuelve una lista vacía', () => {
    expect(ordenarPorJobs({ atls: [], entradas: [], jobs: [], pasosPorJob: [] }))
      .toEqual({ filas: [], avisos: [] })
  })
})
