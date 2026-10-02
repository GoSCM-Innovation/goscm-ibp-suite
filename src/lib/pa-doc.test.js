// @vitest-environment jsdom
//
// El documento del área de planificación: se genera de verdad, se abre como ZIP y se comprueba el XML.
//
// Los encabezados de los CSV son los que lee v7 (`getLike(o,'ID')`, `'Name'`, `'Base Planning Level'`,
// `'Attribute ID'`, `'Operator Profile / Operator Type'`…). Ninguno está inventado para la prueba.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import { agregarCsv, estadoInicial } from '../../core/ibp/pa-doc-model.js'
import {
  MAX_DEFINICION,
  extensionDeImagen,
  fechaDeGeneracion,
  generarDocumento,
  ingerirArchivos,
  nombreDelArchivo,
  numero,
} from './pa-doc.js'

// ── Datos de muestra ─────────────────────────────────────────────────────────────────────────────

const CSV = {
  GENERAL_INFO: 'Planning Area ID;Description;Time Profile ID\nMIAREA;Área de prueba;TP_SEMANAL\n',
  TIMEPROFILE: 'Time Profile ID;Time Profile Level\nTP_SEMANAL;WEEK\nTP_SEMANAL;MONTH\n',
  PLANNING_HORIZONS: 'Planning Horizon;From;To\nWEEK;-4;52\n',
  MASTERDATATYPES: [
    'Master Data Type ID;Name;Type;Used in Planning Area;Attribute ID;Attribute Description;Data Type;Length;Key;Required;Referenced Master Data Type',
    'PRODUCT;Producto;Simple;X;PRDID;Id de producto;String;20;X;X;',
    'PRODUCT;Producto;Simple;;PRDDESCR;Descripción;String;40;;;',
    'LOCATION;Ubicación;Simple;X;LOCID;Id de ubicación;String;20;X;X;',
    'VIRTUAL;Virtual;Reference;;VID;Id virtual;String;10;;;',
  ].join('\n'),
  PA_ATTRIBUTES: [
    'Master Data Type ID;Attribute ID;Planning Area Attribute Description;Data Type;Length;Attribute Category',
    'PRODUCT;PRDID;Id de producto;String;20;Master',
  ].join('\n'),
  ATTRIBUTES_AS_KEYFIGURE: 'Master Data Type ID;Planning Area Attribute;Description\nPRODUCT;LEADTIME;Plazo\n',
  PLEVELS_ATTRS: [
    'Planning Level;Description;Attribute ID',
    'PL_A;Nivel A;PRDID',
    'PL_A;Nivel A;LOCID',
    'PL_B;Nivel B;PRDID',
  ].join('\n'),
  KEYFIGURES: [
    'ID;Name;Base Planning Level;Stored Key Figure;Calculated Key Figure;Aggregation Mode;Calculation Definitions;Hashtags;Helper Key Figure;Alert Key Figure',
    'KF1;Demanda;PL_A;X;;SUM;;#DP #IO;;',
    'KF2;Pronóstico;PL_A;;X;SUM;"IF(A>0;\nB;C)";#DP;;',
    'KF3;Ayuda;PL_B;;X;AVG;;;X;',
    'KF4;Alerta;;X;;;;;;X',
  ].join('\n'),
  VERSIONS: 'ID;Key Figure\nV1;KF1\nV1;KF2\nV2;KF1\n',
  OPERATORS: [
    'Operator Profile / Operator Type;Operator Profile Name / Operator Type Name;Name;Description',
    'COPY;Copiar;COPIA_UNO;Copia uno',
    'COPY;Copiar;COPIA_DOS;Copia dos',
    'FORECAST;Pronóstico;PRON_UNO;Pronostica',
  ].join('\n'),
  SNAPSHOTS: [
    'Name;Description;From Period;To Period;Number of Snapshots;Operator ID;Key Figure ID;Key Figure Name',
    'SNAP1;Captura;2024;2025;3;OP1;KF1;Demanda',
  ].join('\n'),
  UOM_CONVERSIONS: 'Source Unit;Target Unit;Factor\nKG;TON;0.001\n',
  CURRENCY_CONVERSIONS: 'Source Currency;Target Currency;Rate Type\nUSD;COP;M\n',
}

/** El estado con las secciones pedidas (todas por omisión), soltadas como las nombra SAP. */
function estadoCon(ids = Object.keys(CSV), area = 'MIAREA') {
  let estado = estadoInicial()
  for (const id of ids) estado = agregarCsv(estado, `${area}_${id}.csv`, CSV[id]).estado
  return estado
}

