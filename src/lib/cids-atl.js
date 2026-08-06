// Leer un archivo `.atl` de SAP Data Services: la orquestación de verdad.
//
// Portado de `public/legacy/js/docs.js` de v9. Un export de proyecto dice QUÉ hace cada dataflow;
// el ATL dice EN QUÉ ORDEN corren y cuáles van en paralelo. Es la única fuente de eso: no está en el
// XMI de las integraciones ni se puede deducir de las cadenas de datos.
//
// La estructura de un ATL: una `SESSION` que llama a varios `PLAN` en orden, y cada `PLAN` llama a
// sus `DATAFLOW`. Un plan marcado `PARALLEL BEGIN` los corre a la vez. Algunas sesiones no tienen
// planes y llaman a los dataflows directamente.
//
// Es un formato de texto plano, así que se lee línea por línea. No hay gramática publicada; lo que
// hay acá es lo que aparece en los ATL de los proyectos reales.

const CREAR_PLAN = /^CREATE\s+PLAN\s+(\S+)::'[^']*'\s*\(/
const CREAR_SESION = /^CREATE\s+SESSION\s+(\S+)::'[^']*'\s*\(/
const LLAMAR_PLAN = /^CALL\s+PLAN\s+(\S+)::'[^']*'/
const LLAMAR_DATAFLOW = /^CALL\s+DATAFLOW\s+(\S+)::'([^']*)'/
const NOMBRE_VISIBLE = /ALGUICOMMENT\(.*?"ui_display_name"='([^']*)'/
const VARIABLE_GLOBAL = /^\s*GLOBAL\s+(\$\S+)\s+(\S+)/
const VALOR_DE_VARIABLE = /"job_GV_(\$[^"]+)"='([^']*)'/g
const NOMBRE_DEL_TRABAJO = /"job_name"='([^']*)'/
const DESCRIPCION = /"Description"='([^']*)'/

/** Cómo se marca una integración que el ATL no menciona. */
export const SIN_GRUPO = 'Sin grupo ATL'

/**
 * Lee un ATL a `{ sessionName, description, variables, groups, globalDefaults }`.
 *
 * Cada grupo es un `PLAN` con sus dataflows y si corren en paralelo. Los dataflows que la sesión
 * llama sin pasar por un plan se juntan en un grupo sin nombre al final, en el orden de llamada.
 */
export function parseATL(texto) {
  const lineas = String(texto ?? '').split(/\r?\n/)

  const planes = {}
  const ordenDeGrupos = []
  const sueltos = []
  const variables = []
  const globalDefaults = {}

  let nombreDeSesion = ''
  let nombreVisibleDeSesion = ''
  let description = ''

  let planActual = null
  let enSesion = false
  let enCuerpoDeSesion = false
  let enDeclaraciones = false
  // El nombre visible viene en la línea ANTERIOR a la llamada, así que hay que retenerlo.
  let visiblePendiente = ''

  for (const cruda of lineas) {
    const linea = cruda.trim()

    const plan = linea.match(CREAR_PLAN)
    if (plan) {
      planActual = plan[1]
      planes[planActual] = { displayName: '', parallel: false, dataflows: [] }
      enSesion = false
      continue
    }

    const sesion = linea.match(CREAR_SESION)
    if (sesion) {
      nombreDeSesion = sesion[1]
      planActual = null
      enSesion = true
      enDeclaraciones = false
      enCuerpoDeSesion = false
      continue
    }

    if (planActual && planes[planActual]) {
      if (/PARALLEL\s+BEGIN/.test(linea)) { planes[planActual].parallel = true; continue }

      const visible = linea.match(NOMBRE_VISIBLE)
      if (visible) { visiblePendiente = visible[1]; continue }

      const dataflow = linea.match(LLAMAR_DATAFLOW)
      if (dataflow) {
        planes[planActual].dataflows.push({
          fullName: dataflow[1],
          guid: dataflow[2] || '',
          // Sin nombre visible se usa el último tramo del nombre técnico, que es lo más parecido.
          displayName: visiblePendiente || dataflow[1].split('_').pop(),
        })
        visiblePendiente = ''
        continue
      }
    }

    if (enSesion) {
      if (/^\s*DECLARE\b/.test(linea)) { enDeclaraciones = true; continue }

      if (enDeclaraciones && !enCuerpoDeSesion) {
        const global = linea.match(VARIABLE_GLOBAL)
        if (global) { variables.push({ name: global[1], type: global[2] }); continue }
        // Sin `continue`: el BEGIN que cierra las declaraciones se maneja abajo.
      }

      // El primer BEGIN abre el cuerpo, haya habido DECLARE o no: hay sesiones sin variables.
      if (!enCuerpoDeSesion && /^BEGIN\b/.test(linea)) {
        enDeclaraciones = false
        enCuerpoDeSesion = true
        continue
      }

      if (enCuerpoDeSesion) {
        const visible = linea.match(NOMBRE_VISIBLE)
        if (visible) { visiblePendiente = visible[1]; continue }

        const plan2 = linea.match(LLAMAR_PLAN)
        if (plan2) {
          ordenDeGrupos.push(plan2[1])
          if (planes[plan2[1]]) planes[plan2[1]].displayName = visiblePendiente || ''
          visiblePendiente = ''
          continue
        }

        const dataflow = linea.match(LLAMAR_DATAFLOW)
        if (dataflow) {
          sueltos.push({
            fullName: dataflow[1],
            guid: dataflow[2] || '',
            displayName: visiblePendiente || dataflow[1],
          })
          visiblePendiente = ''
          continue
        }
      }
    }

    // Las propiedades del trabajo van sueltas al final del archivo, fuera de todo bloque.
    const trabajo = linea.match(NOMBRE_DEL_TRABAJO)
    if (trabajo) nombreVisibleDeSesion = trabajo[1]

    const desc = linea.match(DESCRIPCION)
    if (desc) description = desc[1]

    VALOR_DE_VARIABLE.lastIndex = 0
    let valor = VALOR_DE_VARIABLE.exec(linea)
    while (valor !== null) {
      globalDefaults[valor[1]] = valor[2]
      valor = VALOR_DE_VARIABLE.exec(linea)
    }
  }

  for (const variable of variables) variable.default = globalDefaults[variable.name] || ''

  const groups = ordenDeGrupos.map((nombre, i) => {
    const plan = planes[nombre] ?? { displayName: '', parallel: false, dataflows: [] }
    return {
      name: nombre,
      displayName: plan.displayName || `Grupo ${i + 1}`,
      parallel: plan.parallel,
      dataflows: plan.dataflows,
    }
  })

  if (sueltos.length > 0) {
    groups.push({ name: '', displayName: '', parallel: false, dataflows: sueltos })
  }

  return {
    sessionName: nombreVisibleDeSesion || nombreDeSesion,
    description,
    variables,
    groups,
    globalDefaults,
  }
}

