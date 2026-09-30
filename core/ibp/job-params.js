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
 * El número de ranura de las variables personalizadas (`P_VARN01`…`P_VARN15`, `P_VARV01`…), o 0.
 *
 * Una plantilla declara las quince ranuras aunque use tres. `P_VARNO` dice cuántas están activas, y
 * las demás se esconden: enseñar doce campos vacíos haría ilegible la pantalla.
 */
export function numeroDeRanura(base) {
  return /^P_VAR[NV]\d\d$/.test(base) ? Number.parseInt(base.slice(6), 10) : 0
}

/**
 * Etiquetas de los parámetros que SAP no nombra, para el diálogo «Ejecutar job».
 *
 * Portadas de `ScheduleModal.jsx` de v8 TAL CUAL, en inglés: son los nombres que SAP IBP pone a esos
 * campos en su propia pantalla, y es como los reconoce quien configuró la plantilla. Traducirlas
 * obligaría a adivinar a qué campo de IBP corresponde cada una. Cuando la plantilla trae etiqueta
 * propia, esa gana.
 */
export const ETIQUETA_DE_PARAMETRO = Object.freeze({
  P_ALGO: 'Planning Algorithm', P_ATD: 'Available-to-Deploy Profile', P_CBP: 'CBP Profile',
  P_DATE: 'Date', P_FLTID: 'Planning Filter', P_OPER: 'Operator Mode',
  P_PLSCOP: 'Network/Subnetwork Selection', P_PRF: 'Planning Run Profile', P_PRM: 'Generate PRM Data',
  P_REFDAY: 'Planning Start', P_SCEN: 'Scenario', P_SIMVE: 'Version or Scenario',
  P_STR: 'Planning Direction', P_SUGF: 'Generate Supply Usage and Gating Factors',
  P_TAP: 'Time Aggregation Profile', P_TYPE: 'Planning Run Type', P_TZONE: 'Time Zone',
  P_VERS: 'Version', P_WDAY: 'Weekday', S_DISPO: 'MRP Controller', S_LOCNO: 'Location',
  S_MATNR: 'Product', S_SUBN: 'Subnetwork', P_ACT: 'Operation', P_AREA: 'Planning Area',
  P_COMM: 'Comment', P_CPDATE: 'Date', P_CPMETH: 'Define By', P_CPTIME: 'Time',
  P_CPTZ: 'Time Zone', P_FRPID: 'From Period', P_NOTES: 'Planning Notes',
  P_OPID: 'Operator Profile', P_OPNAME: 'Operator Name', P_OPTYP: 'Operator Type',
  P_PPROP: 'Time Horizon', P_PROFID: 'Copy Operator Profile ID', P_SHARE: 'Share With',
  P_TIMSEL: 'Use Time Selection from Profile', P_TOPID: 'To Period',
  P_VFROM: 'From Version', P_VTO: 'To Version', S_KEYFG: 'Key Figures',
  S_KF_GRP: 'Key Figure Groups', S_MD: 'Master Data', S_RCODE: 'Reason Code',
  P_ATTFCS: 'Target Attribute', P_FM: 'Forecast Model', P_PL: 'Planning Level',
  P_SCMTP: 'S&OP Time Profile Level', S_VERS: 'Version',
  P_CMD: 'Batch Command', P_PRES: 'Preview', P_SIMU: 'Simulation Mode',
  P_RULE: 'Rule ID', P_SCNID: 'Scenario', P_PLAREA: 'Planning Area',
  // Parámetros de integración con CI-DS / HCI
  P_AGTGP: 'Agent Group', P_AGTNM: 'Agent Name', P_ORGNM: 'Organization Name',
  P_ISPRD: 'Production', P_TSKID: 'Task Name', P_TSKDSC: 'Task Description',
  P_PROF: 'System Configuration', P_CHDUR: 'Status Check (Hours)',
  P_TEMPT: 'Template Type', P_FLTNM: 'Filter', P_AREANM: 'Planning Area',
  P_GCONF: 'Configuration', P_URCTX: 'URL Context',
})

