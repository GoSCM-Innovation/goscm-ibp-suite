// @vitest-environment jsdom
//
// Este es el primer test que necesita un navegador de mentira: el parser usa `DOMParser`, que no
// existe en Node. El resto de la aplicación se sigue probando sin él.

import { describe, it, expect } from 'vitest'
import {
  buildDatastoreIndex,
  buildFileFormatIndex,
  buildSchemaMap,
  buildSchemaMapFull,
  datastoreFromRef,
  extractFilters,
  extractLookups,
  findWriter,
  getProp,
  integrationType,
  isFileTarget,
  parseBatchCsv,
  parseDataflow,
  parseDataflowDiagram,
  parseIntegration,
  parseJobMetadata,
  parseTransforms,
  parseXml,
} from './cids-export.js'

/** Un ZIP de mentira con los archivos que se le pidan. */
const zipCon = (archivos) => ({
  file: (nombre) => (nombre in archivos
    ? { async: async () => archivos[nombre] }
    : null),
})

describe('parseBatchCsv', () => {
  it('indexa cada fila por el nombre de su XML', async () => {
    const mapa = await parseBatchCsv(zipCon({
      'batch.csv': 'Xmlfilename,src_datastore_Name,target_datastorename\nuno.xml,ERP,IBP\ndos.xml,BW,IBP',
    }))

    expect(Object.keys(mapa)).toEqual(['uno.xml', 'dos.xml'])
    expect(mapa['uno.xml'].src_datastore_Name).toBe('ERP')
  })

  it('recorta los espacios de cabeceras y celdas', async () => {
    const mapa = await parseBatchCsv(zipCon({ 'batch.csv': ' Xmlfilename , src_datastore_Name \n uno.xml , ERP ' }))
    expect(mapa['uno.xml'].src_datastore_Name).toBe('ERP')
  })

  it('una celda que falta queda vacía en vez de indefinida', async () => {
    const mapa = await parseBatchCsv(zipCon({ 'batch.csv': 'Xmlfilename,src_datastore_Name\nuno.xml' }))
    expect(mapa['uno.xml'].src_datastore_Name).toBe('')
  })

  it('acepta finales de línea de Windows', async () => {
    const mapa = await parseBatchCsv(zipCon({ 'batch.csv': 'Xmlfilename\r\nuno.xml' }))
    expect(mapa['uno.xml']).toBeTruthy()
  })

  // Un ZIP sin batch.csv sigue teniendo XML útiles: el parser no se planta por esto.
  it('sin batch.csv devuelve un mapa vacío', async () => {
    expect(await parseBatchCsv(zipCon({}))).toEqual({})
  })

  it('con solo la cabecera devuelve un mapa vacío', async () => {
    expect(await parseBatchCsv(zipCon({ 'batch.csv': 'Xmlfilename' }))).toEqual({})
  })

  it('descarta filas sin nombre de XML', async () => {
    const mapa = await parseBatchCsv(zipCon({ 'batch.csv': 'Xmlfilename,ds\n,ERP\nuno.xml,BW' }))
    expect(Object.keys(mapa)).toEqual(['uno.xml'])
  })
})

describe('parseXml', () => {
  it('devuelve la raíz de un XML válido', () => {
    expect(parseXml('<raiz><hijo/></raiz>').localName).toBe('raiz')
  })

  // El parser del navegador no lanza: mete un `parsererror` dentro del resultado.
  it('devuelve null ante algo que no es XML', () => {
    expect(parseXml('<sin cerrar')).toBeNull()
    expect(parseXml('')).toBeNull()
    expect(parseXml(null)).toBeNull()
  })
})

describe('getProp', () => {
  it('lee una propiedad de las que van como hijos', () => {
    const raiz = parseXml('<Job><properties name="Description" value="Carga diaria"/></Job>')
    expect(getProp(raiz, 'Description')).toBe('Carga diaria')
  })

  it('una propiedad que no está devuelve vacío', () => {
    const raiz = parseXml('<Job><properties name="Otra" value="x"/></Job>')
    expect(getProp(raiz, 'Description')).toBe('')
  })
})

