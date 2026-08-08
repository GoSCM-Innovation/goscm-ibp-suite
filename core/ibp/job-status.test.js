import { describe, it, expect } from 'vitest'

import {
  CANCELABLE_JOB_STATUSES,
  JOB_RESTART_MODES,
  JOB_STATUS,
  isJobCancelable,
  isJobFailed,
  isJobFinished,
  isJobRestartable,
  isProblemMessage,
  jobStatusMeta,
  jobSuccessRate,
  messageTypeMeta,
} from './job-status.js'

describe('jobStatusMeta', () => {
  it('describe los estados conocidos', () => {
    expect(jobStatusMeta('F')).toMatchObject({ label: 'Terminado' })
    expect(jobStatusMeta('A')).toMatchObject({ label: 'Fallado' })
  })

  it('todos los estados tienen etiqueta y color', () => {
    for (const [code, meta] of Object.entries(JOB_STATUS)) {
      expect(meta.label, code).toBeTruthy()
      expect(meta.color, code).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  // Si SAP añade un estado, mejor sin clasificar que clasificado mal.
  it('un estado desconocido no se da por terminado ni por fallado', () => {
    expect(jobStatusMeta('Z').label).toBe('Sin clasificar')
    expect(isJobFinished('Z')).toBe(false)
    expect(isJobFailed('Z')).toBe(false)
    expect(isJobCancelable('Z')).toBe(false)
    expect(isJobRestartable('Z')).toBe(false)
  })

  // `c` (cancelándose) y `C` (cancelado) son estados distintos: confundirlos daría por terminado
  // un trabajo que todavía se está deteniendo.
  it('distingue mayúsculas de minúsculas', () => {
    expect(jobStatusMeta('C').label).toBe('Cancelado')
    expect(jobStatusMeta('c').label).toBe('Cancelándose')
    expect(jobStatusMeta('K').label).toBe('Saltado')
    expect(jobStatusMeta('k').label).toBe('Por saltar')
  })
})

describe('las agrupaciones', () => {
  it('lo cancelable es lo que todavía no acabó', () => {
    expect([...CANCELABLE_JOB_STATUSES].sort()).toEqual(['P', 'R', 'S', 'Y'])
    for (const code of CANCELABLE_JOB_STATUSES) expect(isJobFinished(code), code).toBe(false)
  })

  it('lo reiniciable es lo que ya acabó', () => {
    for (const code of ['A', 'U', 'C', 'W', 'F']) expect(isJobRestartable(code), code).toBe(true)
    for (const code of ['R', 'S', 'P', 'Y']) expect(isJobRestartable(code), code).toBe(false)
  })

  it('un estado no puede ser a la vez terminado y fallado', () => {
    for (const code of Object.keys(JOB_STATUS)) {
      expect(isJobFinished(code) && isJobFailed(code), code).toBe(false)
    }
  })

  // Terminar con avisos cuenta como éxito: es lo que hacía v8.
  it('terminado con avisos cuenta como terminado', () => {
    expect(isJobFinished('W')).toBe(true)
  })
})

describe('jobSuccessRate', () => {
  it('calcula sobre lo que ya acabó', () => {
    expect(jobSuccessRate(['F', 'F', 'F', 'A'])).toBe(75)
  })

  // Incluir lo que todavía corre bajaría la tasa por trabajos que aún pueden salir bien.
  it('lo que sigue corriendo no cuenta', () => {
    expect(jobSuccessRate(['F', 'R', 'S'])).toBe(100)
  })

  it('todo bien es 100 y todo mal es 0', () => {
    expect(jobSuccessRate(['F', 'W'])).toBe(100)
    expect(jobSuccessRate(['A', 'U'])).toBe(0)
  })

  // Un "100%" con un trabajo fallado es peor que no dar el dato.
  it('no redondea a 100 habiendo un fallo, ni a 0 habiendo un acierto', () => {
    expect(jobSuccessRate([...Array(200).fill('F'), 'A'])).toBe(99)
    expect(jobSuccessRate([...Array(200).fill('A'), 'F'])).toBe(1)
  })

  it('sin nada acabado no hay tasa que dar', () => {
    expect(jobSuccessRate([])).toBeNull()
    expect(jobSuccessRate(['R', 'S', 'P'])).toBeNull()
  })
})

describe('los tipos de mensaje del registro', () => {
  it('describe los códigos de mensaje de ABAP', () => {
    expect(messageTypeMeta('E').label).toBe('Error')
    expect(messageTypeMeta('S').label).toBe('Correcto')
    expect(messageTypeMeta('W').label).toBe('Aviso')
  })

  // `A` detiene el proceso; `E` anota el fallo y sigue. Las dos son problema.
  it('error e interrupción cuentan como problema; el resto no', () => {
    expect(isProblemMessage('E')).toBe(true)
    expect(isProblemMessage('A')).toBe(true)
    for (const tipo of ['S', 'W', 'I', '', undefined]) expect(isProblemMessage(tipo), tipo).toBe(false)
  })

  it('un tipo desconocido se muestra tal cual, sin darlo por problema', () => {
    expect(messageTypeMeta('Z').label).toBe('Z')
    expect(isProblemMessage('Z')).toBe(false)
  })

  it('sin tipo no revienta', () => {
    expect(messageTypeMeta(undefined).label).toBe('—')
  })
})

describe('JOB_RESTART_MODES', () => {
  it('son los dos de SAP, con su explicación', () => {
    expect(JOB_RESTART_MODES.map((uno) => uno.value)).toEqual(['E', 'A'])
    for (const modo of JOB_RESTART_MODES) expect(modo.description.length).toBeGreaterThan(20)
  })
})
