import { describe, expect, it } from 'vitest'
import {
  ANCHO_MAXIMO,
  ANCHO_MINIMO,
  anchoDePaleta,
  claveDeFijados,
  guardarFijados,
  leerFijados,
  olvidarFijados,
  proyectosVisibles,
  tareasVisibles,
  textoDeTarea,
} from './paleta-tareas.js'

/** Un almacenamiento de mentira, con la forma del de verdad. */
function almacenFalso(inicial = {}) {
  const datos = { ...inicial }
  return {
    datos,
    getItem: (clave) => (clave in datos ? datos[clave] : null),
    setItem: (clave, valor) => { datos[clave] = String(valor) },
    removeItem: (clave) => { delete datos[clave] },
  }
}

const roto = {
  getItem: () => { throw new Error('bloqueado') },
  setItem: () => { throw new Error('bloqueado') },
  removeItem: () => { throw new Error('bloqueado') },
}

describe('anchoDePaleta', () => {
  it('suma lo arrastrado', () => {
    expect(anchoDePaleta(210, 40)).toBe(250)
    expect(anchoDePaleta(210, -20)).toBe(190)
  })

  it('no baja de 160 ni sube de 520', () => {
    expect(anchoDePaleta(210, -500)).toBe(ANCHO_MINIMO)
    expect(anchoDePaleta(210, 900)).toBe(ANCHO_MAXIMO)
    expect([ANCHO_MINIMO, ANCHO_MAXIMO]).toEqual([160, 520])
  })
})

describe('fijados', () => {
  it('se recuerdan por destino', () => {
    expect(claveDeFijados('c1:sandbox')).toBe('ibp.cids.paleta-fijados.c1:sandbox')
    const almacen = almacenFalso()
    guardarFijados('c1:sandbox', new Set(['p1', 'p2']), almacen)
    expect([...leerFijados('c1:sandbox', almacen)]).toEqual(['p1', 'p2'])
    expect(leerFijados('c1:production', almacen).size).toBe(0)
  })

  it('lo guardado con basura se lee como vacío', () => {
    expect(leerFijados('x', almacenFalso({ [claveDeFijados('x')]: '{no es json' })).size).toBe(0)
    expect(leerFijados('x', almacenFalso({ [claveDeFijados('x')]: '{"a":1}' })).size).toBe(0)
  })

  it('olvidar los borra', () => {
    const almacen = almacenFalso()
    guardarFijados('x', new Set(['p1']), almacen)
    olvidarFijados('x', almacen)
    expect(leerFijados('x', almacen).size).toBe(0)
  })

  it('con el almacenamiento bloqueado nada lanza', () => {
    expect(leerFijados('x', roto).size).toBe(0)
    expect(() => guardarFijados('x', new Set(['p']), roto)).not.toThrow()
    expect(() => olvidarFijados('x', roto)).not.toThrow()
  })

  it('sin almacenamiento tampoco', () => {
    expect(leerFijados('x', null).size).toBe(0)
    expect(() => guardarFijados('x', new Set(), null)).not.toThrow()
  })
})

describe('proyectosVisibles', () => {
  const proyectos = [{ guid: 'a', name: 'Ventas' }, { guid: 'b', name: 'Compras' }, { guid: 'c', name: 'Stock' }]
  const base = { proyectos, tareas: {}, fijados: new Set(), soloFijados: false, busqueda: '' }
  const nombres = (lista) => lista.map((proyecto) => proyecto.name)

  it('sin filtros se ve todo', () => {
    expect(nombres(proyectosVisibles(base))).toEqual(['Ventas', 'Compras', 'Stock'])
  })

  it('el filtro de fijados deja solo los fijados', () => {
    expect(nombres(proyectosVisibles({ ...base, fijados: new Set(['b']), soloFijados: true }))).toEqual(['Compras'])
  })

  it('el filtro activo sin ningún fijado no vacía la lista', () => {
    expect(proyectosVisibles({ ...base, soloFijados: true })).toHaveLength(3)
  })

  it('la búsqueda encuentra por nombre de proyecto, sin distinguir mayúsculas', () => {
    expect(nombres(proyectosVisibles({ ...base, busqueda: ' VEN ' }))).toEqual(['Ventas'])
  })

  it('o por una tarea de un proyecto ya abierto', () => {
    const tareas = { c: [{ taskName: 'CARGA_DIARIA' }] }
    expect(nombres(proyectosVisibles({ ...base, tareas, busqueda: 'diaria' }))).toEqual(['Stock'])
  })

  it('se combinan: fijados Y búsqueda', () => {
    const fijados = new Set(['a', 'b'])
    expect(nombres(proyectosVisibles({ ...base, fijados, soloFijados: true, busqueda: 'stock' }))).toEqual([])
  })
})

describe('tareasVisibles y textoDeTarea', () => {
  const tareas = [{ taskName: 'CARGA_A' }, { taskName: 'EXTRAE_B' }]

  it('filtra por nombre', () => {
    expect(tareasVisibles(tareas, 'carga')).toEqual([tareas[0]])
    expect(tareasVisibles(tareas, '  ')).toEqual(tareas)
    expect(tareasVisibles(undefined, 'x')).toEqual([])
  })

  it('el texto lleva el nombre y, si hay, la descripción debajo', () => {
    expect(textoDeTarea({ taskName: 'T', description: '  Carga ventas ' })).toBe('T\n\nCarga ventas')
    expect(textoDeTarea({ taskName: 'T' })).toBe('T')
    expect(textoDeTarea({ taskName: 'T', description: '   ' })).toBe('T')
  })
})