describe('buildDatastoreIndex', () => {
  // Las referencias del XMI apuntan por índice y ese número cuenta TODOS los hijos. Contar solo los
  // datastores desalinearía cada referencia.
  it('indexa por posición entre TODOS los hijos, no solo entre los datastores', () => {
    const raiz = parseXml('<p><Job/><DataStore name="ERP"/><Otro/><DataStore name="IBP"/></p>')
    expect(buildDatastoreIndex(raiz)).toEqual({ 1: 'ERP', 3: 'IBP' })
  })

  it('un datastore sin nombre recibe uno con su posición', () => {
    expect(buildDatastoreIndex(parseXml('<p><DataStore/></p>'))).toEqual({ 0: 'DS_0' })
  })

  it('sin datastores devuelve un mapa vacío', () => {
    expect(buildDatastoreIndex(parseXml('<p><Job/></p>'))).toEqual({})
  })
})

describe('datastoreFromRef', () => {
  const porIndice = { 0: 'ERP', 3: 'IBP' }

  // El formato que reconoce es "algo/N": una barra seguida del número. Es lo que trae el XMI y lo
  // que v9 buscaba; una referencia con otra forma se devuelve tal cual en vez de resolverse mal.
  it('resuelve una referencia por índice', () => {
    expect(datastoreFromRef('//@DataStore/3', porIndice)).toBe('IBP')
  })

  it('una referencia a un índice que no existe se devuelve tal cual', () => {
    expect(datastoreFromRef('//@DataStore/9', porIndice)).toBe('//@DataStore/9')
  })

  it('una referencia sin número se devuelve tal cual', () => {
    expect(datastoreFromRef('ERP_DIRECTO', porIndice)).toBe('ERP_DIRECTO')
  })

  it('sin referencia no inventa nada', () => {
    expect(datastoreFromRef('', porIndice)).toBe('')
    expect(datastoreFromRef(null, porIndice)).toBe('')
  })
})

describe('buildSchemaMap', () => {
  const conLector = (atributos) => parseXml(
    `<DataFlow xmlns:xmi="http://www.omg.org/XMI">
       <elements xmi:type="TableReader" ${atributos}/>
     </DataFlow>`,
  )

  // Sin este mapa la documentación diría "Query_1" donde debería decir "MARA".
  it('lleva del nombre mostrado a la tabla real y su datastore', () => {
    const mapa = buildSchemaMap(
      conLector('displayName="Query_1" tableName="MARA" referencedDataStore="//@DataStore/0"'),
      { 0: 'ERP' },
    )
    expect(mapa.Query_1).toEqual({ table: 'MARA', ds: 'ERP' })
  })

  // Las expresiones referencian el esquema por cualquiera de los dos nombres.
  it('registra también el nombre del esquema de salida cuando difiere', () => {
    const mapa = buildSchemaMap(conLector('displayName="Query_1" outputSchemaName="OUT_1" tableName="MARA"'), {})
    expect(mapa.Query_1.table).toBe('MARA')
    expect(mapa.OUT_1.table).toBe('MARA')
  })

  it('sin nombre de tabla cae al esquema de salida y después al mostrado', () => {
    expect(buildSchemaMap(conLector('displayName="Q" outputSchemaName="OUT"'), {}).Q.table).toBe('OUT')
    expect(buildSchemaMap(conLector('displayName="Q"'), {}).Q.table).toBe('Q')
  })

  it('ignora lo que no es un lector de tabla', () => {
    const dataflow = parseXml(
      `<DataFlow xmlns:xmi="http://www.omg.org/XMI">
         <elements xmi:type="QueryTransform" displayName="Q"/>
       </DataFlow>`,
    )
    expect(buildSchemaMap(dataflow, {})).toEqual({})
  })
})

