import { describe, it, expect } from 'vitest'
import {
  buildBody,
  fallbackFor,
  looksLikeUnknownOperation,
  parseResponse,
  soapActionFor,
  versionFor,
} from './operations.js'

const b64 = (text) => Buffer.from(text, 'utf-8').toString('base64')

describe('soapActionFor', () => {
  it('traduce los nombres que difieren de la operación', () => {
    expect(soapActionFor('getProjects')).toBe('function=getAllProjects')
    expect(soapActionFor('getAgents')).toBe('function=getAllAgents')
    expect(soapActionFor('logout')).toBe('function=logoff')
  })

  it('para el resto usa el nombre de la operación', () => {
    expect(soapActionFor('runTask')).toBe('function=runTask')
  })
})

describe('versionFor y fallbackFor', () => {
  it('las operaciones de segunda versión piden la 2.0', () => {
    expect(versionFor('getAllExecutedTasks2')).toBe('2.0')
    expect(versionFor('getTaskStatusByRunId2')).toBe('2.0')
    expect(versionFor('runTask')).toBeNull()
  })

  it('cada operación de segunda versión tiene su equivalente antiguo', () => {
    expect(fallbackFor('getAllExecutedTasks2')).toBe('getAllExecutedTasks')
    expect(fallbackFor('getTaskStatusByRunId2')).toBe('getTaskStatusByRunId')
    expect(fallbackFor('runTask')).toBeNull()
  })
})

describe('looksLikeUnknownOperation', () => {
  it.each(['Unknown operation: x', 'Function NOT RECOGNIZED', 'invalid function name'])(
    'reconoce "%s" como operación inexistente',
    (text) => {
      expect(looksLikeUnknownOperation(text)).toBe(true)
    },
  )

  it('no confunde otros errores', () => {
    expect(looksLikeUnknownOperation('Session expired')).toBe(false)
  })
})

describe('buildBody', () => {
  it('escapa lo que el usuario escribe', () => {
    const body = buildBody('searchTasks', { nameFilter: 'A & B <script>' })
    expect(body).toContain('A &amp; B &lt;script&gt;')
  })

  it('revienta con una operación que no existe', () => {
    expect(() => buildBody('inventada')).toThrow(/Operación desconocida/)
  })

  it('en runTask incluye solo los campos que se pasan', () => {
    const body = buildBody('runTask', { taskName: 'Carga', agentName: 'AG1' })
    expect(body).toContain('<taskName>Carga</taskName>')
    expect(body).toContain('<agentName>AG1</agentName>')
    expect(body).not.toContain('<agentGroup>')
    expect(body).not.toContain('<globalVariables>')
  })

  it('en runTask las variables van como atributo de nombre', () => {
    const body = buildBody('runTask', {
      taskName: 'T',
      globalVariables: [{ name: 'FECHA', value: '2026-08-04' }],
    })
    expect(body).toContain('<variable name="FECHA">2026-08-04</variable>')
  })

  it('en getTaskLogs respeta el orden de elementos que exige SAP', () => {
    const body = buildBody('getTaskLogs', {
      runId: '99',
      traceLog: { getLog: true },
      errorLog: { getLog: true, pageNum: 2 },
      monitorLog: { getLog: true },
    })
    const orden = ['base64Encode', 'traceLog', 'errorLog', 'runId', 'monitorLog']
      .map((tag) => body.indexOf(`<${tag}>`))
    expect(orden).toEqual([...orden].sort((a, b) => a - b))
    expect(orden.every((i) => i >= 0)).toBe(true)
  })

  it('en getTaskLogs omite los registros que no se piden', () => {
    const body = buildBody('getTaskLogs', { runId: '99', traceLog: { getLog: true } })
    expect(body).toContain('<traceLog>')
    expect(body).not.toContain('<errorLog>')
  })

  it('el filtro de tareas ejecutadas solo incluye los rangos que se dan', () => {
    const soloDesde = buildBody('getAllExecutedTasks2', { startDateFrom: '2026-08-01' })
    expect(soloDesde).toContain('<from>2026-08-01</from>')
    expect(soloDesde).not.toContain('<to>')
    expect(soloDesde).not.toContain('<endDate>')

    const conHasta = buildBody('getAllExecutedTasks2', { startDateFrom: 'a', startDateTo: 'b' })
    expect(conHasta).toContain('<to>b</to>')
  })

  it('las operaciones sin parámetros son peticiones vacías', () => {
    expect(buildBody('ping')).toBe('<web:pingRequest/>')
    expect(buildBody('getProjects')).toBe('<web:allProjectsRequest/>')
  })
})

