// @vitest-environment jsdom
//
// Este es el primer test que necesita un navegador de mentira: el parser usa `DOMParser`, que no
// existe en Node. El resto de la aplicación se sigue probando sin él.

import { describe, it, expect } from 'vitest'
import {
  buildDatastoreIndex,
  buildSchemaMap,
  datastoreFromRef,
  getProp,
  integrationType,
  isFileTarget,
  parseBatchCsv,
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
