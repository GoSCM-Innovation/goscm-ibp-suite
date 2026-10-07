import { describe, it, expect, vi } from 'vitest'

import {
  ENCABEZADOS, LIMITE_DE_CELDA, filasDeEjecucion, hojaDeLogs, leerLogsDeEjecucion, limpiarParaXml,
  nombreDelLibro, partirTexto, reunirLogs, textoDeLog,
} from './task-logs-export.js'

const bloque = (lineas, maxPage = 1) => ({ maxPage: String(maxPage), pageNum: '1', messageLines: lineas })

describe('limpiarParaXml', () => {
  it('quita los caracteres de control que el XML no admite y deja tabulador y saltos', () => {
    expect(limpiarParaXml('a\u0000b\u0007c\td\ne\rf')).toBe('abc\td\ne\rf')
  })

  it('quita mitades sueltas de un par sustituto y conserva los pares completos', () => {
    expect(limpiarParaXml('x\uD800y😀z')).toBe('xy😀z')
  })

  it('sin valor da cadena vacía', () => {
    expect(limpiarParaXml(null)).toBe('')
    expect(limpiarParaXml(undefined)).toBe('')
  })
})

describe('partirTexto', () => {
  it('un texto que cabe queda en un solo trozo', () => {
    expect(partirTexto('hola', 10)).toEqual(['hola'])
    expect(partirTexto('', 10)).toEqual([''])
  })

  it('ningún trozo pasa del límite y juntos dan el texto entero', () => {
    const texto = 'x'.repeat(25)
    const partes = partirTexto(texto, 10)
    expect(partes.every((una) => una.length <= 10)).toBe(true)
    expect(partes.join('')).toBe(texto)
  })

  it('corta en el salto de línea cuando hay uno en la segunda mitad', () => {
    expect(partirTexto('aaaaaaa\nbbbbbbb', 10)).toEqual(['aaaaaaa', 'bbbbbbb'])
  })

  it('no separa un par sustituto', () => {
    const partes = partirTexto(`${'a'.repeat(9)}😀b`, 10)
    expect(partes).toEqual(['a'.repeat(9), '😀b'])
  })

  it('el límite por omisión es el de Excel', () => {
    expect(LIMITE_DE_CELDA).toBe(32767)
    expect(partirTexto('y'.repeat(LIMITE_DE_CELDA + 1))).toHaveLength(2)
  })
})

describe('textoDeLog', () => {
  it('sin bloque queda vacío', () => {
    expect(textoDeLog(null)).toBe('')
  })

  it('con una sola página son sus líneas, sin marcas', () => {
    expect(textoDeLog(bloque(['l1', 'l2']))).toBe('l1\nl2')
  })

  it('con varias páginas junta la primera y la última, cada una con su marca', () => {
    const texto = textoDeLog(bloque(['p1'], 4), bloque(['p4'], 4))
    expect(texto).toBe('[Página 1 de 4]\np1\n\n[Página 4 de 4]\np4')
  })

  it('si la última no se pudo leer, lo dice en vez de dejar el hueco', () => {
    const texto = textoDeLog(bloque(['p1'], 3), { error: 'tiempo agotado' })
    expect(texto).toBe('[Página 1 de 3]\np1\n\n[No se pudo leer la página 3 de 3: tiempo agotado]')
  })
})

