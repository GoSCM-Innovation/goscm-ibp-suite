// Cómo se lee la configuración de una plantilla de trabajo.
//
// Separado de `job-schedule.js` —que es quien consulta— porque no depende de NADA y lo necesitan los
// dos lados: el servidor, que arma los pasos, y el navegador, que decide qué parámetro tiene valor.
//
// Importarlo desde `job-schedule.js` arrastraría `sapFetch` y con él `node:dns` al paquete del
// navegador, que es exactamente lo que rompe la pantalla. Ya pasó una vez con `target-entity.js`.

/**
 * El nombre base de un parámetro.
 *
 * SAP le pega un sufijo a los nombres para distinguir instancias dentro de una plantilla, pero el
 * nombre real son los primeros ocho caracteres. De v8.
 */
export const nombreBase = (nombre) => String(nombre ?? '').slice(0, 8).trimEnd()

/**
 * El número de ranura de las variables personalizadas (`P_VARN01`…`P_VARN15`), o 0.
 *
 * Una plantilla declara las quince ranuras aunque use tres. `P_VARNO` dice cuántas están activas, y
 * las demás se esconden: enseñar doce campos vacíos haría ilegible la pantalla.
 */
export function numeroDeRanura(base) {
  return /^P_VAR[NV]\d\d$/.test(base) ? Number.parseInt(base.slice(6), 10) : 0
}

/**
 * Etiquetas de los parámetros que SAP no nombra.
 *
 * Portadas de v8 tal cual. Sin ellas, la pantalla muestra `P_FLTID` donde debería decir "Filtro de
 * planificación". Cuando la plantilla trae etiqueta propia, esa gana.
 */
export const ETIQUETA_DE_PARAMETRO = Object.freeze({
  P_ALGO: 'Algoritmo de planificación', P_ATD: 'Perfil de disponible para desplegar',
  P_CBP: 'Perfil CBP', P_DATE: 'Fecha', P_FLTID: 'Filtro de planificación',
  P_OPER: 'Modo del operador', P_PLSCOP: 'Selección de red o subred',
  P_PRF: 'Perfil de ejecución', P_PRM: 'Generar datos PRM', P_REFDAY: 'Inicio de la planificación',
  P_SCEN: 'Escenario', P_SIMVE: 'Versión o escenario', P_STR: 'Dirección de la planificación',
  P_SUGF: 'Generar factores de uso y limitantes', P_TAP: 'Perfil de agregación temporal',
  P_TYPE: 'Tipo de ejecución', P_TZONE: 'Zona horaria', P_VERS: 'Versión', P_WDAY: 'Día de la semana',
  S_DISPO: 'Responsable de MRP', S_LOCNO: 'Ubicación', S_MATNR: 'Producto', S_SUBN: 'Subred',
  P_ACT: 'Operación', P_AREA: 'Área de planificación', P_COMM: 'Comentario', P_CPDATE: 'Fecha',
  P_CPMETH: 'Definir por', P_CPTIME: 'Hora', P_CPTZ: 'Zona horaria', P_FRPID: 'Desde período',
  P_NOTES: 'Notas de planificación', P_OPID: 'Perfil del operador', P_OPNAME: 'Nombre del operador',
  P_OPTYP: 'Tipo de operador', P_PPROP: 'Horizonte temporal', P_PROFID: 'Perfil de copia',
  P_SHARE: 'Compartir con', P_TIMSEL: 'Usar la selección temporal del perfil',
  P_TOPID: 'Hasta período', P_VFROM: 'Desde versión', P_VTO: 'Hasta versión',
  S_KEYFG: 'Key figures', S_KF_GRP: 'Grupos de key figures', S_MD: 'Dato maestro',
  S_RCODE: 'Motivo', P_ATTFCS: 'Atributo objetivo', P_FM: 'Modelo de pronóstico',
  P_PL: 'Nivel de planificación', P_SCMTP: 'Nivel del perfil temporal', S_VERS: 'Versión',
})

/** Cómo se llama un parámetro para quien lo lee. */
export function etiquetaDeParametro(nombre, propias = {}) {
  const base = nombreBase(nombre)
  return propias[nombre] ?? ETIQUETA_DE_PARAMETRO[base] ?? base
}

/**
 * ¿Este parámetro tiene un valor de verdad?
 *
 * `0` y `00000000` son ranuras vacías que SAP rellena, no valores. Distinguirlos es lo que permite
 * mostrar primero lo que está configurado.
 */
export function tieneValor(parametro, valores) {
  const suyos = valores[nombreBase(parametro.name)] ?? []
  if (parametro.isCheckbox) return suyos.includes('X')
  return suyos.some((uno) => uno !== '' && uno !== '0' && uno !== '00000000')
}

/** Los valores de una secuencia, indexados por nombre base. Cada uno puede tener varios. */
function valoresDeSecuencia(parametros) {
  const valores = {}
  for (const parametro of parametros) {
    valores[nombreBase(parametro.name)] = (parametro.value ?? [])
      .map((uno) => uno.low ?? '')
      .filter((uno) => uno !== '')
  }
  return valores
}

/**
 * Convierte una secuencia de la plantilla en un paso legible.
 *
 * Se esconden los parámetros marcados como ocultos y las ranuras de variable que no estén activas.
 */
export function pasoDesdeSecuencia(secuencia, posicion, { etiquetasDeGrupo = {}, textosDeCatalogo = {} } = {}) {
  const crudos = secuencia.seq_param_val ?? []
  const valores = valoresDeSecuencia(crudos)

  const etiquetasPropias = {}
  for (const uno of crudos) if (uno.label) etiquetasPropias[uno.name] = uno.label

  const ranurasActivas = Number.parseInt(valores.P_VARNO?.[0] ?? '0', 10) || 0

  const params = crudos
    .filter((uno) => uno.hidden !== true)
    .filter((uno) => {
      const ranura = numeroDeRanura(nombreBase(uno.name))
      return ranura === 0 || ranura <= ranurasActivas
    })
    .map((uno) => ({
      name: uno.name,
      label: etiquetaDeParametro(uno.name, etiquetasPropias),
      group: etiquetasDeGrupo[nombreBase(uno.name)] ?? null,
      isCheckbox: uno.check_box === true,
    }))

  return {
    posicion,
    catalogo: secuencia.basic_jce_name ?? '',
    titulo: textosDeCatalogo[secuencia.basic_jce_name] ?? secuencia.basic_jce_name ?? `Paso ${posicion}`,
    params,
    valores,
  }
}
