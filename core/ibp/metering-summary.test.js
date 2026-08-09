import { describe, it, expect } from 'vitest'

import {
  actividadPorDia,
  adopcionPorHerramienta,
  aSegundos,
  avisosDeAtencion,
  contarPor,
  detalleDeUsuarios,
  diaDe,
  distintos,
  escribirDuracion,
  exitoDeVistas,
  nombresDeUsuario,
  porTipoDeActividad,
  rendimientoPorArea,
  resumirConsumo,
  usuariosSinActividad,
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

  it('la adopción compara activos contra dados de alta', () => {
    expect(salida.adopcion).toEqual({ activos: 3, licenciados: 3, tasa: 100 })
  })

  // Mirando a una sola persona, "1 de 35 activos" es un 3 % que no habla ni del tenant ni de ella,
  // y la lista de inactivos pasa a ser "todos menos esta".
  it('con un filtro puesto no se devuelve adopción ni inactivos', () => {
    const acotado = resumirConsumo(datos, { conContexto: true })
    expect(acotado.adopcion).toBeNull()
    expect(acotado.inactivos).toEqual([])
    expect(acotado.atencion).toEqual([])
    // Lo que sí sigue valiendo se calcula igual.
    expect(acotado.kpis.vistasDePlanificacion).toBe(2)
  })

  it('un tenant sin actividad no revienta', () => {
    const vacio = resumirConsumo({}, {})
    expect(vacio.kpis.usuariosActivos).toBe(0)
    expect(vacio.kpis.duracionMediaDeVista).toBeNull()
    expect(vacio.porAplicacion).toEqual([])
    expect(vacio.adopcion.tasa).toBeNull()
    expect(vacio.atencion).toEqual([])
  })
})

describe('exitoDeVistas', () => {
  const vistas = [
    { SuccessfullyCompleted: true, TotalDuration: 10_000, DurationUnit: 'MSE', PlanningViewCells: 500 },
    { SuccessfullyCompleted: false, TotalDuration: 30_000, DurationUnit: 'MSE', PlanningViewCells: 100 },
  ]

  it('cuenta correctas, fallidas y la tasa', () => {
    expect(exitoDeVistas(vistas)).toMatchObject({ total: 2, correctas: 1, fallidas: 1, tasa: 50, celdas: 600 })
  })

  it('promedia la duración en segundos', () => {
    expect(exitoDeVistas(vistas).segundosMedios).toBe(20)
  })

  it('sin vistas no hay tasa que inventar', () => {
    expect(exitoDeVistas([])).toMatchObject({ total: 0, tasa: null, segundosMedios: null })
  })
})

describe('porTipoDeActividad', () => {
  // El nombre técnico no se lee; el prefijo lo pone SAP en todos por igual y no distingue nada.
  it('quita el prefijo y los guiones bajos', () => {
    expect(porTipoDeActividad([{ ActivityType: 'XLS_CHANGE_PLANNING_VIEW' }]))
      .toEqual([{ nombre: 'CHANGE PLANNING VIEW', total: 1 }])
  })
})

describe('rendimientoPorArea', () => {
  const vistas = [
    { PlanningAreaID: 'A', SuccessfullyCompleted: true, TotalDuration: 10, DurationUnit: 'S' },
    { PlanningAreaID: 'A', SuccessfullyCompleted: false, TotalDuration: 30, DurationUnit: 'S' },
    { PlanningAreaID: 'B', SuccessfullyCompleted: true, TotalDuration: 5, DurationUnit: 'S' },
  ]

  // Una tasa global del 5 % puede esconder un área concreta al 40 %.
  it('da la tasa de error y la duración media de cada área', () => {
    expect(rendimientoPorArea(vistas)[0]).toEqual({
      nombre: 'A', vistas: 2, fallidas: 1, tasaDeError: 50, segundosMedios: 20,
    })
  })

  it('ordena por volumen', () => {
    expect(rendimientoPorArea(vistas).map((una) => una.nombre)).toEqual(['A', 'B'])
  })
})

