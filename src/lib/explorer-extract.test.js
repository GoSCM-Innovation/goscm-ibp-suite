import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('./ibp-master-data.js', () => ({ fetchMasterRows: vi.fn() }))

const { fetchMasterRows } = await import('./ibp-master-data.js')
const { contar, olvidarBase, origenGuardado } = await import('./explorer-db.js')
const { FILAS_POR_PAGINA, extraer } = await import('./explorer-extract.js')

const CONEXION = 'c-1'
const DESTINO = { planningArea: 'GCINDURAMA', versionId: 'GCIDPROD' }

/** Un paso del plan, ya resuelto contra el tenant. */
const paso = (extra = {}) => ({
  tabla: 'bom_psi',
  grupo: 'arbol',
  papel: 'item',
  etiqueta: 'Componentes',
  entidad: 'GIDPRODUCTIONSOURCEITM',
  select: ['SOURCEID', 'PRDID'],
  omitidos: [],
  descartarSi: null,
  sePuede: true,
  esencial: true,
  ...extra,
})

/** Sirve `n` filas repartidas en páginas del tamaño real. La ventana va en el SEGUNDO argumento. */
function conFilas(n, hacer = (i) => ({ SOURCEID: `S${i}`, PRDID: `P${i}` })) {
  fetchMasterRows.mockImplementation((_conexionId, { skip, top }) => Promise.resolve(
    Array.from({ length: Math.max(0, Math.min(top, n - skip)) }, (_, i) => hacer(skip + i)),
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
})

describe('extraer', () => {
  it('baja una tabla y la escribe en la base local', async () => {
    conFilas(3)
    const salida = await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })

    expect(salida).toMatchObject({ guardadas: 3, ok: true, conError: 0 })
    await expect(contar('bom_psi')).resolves.toBe(3)
  })

  it('anota de qué tenant, área y versión son los datos', async () => {
    conFilas(1)
    await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })
    await expect(origenGuardado()).resolves.toBe('c-1|GCINDURAMA|GCIDPROD')
  })

  // Lo que acota la memoria es escribir y soltar, no el tamaño de la página.
  it('pagina hasta el final sin perder filas', async () => {
    conFilas(FILAS_POR_PAGINA + 120)
    const salida = await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })

    expect(salida.guardadas).toBe(FILAS_POR_PAGINA + 120)
    expect(fetchMasterRows).toHaveBeenCalledTimes(2)
    expect(fetchMasterRows.mock.calls[1][1].skip).toBe(FILAS_POR_PAGINA)
  })

  // Sin orden estable, dos ventanas se solapan y dejan huecos: un hueco es un producto sin analizar.
  it('pide las páginas con un orden estable', async () => {
    conFilas(1)
    await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })
    expect(fetchMasterRows.mock.calls[0][1].orderby).toEqual(['SOURCEID', 'PRDID'])
  })

  // «Bajé 8.000 y guardé 5.100» es información; «guardé 5.100» a secas parece un error.
  it('descarta las inválidas y dice cuántas eran', async () => {
    conFilas(4, (i) => ({ SOURCEID: `S${i}`, PRDID: `P${i}`, PINVALID: i % 2 === 0 ? 'X' : '' }))
    const salida = await extraer({
      conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso({ descartarSi: 'PINVALID' })] },
    })

    expect(salida).toMatchObject({ guardadas: 2, descartadas: 2 })
    await expect(contar('bom_psi')).resolves.toBe(2)
  })

  // La marca puede llamarse distinto en este tenant, y el filtro busca el nombre canónico.
  it('traduce los nombres antes de descartar', async () => {
    conFilas(2, (i) => ({ SOURCEID: `S${i}`, PRDID: `P${i}`, INVALIDO: i === 0 ? 'X' : '' }))
    const salida = await extraer({
      conexionId: CONEXION,
      destino: DESTINO,
      plan: { pasos: [paso({ descartarSi: 'PINVALID' })] },
      mapa: { GIDPRODUCTIONSOURCEITM: { PINVALID: 'INVALIDO' } },
    })

    expect(salida).toMatchObject({ guardadas: 1, descartadas: 1 })
  })

  it('un paso que no se puede bajar se anota como omitido', async () => {
    const salida = await extraer({
      conexionId: CONEXION,
      destino: DESTINO,
      plan: { pasos: [paso({ sePuede: false, motivo: 'No hay tabla.' })] },
    })

    expect(salida.hechos[0]).toMatchObject({ omitido: true, motivo: 'No hay tabla.' })
    expect(fetchMasterRows).not.toHaveBeenCalled()
  })

  // Perder una descarga de varios minutos porque una tabla accesoria dio error es inaceptable.
  it('un paso que falla no detiene a los demás', async () => {
    fetchMasterRows.mockImplementation((_conexionId, { entidad }) => (entidad === 'MALA'
      ? Promise.reject(new Error('SAP se cayó'))
      : Promise.resolve([{ SOURCEID: 'S1', PRDID: 'P1' }])))

    const salida = await extraer({
      conexionId: CONEXION,
      destino: DESTINO,
      plan: { pasos: [paso({ entidad: 'MALA' }), paso({ tabla: 'bom_psh' })] },
    })

    expect(salida).toMatchObject({ conError: 1, ok: false })
    expect(salida.hechos[0].error).toMatch(/se cayó/)
    await expect(contar('bom_psh')).resolves.toBe(1)
  })

  // Una descarga de seis minutos sin señales de vida se lee como un cuelgue.
  it('informa el avance por página', async () => {
    conFilas(FILAS_POR_PAGINA + 10)
    const avisos = []
    await extraer({
      conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] }, onProgreso: (uno) => avisos.push(uno),
    })

    expect(avisos.length).toBe(2)
    expect(avisos[0]).toMatchObject({ tabla: 'bom_psi', etiqueta: 'Componentes' })
    expect(avisos[1].bajadas).toBe(FILAS_POR_PAGINA + 10)
  })

  it('se puede cancelar a mitad', async () => {
    conFilas(FILAS_POR_PAGINA * 3)
    let vueltas = 0
    const salida = await extraer({
      conexionId: CONEXION,
      destino: DESTINO,
      plan: { pasos: [paso()] },
      cancelado: () => { vueltas += 1; return vueltas > 2 },
    })

    expect(salida.ok).toBe(false)
    expect(salida.hechos[0].cancelado).toBe(true)
    expect(salida.guardadas).toBeLessThan(FILAS_POR_PAGINA * 3)
  })

  // Volver a bajar la misma tabla no puede dejar las filas viejas junto a las nuevas.
  it('vacía la tabla antes de rellenarla', async () => {
    conFilas(3)
    await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })
    await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })
    await expect(contar('bom_psi')).resolves.toBe(3)
  })

  it('al cambiar de tenant avisa de que se vació lo anterior', async () => {
    conFilas(1)
    await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })

    const salida = await extraer({ conexionId: 'c-2', destino: DESTINO, plan: { pasos: [paso()] } })
    expect(salida.seVacio).toBe(true)
  })

  it('una tabla vacía en SAP no es un error', async () => {
    conFilas(0)
    const salida = await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })
    expect(salida).toMatchObject({ guardadas: 0, ok: true })
  })
})