const AHORA = new Date('2026-10-01T15:00:00Z')

async function generar(opciones = {}) {
  const salida = await generarDocumento({
    estado: estadoCon(),
    meta: { cliente: 'ACME', autor: 'Ana', version: '2.1' },
    ahora: AHORA,
    ...opciones,
  })
  const zip = await JSZip.loadAsync(salida.buffer)
  const xml = await zip.file('word/document.xml').async('string')
  return { ...salida, zip, xml }
}

/** Los títulos del documento como `[nivel, texto]`. */
const titulosDe = (xml) => [...xml.matchAll(/<w:pStyle w:val="Heading(\d)"\/><\/w:pPr><w:r><w:t xml:space="preserve">([^<]*)</g)]
  .map((una) => [Number(una[1]), una[2]])

/** Todo el texto del documento, en orden. */
const textosDe = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((una) => una[1])

/** Las filas de la tabla que sigue a un título, como listas de texto. */
function tablaTrasTitulo(xml, texto) {
  const desde = xml.indexOf(`>${texto}<`)
  expect(desde, `no está el título ${texto}`).toBeGreaterThan(-1)
  const resto = xml.slice(desde)
  const tabla = resto.slice(resto.indexOf('<w:tbl>'), resto.indexOf('</w:tbl>'))
  return tabla.split('<w:tr>').slice(1).map((fila) => textosDe(fila))
}

// ── Pruebas ──────────────────────────────────────────────────────────────────────────────────────

describe('el documento completo', () => {
  it('tiene las diez secciones numeradas y los dos anexos, en el orden de v7', async () => {
    const { xml } = await generar({
      enriquecimiento: { appJobs: [{ name: 'JOB1', text: 'Carga', steps: [] }], mdtCounts: { PRODUCT: 3 } },
    })
    const principales = titulosDe(xml).filter(([nivel]) => nivel === 1).map(([, texto]) => texto)

    expect(principales).toEqual([
      'Tabla de contenido',
      '1. Resumen ejecutivo',
      '2. Configuración general',
      '3. Modelo de datos maestros',
      '4. Planning Levels',
      '5. Key Figures',
      '6. Versiones del Planning Area',
      '7. Operadores y procesos de planificación',
      '8. Snapshots',
      '9. Conversiones de UM y moneda',
      '10. Application Jobs y procesos programados',
      'Anexo A. Índice completo de Key Figures',
      'Anexo B. Atributos por Master Data Type',
    ])
  })

  it('las subsecciones son las de v7', async () => {
    const { xml } = await generar()
    const segundos = titulosDe(xml).filter(([nivel]) => nivel === 2).map(([, texto]) => texto)

    expect(segundos).toEqual([
      '1.1 Cifras clave',
      '2.1 Información general',
      '2.2 Perfil de tiempo',
      '2.3 Horizontes de planificación',
      '3.1 Master Data Types',
      '3.2 Atributos del Planning Area',
      '3.3 Atributos usados como Key Figure',
      '5.1 Clasificación',
      '5.2 Distribución por nivel base',
      '7.1 Copiar',
      '7.2 Pronóstico',
      '9.1 Conversiones de unidad de medida',
      '9.2 Conversiones de moneda',
    ])
  })

  it('sin enriquecimiento no hay sección 10', async () => {
    const { xml } = await generar()
    expect(titulosDe(xml).map(([, texto]) => texto).join('|')).not.toContain('10.')
  })

  it('el cuerpo es XML bien formado en todas sus piezas', async () => {
    const { zip } = await generar({
      enriquecimiento: { appJobs: [{ name: 'A&B', text: '<x>', steps: [] }], mdtCounts: {} },
    })
    for (const nombre of Object.keys(zip.files).filter((una) => /\.(xml|rels)$/.test(una))) {
      const texto = await zip.file(nombre).async('string')
      const analizado = new DOMParser().parseFromString(texto, 'application/xml')
      expect(analizado.getElementsByTagName('parsererror'), nombre).toHaveLength(0)
    }
  })

  it('el índice lleva el texto de ayuda de v7 y Word lo actualiza al abrir', async () => {
    const { xml, zip } = await generar()
    expect(xml).toContain('TOC \\o "1-3" \\h \\z \\u')
    expect(textosDe(xml)).toContain('Abra el documento en Word y actualice este campo (clic derecho → Actualizar campos) para ver la tabla de contenido.')
    expect(await zip.file('word/settings.xml').async('string')).toContain('updateFields')
  })
})