describe('parseResponse', () => {
  it('lee la lista de proyectos', () => {
    const xml = `<r>
      <projects><name>Proyecto A</name><guid>G1</guid><description>Uno</description></projects>
      <projects><name>Proyecto B</name><guid>G2</guid><description>Dos</description></projects>
    </r>`
    expect(parseResponse('getProjects', xml)).toEqual([
      { name: 'Proyecto A', guid: 'G1', description: 'Uno' },
      { name: 'Proyecto B', guid: 'G2', description: 'Dos' },
    ])
  })

  it('quita el prefijo TASK: de los códigos de estado', () => {
    const xml = '<r><statusCode>TASK:SUCCESS</statusCode><jobId>J9</jobId></r>'
    expect(parseResponse('getTaskStatusByRunId', xml)).toMatchObject({ statusCode: 'SUCCESS', jobId: 'J9' })
  })

  it('lee las tareas ejecutadas en el formato nuevo, con los datos en atributos', () => {
    const xml = `<r>
      <runId jobId="J-1" startDate="2026-08-01" statusCode="TASK:SUCCESS" taskName="Carga">1001</runId>
      <runId jobId="J-2" startDate="2026-08-02" statusCode="TASK:ERROR" taskName="Otra">1002</runId>
    </r>`
    expect(parseResponse('getAllExecutedTasks2', xml)).toEqual([
      { runId: '1001', jobId: 'J-1', startDate: '2026-08-01', statusCode: 'SUCCESS', taskName: 'Carga' },
      { runId: '1002', jobId: 'J-2', startDate: '2026-08-02', statusCode: 'ERROR', taskName: 'Otra' },
    ])
  })

  it('lee las tareas ejecutadas en el formato antiguo', () => {
    const xml = '<r><return jobId="J-1" statusCode="TASK:SUCCESS" taskName="Carga">1001</return></r>'
    expect(parseResponse('getAllExecutedTasks', xml)).toEqual([
      { runId: '1001', jobId: 'J-1', startDate: null, statusCode: 'SUCCESS', taskName: 'Carga' },
    ])
  })

  it('lee el identificador de ejecución con cualquiera de sus tres nombres', () => {
    expect(parseResponse('runTask', '<r><RunID>7</RunID></r>').runId).toBe('7')
    expect(parseResponse('runTask', '<r><runId>7</runId></r>').runId).toBe('7')
  })

  it('lee los grupos de agentes con sus agentes dentro', () => {
    const xml = `<r><agentGroups><name>Grupo</name><guid>G</guid><description>D</description>
      <agent><name>AG1</name><guid>A1</guid><agentStatus>RUNNING</agentStatus></agent>
    </agentGroups></r>`
    const grupos = parseResponse('getAgents', xml)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].agents[0]).toMatchObject({ name: 'AG1', agentStatus: 'RUNNING' })
  })

  it('descodifica los registros, que vienen en base64 línea a línea', () => {
    // SAP mete VARIAS líneas codificadas por separado dentro del mismo elemento. Si se
    // juntaran antes de descodificar, el relleno de la primera rompería la detección.
    const xml = `<r><traceLog><maxPage>2</maxPage><pageNum>1</pageNum>
      <messageLines>${b64('Inicio de la tarea')}\n${b64('Fin de la tarea')}</messageLines>
    </traceLog></r>`
    const logs = parseResponse('getTaskLogs', xml)
    expect(logs.traceLog.messageLines).toEqual(['Inicio de la tarea\nFin de la tarea'])
    expect(logs.traceLog.maxPage).toBe('2')
  })

  // El caso real que hacía que el visor mostrara el base64 crudo: este tenant NO separa las
  // líneas, las pega. Cada una conserva su relleno, así que el "=" queda en medio del bloque y
  // el bloque entero deja de parecer base64.
  it('descodifica también las líneas pegadas sin separador', () => {
    // Con relleno, como las manda SAP: rellena cada línea a un ancho fijo.
    const pegadas = b64('Path Name ') + b64('+MA61V1 ') + b64('-Target_Query')
    const xml = `<r><monitorLog><messageLines>${pegadas}</messageLines></monitorLog></r>`

    expect(parseResponse('getTaskLogs', xml).monitorLog.messageLines)
      .toEqual(['Path Name \n+MA61V1 \n-Target_Query'])
  })

  // Sin separador ni relleno no hay forma de saber dónde acaba una línea y empieza la otra. Se
  // juntan, que es un defecto cosmético; lo que importa es que salga texto y no base64.
  it('una línea sin relleno se junta con la siguiente, pero sale legible', () => {
    const xml = `<r><monitorLog><messageLines>${b64('Path Name') + b64('+MA61V1 ')}</messageLines></monitorLog></r>`
    expect(parseResponse('getTaskLogs', xml).monitorLog.messageLines).toEqual(['Path Name+MA61V1 '])
  })

  it('deja pasar tal cual una línea que ya viene en texto plano', () => {
    const xml = '<r><errorLog><messageLines>Error sin codificar</messageLines></errorLog></r>'
    expect(parseResponse('getTaskLogs', xml).errorLog.messageLines).toEqual(['Error sin codificar'])
  })

  // Sin esta guarda, cualquier palabra del alfabeto base64 se descodificaría a caracteres raros.
  it('un texto plano que parece base64 no se descodifica a medias', () => {
    const xml = '<r><errorLog><messageLines>ERROR=fallo=grave</messageLines></errorLog></r>'
    expect(parseResponse('getTaskLogs', xml).errorLog.messageLines).toEqual(['ERROR=fallo=grave'])
  })

  it('devuelve null para los registros que no se pidieron', () => {
    const xml = '<r><traceLog><messageLines>x</messageLines></traceLog></r>'
    const logs = parseResponse('getTaskLogs', xml)
    expect(logs.monitorLog).toBeNull()
    expect(logs.errorLog).toBeNull()
  })

  it('lee las variables de una tarea cuando vienen sueltas', () => {
    const xml = `<r><taskName>T</taskName>
      <globalVariable><name>V1</name><dataType>varchar</dataType></globalVariable>
    </r>`
    expect(parseResponse('getTaskInfo', xml).globalVariables).toEqual([
      { name: 'V1', description: null, dataType: 'varchar', defaultValue: null, length: null },
    ])
  })

  it('lee las variables cuando vienen dentro de un contenedor y con otro nombre', () => {
    const xml = `<r><taskName>T</taskName>
      <globalVariables><variable><name>V1</name></variable><variable><name>V2</name></variable></globalVariables>
    </r>`
    expect(parseResponse('getTaskInfo', xml).globalVariables.map((v) => v.name)).toEqual(['V1', 'V2'])
  })

  it('descarta las variables sin nombre', () => {
    const xml = '<r><globalVariable><description>sin nombre</description></globalVariable></r>'
    expect(parseResponse('getTaskInfo', xml).globalVariables).toEqual([])
  })

  it('una operación sin lector devuelve el XML crudo', () => {
    expect(parseResponse('desconocida', '<a/>')).toEqual({ raw: '<a/>' })
  })
})