describe('leerLogsDeEjecucion', () => {
  it('con logs de una página hace una sola consulta, con los tres logs', async () => {
    const llamar = vi.fn().mockResolvedValue({
      monitorLog: bloque(['m']), traceLog: bloque(['t']), errorLog: null,
    })
    const logs = await leerLogsDeEjecucion(llamar, 42)

    expect(llamar).toHaveBeenCalledTimes(1)
    expect(llamar).toHaveBeenCalledWith('getTaskLogs', {
      runId: 42,
      monitorLog: { getLog: true },
      traceLog: { getLog: true },
      errorLog: { getLog: true },
    })
    expect(logs).toEqual({ monitorLog: 'm', traceLog: 't', errorLog: '' })
  })

  it('pide en una segunda consulta la última página solo de los logs que tienen varias', async () => {
    const llamar = vi.fn()
      .mockResolvedValueOnce({ monitorLog: bloque(['m']), traceLog: bloque(['t1'], 5), errorLog: bloque(['e1'], 2) })
      .mockResolvedValueOnce({ traceLog: bloque(['t5'], 5), errorLog: bloque(['e2'], 2) })
    const logs = await leerLogsDeEjecucion(llamar, 7)

    expect(llamar).toHaveBeenCalledTimes(2)
    expect(llamar).toHaveBeenLastCalledWith('getTaskLogs', {
      runId: 7,
      traceLog: { getLog: true, pageNum: 5 },
      errorLog: { getLog: true, pageNum: 2 },
    })
    expect(logs.monitorLog).toBe('m')
    expect(logs.traceLog).toBe('[Página 1 de 5]\nt1\n\n[Página 5 de 5]\nt5')
    expect(logs.errorLog).toBe('[Página 1 de 2]\ne1\n\n[Página 2 de 2]\ne2')
  })

  it('si falla la segunda consulta conserva la primera página y avisa de la última', async () => {
    const llamar = vi.fn()
      .mockResolvedValueOnce({ monitorLog: bloque(['m1'], 2), traceLog: null, errorLog: null })
      .mockRejectedValueOnce(new Error('sin red'))
    const logs = await leerLogsDeEjecucion(llamar, 1)
    expect(logs.monitorLog).toBe('[Página 1 de 2]\nm1\n\n[No se pudo leer la página 2 de 2: sin red]')
  })

  it('si falla la primera consulta el error sube', async () => {
    const llamar = vi.fn().mockRejectedValue(new Error('sesión vencida'))
    await expect(leerLogsDeEjecucion(llamar, 1)).rejects.toThrow('sesión vencida')
  })
})

describe('filasDeEjecucion', () => {
  const datos = { nombre: 'TASK_A', inicio: 'i', fin: 'f', estado: 'Error', duracion: '1m' }

  it('si todo cabe es una sola fila, sin marca en el nombre', () => {
    const filas = filasDeEjecucion({ ...datos, logs: { monitorLog: 'm', traceLog: 't', errorLog: 'e' } }, 10)
    expect(filas).toEqual([['TASK_A', 'i', 'f', 'Error', '1m', 'm', 't', 'e']])
  })

  it('sigue hasta escribir el log más largo; las continuaciones llevan #2, #3 y repiten los datos', () => {
    const filas = filasDeEjecucion({
      ...datos,
      logs: { monitorLog: 'corto', traceLog: 'x'.repeat(25), errorLog: 'y'.repeat(15) },
    }, 10)

    expect(filas).toHaveLength(3)
    expect(filas.map((fila) => fila[0])).toEqual(['TASK_A', '#2 TASK_A', '#3 TASK_A'])
    expect(filas.every((fila) => fila.slice(1, 5).join() === 'i,f,Error,1m')).toBe(true)
    // El log corto termina en la primera fila y queda vacío en las demás.
    expect(filas.map((fila) => fila[5])).toEqual(['corto', '', ''])
    expect(filas.map((fila) => fila[6]).join('')).toBe('x'.repeat(25))
    expect(filas.map((fila) => fila[7])).toEqual(['y'.repeat(10), 'y'.repeat(5), ''])
  })

  it('ninguna celda pasa del límite', () => {
    const filas = filasDeEjecucion({ ...datos, logs: { traceLog: 'z'.repeat(LIMITE_DE_CELDA * 2 + 5) } })
    expect(filas).toHaveLength(3)
    expect(filas.every((fila) => fila.every((celda) => celda.length <= LIMITE_DE_CELDA))).toBe(true)
  })
})

describe('hojaDeLogs', () => {
  it('lleva el encabezado y las columnas en el orden pedido', () => {
    expect(ENCABEZADOS).toEqual([
      'Task', 'Inicio', 'Fin', 'Estado', 'Duración', 'Log Monitor', 'Log Trace', 'Log Error',
    ])
    const { xml } = hojaDeLogs([['T', 'i', 'f', 'Error', '1m', 'm', 't', 'e']]).toXml()
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr"><is><t>Task</t></is></c>')
    expect(xml).toContain('<c r="A2" s="2" t="inlineStr"><is><t>T</t></is></c>')
    expect(xml).toContain('<c r="F2" s="3" t="inlineStr"><is><t>m</t></is></c>')
  })
})

