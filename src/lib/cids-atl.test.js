import { describe, it, expect } from 'vitest'

import { SIN_GRUPO, matchATLtoIntegrations, parseATL } from './cids-atl.js'

/** Un ATL con dos planes: el primero en paralelo, el segundo secuencial. */
const ATL = `CREATE PLAN PLAN_CARGA::'p1' (
  PARALLEL BEGIN
    ALGUICOMMENT(  "ui_display_name"='Producto' )
    CALL DATAFLOW DF_PRODUCTO::'guid-prod' ( );
    ALGUICOMMENT(  "ui_display_name"='Cliente' )
    CALL DATAFLOW DF_CLIENTE::'guid-clie' ( );
  END
)
CREATE PLAN PLAN_FINAL::'p2' (
  BEGIN
    CALL DATAFLOW ZONA_DF_CIERRE::'' ( );
  END
)
CREATE SESSION SESION_DIARIA::'s1' (
  DECLARE
    GLOBAL $G_PLAN_AREA varchar(20)
    GLOBAL $G_DELTA varchar(1)
  BEGIN
    ALGUICOMMENT(  "ui_display_name"='FLOWof_Maestros' )
    CALL PLAN PLAN_CARGA::'p1' ( );
    ALGUICOMMENT(  "ui_display_name"='Cierre' )
    CALL PLAN PLAN_FINAL::'p2' ( );
  END
)
SET ( "job_name"='Carga diaria' , "Description"='Corre todas las noches' )
SET ( "job_GV_$G_PLAN_AREA"='SAPIBP1' , "job_GV_$G_DELTA"='X' )`

describe('parseATL', () => {
  const atl = parseATL(ATL)

  it('toma el nombre visible del trabajo, no el técnico', () => {
    expect(atl.sessionName).toBe('Carga diaria')
    expect(atl.description).toBe('Corre todas las noches')
  })

  it('los grupos van en el orden en que los llama la sesión', () => {
    expect(atl.groups.map((uno) => uno.name)).toEqual(['PLAN_CARGA', 'PLAN_FINAL'])
    expect(atl.groups.map((uno) => uno.displayName)).toEqual(['FLOWof_Maestros', 'Cierre'])
  })

  // Es el dato que no está en ningún otro lado: si corren a la vez o uno detrás del otro.
  it('marca qué grupo corre en paralelo', () => {
    expect(atl.groups.map((uno) => uno.parallel)).toEqual([true, false])
  })

  it('cada dataflow trae su GUID y su nombre visible', () => {
    expect(atl.groups[0].dataflows).toEqual([
      { fullName: 'DF_PRODUCTO', guid: 'guid-prod', displayName: 'Producto' },
      { fullName: 'DF_CLIENTE', guid: 'guid-clie', displayName: 'Cliente' },
    ])
  })

  it('sin nombre visible usa el último tramo del nombre técnico', () => {
    expect(atl.groups[1].dataflows[0].displayName).toBe('CIERRE')
  })

  it('las variables se leen con su tipo y su valor por omisión', () => {
    expect(atl.variables).toEqual([
      { name: '$G_PLAN_AREA', type: 'varchar(20)', default: 'SAPIBP1' },
      { name: '$G_DELTA', type: 'varchar(1)', default: 'X' },
    ])
  })

  // Hay sesiones que no declaran variables; el cuerpo tiene que abrirse igual.
  it('una sesión sin DECLARE también se lee', () => {
    const simple = parseATL(`CREATE PLAN P::'x' (
  BEGIN
    CALL DATAFLOW DF_UNO::'g1' ( );
  END
)
CREATE SESSION S::'y' (
  BEGIN
    CALL PLAN P::'x' ( );
  END
)`)
    expect(simple.variables).toEqual([])
    expect(simple.groups[0].dataflows).toHaveLength(1)
  })

  // Una tarea puede ser una secuencia plana de dataflows, sin planes de por medio.
  it('los dataflows llamados sin plan forman un grupo al final', () => {
    const plano = parseATL(`CREATE SESSION S::'y' (
  BEGIN
    CALL DATAFLOW DF_UNO::'g1' ( );
    CALL DATAFLOW DF_DOS::'g2' ( );
  END
)`)
    expect(plano.groups).toHaveLength(1)
    expect(plano.groups[0].parallel).toBe(false)
    expect(plano.groups[0].dataflows.map((uno) => uno.guid)).toEqual(['g1', 'g2'])
  })

  it('un grupo sin nombre visible recibe uno numerado', () => {
    const anonimo = parseATL(`CREATE PLAN P::'x' (
  BEGIN
    CALL DATAFLOW DF::'g' ( );
  END
)
CREATE SESSION S::'y' (
  BEGIN
    CALL PLAN P::'x' ( );
  END
)`)
    expect(anonimo.groups[0].displayName).toBe('Grupo 1')
  })

  it('un archivo vacío no revienta', () => {
    expect(parseATL('')).toEqual({
      sessionName: '', description: '', variables: [], groups: [], globalDefaults: {},
    })
  })
})