describe('parseTransforms', () => {
  const dataflow = parseXml(
    `<DataFlow xmlns:xmi="http://www.omg.org/XMI">
       <elements xmi:type="QueryTransform" displayName="Transform1">
         <outputSchema filterExpression="MARA.LVORM = ''">
           <schemaNodes name="MATNR" description="Material" projectionExpression="MARA.MATNR"/>
           <schemaNodes name="OTRO"/>
         </outputSchema>
       </elements>
       <elements xmi:type="XMLMapTransform" displayName="Transform2">
         <outputSchema>
           <schemaNodes name="ID" projectionExpression="ET.ID"/>
         </outputSchema>
       </elements>
       <elements xmi:type="TableReader" displayName="Lector"/>
     </DataFlow>`,
  )

  it('junta los campos de cada transformación con su proyección', () => {
    const transformaciones = parseTransforms(dataflow)
    expect(transformaciones.Transform1.fields).toEqual([
      { name: 'MATNR', desc: 'Material', proj: 'MARA.MATNR' },
      { name: 'OTRO', desc: '', proj: '' },
    ])
  })

  it('trae el filtro del esquema de salida', () => {
    expect(parseTransforms(dataflow).Transform1.filterExpr).toBe("MARA.LVORM = ''")
  })

  // Las salidas de RFC y BAPI pasan por XMLMap: sin incluirlas, la cadena de expresiones se corta.
  it('incluye las transformaciones de XMLMap, no solo las de consulta', () => {
    expect(parseTransforms(dataflow).Transform2.fields[0].proj).toBe('ET.ID')
  })

  it('no toma los lectores de tabla como transformaciones', () => {
    expect(parseTransforms(dataflow)).not.toHaveProperty('Lector')
  })

  it('una transformación sin esquema de salida se salta', () => {
    const sinSalida = parseXml(
      '<DataFlow xmlns:xmi="http://www.omg.org/XMI"><elements xmi:type="QueryTransform" displayName="Q"/></DataFlow>',
    )
    expect(parseTransforms(sinSalida)).toEqual({})
  })
})

describe('integrationType', () => {
  it.each([
    ['con _KF_ es key figure', 'CARGA_KF_VENTAS', 'KF'],
    ['con _MD_ es dato maestro', 'CARGA_MD_PRODUCTO', 'MD'],
    ['con _DM_ también es dato maestro', 'CARGA_DM_PRODUCTO', 'MD'],
    ['con _FILE_ es archivo', 'CARGA_FILE_DIARIA', 'FILE'],
  ])('%s', (_, nombre, esperado) => {
    expect(integrationType(nombre, false)).toBe(esperado)
  })

  it('no distingue mayúsculas', () => {
    expect(integrationType('carga_kf_ventas', false)).toBe('KF')
  })

  // Es la convención de nombres de los proyectos reales, y dato maestro es lo más común.
  it('sin coincidencia asume dato maestro', () => {
    expect(integrationType('CUALQUIER_COSA', false)).toBe('MD')
    expect(integrationType('', false)).toBe('MD')
  })

  it('un destino de archivo manda por encima del nombre', () => {
    expect(integrationType('CARGA_KF_VENTAS', true)).toBe('FILE')
  })
})

describe('isFileTarget', () => {
  it.each(['FILE_DC', 'ARCHIVOS', 'DS_FILE_SALIDA', 'file_algo'])('%s es un destino de archivo', (nombre) => {
    expect(isFileTarget(nombre)).toBe(true)
  })

  it.each(['IBP', 'ERP', '', null])('%s no lo es', (nombre) => {
    expect(isFileTarget(nombre)).toBe(false)
  })
})

describe('parseJobMetadata', () => {
  const raiz = parseXml(
    `<proyecto>
       <Job name="CARGA_MD_PRODUCTO">
         <properties name="Description" value="Carga de productos"/>
         <globalVariables name="$G_PLAN_AREA" defaultValue="'SAPIBP1'"/>
         <globalVariables name="$G_FECHA" defaultValue="20260804"/>
         <globalVariables defaultValue="sin nombre"/>
       </Job>
     </proyecto>`,
  )

  it('trae el nombre y la descripción del trabajo', () => {
    const datos = parseJobMetadata(raiz)
    expect(datos.jobName).toBe('CARGA_MD_PRODUCTO')
    expect(datos.jobDesc).toBe('Carga de productos')
  })

  it('junta las variables globales con su valor por omisión', () => {
    expect(parseJobMetadata(raiz).variables).toEqual([
      { name: '$G_PLAN_AREA', value: "'SAPIBP1'" },
      { name: '$G_FECHA', value: '20260804' },
    ])
  })

  // Viene entrecomillada en el XMI y hay que desnudarla para que sirva como área.
  it('saca el área de planificación sin las comillas', () => {
    expect(parseJobMetadata(raiz).planArea).toBe('SAPIBP1')
  })

  it('sin área de planificación queda vacía', () => {
    const sinArea = parseXml('<p><Job name="X"/></p>')
    expect(parseJobMetadata(sinArea).planArea).toBe('')
  })

  it('sin trabajo devuelve null: no es una integración', () => {
    expect(parseJobMetadata(parseXml('<p><DataStore name="ERP"/></p>'))).toBeNull()
  })
})