/** Cómo se llama un parámetro para quien lo lee. */
export function etiquetaDeParametro(nombre, propias = {}) {
  const base = nombreBase(nombre)
  return propias[nombre] ?? ETIQUETA_DE_PARAMETRO[base] ?? base
}

/**
 * Las etiquetas del panel «Pasos del job», que en v8 eran OTRA tabla y no la del diálogo de lanzar.
 *
 * Portadas de `StepsPanel.jsx` de v8 tal cual. No se fusionan con las de arriba a propósito: algunas
 * difieren —`P_ATTFCS`, `P_AREANM`, `P_FLTNM`, `P_GCONF`, `P_URCTX`…— y fusionarlas cambiaría lo que
 * una de las dos pantallas mostraba. Aquí se busca por el nombre ENTERO del parámetro, no por el base:
 * así lo hacía v8.
 */
export const ETIQUETA_DE_PARAMETRO_DE_PASO = Object.freeze({
  // Planning Run (/IBP/RM_CONFIRMATION_RUN_V2 y obsoletos como /IBP/RM_PLANNING_RUN_CONST_V2)
  P_ALGO: 'Planning Algorithm',
  P_ATD: 'Available-to-Deploy Profile',
  P_CBP: 'CBP Profile',
  P_DATE: 'Date',
  P_FLTID: 'Planning Filter',
  P_OPER: 'Operator Mode',
  P_PLSCOP: 'Network/Subnetwork Selection',
  P_PRF: 'Planning Run Profile',
  P_PRM: 'Generate PRM Data',
  P_REFDAY: 'Planning Start',
  P_SCEN: 'Scenario',
  P_SIMVE: 'Version or Scenario',
  P_STR: 'Planning Direction',
  P_SUGF: 'Generate Supply Usage and Gating Factors',
  P_TAP: 'Time Aggregation Profile',
  P_TYPE: 'Planning Run Type',
  P_TZONE: 'Time Zone',
  P_VERS: 'Version',
  P_WDAY: 'Weekday',
  S_DISPO: 'MRP Controller',
  S_LOCNO: 'Location',
  S_MATNR: 'Product',
  S_SUBN: 'Subnetwork',
  // Operadores de copia y borrado (/IBP/OP_COPYVS, /IBP/OP_DELVS, /IBP/OP_DISAGG)
  P_ACT: 'Operation',
  P_AREA: 'Planning Area',
  P_COMM: 'Comment',
  P_CPDATE: 'Date',
  P_CPMETH: 'Define By',
  P_CPTIME: 'Time',
  P_CPTZ: 'Time Zone',
  P_FRPID: 'From Period',
  P_NOTES: 'Planning Notes',
  P_OPID: 'Operator Profile',
  P_OPNAME: 'Operator Name',
  P_OPTYP: 'Operator Type',
  P_PPROP: 'Time Horizon',
  P_PROFID: 'Copy Operator Profile ID',
  P_SHARE: 'Share With',
  P_TIMSEL: 'Use Time Selection from Profile',
  P_TOPID: 'To Period',
  P_VFROM: 'From Version',
  P_VTO: 'To Version',
  S_KEYFG: 'Key Figures',
  S_KF_GRP: 'Key Figure Groups',
  S_MD: 'Master Data',
  S_RCODE: 'Reason Code',
  // Pronóstico estadístico (/IBP/OP_FCST)
  P_ATTFCS: 'Target Attribute for Algorithm',
  P_FM: 'Forecast Model',
  P_PARPR: 'Parallelization & Packages Off',
  P_PL: 'Planning Level',
  P_TPER: 'Time Profile Level',
  S_ATTR: 'Calculation Level',
  // Operador de S&OP (/IBP/OP_SCM)
  P_SCMTP: 'S&OP Time Profile Level',
  S_PL_UNT: 'Subnetwork',
  S_SIMUL: 'Scenario',
  S_VERS: 'Version',
  // Integración de datos (/IBP/HCI_DI)
  P_AGTGP: 'Agent Group',
  P_AGTNM: 'Agent Name',
  P_AREANM: 'Planning Area Description',
  P_CHDUR: 'Status Check (hours)',
  P_FLTNM: 'Filter Description',
  P_GCONF: 'Use Default Values',
  P_ISPRD: 'Production',
  P_ORGNM: 'Organization Name',
  P_PROF: 'System Configuration',
  P_TEMPT: 'Template Type',
  P_TSKDSC: 'Task Description',
  P_TSKID: 'Task Name',
  P_URCTX: 'User Restrictions',
  // Atributos y valores (OP_DISAGG, OP_FCST)
  P_ATTR1: 'Attribute 1',
  P_ATTR2: 'Attribute 2',
  P_ATTR3: 'Attribute 3',
  P_VAL1: 'Attribute Value 1',
  P_VAL2: 'Attribute Value 2',
  P_VAL3: 'Attribute Value 3',
  // Otros estándar de IBP
  P_PTGUID: 'Planning Area (GUID)',
  P_VRSIO: 'Version',
  P_PSTEP: 'Planning Step',
  P_SCENAR: 'Scenario',
  P_SIMVER: 'Sim. Version',
  P_HORIZF: 'Horizon From',
  P_HORIZT: 'Horizon To',
  P_DATFR: 'Date From',
  P_DATTO: 'Date To',
  P_USERS: 'Users',
  P_USGRP: 'User Group',
  P_USERID: 'User ID',
  P_JOBNAM: 'Job Name',
  P_JOBCNT: 'Job Count',
  P_RUNMOD: 'Run Mode',
  P_TESTM: 'Test Mode',
  P_KEYFIG: 'Key Figure',
  S_KYFGR: 'Key Figure Range',
})

