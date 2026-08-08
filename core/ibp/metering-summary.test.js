import { describe, it, expect } from 'vitest'

import {
  actividadPorDia,
  aSegundos,
  contarPor,
  diaDe,
  distintos,
  escribirDuracion,
  nombresDeUsuario,
  resumirConsumo,
} from './metering-summary.js'

describe('diaDe', () => {
  it('se queda con la fecha de una marca ISO', () => {
    expect(diaDe('2026-08-06T14:03:02.855Z')).toBe('2026-08-06')
  })

  it('lo que no es una marca no tiene día', () => {
    expect(diaDe('ayer')).toBe('')
    expect(diaDe(undefined)).toBe('')
  })
})

describe('aSegundos', () => {
  // El complemento de Excel manda milisegundos; sin mirar la unidad, 23.330 serían seis horas y media.
  it('convierte según la unidad que viene al lado', () => {
    expect(aSegundos(23330, 'MSE')).toBe(23.33)
    expect(aSegundos(2, 'MIN')).toBe(120)
    expect(aSegundos(45, 'S')).toBe(45)
  })

  it('sin unidad se entiende en segundos', () => {
    expect(aSegundos(45)).toBe(45)
  })

  it('lo que no es un número vale cero', () => {
    expect(aSegundos('largo', 'S')).toBe(0)
  })
})

describe('escribirDuracion', () => {
  it('elige la escala según el tamaño', () => {
    expect(escribirDuracion(45)).toBe('45 s')
    expect(escribirDuracion(600)).toBe('10 min')
    expect(escribirDuracion(3600)).toBe('1 h')
    expect(escribirDuracion(5400)).toBe('1 h 30 min')
  })
})

describe('contarPor', () => {
  const filas = [{ a: 'x', n: 2 }, { a: 'y', n: 5 }, { a: 'x', n: 1 }, { a: '', n: 9 }]

  it('cuenta filas y ordena de mayor a menor', () => {
    expect(contarPor(filas, 'a')).toEqual([{ nombre: 'x', total: 2 }, { nombre: 'y', total: 1 }])
  })

  it('puede sumar un campo en vez de contar', () => {
    expect(contarPor(filas, 'a', { cuanto: (f) => f.n })).toEqual([
      { nombre: 'y', total: 5 }, { nombre: 'x', total: 3 },
    ])
  })

  // Una clave vacía no es un grupo: sería una fila "—" que se lleva medio ranking.
  it('las filas sin clave no cuentan', () => {
    expect(contarPor(filas, 'a').map((una) => una.nombre)).not.toContain('')
  })

  it('a igualdad de total desempata por nombre, para que el orden no baile', () => {
    expect(contarPor([{ a: 'b' }, { a: 'a' }], 'a').map((una) => una.nombre)).toEqual(['a', 'b'])
  })
})

describe('distintos', () => {
  it('cuenta valores únicos y descarta los vacíos', () => {
    expect(distintos([{ u: 'a' }, { u: 'a' }, { u: 'b' }, { u: '' }], 'u')).toBe(2)
  })
})

describe('actividadPorDia', () => {
  const filas = [
    { Timestamp: '2026-08-01T10:00:00Z' },
    { Timestamp: '2026-08-01T11:00:00Z' },
    { Timestamp: '2026-08-03T09:00:00Z' },
  ]

  // Sin los días vacíos, la serie salta del 1 al 3 y se lee como dos días seguidos de uso.
  it('rellena los días sin actividad', () => {
    expect(actividadPorDia(filas, { desde: '2026-08-01', hasta: '2026-08-03' })).toEqual([
      { dia: '2026-08-01', total: 2 },
      { dia: '2026-08-02', total: 0 },
      { dia: '2026-08-03', total: 1 },
    ])
  })

  it('sin rango se ajusta a lo que hay', () => {
    expect(actividadPorDia(filas)).toHaveLength(3)
  })

  it('usa el campo de fecha que se le diga', () => {
    const sesiones = [{ TimestampStart: '2026-08-01T10:00:00Z' }]
    expect(actividadPorDia(sesiones, { campo: 'TimestampStart' })).toEqual([{ dia: '2026-08-01', total: 1 }])
  })

  it('sin filas ni rango no hay serie', () => {
    expect(actividadPorDia([])).toEqual([])
  })
})

