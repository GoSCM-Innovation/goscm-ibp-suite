import { describe, it, expect } from 'vitest'
import { decodeXmlEntities, extractFieldLabels, extractSimpleTypeCatalog } from './metadata.js'

const XML = `<?xml version="1.0"?>
<edmx:Edmx>
  <Schema>
    <EntityType Name="ProductoType">
      <Key><PropertyRef Name="PRDID"/></Key>
      <Property Name="PRDID" Type="Edm.String" sap:label="C&#243;digo de producto"/>
      <Property Name="PRDDESC" Type="Edm.String" sap:label="Descripci&#243;n"/>
      <Property Name="SINETIQUETA" Type="Edm.String"/>
      <Property Name="IGUAL" Type="Edm.String" sap:label="IGUAL"/>
      <NavigationProperty Name="NavAlgo"/>
    </EntityType>
    <EntityType Name="VersionadoType">
      <Key><PropertyRef Name="PlanningAreaID"/><PropertyRef Name="PRDID"/></Key>
      <Property Name="PlanningAreaID" Type="Edm.String"/>
      <Property Name="PRDID" Type="Edm.String" sap:label="Producto del &#225;rea"/>
    </EntityType>
    <EntityType Name="SinClaveType">
      <Property Name="X" Type="Edm.String"/>
    </EntityType>
    <EntityContainer>
      <EntitySet Name="Producto" EntityType="Servicio.ProductoType"/>
      <EntitySet Name="Versionado" EntityType="Servicio.VersionadoType"/>
      <EntitySet Name="SinClave" EntityType="Servicio.SinClaveType"/>
      <EntitySet Name="ProductoTrans" EntityType="Servicio.ProductoType"/>
      <EntitySet Name="ProductoMessage" EntityType="Servicio.ProductoType"/>
      <EntitySet Name="Producto_VI" EntityType="Servicio.ProductoType"/>
      <EntitySet Name="ValueResultSet" EntityType="Servicio.ProductoType"/>
      <EntitySet Name="VersionSpecificMasterDataTypes" EntityType="Servicio.ProductoType"/>
    </EntityContainer>
  </Schema>
</edmx:Edmx>`

describe('decodeXmlEntities', () => {
  it('descodifica las referencias numéricas que SAP usa para los acentos', () => {
    expect(decodeXmlEntities('C&#243;digo &#225;rea &#241;')).toBe('Código área ñ')
  })

  it('descodifica también las hexadecimales y las con nombre', () => {
    expect(decodeXmlEntities('&#xF3;&lt;a&gt;&quot;x&quot;&apos;')).toBe('ó<a>"x"\'')
  })

  it('deja el ampersand para el final, para no reinterpretar lo ya descodificado', () => {
    // Si &amp; se procesara primero, "&amp;#243;" acabaría siendo "ó" en vez de "&#243;".
    expect(decodeXmlEntities('&amp;#243;')).toBe('&#243;')
  })
})

describe('extractFieldLabels', () => {
  const labels = extractFieldLabels(XML)

  it('saca la etiqueta legible de cada campo', () => {
    expect(labels.PRDDESC).toBe('Descripción')
  })

  it('descarta las etiquetas que solo repiten el nombre técnico', () => {
    expect(labels.IGUAL).toBeUndefined()
  })

  it('ignora los campos sin etiqueta', () => {
    expect(labels.SINETIQUETA).toBeUndefined()
  })

  it('gana la primera etiqueta de verdad cuando el campo se repite entre entidades', () => {
    expect(labels.PRDID).toBe('Código de producto')
  })

  it('no confunde una propiedad de navegación con un campo', () => {
    expect(labels.NavAlgo).toBeUndefined()
  })
})

describe('extractSimpleTypeCatalog', () => {
  const catalog = extractSimpleTypeCatalog(XML)

  it('incluye los tipos simples con sus claves y campos', () => {
    expect(catalog.Producto).toEqual({
      keys: ['PRDID'],
      fields: ['PRDID', 'PRDDESC', 'SINETIQUETA', 'IGUAL'],
    })
  })

  it('excluye los que dependen del área de planificación: SAP ya los lista aparte', () => {
    expect(catalog.Versionado).toBeUndefined()
  })

  it('excluye los conjuntos sin clave, que no se pueden leer fila a fila', () => {
    expect(catalog.SinClave).toBeUndefined()
  })

  it.each(['ProductoTrans', 'ProductoMessage', 'Producto_VI', 'ValueResultSet', 'VersionSpecificMasterDataTypes'])(
    'excluye %s, que no es una tabla de dato maestro',
    (setName) => {
      expect(catalog[setName]).toBeUndefined()
    },
  )

  it('devuelve un catálogo vacío si el XML no trae nada reconocible', () => {
    expect(extractSimpleTypeCatalog('<vacio/>')).toEqual({})
  })
})
