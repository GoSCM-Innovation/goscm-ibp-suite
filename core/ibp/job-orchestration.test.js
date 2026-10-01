import { describe, it, expect } from 'vitest'

import {
  CODIGO_CANCELADO, estadoParaElMotor, identificadorDeEjecucion, partirIdentificador,
} from './job-orchestration.js'
import { nextStepState } from '../orchestrations/step-outcome.js'

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

  // `JobSchedule` no siempre devuelve la repetición. Rechazarlo dejaba el paso corriendo para siempre.
  it('sin repetición se parte igual, para preguntar solo por el nombre', () => {
    expect(identificadorDeEjecucion('FA163E6E', undefined)).toBe('FA163E6E|')
    expect(partirIdentificador('FA163E6E|')).toEqual({ jobName: 'FA163E6E', jobRunCount: '' })
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

  // v8 daba «saltado» por terminado y lo contaba como error.
  it('saltado (K) también es un fallo', () => {
    expect(run('K').statusCode).toBe('ERROR')
  })

  // Como en v8: cancelado no es un fallo, el paso queda «Cancelado» y la cadena sigue.
  it('cancelado (C) y borrado (D) son cancelados', () => {
    expect(run('C').statusCode).toBe(CODIGO_CANCELADO)
    expect(run('D').statusCode).toBe(CODIGO_CANCELADO)
  })

  // v8 no los daba por terminados: se sigue preguntando.
  it('desconocido (X), por saltar (k) y cancelándose (c) no son finales', () => {
    for (const letra of ['X', 'k', 'c']) expect(run(letra).statusCode).toBe('RUNNING')
  })

  // La pantalla de v8 la enseñaba junto al trabajo: «Job: … [F]».
  it('devuelve la letra de SAP tal cual', () => {
    expect(run('F').codigoSap).toBe('F')
    expect(estadoParaElMotor(null)).not.toHaveProperty('codigoSap')
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

  // El motor trata «desconocido» como FALLO, así que devolverlo aquí marcaría fallado un trabajo
  // sano antes de que SAP alcance a anotarlo.
  it('una ejecución que SAP no registró todavía es EN COLA, no desconocida', () => {
    expect(estadoParaElMotor(null).statusCode).toBe('QUEUEING')
    expect(estadoParaElMotor(undefined).statusCode).toBe('QUEUEING')
  })
})

// Estas comprueban el efecto en el MOTOR y no solo la traducción. Es lo que hacía falta: la primera
// versión devolvía «desconocido» para una ejecución sin registrar y las pruebas de la traducción
// pasaban igual, porque el problema no estaba en lo que devolvía sino en lo que el motor hace con eso.
describe('lo que el motor decide con cada traducción', () => {
  const enMarcha = { status: 'running', sapRunId: 'J|1', retryCount: 0 }
  const decidir = (run) => nextStepState(enMarcha, estadoParaElMotor(run), {}, 1000, { cancelledCodes: [CODIGO_CANCELADO] })

  it('una ejecución sin registrar deja el paso corriendo', () => {
    expect(decidir(null).status).toBe('running')
  })

  it('un trabajo terminado da el paso por bueno', () => {
    expect(decidir({ JobStatus: 'F' }).status).toBe('success')
  })

  it('terminado con avisos también deja seguir a lo que viene detrás', () => {
    expect(decidir({ JobStatus: 'W' }).status).toBe('success_with_errors')
  })

  it('un trabajo fallado corta el paso', () => {
    expect(decidir({ JobStatus: 'A' }).status).toBe('error')
  })

  it('un trabajo cancelado deja el paso cancelado, no fallado', () => {
    expect(decidir({ JobStatus: 'C' })).toMatchObject({ status: 'cancelled', error: 'SAP: C' })
  })

  it('uno desconocido para SAP (X) sigue esperando', () => {
    expect(decidir({ JobStatus: 'X' }).status).toBe('running')
  })

  it('uno en marcha no decide nada', () => {
    expect(decidir({ JobStatus: 'R' }).status).toBe('running')
  })

  // La red de seguridad del motor: un código raro CON hora de fin se resuelve por el mensaje.
  it('un código desconocido con hora de fin no deja el paso colgado', () => {
    expect(decidir({ JobStatus: 'Z', JobEndDateTime: '20260808120000' }).status).not.toBe('running')
  })
})
