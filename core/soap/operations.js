// Las operaciones de SAP CI-DS: cómo se pide cada una y cómo se lee su respuesta.
//
// Portado de `api/soap.js` de v9 sin cambiar el comportamiento. Todo lo que hay aquí es
// conocimiento del servicio de SAP averiguado contra tenants reales: el orden exigido de los
// elementos, los nombres que cambian entre versiones, los prefijos que hay que quitar. No se
// toca sin comprobarlo contra un tenant.

import { escapeXml, xmlAll, xmlAttribute, xmlText, xmlValue } from './xml.js'

/**
 * Algunas operaciones se llaman de una forma en la petición y de otra en la acción SOAP.
 * Las que no están aquí usan `function=<nombre de la operación>`.
 */
const SOAP_ACTIONS = {
  getProjects: 'function=getAllProjects',
  getProjectTasks: 'function=getAllProjectTasks',
  getSystemConfigurations: 'function=getAllSystemConfigurations',
  getAgents: 'function=getAllAgents',
  logout: 'function=logoff',
}

/** Las operaciones que existen en dos versiones piden la 2.0 en la cabecera. */
const VERSION_2_OPERATIONS = new Set(['getAllExecutedTasks2', 'getTaskStatusByRunId2'])

/**
 * Hay tenants que solo publican los nombres antiguos. Cuando el nuevo no existe, se reintenta
 * automáticamente con el viejo en vez de dejar al usuario con un error incomprensible.
 */
const FALLBACKS = {
  getAllExecutedTasks2: 'getAllExecutedTasks',
  getTaskStatusByRunId2: 'getTaskStatusByRunId',
}

export function soapActionFor(operation) {
  return SOAP_ACTIONS[operation] ?? `function=${operation}`
}

export function versionFor(operation) {
  return VERSION_2_OPERATIONS.has(operation) ? '2.0' : null
}

export function fallbackFor(operation) {
  return FALLBACKS[operation] ?? null
}

/** Indica si el mensaje de error de SAP significa "esa operación no existe aquí". */
export function looksLikeUnknownOperation(text) {
  const lower = String(text).toLowerCase()
  return lower.includes('unknown operation')
    || lower.includes('not recognized')
    || lower.includes('invalid function')
}

export function buildBody(operation, params = {}) {
  const xe = escapeXml

  switch (operation) {
    case 'ping':
      return '<web:pingRequest/>'

    case 'logout':
      return `<web:logoutRequest><SessionID>${xe(params.sessionId)}</SessionID></web:logoutRequest>`

    case 'getProjects':
      return '<web:allProjectsRequest/>'

    case 'getProjectTasks':
      return `<web:allProjectTasksRequest><projectGuid>${xe(params.projectGuid)}</projectGuid></web:allProjectTasksRequest>`

    case 'searchTasks':
      return `<web:searchTasksRequest><nameFilter>${xe(params.nameFilter || '')}</nameFilter></web:searchTasksRequest>`

    case 'getTaskInfo':
      return `<web:taskInfoRequest><taskGuid>${xe(params.taskGuid)}</taskGuid></web:taskInfoRequest>`

    case 'getAgents':
      return `<web:allAgentsRequest><activeOnly>${params.activeOnly ? 'true' : 'false'}</activeOnly></web:allAgentsRequest>`

    case 'getSystemConfigurations':
      return '<web:allSystemConfigurationsRequest/>'

    case 'runTask': {
      const variables = (params.globalVariables || [])
        .map((v) => `<variable name="${xe(v.name)}">${xe(v.value)}</variable>`)
        .join('\n      ')
      return `<web:runTaskRequest>
        <taskName>${xe(params.taskName)}</taskName>
        <description>${xe(params.description || '')}</description>
        ${params.agentName ? `<agentName>${xe(params.agentName)}</agentName>` : ''}
        ${params.agentGroup ? `<agentGroup>${xe(params.agentGroup)}</agentGroup>` : ''}
        ${params.profileName ? `<profileName>${xe(params.profileName)}</profileName>` : ''}
        ${variables ? `<globalVariables>${variables}</globalVariables>` : ''}
      </web:runTaskRequest>`
    }

    case 'getTaskStatusByRunId2':
    case 'getTaskStatusByRunId':
      return `<web:taskStatusRequest><runId>${xe(params.runId)}</runId></web:taskStatusRequest>`

    case 'getAllExecutedTasks2':
    case 'getAllExecutedTasks': {
      const startDate = params.startDateFrom
        ? `<startDate><from>${xe(params.startDateFrom)}</from>${params.startDateTo ? `<to>${xe(params.startDateTo)}</to>` : ''}</startDate>`
        : ''
      const endDate = params.endDateFrom
        ? `<endDate><from>${xe(params.endDateFrom)}</from>${params.endDateTo ? `<to>${xe(params.endDateTo)}</to>` : ''}</endDate>`
        : ''
      return `<web:executedTaskFilterRequest>
        ${params.taskName ? `<taskName>${xe(params.taskName)}</taskName>` : ''}
        ${startDate}
        ${endDate}
        ${params.statusCode ? `<statusCode>${xe(params.statusCode)}</statusCode>` : ''}
      </web:executedTaskFilterRequest>`
    }

    case 'getTaskLogs': {
      const logBlock = (name, log) => (log?.getLog
        ? `<${name}><getLog>true</getLog><pageNum>${log.pageNum || 1}</pageNum></${name}>`
        : '')
      // El esquema de SAP exige EXACTAMENTE este orden de elementos: base64Encode, traceLog,
      // errorLog, runId, monitorLog. Cambiarlo hace que rechace la petición.
      return `<web:taskLogsRequest>
        <base64Encode>${params.base64Encode !== false ? 'true' : 'false'}</base64Encode>
        ${logBlock('traceLog', params.traceLog)}
        ${logBlock('errorLog', params.errorLog)}
        <runId>${xe(params.runId)}</runId>
        ${logBlock('monitorLog', params.monitorLog)}
      </web:taskLogsRequest>`
    }

    case 'cancelTask':
      return `<web:cancelTaskRequest><runId>${xe(params.runId)}</runId></web:cancelTaskRequest>`

    default:
      throw new Error(`Operación desconocida: ${operation}`)
  }
}