describe('nombresDeUsuario', () => {
  it('prefiere el nombre completo', () => {
    expect(nombresDeUsuario([{ UserID: 'U1', UserName: 'SINTEC10', FullName: 'Gustavo Parrilla' }]))
      .toEqual({ U1: 'Gustavo Parrilla' })
  })

  it('sin nombre se queda con el identificador', () => {
    expect(nombresDeUsuario([{ UserID: 'U1' }])).toEqual({ U1: 'U1' })
  })
})

describe('resumirConsumo', () => {
  const datos = {
    sesiones: [
      { UserID: 'U1', MeteringComponent: 'SCM-IBP-XLS-SRV', PlanningAreaID: 'AREA1', TimestampStart: '2026-08-01T10:00:00Z' },
      { UserID: 'U2', MeteringComponent: 'SCM-IBP-XLS-SRV', PlanningAreaID: 'AREA2', TimestampStart: '2026-08-01T11:00:00Z' },
    ],
    vistas: [
      { UserID: 'U1', PlanningAreaID: 'AREA1', TotalDuration: 10_000, DurationUnit: 'MSE', PlanningViewCells: 500, FavoriteName: 'Mi vista', Timestamp: '2026-08-01T10:00:00Z' },
      { UserID: 'U1', PlanningAreaID: 'AREA1', TotalDuration: 30_000, DurationUnit: 'MSE', PlanningViewCells: 900, TemplateName: 'Plantilla', Timestamp: '2026-08-01T12:00:00Z' },
    ],
    entradas: [{ UserID: 'U2', Timestamp: '2026-08-01T09:00:00Z' }],
    aplicaciones: [
      { UserID: 'U1', FioriProjectID: 'tl.ibp.excel.addin.logon', FioriProjectTitle: 'Excel', ActivityCount: 100, Timestamp: '2026-08-01T10:00:00Z' },
      { UserID: 'U3', FioriProjectID: 'tl.ibp.alerts', FioriProjectTitle: 'Alertas', ActivityCount: 7, Timestamp: '2026-08-01T10:00:00Z' },
    ],
    alertas: [],
    cifras: [{ KeyFigureID: 'ADJUSTEDPRODUCTION', KeyFigureCount: 104, UserID: 'U1' }],
    usuarios: [{ UserID: 'U1', FullName: 'Ana' }, { UserID: 'U2', FullName: 'Beto' }, { UserID: 'U9', FullName: 'Sin uso' }],
    componentes: [{ MeteringComponent: 'SCM-IBP-XLS-SRV', MeteringComponentText: 'Excel Add-In' }],
  }

  const salida = resumirConsumo(datos, { desde: '2026-08-01T00:00:00Z', hasta: '2026-08-02T00:00:00Z' })

  // Quien solo abrió una aplicación web no aparece en las sesiones de Excel; contarlo allí lo dejaría fuera.
  it('los usuarios activos salen de todos los conjuntos', () => {
    expect(salida.kpis.usuariosActivos).toBe(3)
    expect(salida.kpis.usuariosDelTenant).toBe(3)
  })

  // Si el complemento entra en el ranking se lo come entero y esconde qué aplicaciones web se miran.
  it('el complemento de Excel no compite con las aplicaciones', () => {
    expect(salida.porAplicacion).toEqual([{ nombre: 'Alertas', total: 7 }])
    expect(salida.kpis.accionesEnAplicaciones).toBe(7)
    expect(salida.accionesDelComplemento).toBe(100)
  })

  it('las duraciones se suman en segundos, no en milisegundos', () => {
    expect(salida.kpis.segundosEnVistas).toBe(40)
    expect(salida.kpis.duracionMediaDeVista).toBe(20)
  })

  it('traduce los códigos de componente a su texto', () => {
    expect(salida.porComponente).toEqual([{ nombre: 'Excel Add-In', total: 2 }])
  })

  it('traduce los identificadores de usuario a su nombre', () => {
    expect(salida.porUsuario[0]).toEqual({ nombre: 'Ana', total: 2 })
  })

  it('las vistas más lentas salen ordenadas y con su etiqueta', () => {
    expect(salida.vistasMasLentas[0]).toMatchObject({ plantilla: 'Plantilla', segundos: 30, usuario: 'Ana' })
  })

  it('un tenant sin actividad no revienta', () => {
    const vacio = resumirConsumo({}, {})
    expect(vacio.kpis.usuariosActivos).toBe(0)
    expect(vacio.kpis.duracionMediaDeVista).toBeNull()
    expect(vacio.porAplicacion).toEqual([])
  })
})
