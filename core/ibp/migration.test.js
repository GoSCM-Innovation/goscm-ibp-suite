import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./master-data.js', () => ({ countEntity: vi.fn(), readSchema: vi.fn() }))

const { countEntity, readSchema } = await import('./master-data.js')
const { planificarMigracion } = await import('./migration.js')

const origen = { baseUrl: 'https://a', credentials: { user: 'a' }, planningArea: 'PA1', versionId: 'V1' }
const destino = { baseUrl: 'https://b', credentials: { user: 'b' }, planningArea: 'PA2' }

beforeEach(() => {
  countEntity.mockReset()
  readSchema.mockReset()
})

/** Responde el esquema según la entidad que se pida. */
const esquemas = (porEntidad) => readSchema.mockImplementation(({ entidad }) => {
  const columnas = porEntidad[entidad]
  if (columnas === undefined) return Promise.reject(new Error('no se pudo leer'))
  if (columnas === null) return Promise.resolve({ vacia: true, columnas: [], claves: [] })
  return Promise.resolve({ vacia: false, columnas, claves: [columnas[0]] })
})

describe('planificarMigracion', () => {
  it('empareja, compara y cuenta', async () => {
    esquemas({
      GIDPRODUCT: ['PRDID', 'BRAND', 'SOLOAQUI'],
      AS1PRODUCT: ['PRDID', 'BRAND', 'SOLOALLA'],
    })
    countEntity.mockResolvedValue(8005)

    const { entradas, resumen } = await planificarMigracion({
      origen, destino, tablas: ['GIDPRODUCT'], tablasDelDestino: ['AS1PRODUCT', 'AS1LOCATION'],
    })

    expect(entradas[0]).toMatchObject({
      origen: 'GIDPRODUCT',
      destino: 'AS1PRODUCT',
      comunes: ['PRDID', 'BRAND'],
      soloEnOrigen: ['SOLOAQUI'],
      soloEnDestino: ['SOLOALLA'],
      filas: 8005,
    })
    expect(resumen).toMatchObject({ tablas: 1, copiables: 1, filas: 8005 })
  })

  // Sin un orden estable, dos ventanas de lectura se solapan y dejan huecos: un hueco es una fila
  // que no se copia.
  it('devuelve las claves del origen, que son con las que se ordena al copiar', async () => {
    esquemas({ T: ['PRDID', 'BRAND'], T2: ['PRDID'] })
    countEntity.mockResolvedValue(1)

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['T'], tablasDelDestino: ['T2'], destinoDe: { T: 'T2' },
    })
    expect(entradas[0].claves).toEqual(['PRDID'])
  })

  // El área y la versión viajan en el contexto de la transacción, no como columnas.
  it('no cuenta los campos de solo lectura como diferencias', async () => {
    esquemas({ T: ['A', 'PlanningAreaID', 'CREATEDDATE'], T2: ['A'] })
    countEntity.mockResolvedValue(1)

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['T'], tablasDelDestino: ['T2'], destinoDe: { T: 'T2' },
    })
    expect(entradas[0]).toMatchObject({ comunes: ['A'], soloEnOrigen: [] })
  })

  it('una pareja puesta a mano gana al emparejado automático', async () => {
    esquemas({ GIDPRODUCT: ['A'], AS1LOCATION: ['A'] })
    countEntity.mockResolvedValue(3)

    const { entradas } = await planificarMigracion({
      origen,
      destino,
      tablas: ['GIDPRODUCT'],
      tablasDelDestino: ['AS1PRODUCT', 'AS1LOCATION'],
      destinoDe: { GIDPRODUCT: 'AS1LOCATION' },
    })
    expect(entradas[0]).toMatchObject({ destino: 'AS1LOCATION', emparejadaAMano: true })
  })

  // Sin fila de muestra no se puede deducir el esquema, y ahí se mandaría todo.
  it('una tabla vacía en el destino deja el plan a ciegas', async () => {
    esquemas({ T: ['A'], T2: null })
    countEntity.mockResolvedValue(5)

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['T'], tablasDelDestino: ['T2'], destinoDe: { T: 'T2' },
    })
    expect(entradas[0]).toMatchObject({ verificable: false, comunes: null })
  })

  it('sin pareja no se pide el esquema del destino', async () => {
    esquemas({ GIDRARO: ['A'] })
    countEntity.mockResolvedValue(2)

    const { entradas, resumen } = await planificarMigracion({
      origen, destino, tablas: ['GIDRARO'], tablasDelDestino: ['AS1PRODUCT'],
    })
    expect(entradas[0].destino).toBeNull()
    expect(resumen.copiables).toBe(0)
  })

  // Una cuenta que falla no debe tumbar el plan: lo demás sigue valiendo.
  it('si no se puede contar, la tabla queda sin número', async () => {
    esquemas({ T: ['A'], T2: ['A'] })
    countEntity.mockRejectedValue(new Error('tiempo agotado'))

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['T'], tablasDelDestino: ['T2'], destinoDe: { T: 'T2' },
    })
    expect(entradas[0].filas).toBeNull()
  })

  // El esquema es de la tabla; el filtro es de lo que se va a copiar.
  it('el filtro va en la cuenta y no en la lectura del esquema', async () => {
    esquemas({ T: ['A'], T2: ['A'] })
    countEntity.mockResolvedValue(1)

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['T'], tablasDelDestino: ['T2'], destinoDe: { T: 'T2' },
      filtroPorTabla: { T: "BRAND eq 'X'" },
    })

    expect(countEntity).toHaveBeenCalledWith(expect.objectContaining({ extraFilter: "BRAND eq 'X'" }))
    expect(readSchema).not.toHaveBeenCalledWith(expect.objectContaining({ extraFilter: expect.anything() }))
    // La pantalla necesita saberlo: "8.005" y "1.246 de 8.005" no se leen igual.
    expect(entradas[0].filtrada).toBe(true)
  })

  // Uno global no serviría: filtrar por marca aplicado a la tabla de ubicaciones se llevaría todo.
  it('el filtro es de cada tabla, no de la migración', async () => {
    esquemas({ A: ['X'], A2: ['X'], B: ['X'], B2: ['X'] })
    countEntity.mockResolvedValue(1)

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['A', 'B'], tablasDelDestino: ['A2', 'B2'],
      destinoDe: { A: 'A2', B: 'B2' },
      filtroPorTabla: { A: "BRAND eq 'X'" },
    })

    expect(entradas.find((una) => una.origen === 'A').filtrada).toBe(true)
    expect(entradas.find((una) => una.origen === 'B').filtrada).toBe(false)
    expect(countEntity.mock.calls.find((una) => una[0].entidad === 'B')[0].extraFilter).toBe('')
  })

  it('varias tablas salen todas en el plan', async () => {
    esquemas({ A: ['X'], A2: ['X'], B: ['X'], B2: ['X'], C: ['X'], C2: ['X'] })
    countEntity.mockResolvedValue(1)

    const { entradas } = await planificarMigracion({
      origen, destino, tablas: ['A', 'B', 'C'], tablasDelDestino: ['A2', 'B2', 'C2'],
      destinoDe: { A: 'A2', B: 'B2', C: 'C2' },
    })
    expect(entradas.map((una) => una.origen)).toEqual(['A', 'B', 'C'])
  })
})