/** Un XML de integraciÃ³n con un lector de tabla, una Query y un escritor. */
const XML_TABLA = `<p xmlns:xmi="http://www.omg.org/XMI">
  <DataStore name="ERP"/>
  <DataStore name="IBP"/>
  <Job name="GOSCM_MD_PRODUCTO">
    <globalVariables name="$G_PLAN_AREA" defaultValue="'SAPIBP1'"/>
  </Job>
  <DataFlow name="DF_PRODUCTO" guid="G-1">
    <elements xmi:type="dataflow:TableReader" displayName="MARA_R" tableName="MARA"
              referencedDataStore="//@DataStore/0" location="[10,20]"/>
    <elements xmi:type="dataflow:QueryTransform" displayName="Target_Query" location="[100,20]">
      <outputSchema filterExpression="MARA_R.MTART = 'FERT'">
        <inputSchemas schemaName="MARA_R"/>
        <schemaNodes name="PRDID" projectionExpression="MARA_R.MATNR"/>
        <schemaNodes name="TXT" description="Texto" projectionExpression="upper(MARA_R.MAKTX)"/>
        <schemaNodes name="LOC" projectionExpression="lookup(DS.T1, LOCID, 'X', MARA_R.WERKS)"/>
      </outputSchema>
    </elements>
    <elements xmi:type="dataflow:TableLoader" displayName="Cargar" tableName="PRODUCT"
              referencedDataStore="//@DataStore/1" location="[200,20]"/>
    <connections sourceElement="/2/@elements.0" targetElement="/2/@elements.1" schemaName="MARA_R"/>
    <connections sourceElement="/2/@elements.1" targetElement="/2/@elements.2"/>
  </DataFlow>
</p>`

/** El primer `DataFlow` de un XML, que es lo que reciben las funciones de este bloque. */
const dataflowDe = (xml) => {
  for (const hijo of parseXml(xml).children) if (hijo.localName === 'DataFlow') return hijo
  return null
}

describe('buildFileFormatIndex', () => {
  it('indexa por la posiciÃ³n entre TODOS los hijos, no entre los formatos', () => {
    const raiz = parseXml('<p><DataStore name="ERP"/><FlatFileFormat name="SALIDA"/><DelimitedFileFormat name="CSV"/></p>')
    expect(buildFileFormatIndex(raiz)).toEqual({ 1: 'SALIDA', 2: 'CSV' })
  })

  it('un formato sin nombre igual ocupa su lugar', () => {
    expect(buildFileFormatIndex(parseXml('<p><FixedWidthFileFormat/></p>'))).toEqual({ 0: 'FILE_0' })
  })
})

describe('buildSchemaMapFull', () => {
  it('agrega los lectores de archivo, que `buildSchemaMap` deja fuera', () => {
    const df = dataflowDe(`<p xmlns:xmi="http://www.omg.org/XMI"><DataFlow>
      <elements xmi:type="dataflow:FileReader" displayName="Lector" outputSchemaName="VENTAS"/>
    </DataFlow></p>`)

    expect(buildSchemaMap(df, {})).toEqual({})
    expect(buildSchemaMapFull(df, {})).toEqual({
      Lector: { table: 'VENTAS', ds: 'FILE' },
      VENTAS: { table: 'VENTAS', ds: 'FILE' },
    })
  })

  it('sigue trayendo los lectores de tabla', () => {
    expect(buildSchemaMapFull(dataflowDe(XML_TABLA), { 0: 'ERP', 1: 'IBP' }).MARA_R)
      .toEqual({ table: 'MARA', ds: 'ERP' })
  })
})