/** SAP prefija los códigos de estado con "TASK:". Se quita para no arrastrarlo por toda la app. */
const stripTaskPrefix = (value) => String(value || '').replace(/^TASK:/, '')

/**
 * Descodifica una línea de registro.
 *
 * SAP codifica cada línea por separado en base64, pero mete VARIAS líneas ya codificadas
 * dentro del mismo elemento, separadas por saltos. Hay que descodificar trozo a trozo: si se
 * juntaran primero, el relleno final de una línea quedaría en medio del texto y la detección
 * de base64 fallaría, devolviendo el bloque entero como texto ilegible.
 *
 * La descodificación es tolerante a propósito: una línea que ya viene en texto plano no pasa
 * la comprobación y sale tal cual.
 */
function decodeLogToken(part) {
  const clean = part.replace(/\s+/g, '')
  if (clean && /^[A-Za-z0-9+/]+=*$/.test(clean) && clean.length % 4 === 0) {
    try {
      const decoded = Buffer.from(clean, 'base64').toString('utf-8')
      if (decoded && !/�/.test(decoded)) return decoded
    } catch {
      // No era base64 de verdad: se devuelve el original.
    }
  }
  return part
}

function decodeLogLine(raw) {
  return xmlText(raw).split(/\r?\n/).map(decodeLogToken).join('\n')
}

