import { describe, it, expect } from 'vitest'
import { DONE_STEP_STATUSES, isRetryDue, isStepDone, nextStepState } from './step-outcome.js'

const AHORA = Date.UTC(2026, 7, 4, 12, 0, 0)

const corriendo = (extra = {}) => ({
  status: 'running',
  sapRunId: '16468',
  sapStatusCode: null,
  startedAt: '2026-08-04T11:00:00.000Z',
  finishedAt: null,
  error: null,
  retryCount: 0,
  retryAt: null,
  ...extra,
})

const decidir = (sapStatus, config = {}, estado = corriendo()) => nextStepState(estado, sapStatus, config, AHORA)

describe('nextStepState', () => {
  describe('terminó bien', () => {
    it('SUCCESS deja el paso como correcto', () => {
      const resultado = decidir({ statusCode: 'SUCCESS', endTime: '20260804120000' })
      expect(resultado.status).toBe('success')
      expect(resultado.finishedAt).toBe(new Date(AHORA).toISOString())
      expect(resultado.error).toBeNull()
    })

    // Terminaron y dejaron el dato: la orquestación puede seguir.
    it.each(['SUCCESS_WITH_ERRORS_D', 'SUCCESS_WITH_ERRORS_E'])('%s deja el paso como correcto con avisos', (codigo) => {
      expect(decidir({ statusCode: codigo }).status).toBe('success_with_errors')
    })

    // No están documentados; aparecieron en tenants reales y v9 tuvo que contemplarlos.
    it.each(['COMPLETED', 'FINISHED', 'DONE'])('%s es un alias de correcto', (codigo) => {
      expect(decidir({ statusCode: codigo }).status).toBe('success')
    })

    it('el código llega en minúsculas o con espacios y se entiende igual', () => {
      expect(decidir({ statusCode: '  success  ' }).status).toBe('success')
    })
  })

  describe('terminó mal', () => {
    it('ERROR deja el paso fallado, con lo que dijo SAP', () => {
      const resultado = decidir({ statusCode: 'ERROR', statusMsg: 'No se pudo abrir el archivo' })
      expect(resultado.status).toBe('error')
      expect(resultado.error).toBe('SAP: ERROR - No se pudo abrir el archivo')
    })

    // Para el monitor una cancelada es un final más; para el motor es un fallo, porque el paso no
    // hizo su trabajo y lo que venía detrás no puede darse por bueno.
    it('TERMINATED es un fallo para el motor, aunque la tabla lo muestre como "Cancelada"', () => {
      expect(decidir({ statusCode: 'TERMINATED' }).status).toBe('error')
    })

    // La tabla dice que UNKNOWN NO es terminal para que el monitor siga preguntando. El motor no
    // puede hacer eso: esperaría para siempre sin decir nada.
    it('UNKNOWN es un fallo para el motor, aunque la tabla no lo dé por terminado', () => {
      expect(decidir({ statusCode: 'UNKNOWN' }).status).toBe('error')
    })

    it('sin mensaje de SAP el error igual dice el código', () => {
      expect(decidir({ statusCode: 'ERROR' }).error).toBe('SAP: ERROR')
    })
  })

  describe('sigue en marcha', () => {
    it.each(['RUNNING', 'QUEUEING', 'IMPORTED', 'FETCHED'])('%s no cambia nada: se vuelve a preguntar', (codigo) => {
      const estado = corriendo()
      expect(decidir({ statusCode: codigo }, {}, estado)).toBe(estado)
    })
  })

  describe('reintentos', () => {
    const conReintentos = { errorStrategy: 'retry', maxRetries: 3, retryDelaySeconds: 60 }

    it('vuelve a pendiente y anota cuándo relanzar', () => {
      const resultado = decidir({ statusCode: 'ERROR' }, conReintentos)

      expect(resultado.status).toBe('pending')
      expect(resultado.retryCount).toBe(1)
      expect(resultado.retryAt).toBe(new Date(AHORA + 60_000).toISOString())
    })

    // El reintento es una ejecución NUEVA en SAP, no la misma otra vez: quedarse con el
    // identificador viejo haría que el motor consultara el resultado anterior y lo diera por nuevo.
    it('suelta el identificador de la ejecución anterior', () => {
      const resultado = decidir({ statusCode: 'ERROR' }, conReintentos)
      expect(resultado.sapRunId).toBeNull()
      expect(resultado.sapStatusCode).toBeNull()
    })

    it('el mensaje dice por qué intento va', () => {
      const resultado = decidir({ statusCode: 'ERROR' }, conReintentos, corriendo({ retryCount: 1 }))
      expect(resultado.error).toBe('SAP: ERROR (intento 2 de 3)')
      expect(resultado.retryCount).toBe(2)
    })

    it('agotados los intentos, se da por fallado y no agenda otro', () => {
      const resultado = decidir({ statusCode: 'ERROR' }, conReintentos, corriendo({ retryCount: 3 }))
      expect(resultado.status).toBe('error')
      expect(resultado.retryAt).toBeFalsy()
      expect(resultado.retryCount).toBe(3)
    })

    it('sin la estrategia de reintentar, un fallo es un fallo aunque haya intentos configurados', () => {
      const resultado = decidir({ statusCode: 'ERROR' }, { errorStrategy: 'stop', maxRetries: 3 })
      expect(resultado.status).toBe('error')
    })

    it('la estrategia de continuar tampoco reintenta: sigue el que viene detrás', () => {
      expect(decidir({ statusCode: 'ERROR' }, { errorStrategy: 'continue', maxRetries: 3 }).status).toBe('error')
    })

    it('sin espera configurada usa la de por omisión', () => {
      const resultado = decidir({ statusCode: 'ERROR' }, { errorStrategy: 'retry', maxRetries: 1 })
      expect(resultado.retryAt).toBe(new Date(AHORA + 30_000).toISOString())
    })
  })

  describe('códigos que no están en ninguna lista', () => {
    // Red de seguridad para tenants que devuelven códigos sin documentar.
    it('con hora de fin y mensaje que suena a error, se da por fallado', () => {
      const resultado = decidir({ statusCode: 'RARO', endTime: '20260804120000', statusMsg: 'Job failed' })
      expect(resultado.status).toBe('error')
      expect(resultado.error).toContain('RARO')
    })

    it('con hora de fin y mensaje inofensivo, se da por correcto', () => {
      const resultado = decidir({ statusCode: 'RARO', endTime: '20260804120000', statusMsg: 'Todo listo' })
      expect(resultado.status).toBe('success')
      expect(resultado.error).toBeNull()
    })

    it('sin código pero con hora de fin, se anota que solo había hora', () => {
      const resultado = decidir({ endTime: '20260804120000' })
      expect(resultado.status).toBe('success')
      expect(resultado.sapStatusCode).toBe('SOLO_HORA_DE_FIN')
    })

    // Lo prudente: el paso siguiente puede escribir en SAP, así que no se supone que terminó.
    it('sin hora de fin no se supone nada: se sigue esperando', () => {
      const estado = corriendo()
      expect(decidir({ statusCode: 'RARO' }, {}, estado)).toBe(estado)
      expect(decidir({}, {}, estado)).toBe(estado)
      expect(decidir(null, {}, estado)).toBe(estado)
    })
  })

  it('no modifica el estado que recibe', () => {
    const estado = corriendo()
    const copia = { ...estado }
    decidir({ statusCode: 'ERROR' }, {}, estado)
    expect(estado).toEqual(copia)
  })
})

