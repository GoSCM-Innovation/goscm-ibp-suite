import { describe, it, expect } from 'vitest'

import {
  estadoParaElMotor, identificadorDeEjecucion, partirIdentificador,
} from './job-orchestration.js'

describe('identificadorDeEjecucion', () => {
  it('junta el nombre técnico y la repetición', () => {
    expect(identificadorDeEjecucion('FA163E6E', '7')).toBe('FA163E6E|7')
  })

  it('y se puede deshacer', () => {
    expect(partirIdentificador('FA163E6E|7')).toEqual({ jobName: 'FA163E6E', jobRunCount: '7' })
  })

  // Consultar a SAP con datos rotos devolvería cualquier cosa y el paso quedaría colgado.
  it('lo que no tiene esa forma no se parte', () => {
    expect(partirIdentificador('FA163E6E')).toBeNull()
    expect(partirIdentificador('|7')).toBeNull()
    expect(partirIdentificador(undefined)).toBeNull()
  })
})

describe('estadoParaElMotor', () => {
  const run = (JobStatus, extra = {}) => estadoParaElMotor({ JobStatus, ...extra })

  it('un trabajo terminado es un éxito', () => {
    expect(run('F')).toMatchObject({ statusCode: 'SUCCESS' })
  })

  // Hizo lo suyo y dejó el dato: tratarlo como fallo pararía cadenas enteras por un aviso.
  it('terminado con avisos también deja seguir', () => {
    expect(run('W').statusCode).toBe('SUCCESS_WITH_ERRORS_D')
  })

  it('un fallo es un fallo', () => {
    expect(run('A')).toMatchObject({ statusCode: 'ERROR' })
    expect(run('U')).toMatchObject({ statusCode: 'ERROR' })
  })

  // El monitor lo pinta como un final más; para el motor no hizo su trabajo.
  it('cancelado es un fallo para el motor', () => {
    expect(run('C').statusCode).toBe('ERROR')
  })

  it('lo que sigue en marcha no decide nada', () => {
    expect(run('R').statusCode).toBe('RUNNING')
  })

  it('lo que espera turno tampoco', () => {
    expect(run('S').statusCode).toBe('QUEUEING')
  })

  // Suponer aquí escondería el caso raro; el motor tiene su propia red de seguridad.
  it('un código desconocido se pasa como tal, con su hora de fin', () => {
    expect(run('Z', { JobEndDateTime: '20260808120000' }))
      .toMatchObject({ statusCode: 'UNKNOWN', endTime: '20260808120000' })
  })

  it('lo que no terminó no lleva hora de fin aunque SAP mande una', () => {
    expect(run('R', { JobEndDateTime: '20260808120000' }).endTime).toBeNull()
  })

  it('siempre lleva una etiqueta legible', () => {
    expect(run('F').statusMsg).toBeTruthy()
  })
})