describe('la portada', () => {
  it('lleva el cliente en naranja, el título, el área, la descripción y el subtítulo', async () => {
    const { xml } = await generar()
    const portada = xml.slice(0, xml.indexOf('Tabla de contenido'))

    expect(portada).toContain('<w:color w:val="E8622A"/><w:sz w:val="40"/></w:rPr><w:t xml:space="preserve">ACME')
    expect(textosDe(portada)).toEqual(expect.arrayContaining([
      'ACME', 'Documentación del Planning Area', 'MIAREA', 'Área de prueba', 'SAP Integrated Business Planning',
    ]))
  })

  it('la tabla Campo/Valor trae cliente, área, autor, versión, fecha y «Generado con»', async () => {
    const { xml } = await generar()
    const portada = textosDe(xml.slice(0, xml.indexOf('Tabla de contenido')))

    const desde = portada.indexOf('Campo')
    expect(portada.slice(desde, desde + 14)).toEqual([
      'Campo', 'Valor',
      'Cliente', 'ACME',
      'Planning Area', 'MIAREA',
      'Autor', 'Ana',
      'Versión del documento', '2.1',
      'Fecha de generación', '1 de octubre de 2026',
      'Generado con', 'GoSCM · PA Documenter',
    ].slice(0, 14))
    expect(portada).toContain('Generado con GoSCM · PA Documenter')
  })

  it('sin cliente la portada dice «Cliente», y sin versión, «1.0»', async () => {
    const { xml } = await generar({ meta: {} })
    const portada = textosDe(xml.slice(0, xml.indexOf('Tabla de contenido')))
    expect(portada[0]).toBe('Cliente')
    expect(portada).toContain('1.0')
  })

  it('sin área detectada dice «SAP IBP»', async () => {
    const { xml } = await generar({ estado: agregarCsv(estadoInicial(), 'VERSIONS.csv', 'ID\nV1').estado })
    expect(textosDe(xml.slice(0, xml.indexOf('Tabla de contenido')))).toContain('SAP IBP')
  })

  it('la fecha es es-CO con el mes en letras', () => {
    expect(fechaDeGeneracion(AHORA)).toBe('1 de octubre de 2026')
  })

  it('el logo del cliente y el de GoSCM se incrustan en la portada', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const { xml, zip } = await generar({
      logo: { base64: png, extension: 'png', ancho: 600, alto: 200 },
      marca: { base64: png, extension: 'png', ancho: 300, alto: 100 },
    })

    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['word/media/logo_cliente.png', 'word/media/logo_goscm.png']))
    expect(xml).toContain('r:embed="rIdLogo"')
    expect(xml).toContain('r:embed="rIdGoscm"')
    // El logo del cliente se escala a 240 píxeles de ancho; el de GoSCM, a 150.
    expect(xml).toContain(`cx="${240 * 9525}"`)
    expect(xml).toContain(`cx="${150 * 9525}"`)
    expect(xml.indexOf('rIdLogo')).toBeLessThan(xml.indexOf('Tabla de contenido'))
  })

  it('un logo JPEG se declara como image/jpeg', async () => {
    const { zip } = await generar({ logo: { base64: '/9j/AAAA', extension: 'jpeg', ancho: 10, alto: 10 } })
    expect(await zip.file('[Content_Types].xml').async('string'))
      .toContain('Extension="jpeg" ContentType="image/jpeg"')
  })

  it('sin logos no declara ninguna imagen', async () => {
    const { zip } = await generar()
    expect(Object.keys(zip.files).some((una) => una.startsWith('word/media/'))).toBe(false)
  })
})