describe('adopcionPorHerramienta', () => {
  const conjuntos = {
    vistas: [{ UserID: 'U1' }, { UserID: 'U2' }],
    aplicaciones: [
      { UserID: 'U1', FioriProjectID: 'tl.ibp.excel.addin.logon', FioriProjectTitle: 'Excel', ActivityCount: 900 },
      { UserID: 'U3', FioriProjectID: 'tl.ibp.alerts', FioriProjectTitle: 'Alertas', ActivityCount: 7 },
    ],
    alertas: [],
  }

  // Una herramienta que un solo usuario aporrea mil veces no está adoptada.
  it('mide en usuarios distintos, no en eventos', () => {
    const filas = adopcionPorHerramienta(conjuntos, new Set(['U1', 'U2', 'U3', 'U4']))
    expect(filas[0]).toEqual({ nombre: 'Complemento de Excel', usuarios: 2, eventos: 2, tasa: 50 })
    expect(filas[1]).toEqual({ nombre: 'Alertas', usuarios: 1, eventos: 7, tasa: 25 })
  })

  it('las herramientas sin uso no ocupan una fila', () => {
    expect(adopcionPorHerramienta(conjuntos, new Set(['U1'])).map((una) => una.nombre))
      .not.toContain('Monitor de alertas')
  })
})

describe('detalleDeUsuarios', () => {
  const conjuntos = {
    sesiones: [{ UserID: 'U1', TimestampStart: '2026-08-01T10:00:00Z', PlanningAreaID: 'A' }],
    vistas: [
      { UserID: 'U1', Timestamp: '2026-08-05T10:00:00Z', PlanningAreaID: 'B' },
      { UserID: 'U2', Timestamp: '2026-08-02T10:00:00Z' },
    ],
    aplicaciones: [],
  }

  it('junta los conjuntos y se queda con la última fecha', () => {
    expect(detalleDeUsuarios(conjuntos, { U1: 'Ana' })[0])
      .toEqual({ id: 'U1', nombre: 'Ana', eventos: 2, ultima: '2026-08-05', areas: ['A', 'B'] })
  })

  it('sin área conocida la lista queda vacía, no con un hueco', () => {
    expect(detalleDeUsuarios(conjuntos, {}).find((uno) => uno.id === 'U2').areas).toEqual([])
  })
})

describe('usuariosSinActividad', () => {
  const usuarios = [{ UserID: 'U1', FullName: 'Ana' }, { UserID: 'U2', FirstName: 'Beto', LastName: 'Pérez' }]

  it('deja fuera a los que sí aparecieron', () => {
    expect(usuariosSinActividad(usuarios, new Set(['U1']))).toEqual([{ id: 'U2', nombre: 'Beto Pérez' }])
  })

  it('con todos activos no queda nadie', () => {
    expect(usuariosSinActividad(usuarios, new Set(['U1', 'U2']))).toEqual([])
  })
})

describe('avisosDeAtencion', () => {
  it('avisa de las licencias sin usar, en singular y en plural', () => {
    expect(avisosDeAtencion({ inactivos: [{ id: 'U1' }], porArea: [] })[0].mensaje).toMatch(/^1 usuario /)
    expect(avisosDeAtencion({ inactivos: [{ id: 'U1' }, { id: 'U2' }], porArea: [] })[0].mensaje).toMatch(/^2 usuarios /)
  })

  it('avisa de un área que falla de más', () => {
    const avisos = avisosDeAtencion({ inactivos: [], porArea: [{ nombre: 'A', vistas: 10, tasaDeError: 40 }] })
    expect(avisos).toEqual([{ tipo: 'error', mensaje: 'En A falló el 40% de las 10 vistas de planificación.' }])
  })

  // Un área con dos vistas y una fallida da el 50 % y no dice nada.
  it('con pocas vistas la tasa no significa nada y no se avisa', () => {
    expect(avisosDeAtencion({ inactivos: [], porArea: [{ nombre: 'A', vistas: 2, tasaDeError: 50 }] })).toEqual([])
  })

  it('un tenant sin nada que mirar no da avisos', () => {
    expect(avisosDeAtencion({ inactivos: [], porArea: [{ nombre: 'A', vistas: 100, tasaDeError: 2 }] })).toEqual([])
  })
})
