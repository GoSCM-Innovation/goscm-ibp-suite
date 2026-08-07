import { describe, it, expect } from 'vitest'

import { formatEdmType, mergeCatalogs, parseCatalog, planningAreasFrom } from './catalog.js'

describe('formatEdmType', () => {
  it.each([
    ['Edm.String', '40', null, null, 'NVARCHAR(40)'],
    ['Edm.String', null, null, null, 'NVARCHAR'],
    ['Edm.Decimal', null, '18', '6', 'DECIMAL(18,6)'],
    ['Edm.Decimal', null, '18', null, 'DECIMAL(18)'],
    ['Edm.Decimal', null, null, null, 'DECIMAL'],
    ['Edm.Int32', null, null, null, 'INTEGER'],
    ['Edm.Int64', null, null, null, 'BIGINT'],
    ['Edm.Boolean', null, null, null, 'BOOLEAN'],
    ['Edm.DateTime', null, null, null, 'TIMESTAMP'],
    ['Edm.Guid', null, null, null, 'NVARCHAR(36)'],
  ])('%s → %s', (tipo, largo, precision, escala, esperado) => {
    expect(formatEdmType(tipo, largo, precision, escala)).toBe(esperado)
  })

  // Escala cero es una escala válida: `DECIMAL(5)` y `DECIMAL(5,0)` no son lo mismo.
  it('la escala cero se conserva', () => {
    expect(formatEdmType('Edm.Decimal', null, '5', '0')).toBe('DECIMAL(5,0)')
  })

  it('un tipo desconocido se muestra en mayúsculas, sin inventar nada', () => {
    expect(formatEdmType('Edm.Raro')).toBe('RARO')
  })

  it('sin tipo no devuelve nada', () => {
    expect(formatEdmType('')).toBe('')
    expect(formatEdmType(null)).toBe('')
  })
})

const METADATA_MASTER = `<edmx>
  <EntityType Name="Product">
    <Key><PropertyRef Name="PRDID"/></Key>
    <Property Name="PRDID" Type="Edm.String" MaxLength="40" sap:label="Id de producto"/>
    <Property Name="PRDDESCR" Type="Edm.String" MaxLength="80" sap:label="Descripción"/>
  </EntityType>
  <EntitySet Name="AS1PRODUCT" EntityType="ns.Product"/>
  <EntitySet Name="AS1PRODUCTTrans" EntityType="ns.Product"/>
</edmx>`

const METADATA_PLANNING = `<edmx>
  <EntityType Name="SAPIBP1Type">
    <Property Name="PRDID" Type="Edm.String" MaxLength="99" sap:label="Producto (planificación)"/>
    <Property Name="CONSENSUSDEMANDQTY" Type="Edm.Decimal" Precision="24" Scale="6" sap:label="Demanda"/>
  </EntityType>
  <EntitySet Name="SAPIBP1" EntityType="ns.SAPIBP1Type"/>
  <EntitySet Name="SAPIBP1Trans" EntityType="ns.SAPIBP1Type"/>
  <EntitySet Name="ValueResultSet" EntityType="ns.Otro"/>
</edmx>`

describe('parseCatalog', () => {
  const master = parseCatalog(METADATA_MASTER, 'MASTER_DATA_API_SRV')

  it('lee la etiqueta y el tipo de cada campo', () => {
    expect(master.descs.PRDID).toBe('Id de producto')
    expect(master.types.PRDID).toBe('NVARCHAR(40)')
  })

  it('lista los conjuntos con su servicio', () => {
    expect(master.entitySets).toEqual([
      { name: 'AS1PRODUCT', nameUC: 'AS1PRODUCT', service: 'MASTER_DATA_API_SRV' },
      { name: 'AS1PRODUCTTrans', nameUC: 'AS1PRODUCTTRANS', service: 'MASTER_DATA_API_SRV' },
    ])
  })

  // En dato maestro el $select no es obligatorio, así que saber las propiedades no aporta nada.
  it('solo los datos de planificación traen las propiedades de cada entidad', () => {
    expect(master.entityProps).toEqual({})

    const planning = parseCatalog(METADATA_PLANNING, 'PLANNING_DATA_API_SRV')
    expect([...planning.entityProps.SAPIBP1]).toEqual(['PRDID', 'CONSENSUSDEMANDQTY'])
  })

  it('un metadata vacío no revienta', () => {
    expect(parseCatalog('', 'MASTER_DATA_API_SRV'))
      .toEqual({ descs: {}, types: {}, entitySets: [], entityProps: {} })
  })
})

describe('mergeCatalogs', () => {
  // La etiqueta y el tipo de dato maestro son los buenos; los de planificación no deben pisarlos.
  it('gana el primero que definió cada campo', () => {
    const junto = mergeCatalogs([
      parseCatalog(METADATA_MASTER, 'MASTER_DATA_API_SRV'),
      parseCatalog(METADATA_PLANNING, 'PLANNING_DATA_API_SRV'),
    ])

    expect(junto.descs.PRDID).toBe('Id de producto')
    expect(junto.types.PRDID).toBe('NVARCHAR(40)')
    expect(junto.types.CONSENSUSDEMANDQTY).toBe('DECIMAL(24,6)')
  })

  it('junta los conjuntos de todos los servicios', () => {
    const junto = mergeCatalogs([
      parseCatalog(METADATA_MASTER, 'MASTER_DATA_API_SRV'),
      parseCatalog(METADATA_PLANNING, 'PLANNING_DATA_API_SRV'),
    ])
    expect(junto.entitySets).toHaveLength(5)
  })

  it('sin catálogos devuelve uno vacío', () => {
    expect(mergeCatalogs([])).toEqual({ descs: {}, types: {}, entitySets: [], entityProps: {} })
  })
})

describe('planningAreasFrom', () => {
  // SAP no las lista en ningún lado; se deducen del par `<AREA>` + `<AREA>Trans`.
  it('deduce las áreas de los pares de conjuntos', () => {
    const { entitySets } = parseCatalog(METADATA_PLANNING, 'PLANNING_DATA_API_SRV')
    expect(planningAreasFrom(entitySets)).toEqual(['SAPIBP1'])
  })

  it('un Trans sin su conjunto base no es un área', () => {
    expect(planningAreasFrom([
      { name: 'HuerfanoTrans', service: 'PLANNING_DATA_API_SRV' },
    ])).toEqual([])
  })

  it('los conjuntos de dato maestro no cuentan', () => {
    expect(planningAreasFrom([
      { name: 'AS1PRODUCT', service: 'MASTER_DATA_API_SRV' },
      { name: 'AS1PRODUCTTrans', service: 'MASTER_DATA_API_SRV' },
    ])).toEqual([])
  })
})