describe('matchATLtoIntegrations', () => {
  const item = (sheetName, dataflowName, dataflowGuid) => ({
    sheetName,
    parsed: { dataflowName, dataflowGuid },
  })

  const integraciones = [
    item('HOJA_PROD', 'DF_PRODUCTO', 'guid-prod'),
    item('HOJA_CLIE', 'DF_CLIENTE', 'guid-clie'),
    item('HOJA_SOLA', 'DF_HUERFANO', 'guid-huerfano'),
  ]

  it('empareja por GUID y respeta el orden del ATL', () => {
    const { ordenadas } = matchATLtoIntegrations(parseATL(ATL), integraciones)
    expect(ordenadas.map((una) => una.sheetName)).toEqual(['HOJA_PROD', 'HOJA_CLIE', 'HOJA_SOLA'])
    expect(ordenadas.map((una) => una.atlOrder)).toEqual([1, 2, 3])
  })

  it('le pone a cada una su grupo, su sesión y si corre en paralelo', () => {
    const [primera] = matchATLtoIntegrations(parseATL(ATL), integraciones).ordenadas
    expect(primera.atlGroup).toBe('Maestros')
    expect(primera.atlSession).toBe('Carga diaria')
    expect(primera.atlParallel).toBe(true)
  })

  // Una integración que el ATL no menciona sigue existiendo y hay que documentarla.
  it('las que el ATL no menciona van al final, sin grupo', () => {
    const { ordenadas } = matchATLtoIntegrations(parseATL(ATL), integraciones)
    expect(ordenadas.at(-1)).toMatchObject({ sheetName: 'HOJA_SOLA', atlGroup: SIN_GRUPO })
  })

  it('sin GUID empareja por el nombre visible', () => {
    const atl = { groups: [{ displayName: 'G', parallel: false, dataflows: [{ guid: '', displayName: 'df_producto' }] }], sessionName: 'S' }
    const { ordenadas } = matchATLtoIntegrations(atl, [item('HOJA_PROD', 'DF_PRODUCTO', '')])
    expect(ordenadas[0].atlGroup).toBe('G')
  })

  // Adivinar cuál de dos es peor que dejarla sin grupo.
  it('un nombre que corresponde a dos integraciones no empareja ninguna', () => {
    const atl = { groups: [{ displayName: 'G', parallel: false, dataflows: [{ guid: '', displayName: 'DF' }] }], sessionName: 'S' }
    const dos = [item('A', 'DF', ''), item('B', 'DF', '')]
    const { ordenadas, ambiguas } = matchATLtoIntegrations(atl, dos)

    expect(ambiguas).toEqual(['DF'])
    expect(ordenadas.every((una) => una.atlGroup === SIN_GRUPO)).toBe(true)
  })

  it('el mismo dataflow llamado dos veces se documenta una sola', () => {
    const atl = {
      sessionName: 'S',
      groups: [{ displayName: 'G', parallel: false, dataflows: [{ guid: 'g1' }, { guid: 'g1' }] }],
    }
    const { ordenadas } = matchATLtoIntegrations(atl, [item('A', 'DF', 'g1')])
    expect(ordenadas).toHaveLength(1)
  })

  it('un ATL que no empareja con nada deja todo sin grupo', () => {
    const { ordenadas } = matchATLtoIntegrations({ sessionName: '', groups: [] }, integraciones)
    expect(ordenadas.map((una) => una.atlGroup)).toEqual([SIN_GRUPO, SIN_GRUPO, SIN_GRUPO])
  })
})