describe('findWriter', () => {
  it('encuentra el escritor de tabla y su datastore', () => {
    expect(findWriter(dataflowDe(XML_TABLA), { 0: 'ERP', 1: 'IBP' }, {}, ''))
      .toEqual({ targetTable: 'PRODUCT', targetDS: 'IBP', fileLoaderFileName: '' })
  })

  // Un dataflow puede tener los dos; la tabla es el destino que interesa documentar.
  it('prefiere la tabla aunque el archivo venga primero', () => {
    const df = dataflowDe(`<p xmlns:xmi="http://www.omg.org/XMI"><DataFlow>
      <elements xmi:type="dataflow:FileLoader" displayName="Archivo"/>
      <elements xmi:type="dataflow:TableLoader" tableName="PRODUCT"/>
    </DataFlow></p>`)
    expect(findWriter(df, {}, {}, '').targetTable).toBe('PRODUCT')
  })

  it('resuelve el archivo por su formato y guarda el nombre del archivo', () => {
    const df = dataflowDe(`<p xmlns:xmi="http://www.omg.org/XMI"><DataFlow>
      <elements xmi:type="dataflow:FileLoader" displayName="Escribir" referencedFileFormat="//@FlatFileFormat/2">
        <properties name="file_name" value="ventas.csv"/>
      </elements>
    </DataFlow></p>`)
    expect(findWriter(df, {}, { 2: 'SALIDA' }, ''))
      .toEqual({ targetTable: 'SALIDA', targetDS: 'FILE_DC', fileLoaderFileName: 'ventas.csv' })
  })

  it('sin escritor no hay destino', () => {
    const df = dataflowDe('<p xmlns:xmi="http://www.omg.org/XMI"><DataFlow><elements xmi:type="dataflow:TableReader"/></DataFlow></p>')
    expect(findWriter(df, {}, {}, '')).toBeNull()
  })
})

describe('extractLookups', () => {
  it('se queda con la llamada entera, no con el primer parÃ©ntesis que cierra', () => {
    const transformaciones = {
      Q: { fields: [{ name: 'X', proj: "lookup(DS.T, C, 'X', substr(A.B, 1, 3)) + 1" }] },
    }
    expect(extractLookups(transformaciones))
      .toEqual([{ func: "lookup(DS.T, C, 'X', substr(A.B, 1, 3))", transform: 'Q' }])
  })

  it('encuentra dos lookups en la misma expresiÃ³n', () => {
    const transformaciones = { Q: { fields: [{ name: 'X', proj: 'lookup(a) || lookup(b)' }] } }
    expect(extractLookups(transformaciones).map((uno) => uno.func)).toEqual(['lookup(a)', 'lookup(b)'])
  })

  it('sin lookups no devuelve nada', () => {
    expect(extractLookups({ Q: { fields: [{ name: 'X', proj: 'A.B' }] } })).toEqual([])
  })
})

describe('extractFilters', () => {
  it('lista la tabla real del filtro, no el nombre del lector', () => {
    const df = dataflowDe(XML_TABLA)
    const filtros = extractFilters(df, parseTransforms(df), buildSchemaMapFull(df, { 0: 'ERP', 1: 'IBP' }))

    expect(filtros).toHaveLength(1)
    expect(filtros[0].sourceTable).toBe('MARA')
    expect(filtros[0].expression).toBe("MARA_R.MTART = 'FERT'")
  })

  it('trae tambiÃ©n las condiciones de uniÃ³n', () => {
    const df = dataflowDe(`<p xmlns:xmi="http://www.omg.org/XMI"><DataFlow>
      <elements xmi:type="dataflow:QueryTransform" displayName="Q">
        <outputSchema>
          <joins expression="A.ID = B.ID"/>
        </outputSchema>
      </elements>
    </DataFlow></p>`)
    expect(extractFilters(df, parseTransforms(df), {}).map((uno) => uno.expression)).toEqual(['A.ID = B.ID'])
  })

  // La misma expresiÃ³n reaparece en cada transformaciÃ³n encadenada; documentarla cinco veces no sirve.
  it('no repite la misma expresiÃ³n', () => {
    const transformaciones = {
      Q1: { fields: [], filterExpr: 'A.X = 1' },
      Q2: { fields: [], filterExpr: 'A.X = 1' },
    }
    expect(extractFilters(dataflowDe('<p><DataFlow/></p>'), transformaciones, {})).toHaveLength(1)
  })
})