export function parseResponse(operation, xml) {
  switch (operation) {
    case 'ping':
      return { message: xmlValue(xml, 'Message') || xmlValue(xml, 'message') }

    case 'logout':
      return { message: xmlValue(xml, 'LogoutMessage') || xmlValue(xml, 'logoutMessage') }

    case 'getProjects':
      return xmlAll(xml, 'projects').map((p) => ({
        name: xmlValue(p, 'name'),
        guid: xmlValue(p, 'guid'),
        description: xmlValue(p, 'description'),
      }))

    case 'getProjectTasks':
      return xmlAll(xml, 'tasks').map((t) => ({
        taskName: xmlValue(t, 'taskName'),
        description: xmlValue(t, 'description'),
        taskGuid: xmlValue(t, 'taskGuid'),
        type: xmlValue(t, 'type'),
      }))

    case 'searchTasks':
      return xmlAll(xml, 'return').map((t) => ({
        taskName: xmlValue(t, 'taskName'),
        description: xmlValue(t, 'description'),
        taskGuid: xmlValue(t, 'taskGuid'),
        type: xmlValue(t, 'type'),
      }))

    case 'getTaskInfo': {
      // Las variables llegan con estructuras distintas según el tenant: sueltas, dentro de un
      // contenedor, o con otro nombre de etiqueta. Se prueban las formas conocidas en orden.
      let variableElements = xmlAll(xml, 'globalVariable')
      if (variableElements.length === 0) {
        const containers = xmlAll(xml, 'globalVariables')
        if (containers.length === 1) {
          const inner = xmlAll(containers[0], 'globalVariable')
          variableElements = inner.length > 0 ? inner : xmlAll(containers[0], 'variable')
          if (variableElements.length === 0) variableElements = containers
        } else if (containers.length > 1) {
          variableElements = containers
        }
      }
      if (variableElements.length === 0) variableElements = xmlAll(xml, 'variable')

      const globalVariables = variableElements
        .map((v) => ({
          name: xmlValue(v, 'name'),
          description: xmlValue(v, 'description'),
          dataType: xmlValue(v, 'dataType'),
          defaultValue: xmlValue(v, 'defaultValue'),
          length: xmlValue(v, 'length'),
        }))
        .filter((v) => v.name)

      const propertyElements = xmlAll(xml, 'property').length > 0
        ? xmlAll(xml, 'property')
        : xmlAll(xml, 'properties')

      return {
        taskName: xmlValue(xml, 'taskName'),
        taskGuid: xmlValue(xml, 'taskGuid'),
        description: xmlValue(xml, 'description'),
        type: xmlValue(xml, 'type'),
        globalVariables,
        properties: propertyElements.map((p) => ({
          name: xmlValue(p, 'name'),
          value: xmlValue(p, 'value'),
          caption: xmlValue(p, 'caption'),
        })),
      }
    }

    case 'getAgents':
      return xmlAll(xml, 'agentGroups').map((g) => ({
        name: xmlValue(g, 'name'),
        guid: xmlValue(g, 'guid'),
        description: xmlValue(g, 'description'),
        agents: xmlAll(g, 'agent').map((a) => ({
          name: xmlValue(a, 'name'),
          guid: xmlValue(a, 'guid'),
          description: xmlValue(a, 'description'),
          lastConnected: xmlValue(a, 'lastConnected'),
          version: xmlValue(a, 'version'),
          agentStatus: xmlValue(a, 'agentStatus'),
        })),
      }))

    case 'getSystemConfigurations':
      return xmlAll(xml, 'sysConfigurations').map((s) => ({
        name: xmlValue(s, 'name'),
        guid: xmlValue(s, 'guid'),
        description: xmlValue(s, 'description'),
        dsConfigurations: xmlAll(s, 'dsConfiguration').map((d) => ({
          dataStoreName: xmlValue(d, 'dataStoreName'),
          dataStoreConfigurationName: xmlValue(d, 'dataStoreConfigurationName'),
        })),
      }))

    case 'runTask':
      return { runId: xmlValue(xml, 'RunID') || xmlValue(xml, 'runId') || xmlValue(xml, 'RunId') }

    case 'getTaskStatusByRunId2':
    case 'getTaskStatusByRunId':
      return {
        projectName: xmlValue(xml, 'projectName'),
        jobId: xmlValue(xml, 'jobId'),
        statusCode: stripTaskPrefix(xmlValue(xml, 'statusCode')),
        statusMsg: xmlValue(xml, 'statusMsg'),
        startTime: xmlValue(xml, 'startTime'),
        endTime: xmlValue(xml, 'endTime'),
        executionTime: xmlValue(xml, 'executionTime'),
        description: xmlValue(xml, 'description'),
        uploadBatchInfos: xmlAll(xml, 'uploadBatchInfos').map((b) => ({
          id: xmlValue(b, 'id'),
          name: xmlValue(b, 'name'),
          startTime: xmlValue(b, 'startTime'),
        })),
      }

    case 'getAllExecutedTasks2':
    case 'getAllExecutedTasks': {
      // Formato nuevo: el identificador va como contenido y el resto como atributos.
      const runIdElements = xmlAll(xml, 'runId')
      if (runIdElements.length > 0) {
        return runIdElements.map((r) => ({
          runId: xmlValue(r, 'runId') || xmlText(r),
          jobId: xmlAttribute(r, 'runId', 'jobId'),
          startDate: xmlAttribute(r, 'runId', 'startDate'),
          statusCode: stripTaskPrefix(xmlAttribute(r, 'runId', 'statusCode')),
          taskName: xmlAttribute(r, 'runId', 'taskName'),
        }))
      }
      // Formato antiguo: lo mismo pero dentro de <return>.
      return xmlAll(xml, 'return').map((r) => ({
        runId: xmlValue(r, 'return') || xmlText(r),
        jobId: xmlAttribute(r, 'return', 'jobId'),
        startDate: xmlAttribute(r, 'return', 'startDate'),
        statusCode: stripTaskPrefix(xmlAttribute(r, 'return', 'statusCode')),
        taskName: xmlAttribute(r, 'return', 'taskName'),
      }))
    }

    case 'getTaskLogs': {
      const parseLog = (name) => {
        const block = xmlValue(xml, name)
        if (!block) return null
        return {
          maxPage: xmlValue(block, 'maxPage'),
          pageNum: xmlValue(block, 'pageNum'),
          jobRunStatus: xmlValue(block, 'JobRunStatus'),
          messageLines: xmlAll(block, 'messageLines').map(decodeLogLine),
        }
      }
      return {
        traceLog: parseLog('traceLog'),
        monitorLog: parseLog('monitorLog'),
        errorLog: parseLog('errorLog'),
      }
    }

    case 'cancelTask':
      return {
        status: xmlValue(xml, 'status') || xmlValue(xml, 'Status'),
        message: xmlValue(xml, 'message') || xmlValue(xml, 'Message'),
      }

    default:
      return { raw: xml }
  }
}