/** Cómo se llama un parámetro en el panel de pasos cuando su plantilla no trae etiqueta. */
export const etiquetaDeParametroDePaso = (nombre) => ETIQUETA_DE_PARAMETRO_DE_PASO[nombre] ?? nombre

/**
 * Cómo se escribe cada operador de una selección (`Option` de `JobParamValuesStructGet`).
 *
 * El `EQ` no se escribe: un parámetro igual a un valor se lee mejor sin el «=» delante.
 */
export const OPERADOR_DE_SELECCION = Object.freeze({
  EQ: '=', NE: '≠', LT: '<', LE: '≤', GT: '>', GE: '≥', BT: '…', CP: '~',
})

/** El orden de las secciones de parámetros, el mismo que usa la pantalla de SAP IBP. */
export const ORDEN_DE_SECCIONES = Object.freeze([
  'General', 'Control Parameters', 'Planning Start Settings', 'Planning Scope',
])

/**
 * A qué sección va cada parámetro cuando su plantilla no lo dice.
 *
 * De v8, que lo sacó de `JobTemplateParamGroupSet` y `JobTemplateParameterSet` de la plantilla
 * `/IBP/RM_CONFIRMATION_RUN_V2`. Se usa para las plantillas propias del cliente (`Z*`, `YY1_*`), que
 * no traen grupos en el servicio.
 */