describe('reunirLogs', () => {
  const comoSeLee = (fila, detalle) => ({
    nombre: fila.taskName, inicio: 'i', fin: detalle?.endTime ?? '', estado: fila.statusCode, duracion: '',
  })

  it('pide fin y duración solo de lo que falta y deja las filas en el orden recibido', async () => {
    const ejecuciones = [
      { runId: 1, taskName: 'A', statusCode: 'ERROR' },
      { runId: 2, taskName: 'B', statusCode: 'RUNNING' },
      { runId: 3, taskName: 'C', statusCode: 'SUCCESS' },
    ]
    const pedirDetalles = vi.fn().mockResolvedValue({ 2: { endTime: 'f2' }, 3: { endTime: 'f3' } })
    const llamar = vi.fn(async (_, { runId }) => ({ monitorLog: bloque([`log${runId}`]) }))

    const resultado = await reunirLogs({
      ejecuciones,
      llamar,
      pedirDetalles,
      detallesPrevios: { 1: { endTime: 'f1' }, 2: { endTime: 'viejo' } },
      esTerminal: (codigo) => codigo !== 'RUNNING',
      comoSeLee,
    })

    // La 1 es terminal y ya estaba; la 2 sigue viva y se vuelve a preguntar; la 3 faltaba.
    expect(pedirDetalles.mock.calls[0][0]).toEqual([2, 3])
    expect(resultado.filas.map((fila) => [fila[0], fila[2], fila[5]])).toEqual([
      ['A', 'f1', 'log1'], ['B', 'f2', 'log2'], ['C', 'f3', 'log3'],
    ])
    expect(resultado.fallidas).toBe(0)
  })

  it('una ejecución que falla no corta la descarga: se marca y se cuenta', async () => {
    const llamar = vi.fn(async (_, { runId }) => {
      if (runId === 2) throw new Error('timeout')
      return { monitorLog: bloque(['ok']) }
    })
    const resultado = await reunirLogs({
      ejecuciones: [{ runId: 1, taskName: 'A' }, { runId: 2, taskName: 'B' }],
      llamar,
      pedirDetalles: vi.fn().mockResolvedValue({}),
      esTerminal: () => true,
      comoSeLee,
    })

    expect(resultado.fallidas).toBe(1)
    expect(resultado.primerError).toBe('timeout')
    expect(resultado.filas[1].slice(5)).toEqual(Array(3).fill('[No se pudo leer el log: timeout]'))
  })

  it('si se pide parar, no devuelve nada', async () => {
    let parar = false
    const llamar = vi.fn(async () => { parar = true; return {} })
    const resultado = await reunirLogs({
      ejecuciones: [{ runId: 1 }, { runId: 2 }],
      llamar,
      pedirDetalles: vi.fn().mockResolvedValue({}),
      detallesPrevios: { 1: {}, 2: {} },
      esTerminal: () => true,
      comoSeLee,
      debeParar: () => parar,
    })
    expect(resultado).toBeNull()
  })

  it('cuenta el avance de los logs', async () => {
    const onAvance = vi.fn()
    await reunirLogs({
      ejecuciones: [{ runId: 1 }, { runId: 2 }],
      llamar: vi.fn().mockResolvedValue({}),
      pedirDetalles: vi.fn().mockResolvedValue({}),
      esTerminal: () => true,
      comoSeLee,
      onAvance,
    })
    expect(onAvance).toHaveBeenLastCalledWith({ fase: 'logs', hechas: 2, total: 2 })
  })
})

describe('nombreDelLibro', () => {
  it('lleva destino, días del rango y cantidad, sin caracteres raros', () => {
    expect(nombreDelLibro({
      destino: 'Cliente · Productivo', desde: '2026-09-01T00:00', hasta: '2026-09-30T23:59', total: 120,
    })).toBe('logs_Cliente_Productivo_2026-09-01_2026-09-30_120.xlsx')
  })
})