describe('isRetryDue', () => {
  it('le toca cuando ya pasó la espera', () => {
    expect(isRetryDue({ status: 'pending', retryAt: new Date(AHORA - 1000).toISOString() }, AHORA)).toBe(true)
  })

  it('no le toca si la espera no terminó', () => {
    expect(isRetryDue({ status: 'pending', retryAt: new Date(AHORA + 1000).toISOString() }, AHORA)).toBe(false)
  })

  it('un paso pendiente sin reintento anotado no es un reintento: es uno que nunca arrancó', () => {
    expect(isRetryDue({ status: 'pending', retryAt: null }, AHORA)).toBe(false)
  })

  it('un paso que no está pendiente no se relanza', () => {
    expect(isRetryDue({ status: 'running', retryAt: new Date(AHORA - 1000).toISOString() }, AHORA)).toBe(false)
  })

  it('una fecha ilegible no dispara un relanzamiento', () => {
    expect(isRetryDue({ status: 'pending', retryAt: 'cuando sea' }, AHORA)).toBe(false)
    expect(isRetryDue(null, AHORA)).toBe(false)
  })
})

describe('isStepDone', () => {
  it.each(DONE_STEP_STATUSES)('%s ya no espera nada', (estado) => {
    expect(isStepDone(estado)).toBe(true)
  })

  it.each(['pending', 'running'])('%s todavía espera', (estado) => {
    expect(isStepDone(estado)).toBe(false)
  })
})