describe('parseDataflowDiagram', () => {
  const diagrama = parseDataflowDiagram(dataflowDe(XML_TABLA), { 0: 'ERP', 1: 'IBP' })

  it('numera los nodos por su posiciÃ³n, que es como los referencian las conexiones', () => {
    expect(diagrama.nodes.map((uno) => uno.id)).toEqual([0, 1, 2])
    expect(diagrama.edges).toEqual([
      { from: 0, to: 1, schemaName: 'MARA_R' },
      { from: 1, to: 2, schemaName: '' },
    ])
  })

  it('quita el prefijo del tipo XMI y lee la posiciÃ³n en el lienzo', () => {
    expect(diagrama.nodes[0].xmiType).toBe('TableReader')
    expect(diagrama.nodes[0].location).toEqual({ x: 10, y: 20 })
  })

  it('a un lector de tabla le pone su tabla y su datastore', () => {
    expect(diagrama.nodes[0].tableName).toBe('MARA')
    expect(diagrama.nodes[0].dsName).toBe('ERP')
  })

  it('a una transformaciÃ³n le guarda el paso a paso', () => {
    expect(diagrama.nodes[1].inputSchemas).toEqual(['MARA_R'])
    expect(diagrama.nodes[1].filterExpression).toBe("MARA_R.MTART = 'FERT'")
    expect(diagrama.nodes[1].fields.map((uno) => uno.name)).toEqual(['PRDID', 'TXT', 'LOC'])
  })

  it('una conexiÃ³n que no apunta a un elemento se descarta', () => {
    const df = dataflowDe('<p><DataFlow><connections sourceElement="basura" targetElement="basura"/></DataFlow></p>')
    expect(parseDataflowDiagram(df, {}).edges).toEqual([])
  })
})

describe('parseDataflow', () => {
  const resultado = parseDataflow(dataflowDe(XML_TABLA), { 0: 'ERP', 1: 'IBP' }, {}, '', '')

  it('mapea cada campo destino hasta su tabla de origen', () => {
    expect(resultado.mappings[0]).toEqual({
      srcDS: 'ERP',
      srcTable: 'MARA_R',
      srcField: 'MATNR',
      dstDS: 'IBP',
      dstTable: 'PRODUCT',
      dstField: 'PRDID',
      dstDesc: 'Id de producto',
      ops: '',
    })
  })

  // `ops` solo se llena cuando de verdad se le hace algo al campo.
  it('muestra la operaciÃ³n solo cuando el campo no se copia tal cual', () => {
    expect(resultado.mappings[1].ops).toBe('upper(MARA_R.MAKTX)')
    expect(resultado.mappings[1].dstDesc).toBe('Texto')
  })

  it('trae los filtros, los lookups y el diagrama en el mismo recorrido', () => {
    expect(resultado.filters).toHaveLength(1)
    expect(resultado.lookups).toHaveLength(1)
    expect(resultado.diagram.nodes).toHaveLength(3)
    expect(resultado.dataflowName).toBe('DF_PRODUCTO')
    expect(resultado.dataflowGuid).toBe('G-1')
  })

  it('un dataflow sin escritor no es una integraciÃ³n', () => {
    expect(parseDataflow(dataflowDe('<p><DataFlow/></p>'), {}, {}, '', '')).toBeNull()
  })
})

describe('parseIntegration', () => {
  it('devuelve el trabajo con su dataflow y el Ã¡rea sin las comillas del XMI', () => {
    const [integracion] = parseIntegration(XML_TABLA)
    expect(integracion.jobName).toBe('GOSCM_MD_PRODUCTO')
    expect(integracion.planArea).toBe('SAPIBP1')
    expect(integracion.tipoIntegracion).toBe('MD')
    expect(integracion.targetTable).toBe('PRODUCT')
  })

  it('completa los datastores que el XML no dijo con lo que trae el batch.csv', () => {
    const sinDatastore = XML_TABLA.replace(' referencedDataStore="//@DataStore/0"', '')
    const [integracion] = parseIntegration(sinDatastore, {
      src_datastore_Name: 'ERP_CSV',
      target_datastorename: 'IBP_CSV',
    })

    expect(integracion.mappings[0].srcDS).toBe('ERP_CSV')
    expect(integracion.dstDSName).toBe('IBP_CSV')
  })

  // v9 fusionaba los dataflows de un XML en uno solo y se perdÃ­an destinos sin avisar.
  it('un XML con dos dataflows da dos integraciones', () => {
    const uno = XML_TABLA.slice(XML_TABLA.indexOf('<DataFlow'), XML_TABLA.indexOf('</DataFlow>') + 11)
    const dos = XML_TABLA.replace('</p>', `${uno.replace('DF_PRODUCTO', 'DF_CLIENTE').replace('"PRODUCT"', '"CUSTOMER"')}</p>`)

    expect(parseIntegration(dos).map((una) => una.targetTable)).toEqual(['PRODUCT', 'CUSTOMER'])
  })

  it('sin trabajo no hay integraciÃ³n que documentar', () => {
    expect(parseIntegration('<p><DataFlow/></p>')).toEqual([])
  })

  it('un XML roto no revienta', () => {
    expect(parseIntegration('<p><sin cerrar')).toEqual([])
  })
})
