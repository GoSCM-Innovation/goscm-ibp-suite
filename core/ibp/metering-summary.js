// Las cuentas del consumo de un tenant: quién lo usó, con qué y cuánto.
//
// Portado de `Metering.jsx` de v8, que las hacía dentro del render. Aquí están aparte para poder
// probarlas y —sobre todo— para poder hacerlas en el servidor: el conjunto de actividad de las
// aplicaciones trae 15.623 filas en treinta días en un tenant mediano, y mandarlas al navegador para
// que las sume allí serían un par de megas por cada vez que alguien abre la pestaña.
//
// Sin dependencias: lo usan el servidor y las pruebas, y la pantalla importa las etiquetas.

/** Los rangos que ofrece la pantalla. */
export const RANGOS_DE_CONSUMO = Object.freeze([
  { dias: 7, label: '7 d' },
  { dias: 30, label: '30 d' },
  { dias: 90, label: '90 d' },
])

/**
 * Los complementos de Excel se cuentan aparte del resto de las aplicaciones.
 *
 * SAP mete la actividad del complemento en el mismo conjunto que las aplicaciones Fiori, con el
 * identificador empezando así. Mezclarlas hace que el complemento se coma el ranking —es de lejos lo
 * más usado— y esconda qué aplicaciones web mira la gente, que es lo que la pestaña quiere responder.
 */
export const PREFIJO_COMPLEMENTO_EXCEL = 'tl.ibp.excel.addin.'

