import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('./ibp-master-data.js', () => ({ fetchMasterPage: vi.fn() }))

const { fetchMasterPage } = await import('./ibp-master-data.js')
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

/**
 * Sirve `n` filas repartidas en páginas del tamaño real. La ventana va en el SEGUNDO argumento.
 *
 * Devuelve el total cuando se pide, que es lo que hace SAP con `$inlinecount`: viaja con la primera
 * página y no cuesta otra petición.
 */
function conFilas(n, hacer = (i) => ({ SOURCEID: `S${i}`, PRDID: `P${i}` })) {
  fetchMasterPage.mockImplementation((_conexionId, { skip, top, conTotal }) => Promise.resolve({
    filas: Array.from({ length: Math.max(0, Math.min(top, n - skip)) }, (_, i) => hacer(skip + i)),
    total: conTotal ? n : null,
  }))
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
    expect(fetchMasterPage).toHaveBeenCalledTimes(2)
    expect(fetchMasterPage.mock.calls[1][1].skip).toBe(FILAS_POR_PAGINA)
  })

  // Sin orden estable, dos ventanas se solapan y dejan huecos: un hueco es un producto sin analizar.
  it('pide las páginas con un orden estable', async () => {
    conFilas(1)
    await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })
    expect(fetchMasterPage.mock.calls[0][1].orderby).toEqual(['SOURCEID', 'PRDID'])
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
    expect(fetchMasterPage).not.toHaveBeenCalled()
  })

  // Perder una descarga de varios minutos porque una tabla accesoria dio error es inaceptable.
  it('un paso que falla no detiene a los demás', async () => {
    fetchMasterPage.mockImplementation((_conexionId, { entidad }) => (entidad === 'MALA'
      ? Promise.reject(new Error('SAP se cayó'))
      : Promise.resolve({ filas: [{ SOURCEID: 'S1', PRDID: 'P1' }], total: 1 })))

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

// Lo que antes no se veía: «llegaron menos filas de las que pedí» y «la tabla se acabó» se leían
// igual, así que una respuesta recortada se presentaba como una descarga completa.
describe('cuando SAP no manda todo lo que dice tener', () => {
  it('una página corta no cierra la descarga si el total dice que falta', async () => {
    // SAP dice 7.000 filas y contesta de 1.000 en 1.000: con el criterio viejo se paraba en la
    // primera página y se guardaban 1.000 como si fueran todas.
    fetchMasterPage.mockImplementation((_conexionId, { skip, conTotal }) => Promise.resolve({
      filas: Array.from({ length: Math.max(0, Math.min(1000, 7000 - skip)) },
        (_, i) => ({ SOURCEID: `S${skip + i}`, PRDID: `P${skip + i}` })),
      total: conTotal ? 7000 : null,
    }))

    const salida = await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })

    expect(salida.guardadas).toBe(7000)
    expect(salida.hechos[0]).toMatchObject({ faltan: 0, enSap: 7000 })
    expect(salida.ok).toBe(true)
    await expect(contar('bom_psi')).resolves.toBe(7000)
  })

  it('si aun así faltan filas, lo dice en vez de darse por terminada', async () => {
    // Dice 500 y solo entrega 200, y después nada. No se puede hacer más que decirlo.
    fetchMasterPage.mockImplementation((_conexionId, { skip, conTotal }) => Promise.resolve({
      filas: skip === 0
        ? Array.from({ length: 200 }, (_, i) => ({ SOURCEID: `S${i}`, PRDID: `P${i}` }))
        : [],
      total: conTotal ? 500 : null,
    }))

    const salida = await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })

    expect(salida.hechos[0]).toMatchObject({ bajadas: 200, enSap: 500, faltan: 300 })
    expect(salida.incompletas).toBe(1)
    expect(salida.ok).toBe(false)
  })

  it('sin total, una página corta sigue cerrando la tabla', async () => {
    fetchMasterPage.mockImplementation((_conexionId, { skip }) => Promise.resolve({
      filas: skip === 0 ? [{ SOURCEID: 'S1', PRDID: 'P1' }] : [],
      total: null,
    }))

    const salida = await extraer({ conexionId: CONEXION, destino: DESTINO, plan: { pasos: [paso()] } })

    expect(salida).toMatchObject({ guardadas: 1, incompletas: 0, ok: true })
    expect(fetchMasterPage).toHaveBeenCalledTimes(1)
  })
})

// v7 ataba los componentes, la validez y los recursos a su cabecera: una receta descartada por
// `PINVALID` no deja sus piezas sueltas. Importa porque los analizadores recorren esas tablas
// enteras, y un componente de una receta muerta contaría como consumido.
describe('las filas atadas a su cabecera', () => {
  const CABECERA = paso({
    tabla: 'bom_psh',
    papel: 'header',
    etiqueta: 'Cabeceras',
    entidad: 'GIDPRODUCTIONSOURCEHDR',
    select: ['SOURCEID', 'PRDID', 'PINVALID'],
    descartarSi: 'PINVALID',
  })

  const COMPONENTES = paso({ atadoA: { tabla: 'bom_psh', campo: 'SOURCEID' } })

  it('solo se guardan las de una cabecera que sobrevivió', async () => {
    fetchMasterPage.mockImplementation((_conexionId, { entidad, skip, conTotal }) => {
      const filas = skip > 0 ? [] : (entidad === 'GIDPRODUCTIONSOURCEHDR'
        // S2 está marcada como inválida, así que su cabecera no se guarda.
        ? [
          { SOURCEID: 'S1', PRDID: 'P1', PINVALID: '' },
          { SOURCEID: 'S2', PRDID: 'P2', PINVALID: 'X' },
        ]
        : [
          { SOURCEID: 'S1', PRDID: 'C1' },
          { SOURCEID: 'S2', PRDID: 'C2' },
          { SOURCEID: 'S9', PRDID: 'C9' },
        ])
      return Promise.resolve({ filas, total: conTotal ? filas.length : null })
    })

    const salida = await extraer({
      conexionId: CONEXION, destino: DESTINO, plan: { pasos: [CABECERA, COMPONENTES] },
    })

    // De los tres componentes queda uno: el de S1. El de S2 cuelga de una receta inválida y el de
    // S9 de una que no existe.
    expect(salida.hechos[1]).toMatchObject({ bajadas: 3, guardadas: 1 })
    await expect(contar('bom_psi')).resolves.toBe(1)
  })

  it('si la cabecera no se bajó entera, el paso atado se salta', async () => {
    // La cabecera queda incompleta: dice 900 y entrega 100. Con claves a medias, el filtro tiraría
    // componentes buenos, y una tabla a la que le faltan filas buenas se lee igual que una completa.
    fetchMasterPage.mockImplementation((_conexionId, { entidad, skip, conTotal }) => {
      if (entidad === 'GIDPRODUCTIONSOURCEHDR') {
        return Promise.resolve({
          filas: skip === 0
            ? Array.from({ length: 100 }, (_, i) => ({ SOURCEID: `S${i}`, PRDID: `P${i}`, PINVALID: '' }))
            : [],
          total: conTotal ? 900 : null,
        })
      }
      return Promise.resolve({ filas: [{ SOURCEID: 'S1', PRDID: 'C1' }], total: conTotal ? 1 : null })
    })

    const salida = await extraer({
      conexionId: CONEXION, destino: DESTINO, plan: { pasos: [CABECERA, COMPONENTES] },
    })

    expect(salida.hechos[1]).toMatchObject({ omitido: true })
    expect(salida.hechos[1].motivo).toMatch(/no se pudo bajar entera/i)
    await expect(contar('bom_psi')).resolves.toBe(0)
  })
})