/**
 * Empareja los dataflows del ATL con las integraciones leídas del ZIP.
 *
 * Se empareja por GUID, que es único y no puede dar un falso positivo. Si alguno de los dos lados no
 * lo trae, se cae al nombre visible; y si ese nombre corresponde a más de una integración, no se
 * empareja ninguna: adivinar cuál es sería peor que dejarla sin grupo.
 *
 * Devuelve TODAS las integraciones, en el orden del ATL primero y las que no aparecen al final,
 * marcadas como sin grupo. La lista tiene que quedar completa: una integración que el ATL no
 * menciona sigue existiendo y hay que documentarla.
 */
export function matchATLtoIntegrations(atl, integraciones) {
  const porGuid = {}
  const porNombre = {}

  for (const item of integraciones) {
    const guid = (item.parsed.dataflowGuid || '').trim()
    const nombre = (item.parsed.dataflowName || '').toUpperCase().trim()
    if (guid) porGuid[guid] = item
    if (nombre) (porNombre[nombre] ??= []).push(item)
  }

  const ordenadas = []
  const yaPuestas = new Set()
  const ambiguas = []

  for (const grupo of atl.groups) {
    for (const dataflow of grupo.dataflows) {
      let item = dataflow.guid ? porGuid[dataflow.guid] ?? null : null

      if (!item) {
        const candidatas = porNombre[dataflow.displayName.toUpperCase().trim()] ?? []
        if (candidatas.length === 1) [item] = candidatas
        else if (candidatas.length > 1) { ambiguas.push(dataflow.displayName); continue }
      }

      if (!item || yaPuestas.has(item.sheetName)) continue

      yaPuestas.add(item.sheetName)
      ordenadas.push({
        ...item,
        // Los planes suelen llamarse `FLOWof_<algo>`; ese prefijo no le dice nada a quien lee.
        atlGroup: (grupo.displayName || '').replace(/^FLOWof_/i, ''),
        atlSession: atl.sessionName,
        atlParallel: grupo.parallel,
        atlOrder: ordenadas.length + 1,
      })
    }
  }

  for (const item of integraciones) {
    if (yaPuestas.has(item.sheetName)) continue
    ordenadas.push({ ...item, atlGroup: SIN_GRUPO, atlSession: '', atlParallel: false, atlOrder: ordenadas.length + 1 })
  }

  return { ordenadas, ambiguas }
}