describe('el resumen ejecutivo', () => {
  it('cita el área entre comillas curvas y los módulos deducidos', async () => {
    const { xml } = await generar()
    const textos = textosDe(xml)
    expect(textos.some((t) => t.includes('describe la configuración del área “MIAREA”, extraída'))).toBe(true)
    expect(textos).toContain('Módulos de SAP IBP identificados en la configuración: Demand Planning, Inventory Optimization.')
  })

  it('las cifras clave llevan las etiquetas de v7', async () => {
    const { xml } = await generar()
    const filas = tablaTrasTitulo(xml, '1.1 Cifras clave')

    expect(filas[0]).toEqual(['Objeto', 'Cantidad', 'Detalle'])
    expect(filas.slice(1)).toEqual([
      ['Key Figures', '4', '2 stored · 2 calc · 1 helper · 1 alert'],
      ['Planning Levels', '2', ''],
      ['Master Data Types', '3', '4 attrs'],
      ['Atributos del Planning Area', '1', ''],
      ['Operators', '3', '2 cat.'],
      ['Snapshots', '1', ''],
      ['Versions (KF)', '3', ''],
      ['Perfil de tiempo', 'TP_SEMANAL', ''],
    ])
  })
})

describe('configuración general y datos maestros', () => {
  it('la información general es una tabla Campo/Valor con todas las columnas', async () => {
    const filas = tablaTrasTitulo((await generar()).xml, '2.1 Información general')
    expect(filas).toEqual([
      ['Campo', 'Valor'],
      ['Planning Area ID', 'MIAREA'],
      ['Description', 'Área de prueba'],
      ['Time Profile ID', 'TP_SEMANAL'],
    ])
  })

  it('los tipos de dato maestro cuentan atributos y los activos en el área', async () => {
    const filas = tablaTrasTitulo((await generar()).xml, '3.1 Master Data Types')
    expect(filas).toEqual([
      ['ID', 'Nombre', 'Tipo', 'Atributos', 'En PA'],
      ['LOCATION', 'Ubicación', 'Simple', '1', '1'],
      ['PRODUCT', 'Producto', 'Simple', '2', '1'],
      ['VIRTUAL', 'Virtual', 'Reference', '1', '0'],
    ])
  })

  it('la volumetría en vivo añade la columna, con guion donde no hay número, y su total', async () => {
    const { xml } = await generar({
      enriquecimiento: { appJobs: [], mdtCounts: { PRODUCT: 12345, LOCATION: 5, VIRTUAL: null } },
    })
    const filas = tablaTrasTitulo(xml, '3.1 Master Data Types')

    expect(filas[0]).toEqual(['ID', 'Nombre', 'Tipo', 'Atributos', 'En PA', 'Registros (en vivo)'])
    expect(filas.map((f) => f[5])).toEqual(['Registros (en vivo)', '5', '12.345', '—'])
    expect(textosDe(xml)).toContain('Volumetría en vivo (SAP_COM_0720): 12.350 registros de datos maestros en total. Un guion (—) indica que ese tipo no expone una entidad de datos consultable o no devolvió volumen.')
  })

  it('sin volumetría no hay columna ni nota', async () => {
    const { xml } = await generar({ enriquecimiento: { appJobs: [], mdtCounts: null } })
    expect(tablaTrasTitulo(xml, '3.1 Master Data Types')[0]).toHaveLength(5)
    expect(textosDe(xml).join('|')).not.toContain('Volumetría en vivo')
  })
})