/** "AAAA-MM-DD" de una marca ISO. Devuelve `''` si no se entiende. */
export function diaDe(iso) {
  const texto = String(iso ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : ''
}

/**
 * Los segundos de una duración de SAP, que llega con su unidad al lado.
 *
 * El complemento de Excel las manda en milisegundos y el resto en segundos; sin mirar la unidad, una
 * sesión de 23 segundos se leería como seis horas y media.
 */
export function aSegundos(valor, unidad = '') {
  const numero = Number(valor)
  if (!Number.isFinite(numero)) return 0

  switch (String(unidad).trim().toUpperCase()) {
    case 'MSE': case 'MS': case 'MILLISECOND': return numero / 1000
    case 'MIN': return numero * 60
    case 'H': case 'HR': return numero * 3600
    default: return numero
  }
}

/** Una duración en segundos escrita como la lee una persona. */
export function escribirDuracion(segundos) {
  const total = Math.max(0, Math.round(Number(segundos) || 0))
  if (total < 60) return `${total} s`

  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  if (horas === 0) return `${minutos} min`
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`
}

/** Agrupa por una clave y devuelve las cuentas ordenadas de mayor a menor. */
export function contarPor(filas, clave, { cuanto = () => 1 } = {}) {
  const cuentas = new Map()
  for (const fila of filas ?? []) {
    const valor = String(typeof clave === 'function' ? clave(fila) : fila[clave] ?? '').trim()
    if (!valor) continue
    cuentas.set(valor, (cuentas.get(valor) ?? 0) + (Number(cuanto(fila)) || 0))
  }

  return [...cuentas.entries()]
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre))
}

/** Cuántos valores distintos hay de una clave. */
export function distintos(filas, clave) {
  const vistos = new Set()
  for (const fila of filas ?? []) {
    const valor = String(fila[clave] ?? '').trim()
    if (valor) vistos.add(valor)
  }
  return vistos.size
}

/**
 * La actividad por día, con un punto por cada día del rango aunque no haya nada.
 *
 * Los días vacíos importan: una serie que salta del lunes al viernes se lee como cuatro días
 * seguidos de uso y no como un fin de semana sin nadie.
 */
export function actividadPorDia(filas, { campo = 'Timestamp', desde, hasta } = {}) {
  const cuentas = new Map()
  for (const fila of filas ?? []) {
    const dia = diaDe(fila[campo])
    if (dia) cuentas.set(dia, (cuentas.get(dia) ?? 0) + 1)
  }

  const primero = diaDe(desde) || [...cuentas.keys()].sort()[0]
  const ultimo = diaDe(hasta) || [...cuentas.keys()].sort().slice(-1)[0]
  if (!primero || !ultimo) return []

  const serie = []
  for (let t = Date.parse(`${primero}T00:00:00Z`); t <= Date.parse(`${ultimo}T00:00:00Z`); t += 86_400_000) {
    const dia = new Date(t).toISOString().slice(0, 10)
    serie.push({ dia, total: cuentas.get(dia) ?? 0 })
    if (serie.length > 400) break
  }
  return serie
}

/** El nombre legible de cada usuario, por su identificador técnico. */
export function nombresDeUsuario(usuarios) {
  return Object.fromEntries(
    (usuarios ?? []).map((uno) => [uno.UserID, uno.FullName || uno.UserName || uno.UserID]),
  )
}

/** El texto de cada componente de facturación, por su código. */
export function nombresDeComponente(componentes) {
  return Object.fromEntries(
    (componentes ?? []).map((uno) => [uno.MeteringComponent, uno.MeteringComponentText || uno.MeteringComponent]),
  )
}

/** Cambia los identificadores por nombres, dejando el identificador si no hay ninguno. */
export const conNombres = (cuentas, nombres) =>
  cuentas.map((una) => ({ ...una, nombre: nombres[una.nombre] || una.nombre }))

/** Los identificadores de usuario que aparecen en cualquiera de los conjuntos. */
export function usuariosConActividad(conjuntos) {
  const activos = new Set()
  for (const filas of conjuntos) {
    for (const fila of filas ?? []) if (fila?.UserID) activos.add(fila.UserID)
  }
  return activos
}

/**
 * Cómo le fue al complemento de Excel: cuántas vistas se abrieron y cuántas se cayeron.
 *
 * `SuccessfullyCompleted` es un booleano de verdad —46 de 863 en el tenant de pruebas—, así que la
 * tasa se puede calcular sin adivinar. Las duraciones vienen en milisegundos, de ahí `aSegundos`.
 */
export function exitoDeVistas(vistas, entradas = []) {
  const total = vistas.length
  const correctas = vistas.filter((una) => una.SuccessfullyCompleted).length
  const segundos = vistas.reduce((suma, una) => suma + aSegundos(una.TotalDuration, una.DurationUnit), 0)
  const deEntrada = entradas.reduce((suma, una) => suma + aSegundos(una.TotalDuration, una.DurationUnit), 0)

  return {
    total,
    correctas,
    fallidas: total - correctas,
    tasa: total > 0 ? Math.round((correctas / total) * 100) : null,
    celdas: vistas.reduce((suma, una) => suma + (Number(una.PlanningViewCells) || 0), 0),
    segundosMedios: total > 0 ? Math.round(segundos / total) : null,
    segundosMediosDeEntrada: entradas.length > 0 ? Math.round(deEntrada / entradas.length) : null,
  }
}

/** Qué hace la gente dentro de Excel, sin el prefijo técnico que SAP le cuelga a cada tipo. */
export function porTipoDeActividad(vistas) {
  return contarPor(vistas, (una) => String(una.ActivityType ?? '').replace(/^XLS_/, '').replace(/_/g, ' '))
}

/**
 * Cómo se comporta cada área: cuántas vistas, qué parte falla y cuánto tardan.
 *
 * La tasa de error por área es lo que en v8 disparaba un aviso, y sigue siendo la lectura útil: una
 * tasa global del 5 % puede esconder un área concreta al 40 %.
 */
export function rendimientoPorArea(vistas) {
  const areas = new Map()
  for (const una of vistas ?? []) {
    const area = String(una.PlanningAreaID ?? '').trim()
    if (!area) continue

    const acumulado = areas.get(area) ?? { nombre: area, vistas: 0, fallidas: 0, segundos: 0 }
    acumulado.vistas += 1
    if (!una.SuccessfullyCompleted) acumulado.fallidas += 1
    acumulado.segundos += aSegundos(una.TotalDuration, una.DurationUnit)
    areas.set(area, acumulado)
  }

  return [...areas.values()]
    .map((una) => ({
      nombre: una.nombre,
      vistas: una.vistas,
      fallidas: una.fallidas,
      tasaDeError: Math.round((una.fallidas / una.vistas) * 100),
      segundosMedios: Math.round(una.segundos / una.vistas),
    }))
    .sort((a, b) => b.vistas - a.vistas)
}

/**
 * Qué parte de los usuarios activos toca cada herramienta.
 *
 * Se mide en usuarios distintos y no en eventos a propósito: una herramienta que un solo usuario
 * aporrea mil veces no está adoptada, y contando eventos encabezaría la lista.
 */
export function adopcionPorHerramienta({ vistas = [], aplicaciones = [], alertas = [], tableros = [], historias = [] }, activos) {
  const deFiori = aplicaciones.filter((una) => !String(una.FioriProjectID ?? '').startsWith(PREFIJO_COMPLEMENTO_EXCEL))

  const porAplicacion = new Map()
  for (const una of deFiori) {
    const nombre = una.FioriProjectTitle || una.FioriProjectID
    if (!nombre) continue
    const acumulado = porAplicacion.get(nombre) ?? { nombre, usuarios: new Set(), eventos: 0 }
    if (una.UserID) acumulado.usuarios.add(una.UserID)
    acumulado.eventos += Number(una.ActivityCount) || 0
    porAplicacion.set(nombre, acumulado)
  }

  const bloques = [
    ['Complemento de Excel', vistas],
    ['Monitor de alertas', alertas],
    ['Tableros', tableros],
    ['Historias analíticas', historias],
  ]

  const filas = [
    ...bloques
      .filter(([, filas_]) => filas_.length > 0)
      .map(([nombre, filas_]) => ({ nombre, usuarios: distintos(filas_, 'UserID'), eventos: filas_.length })),
    ...[...porAplicacion.values()].map((una) => ({ nombre: una.nombre, usuarios: una.usuarios.size, eventos: una.eventos })),
  ]

  const total = activos instanceof Set ? activos.size : Number(activos) || 0
  return filas
    .map((una) => ({ ...una, tasa: total > 0 ? Math.round((una.usuarios / total) * 100) : null }))
    .sort((a, b) => b.usuarios - a.usuarios || b.eventos - a.eventos)
}

/** Cada usuario activo con cuánto hizo, cuándo fue la última vez y en qué áreas. */
export function detalleDeUsuarios({ sesiones = [], vistas = [], aplicaciones = [] }, nombres) {
  const gente = new Map()

  const anotar = (fila, campoDeFecha) => {
    if (!fila.UserID) return
    const uno = gente.get(fila.UserID) ?? { id: fila.UserID, eventos: 0, ultima: '', areas: new Set() }
    uno.eventos += 1

    const dia = diaDe(fila[campoDeFecha])
    if (dia > uno.ultima) uno.ultima = dia
    if (fila.PlanningAreaID) uno.areas.add(fila.PlanningAreaID)
    gente.set(fila.UserID, uno)
  }

  for (const fila of sesiones) anotar(fila, 'TimestampStart')
  for (const fila of [...vistas, ...aplicaciones]) anotar(fila, 'Timestamp')

  return [...gente.values()]
    .map((uno) => ({
      id: uno.id,
      nombre: nombres?.[uno.id] || uno.id,
      eventos: uno.eventos,
      ultima: uno.ultima || '—',
      areas: [...uno.areas].sort(),
    }))
    .sort((a, b) => b.eventos - a.eventos || a.nombre.localeCompare(b.nombre))
}

/** Los usuarios dados de alta que no aparecen en ningún conjunto del período. */
export function usuariosSinActividad(usuarios, activos) {
  return (usuarios ?? [])
    .filter((uno) => uno.UserID && !activos.has(uno.UserID))
    .map((uno) => ({
      id: uno.UserID,
      nombre: uno.FullName || [uno.FirstName, uno.LastName].filter(Boolean).join(' ') || uno.UserName || uno.UserID,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/** Cuántas vistas tiene que tener un área antes de que su tasa de error signifique algo. */
const MINIMO_PARA_AVISAR = 5

/** Cuánta parte de las vistas de un área puede fallar antes de que valga la pena decirlo. */
const ERROR_QUE_PREOCUPA = 30

/**
 * Lo que merece una mirada: licencias sin usar y áreas que fallan de más.
 *
 * Con un mínimo de vistas antes de avisar, porque un área con dos vistas y una fallida da el 50 % y
 * no dice nada; sin el mínimo, la pantalla avisaría de todo y nadie leería ninguno.
 */
export function avisosDeAtencion({ inactivos, porArea }) {
  const avisos = []

  if (inactivos.length > 0) {
    avisos.push({
      tipo: 'aviso',
      mensaje: inactivos.length === 1
        ? '1 usuario dado de alta no tuvo actividad en el período.'
        : `${inactivos.length} usuarios dados de alta no tuvieron actividad en el período.`,
    })
  }

  for (const area of porArea) {
    if (area.vistas >= MINIMO_PARA_AVISAR && area.tasaDeError > ERROR_QUE_PREOCUPA) {
      avisos.push({
        tipo: 'error',
        mensaje: `En ${area.nombre} falló el ${area.tasaDeError}% de las ${area.vistas} vistas de planificación.`,
      })
    }
  }

  return avisos
}

/**
 * Todo lo que la pestaña de consumo dibuja, a partir de lo que se leyó del tenant.
 *
 * Recibe los conjuntos crudos y devuelve unos pocos kB. Los rankings van cortados a `top` porque una
 * lista de 300 aplicaciones no se lee: lo que interesa es qué está arriba.
 */
export function resumirConsumo(datos, { desde, hasta, top = 10, conContexto = false } = {}) {
  const {
    sesiones = [], vistas = [], entradas = [], aplicaciones = [], alertas = [],
    cifras = [], usuarios = [], componentes = [], tableros = [], historias = [],
  } = datos ?? {}

  const nombreDeUsuario = nombresDeUsuario(usuarios)
  const nombreDeComponente = nombresDeComponente(componentes)

  const deExcel = aplicaciones.filter((una) => String(una.FioriProjectID ?? '').startsWith(PREFIJO_COMPLEMENTO_EXCEL))
  const deFiori = aplicaciones.filter((una) => !String(una.FioriProjectID ?? '').startsWith(PREFIJO_COMPLEMENTO_EXCEL))

  const segundosEnVistas = vistas.reduce((suma, una) => suma + aSegundos(una.TotalDuration, una.DurationUnit), 0)

  // Los usuarios activos se cuentan sobre TODOS los conjuntos: alguien que solo abrió una aplicación
  // web no aparece en las sesiones de Excel, y contarlo solo allí lo dejaría fuera.
  const activos = usuariosConActividad([sesiones, vistas, entradas, aplicaciones, alertas, cifras])

  const porAreaDetallado = rendimientoPorArea(vistas)

  // Con un filtro puesto, la adopción y los inactivos dejan de significar nada: mirando a una sola
  // persona, "1 de 35 usuarios activos" es un 3 % que no habla del tenant ni de ella, y la lista de
  // inactivos pasa a ser "todos menos esta". Se omiten en vez de mostrarlos mal.
  const inactivos = conContexto ? [] : usuariosSinActividad(usuarios, activos)

  return {
    adopcion: conContexto ? null : {
      activos: activos.size,
      licenciados: usuarios.length,
      tasa: usuarios.length > 0 ? Math.round((activos.size / usuarios.length) * 100) : null,
    },

    atencion: avisosDeAtencion({ inactivos, porArea: porAreaDetallado }),
    herramientas: adopcionPorHerramienta({ vistas, aplicaciones, alertas, tableros, historias }, activos),
    usuarios: detalleDeUsuarios({ sesiones, vistas, aplicaciones }, nombreDeUsuario).slice(0, 50),
    inactivos,

    excel: {
      ...exitoDeVistas(vistas, entradas),
      porTipo: porTipoDeActividad(vistas),
      porArea: porAreaDetallado.slice(0, top),
    },

    kpis: {
      usuariosActivos: activos.size,
      usuariosDelTenant: usuarios.length,
      sesiones: sesiones.length,
      vistasDePlanificacion: vistas.length,
      entradasAExcel: entradas.length,
      accionesEnAplicaciones: deFiori.reduce((suma, una) => suma + (Number(una.ActivityCount) || 0), 0),
      areasUsadas: distintos(sesiones.length > 0 ? sesiones : vistas, 'PlanningAreaID'),
      segundosEnVistas: Math.round(segundosEnVistas),
      duracionMediaDeVista: vistas.length > 0 ? Math.round(segundosEnVistas / vistas.length) : null,
      alertas: alertas.length,
    },

    porDia: actividadPorDia(vistas.length >= aplicaciones.length ? vistas : aplicaciones, { desde, hasta }),
    porDiaDeSesiones: actividadPorDia(sesiones, { campo: 'TimestampStart', desde, hasta }),

    porComponente: conNombres(contarPor(sesiones, 'MeteringComponent'), nombreDeComponente).slice(0, top),
    porArea: contarPor(sesiones.length > 0 ? sesiones : vistas, 'PlanningAreaID').slice(0, top),

    porUsuario: conNombres(
      contarPor([...vistas, ...entradas, ...deFiori], 'UserID'),
      nombreDeUsuario,
    ).slice(0, top),

    porAplicacion: contarPor(
      deFiori,
      (una) => una.FioriProjectTitle || una.FioriProjectID,
      { cuanto: (una) => Number(una.ActivityCount) || 0 },
    ).slice(0, top),

    porCifraClave: contarPor(cifras, 'KeyFigureID', { cuanto: (una) => Number(una.KeyFigureCount) || 0 }).slice(0, top),

    vistasMasLentas: [...vistas]
      .map((una) => ({
        area: una.PlanningAreaID || '—',
        usuario: nombreDeUsuario[una.UserID] || una.UserID,
        plantilla: una.FavoriteName || una.TemplateName || una.WorksheetName || '—',
        celdas: Number(una.PlanningViewCells) || 0,
        segundos: Math.round(aSegundos(una.TotalDuration, una.DurationUnit)),
      }))
      .sort((a, b) => b.segundos - a.segundos)
      .slice(0, top),

    accionesDelComplemento: deExcel.reduce((suma, una) => suma + (Number(una.ActivityCount) || 0), 0),
  }
}
