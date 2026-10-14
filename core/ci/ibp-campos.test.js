import { describe, expect, it } from 'vitest'
import { parseCamposDeEntidad } from './ibp-campos.js'

// Un `$metadata` mínimo con la forma del real: dos tablas con sus tipos, etiquetas y un campo de sistema.
const XML = `
<edmx:Edmx><edmx:DataServices><Schema Namespace="IBP">
  <EntityType Name="ABPRODUCTType">
    <Key><PropertyRef Name="PRDID"/></Key>
    <Property Name="PRDID" Type="Edm.String" Nullable="false" MaxLength="60" sap:label="Product ID"/>
    <Property Name="PRDDESCR" Type="Edm.String" MaxLength="120" sap:label="Product Description"/>
    <Property Name="ZPESOBRUTO" Type="Edm.Decimal" Precision="18" Scale="3" sap:label="Peso bruto"/>
    <Property Name="ZSINETIQUETA" Type="Edm.String" MaxLength="10"/>
    <Property Name="PlanningAreaID" Type="Edm.String" MaxLength="30" sap:label="Planning Area ID"/>
    <Property Name="CREATEDDATE" Type="Edm.DateTime" sap:label="Created On"/>
    <NavigationProperty Name="Cosas" Relationship="x"/>
  </EntityType>
  <EntityType Name="ABLOCATIONType">
    <Property Name="LOCID" Type="Edm.String" MaxLength="20" sap:label="Location ID"/>
  </EntityType>
  <EntityContainer Name="C">
    <EntitySet Name="ABPRODUCT" EntityType="IBP.ABPRODUCTType"/>
    <EntitySet Name="ABLOCATION" EntityType="IBP.ABLOCATIONType"/>
    <EntitySet Name="ABOTRA" EntityType="IBP.NoExisteType"/>
  </EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>`

describe('parseCamposDeEntidad', () => {
  it('lee los campos de la tabla pedida, con etiqueta y tipo de dato', () => {
    const campos = parseCamposDeEntidad(XML, 'ABPRODUCT')
    expect(campos.map((c) => c.campo)).toEqual(['PRDID', 'PRDDESCR', 'ZPESOBRUTO', 'ZSINETIQUETA', 'PlanningAreaID', 'CREATEDDATE'])
    expect(campos[0]).toEqual({ campo: 'PRDID', etiqueta: 'Product ID', tipo: 'NVARCHAR(60)', sistema: false })
    expect(campos[2]).toMatchObject({ tipo: 'DECIMAL(18,3)', etiqueta: 'Peso bruto' })
  })

  it('un campo sin etiqueta la trae vacía, no inventada', () => {
    expect(parseCamposDeEntidad(XML, 'ABPRODUCT').find((c) => c.campo === 'ZSINETIQUETA').etiqueta).toBe('')
  })

  // El body se escribe con el nombre exacto que publica SAP: no se pasa a mayúsculas.
  it('conserva las mayúsculas y minúsculas del nombre del campo', () => {
    expect(parseCamposDeEntidad(XML, 'ABPRODUCT').map((c) => c.campo)).toContain('PlanningAreaID')
  })

  it('marca los campos de sistema, que SAP rellena y rechaza al escribir', () => {
    const sistema = parseCamposDeEntidad(XML, 'ABPRODUCT').filter((c) => c.sistema).map((c) => c.campo)
    expect(sistema).toEqual(['PlanningAreaID', 'CREATEDDATE'])
  })

  it('no confunde las propiedades de navegación con campos', () => {
    expect(parseCamposDeEntidad(XML, 'ABPRODUCT').map((c) => c.campo)).not.toContain('Cosas')
  })

  it('no mezcla los campos de una tabla con los de otra', () => {
    expect(parseCamposDeEntidad(XML, 'ABLOCATION').map((c) => c.campo)).toEqual(['LOCID'])
  })

  it('no distingue mayúsculas al buscar la tabla', () => {
    expect(parseCamposDeEntidad(XML, 'abproduct')).toHaveLength(6)
  })

  it('una tabla que no existe es null', () => {
    expect(parseCamposDeEntidad(XML, 'ABNADA')).toBeNull()
  })

  it('una tabla cuyo tipo no está declarado es null, no una lista vacía', () => {
    expect(parseCamposDeEntidad(XML, 'ABOTRA')).toBeNull()
  })

  it('tolera un documento vacío o que no es XML', () => {
    expect(parseCamposDeEntidad('', 'ABPRODUCT')).toBeNull()
    expect(parseCamposDeEntidad(undefined, 'ABPRODUCT')).toBeNull()
    expect(parseCamposDeEntidad('no es xml', 'ABPRODUCT')).toBeNull()
  })
})