describe('niveles, cifras, versiones, operadores y snapshots', () => {
  it('los niveles agrupan sus atributos', async () => {
    const filas = tablaTrasTitulo((await generar()).xml, '4. Planning Levels')
    expect(filas).toEqual([
      ['Planning Level', 'Descripción', 'N.º attrs', 'Atributos (muestra)'],
      ['PL_A', 'Nivel A', '2', 'PRDID, LOCID'],
      ['PL_B', 'Nivel B', '1', 'PRDID'],
    ])
  })

  it('la muestra de un nivel se corta en 12 atributos y lo dice con « …»', async () => {
    const atributos = Array.from({ length: 15 }, (nada, i) => `PL;Nivel;ATR${i}`).join('\n')
    const estado = agregarCsv(estadoInicial(), 'X_PLEVELS_ATTRS.csv', `Planning Level;Description;Attribute ID\n${atributos}`).estado
    const { xml } = await generar({ estado })

    const fila = tablaTrasTitulo(xml, '4. Planning Levels')[1]
    expect(fila[2]).toBe('15')
    expect(fila[3]).toBe(`${Array.from({ length: 12 }, (nada, i) => `ATR${i}`).join(', ')} …`)
  })

  it('la clasificación y la distribución por nivel base', async () => {
    const { xml } = await generar()
    expect(tablaTrasTitulo(xml, '5.1 Clasificación')).toEqual([
      ['Clasificación', 'Cantidad'],
      ['Total', '4'],
      ['Almacenadas (Stored)', '2'],
      ['Calculadas (Calculated)', '2'],
      ['Auxiliares (Helper)', '1'],
      ['De alerta (Alert)', '1'],
    ])
    expect(tablaTrasTitulo(xml, '5.2 Distribución por nivel base')).toEqual([
      ['Nivel base', 'N.º KF'], ['PL_A', '2'], ['PL_B', '1'], ['(—)', '1'],
    ])
  })

  it('la distribución se limita a los 20 niveles con más cifras', async () => {
    const filas = Array.from({ length: 30 }, (nada, i) => `K${i};N;NIVEL${i};X;;;;;;`).join('\n')
    const estado = agregarCsv(estadoInicial(), 'X_KEYFIGURES.csv', `ID;Name;Base Planning Level;Stored Key Figure;a;b;c;d;e;f\n${filas}`).estado
    expect(tablaTrasTitulo((await generar({ estado })).xml, '5.2 Distribución por nivel base')).toHaveLength(21)
  })

  it('las versiones cuentan las definiciones por versión', async () => {
    expect(tablaTrasTitulo((await generar()).xml, '6. Versiones del Planning Area')).toEqual([
      ['Versión', 'N.º de key figures'], ['V1', '2'], ['V2', '1'],
    ])
  })

  it('los operadores van por categoría y luego uno por tipo', async () => {
    const { xml } = await generar()
    expect(tablaTrasTitulo(xml, '7. Operadores y procesos de planificación')).toEqual([
      ['Categoría (perfil)', 'Tipo', 'N.º'], ['Copiar', 'COPY', '2'], ['Pronóstico', 'FORECAST', '1'],
    ])
    expect(tablaTrasTitulo(xml, '7.1 Copiar')).toEqual([
      ['Nombre', 'Descripción'], ['COPIA_UNO', 'Copia uno'], ['COPIA_DOS', 'Copia dos'],
    ])
  })

  it('los snapshots traen sus ocho columnas', async () => {
    expect(tablaTrasTitulo((await generar()).xml, '8. Snapshots')).toEqual([
      ['Perfil', 'Descripción', 'Desde', 'Hasta', 'N.º', 'Operador', 'KF ID', 'KF Nombre'],
      ['SNAP1', 'Captura', '2024', '2025', '3', 'OP1', 'KF1', 'Demanda'],
    ])
  })
})

describe('lo que no vino', () => {
  it('una sección ausente dice «No provisto en los archivos cargados.»', async () => {
    const { xml } = await generar({ estado: estadoCon(['KEYFIGURES']) })
    const textos = textosDe(xml)
    const desde = textos.indexOf('4. Planning Levels')
    expect(textos[desde + 1]).toBe('No provisto en los archivos cargados.')
    expect(textos.filter((t) => t === 'No provisto en los archivos cargados.').length).toBeGreaterThanOrEqual(5)
  })

  it('las conversiones ausentes dicen que no hay ninguna configurada', async () => {
    const textos = textosDe((await generar({ estado: estadoCon(['KEYFIGURES']) })).xml)
    expect(textos).toContain('No hay conversiones de unidad de medida configuradas en este Planning Area.')
    expect(textos).toContain('No hay conversiones de moneda configuradas en este Planning Area.')
  })

  // v7 omite las subsecciones 3.2 y 3.3 si esos archivos no vinieron.
  it('las subsecciones de datos maestros solo salen si hay datos', async () => {
    const { xml } = await generar({ estado: estadoCon(['MASTERDATATYPES']) })
    const todos = titulosDe(xml).map(([, texto]) => texto)
    expect(todos).toContain('3.1 Master Data Types')
    expect(todos).not.toContain('3.2 Atributos del Planning Area')
    expect(todos).not.toContain('3.3 Atributos usados como Key Figure')
    expect(todos).not.toContain('2.1 Información general')
  })

  it('con las cifras ausentes el Anexo A lo dice', async () => {
    const textos = textosDe((await generar({ estado: estadoCon(['MASTERDATATYPES']) })).xml)
    const desde = textos.indexOf('Anexo A. Índice completo de Key Figures')
    expect(textos[desde + 1]).toBe('No provisto en los archivos cargados.')
  })
})