export const SECCION_DE_PARAMETRO = Object.freeze({
  // General
  P_ALGO: 'General',
  P_AREA: 'General',
  P_OPER: 'General',
  P_SCEN: 'General',
  P_SIMVE: 'General',
  P_TYPE: 'General',
  P_VERS: 'General',
  // Control Parameters
  P_ATD: 'Control Parameters',
  P_CBP: 'Control Parameters',
  P_CLMD: 'Control Parameters',
  P_LOG: 'Control Parameters',
  P_PRF: 'Control Parameters',
  P_PRM: 'Control Parameters',
  P_STR: 'Control Parameters',
  P_SUGF: 'Control Parameters',
  P_TAP: 'Control Parameters',
  S_VERS: 'Control Parameters',
  // Planning Start Settings
  P_DATE: 'Planning Start Settings',
  P_REFDAY: 'Planning Start Settings',
  P_TZONE: 'Planning Start Settings',
  P_WDAY: 'Planning Start Settings',
  // Planning Scope
  P_FLTID: 'Planning Scope',
  P_PLSCOP: 'Planning Scope',
  S_DISPO: 'Planning Scope',
  S_LOCNO: 'Planning Scope',
  S_MATNR: 'Planning Scope',
  S_SUBN: 'Planning Scope',
})

/**
 * Lo que se sabe de un tipo de paso cuando su plantilla no dice nada: sin filtrar parámetros, sin
 * orden propio y con las secciones de respaldo.
 */
export const metaSinDatos = () => ({
  hasData: false,
  visibleParams: null,
  paramOrder: [],
  groupMap: { ...SECCION_DE_PARAMETRO },
  labelMap: {},
})

/**
 * Qué parámetros de un tipo de paso se muestran, en qué orden, con qué etiqueta y en qué sección.
 *
 * Portado de `loadAllTemplateMeta` de `StepsPanel.jsx` de v8. Junta tres lecturas de SAP sobre el
 * catálogo del paso (`JobCatalogEntryName`):
 *
 *   - `plantilla`: la respuesta de `JobTemplateRead`, con la etiqueta y la marca de oculto de cada
 *     parámetro en el JSON de `TemplateData`. De su PRIMERA secuencia, como en v8.
 *   - `parametros`: las filas de `JobTemplateParameterSet`, que dicen a qué grupo va cada uno.
 *   - `grupos`: las filas de `JobTemplateParamGroupSet`, con el texto de cada grupo.
 *
 * Si ni la plantilla ni los parámetros traen nada —plantillas propias del cliente—, se devuelve el
 * respaldo: no se filtra nada y las secciones salen de la tabla fija.
 */
export function metaDeCatalogo({ plantilla, parametros = [], grupos = [] } = {}) {
  let deLaPlantilla = []
  try {
    const dentro = JSON.parse(plantilla?.d?.TemplateData ?? plantilla?.TemplateData ?? 'null')
    deLaPlantilla = dentro?.templates?.[0]?.sequences?.[0]?.seq_param_val ?? []
  } catch { /* JSON inválido: se queda sin parámetros de la plantilla */ }

  if (!deLaPlantilla.length && !parametros.length) return metaSinDatos()

  const labelMap = {}
  const ocultos = new Set()
  for (const uno of deLaPlantilla) {
    if (uno.label) labelMap[uno.name] = uno.label
    if (uno.hidden === true) ocultos.add(uno.name)
  }

  const textoDeGrupo = {}
  for (const grupo of grupos) textoDeGrupo[grupo.JobTemplateParamGroupName] = grupo.JobTemplateParamGroupText

  const grupoDeParametro = {}
  for (const uno of parametros) grupoDeParametro[uno.JobTemplateParameterName] = uno.JobTemplateParamGroupName

  // El orden es el de la plantilla si lo hay; si no, el de `JobTemplateParameterSet`. En los dos
  // casos sin los ocultos.
  const ordenados = deLaPlantilla.length
    ? deLaPlantilla.filter((uno) => !ocultos.has(uno.name)).map((uno) => uno.name)
    : parametros.filter((uno) => uno.JobTempParamHiddenInd !== 'X').map((uno) => uno.JobTemplateParameterName)

  const groupMap = {}
  for (const nombre of ordenados) {
    const texto = textoDeGrupo[grupoDeParametro[nombre]]
    if (texto) groupMap[nombre] = texto
  }

  return { hasData: true, visibleParams: [...new Set(ordenados)], paramOrder: ordenados, groupMap, labelMap }
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