describe('los anexos', () => {
  it('el Anexo A trae todas las cifras con tipo S/C y la definición', async () => {
    const filas = tablaTrasTitulo((await generar()).xml, 'Anexo A. Índice completo de Key Figures')
    expect(filas[0]).toEqual(['ID', 'Nombre', 'Nivel base', 'Tipo', 'Agregación', 'Definición de cálculo'])
    expect(filas[1]).toEqual(['KF1', 'Demanda', 'PL_A', 'S', 'SUM', ''])
    expect(filas[2].slice(0, 5)).toEqual(['KF2', 'Pronóstico', 'PL_A', 'C', 'SUM'])
    expect(filas[2][5]).toContain('IF(A&gt;0;')
  })

  it('la definición se recorta a 220 caracteres', async () => {
    const larga = 'x'.repeat(300)
    const estado = agregarCsv(estadoInicial(), 'X_KEYFIGURES.csv', `ID;Name;Calculation Definitions\nK;N;${larga}`).estado
    const fila = tablaTrasTitulo((await generar({ estado })).xml, 'Anexo A. Índice completo de Key Figures')[1]
    expect(MAX_DEFINICION).toBe(220)
    expect(fila[5]).toBe(`${'x'.repeat(220)}…`)
  })

  // v7 no tiene tope: una suite que cortara a 400 filas daría un documento distinto.
  it('no hay tope de filas: 700 cifras salen las 700', async () => {
    const filas = Array.from({ length: 700 }, (nada, i) => `K${i};N${i};PL;X`).join('\n')
    const estado = agregarCsv(estadoInicial(), 'X_KEYFIGURES.csv', `ID;Name;Base Planning Level;Stored Key Figure\n${filas}`).estado
    expect(tablaTrasTitulo((await generar({ estado })).xml, 'Anexo A. Índice completo de Key Figures')).toHaveLength(701)
  })

  it('el Anexo B trae los atributos de cada tipo', async () => {
    const filas = tablaTrasTitulo((await generar()).xml, 'Anexo B. Atributos por Master Data Type')
    expect(filas[0]).toEqual(['MDT', 'Atributo', 'Descripción', 'Tipo', 'Long.', 'Key', 'Req.', 'Ref. MDT'])
    expect(filas[1]).toEqual(['PRODUCT', 'PRDID', 'Id de producto', 'String', '20', 'X', 'X', ''])
    expect(filas).toHaveLength(5)
  })
})

describe('los Application Jobs en vivo', () => {
  const jobs = [
    { name: 'ZB', text: 'Carga B', steps: [{ pos: 2, name: 'Dos', type: 'COPY', cids: false }, { pos: 1, name: 'Uno', type: 'DATA INTEGRATION', cids: true }] },
    { name: 'ZA', text: 'ZA', steps: [] },
  ]

  it('el resumen cuenta pasos y pasos CI-DS', async () => {
    const { xml } = await generar({ enriquecimiento: { appJobs: jobs, mdtCounts: null } })
    expect(tablaTrasTitulo(xml, '10.1 Resumen de plantillas')).toEqual([
      ['Job', 'Descripción', 'N.º pasos', 'Pasos CI-DS'],
      ['Carga B', 'ZB', '2', '1'],
      ['ZA', 'ZA', '0', '0'],
    ])
  })

  it('cada plantilla lleva sus pasos por posición y marca los de CI-DS con «Sí»', async () => {
    const { xml } = await generar({ enriquecimiento: { appJobs: jobs, mdtCounts: null } })
    expect(tablaTrasTitulo(xml, '10.2 Carga B')).toEqual([
      ['#', 'Paso', 'Tipo de paso', 'CI-DS'],
      ['1', 'Uno', 'DATA INTEGRATION', 'Sí'],
      ['2', 'Dos', 'COPY', ''],
    ])
    expect(tablaTrasTitulo(xml, '10.3 ZA')[1]).toEqual(['', '—', '', ''])
  })

  it('si el enriquecimiento no trajo jobs, la sección lo explica', async () => {
    const { xml } = await generar({ enriquecimiento: { appJobs: [], mdtCounts: null } })
    expect(textosDe(xml)).toContain('No se obtuvieron Application Jobs: se requiere conexión a SAP IBP y que el servicio SAP_COM_0326 devuelva plantillas.')
  })

  it('la introducción cuenta las plantillas', async () => {
    const { xml } = await generar({ enriquecimiento: { appJobs: jobs, mdtCounts: null } })
    expect(textosDe(xml).some((t) => t.includes('Se leyeron en vivo 2 plantillas de job vía SAP_COM_0326'))).toBe(true)
  })
})

describe('las tablas', () => {
  it('los encabezados son naranja y los de resumen, azul', async () => {
    const { xml } = await generar()
    expect(xml).toContain('w:fill="E8622A"')
    expect(xml).toContain('w:fill="1F3864"')
    expect(xml).not.toContain('DEEAF6')
  })
})

describe('el nombre del archivo', () => {
  it('es Documentacion_PA_<PA>_<AAAA-MM-DD>.docx', () => {
    expect(nombreDelArchivo('MIAREA', AHORA)).toBe('Documentacion_PA_MIAREA_2026-10-01.docx')
  })

  it('sin área dice IBP', () => {
    expect(nombreDelArchivo('', AHORA)).toBe('Documentacion_PA_IBP_2026-10-01.docx')
  })

  it('un área con caracteres que no valen en un nombre de archivo los sustituye', () => {
    expect(nombreDelArchivo('A/B:C', AHORA)).toBe('Documentacion_PA_A_B_C_2026-10-01.docx')
  })

  it('el documento generado lo trae', async () => {
    expect((await generar()).nombre).toBe('Documentacion_PA_MIAREA_2026-10-01.docx')
  })
})

describe('numero', () => {
  it('usa los separadores de es-CO', () => {
    expect(numero(12345)).toBe('12.345')
  })
})

describe('extensionDeImagen', () => {
  it('reconoce PNG y JPEG por su contenido', () => {
    expect(extensionDeImagen('iVBORw0KGgoAAAA')).toBe('png')
    expect(extensionDeImagen('/9j/4AAQ')).toBe('jpeg')
  })

  // v7 daba por PNG cualquier cosa que no se llamara .jpg: un .webp acababa roto dentro del Word.
  it('lo que no es ninguna de las dos no se acepta', () => {
    expect(extensionDeImagen('UklGRg==')).toBeNull()
    expect(extensionDeImagen('')).toBeNull()
  })
})

describe('ingerirArchivos', () => {
  const archivo = (name, contenido) => ({
    name,
    text: async () => contenido,
    arrayBuffer: async () => contenido,
  })

  async function ingerir(archivos) {
    let estado = estadoInicial()
    const registro = []
    await ingerirArchivos(archivos, {
      JSZip,
      obtenerEstado: () => estado,
      guardarEstado: (nuevo) => { estado = nuevo },
      registro: (clase, mensaje) => registro.push([clase, mensaje]),
    })
    return { estado, registro }
  }

  it('un CSV suelto se detecta y se dice', async () => {
    const { estado, registro } = await ingerir([archivo('AS_VERSIONS.csv', CSV.VERSIONS)])
    expect(estado.datos.VERSIONS.filas).toHaveLength(3)
    expect(registro).toEqual([['ok', 'Detectado: VERSIONS']])
  })

  it('un CSV que no es de ninguna sección se avisa como no reconocido', async () => {
    const { registro } = await ingerir([archivo('otro.csv', 'a;b')])
    expect(registro).toEqual([['warn', 'No reconocido: otro.csv']])
  })

  it('un ZIP se abre y cada CSV se dice con «ZIP →»', async () => {
    const zip = new JSZip()
    zip.file('carpeta/AS_VERSIONS.csv', CSV.VERSIONS)
    zip.file('AS_KEYFIGURES.csv', CSV.KEYFIGURES)
    zip.file('notas.txt', 'no es un csv')
    zip.file('raro.csv', 'a;b')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    const { estado, registro } = await ingerir([{ name: 'config.zip', arrayBuffer: async () => buffer }])

    expect(Object.keys(estado.datos).sort()).toEqual(['KEYFIGURES', 'VERSIONS'])
    expect(registro.map((r) => r[1]).sort()).toEqual(['ZIP → KEYFIGURES', 'ZIP → VERSIONS'])
  })

  it('un archivo que falla se dice y no detiene a los demás', async () => {
    const roto = { name: 'AS_KEYFIGURES.csv', text: async () => { throw new Error('boom') } }
    const { estado, registro } = await ingerir([roto, archivo('AS_VERSIONS.csv', CSV.VERSIONS)])

    expect(registro[0]).toEqual(['err', 'Error con AS_KEYFIGURES.csv: boom'])
    expect(estado.datos.VERSIONS).toBeDefined()
  })

  it('lo que no es CSV ni ZIP se ignora sin ruido', async () => {
    const { registro } = await ingerir([archivo('foto.png', '')])
    expect(registro).toEqual([])
  })
})
