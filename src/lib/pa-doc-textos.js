// Los textos del documento de un área de planificación.
//
// Portados LETRA POR LETRA del diccionario `T.es` de `paDoc.js` de v7. v7 genera el documento en español
// y en inglés según el idioma de la interfaz; el idioma de la suite es una fase propia que se hace
// cuando todo esté portado, así que por ahora solo está el español. Pero el código ya lee los textos por
// idioma (`textosDe`): cuando llegue esa fase, el inglés es añadir su diccionario en `TEXTOS.en` —el
// `T.en` de v7— sin tocar a quien los usa.
//
// Los textos no se «arreglan» aquí: «Abra el documento en Word y actualice este campo» está en usted
// porque es el texto de v7, y es un documento que se entrega al cliente.

const es = {
  docTitle: 'Documentación del Planning Area',
  subtitle: 'SAP Integrated Business Planning',
  genBy: 'Generado con GoSCM · PA Documenter',
  metaClient: 'Cliente',
  metaPA: 'Planning Area',
  metaAuthor: 'Autor',
  metaVersion: 'Versión del documento',
  metaDate: 'Fecha de generación',
  metaGen: 'Generado con',
  toc: 'Tabla de contenido',
  tocHint: 'Abra el documento en Word y actualice este campo (clic derecho → Actualizar campos) para ver la tabla de contenido.',
  colField: 'Campo',
  colValue: 'Valor',
  colObject: 'Objeto',
  colQty: 'Cantidad',
  colDetail: 'Detalle',
  notProvided: 'No provisto en los archivos cargados.',

  s1: '1. Resumen ejecutivo',
  s1intro: 'Un Planning Area (área de planificación) es el contenedor central del modelo de SAP IBP: define los niveles de planificación, los atributos de datos maestros, las key figures (indicadores), las versiones de escenario y los procesos que operan sobre el plan. Este documento describe la configuración del área {pa}, extraída del Download Configuration File.',
  s1mods: 'Módulos de SAP IBP identificados en la configuración: {mods}.',
  s1figs: '1.1 Cifras clave',
  s1figsIntro: 'Resumen cuantitativo de los principales objetos configurados en el área.',

  s2: '2. Configuración general',
  s2gi: '2.1 Información general',
  s2giIntro: 'Parámetros globales del área: si tiene planificación de suministro habilitada, historial de cambios, key figures de orden, y el perfil de tiempo asociado.',
  s2tp: '2.2 Perfil de tiempo',
  s2tpIntro: 'El perfil de tiempo define los niveles temporales sobre los que se planifica (día, semana, mes, trimestre, año) y el nivel al que se almacenan los datos. Determina la granularidad temporal de todas las key figures.',
  s2ph: '2.3 Horizontes de planificación',
  s2phIntro: 'Ventana de visualización por defecto hacia el pasado y el futuro en cada nivel temporal.',

  s3: '3. Modelo de datos maestros',
  s3intro: 'Los Master Data Types (tipos de datos maestros) describen los objetos del negocio sobre los que se planifica: productos, ubicaciones, clientes, recursos, fuentes de aprovisionamiento, etc. Pueden ser Simple (tabla propia), Reference (referencia a otro tipo) o Compound (combinación de varios).',
  s3mdt: '3.1 Master Data Types',
  s3mdtIntro: 'Se identifican {n} tipos de datos maestros con {a} atributos en total. La columna "En PA" indica cuántos atributos de cada tipo están activos en esta área.',
  s3attr: '3.2 Atributos del Planning Area',
  s3attrIntro: 'Atributos habilitados en el área, con su tipo de dato, longitud y categoría. Los atributos son las dimensiones por las que se puede desglosar y filtrar la información.',
  s3aak: '3.3 Atributos usados como Key Figure',
  s3aakIntro: 'Atributos de datos maestros que se exponen como key figures (por ejemplo lead times o costos), permitiendo usarlos en cálculos y planificación como si fueran indicadores.',

  s4: '4. Planning Levels',
  s4intro: 'Un Planning Level (nivel de planificación) es una combinación de atributos que define la granularidad a la que se almacena o calcula una key figure (por ejemplo Producto × Ubicación × Cliente × Semana). El área define {n} niveles; se listan con su descripción y los atributos que los componen.',

  s5: '5. Key Figures',
  s5intro: 'Una Key Figure es un indicador cuantitativo del plan (demanda, pronóstico, inventario, capacidad, etc.). Puede ser almacenada (Stored, guarda valores) o calculada (Calculated, se deriva de otras mediante una expresión). Las helper son auxiliares de cálculo y las alert generan alertas. Cada key figure tiene un nivel base, modos de agregación/desagregación y, si es calculada, una definición de cálculo.',
  s5cls: '5.1 Clasificación',
  s5clsColA: 'Clasificación',
  s5clsColB: 'Cantidad',
  s5cTotal: 'Total',
  s5cStored: 'Almacenadas (Stored)',
  s5cCalc: 'Calculadas (Calculated)',
  s5cHelper: 'Auxiliares (Helper)',
  s5cAlert: 'De alerta (Alert)',
  s5lvl: '5.2 Distribución por nivel base',
  s5lvlIntro: 'Número de key figures definidas en cada nivel de planificación (los 20 niveles con más key figures).',
  s5colLvl: 'Nivel base',
  s5colN: 'N.º KF',

  s6: '6. Versiones del Planning Area',
  s6intro: 'Las versiones permiten mantener escenarios alternativos del plan (base, optimista, pesimista, etc.). La versión base contiene el plan oficial; las versiones específicas pueden tener sus propios valores de key figures. Se registran {n} definiciones de key figures por versión.',
  s6colV: 'Versión',
  s6colN: 'N.º de key figures',

  s7: '7. Operadores y procesos de planificación',
  s7intro: 'Los operadores son los procesos que transforman los datos del área: copiar valores entre key figures (Copy), ejecutar modelos de pronóstico (Forecast), tomar capturas (Snapshot), correr el optimizador o la heurística de suministro (SCM), segmentar productos (ABC/XYZ), calcular lead times, etc. Se identifican {n} operadores en {c} categorías.',
  s7colCat: 'Categoría (perfil)',
  s7colType: 'Tipo',
  s7colN: 'N.º',
  s7colName: 'Nombre',
  s7colDescr: 'Descripción',

  s8: '8. Snapshots',
  s8intro: 'Un snapshot captura el valor de una o varias key figures en un momento dado, para poder comparar la evolución del plan a lo largo del tiempo (por ejemplo, medir el error de pronóstico por lag). Se documentan los perfiles configurados con sus key figures de entrada y salida.',

  s9: '9. Conversiones de UM y moneda',
  s9intro: 'Reglas de conversión entre unidades de medida y entre monedas usadas por las key figures del área.',
  s9uom: '9.1 Conversiones de unidad de medida',
  s9cur: '9.2 Conversiones de moneda',
  s9noUom: 'No hay conversiones de unidad de medida configuradas en este Planning Area.',
  s9noCur: 'No hay conversiones de moneda configuradas en este Planning Area.',

  s10: '10. Application Jobs y procesos programados',
  s10intro: 'Los Application Jobs son las tareas programables del tenant de SAP IBP (copias de versión, ejecución de operadores, integración de datos CI-DS, etc.). Se leyeron en vivo {n} plantillas de job vía SAP_COM_0326. Para cada una se listan sus pasos en orden de ejecución; los pasos de integración de datos (CI-DS) se marcan con "Sí".',
  s10none: 'No se obtuvieron Application Jobs: se requiere conexión a SAP IBP y que el servicio SAP_COM_0326 devuelva plantillas.',
  s10sum: '10.1 Resumen de plantillas',
  s10cols: ['Job', 'Descripción', 'N.º pasos', 'Pasos CI-DS'],
  s10stepCols: ['#', 'Paso', 'Tipo de paso', 'CI-DS'],
  s10yes: 'Sí',

  anexoA: 'Anexo A. Índice completo de Key Figures',
  anexoAintro: 'Listado de las {n} key figures con su nivel base, tipo, modo de agregación y expresión de cálculo.',
  anexoAcols: ['ID', 'Nombre', 'Nivel base', 'Tipo', 'Agregación', 'Definición de cálculo'],
  anexoB: 'Anexo B. Atributos por Master Data Type',
  anexoBintro: 'Detalle de todos los atributos de cada tipo de dato maestro, con su tipo, longitud, si es clave, si es obligatorio y la referencia a otros tipos.',
  anexoBcols: ['MDT', 'Atributo', 'Descripción', 'Tipo', 'Long.', 'Key', 'Req.', 'Ref. MDT'],
  s3mdtCols: ['ID', 'Nombre', 'Tipo', 'Atributos', 'En PA'],
  s3mdtColRows: 'Registros (en vivo)',
  s3mdtVol: 'Volumetría en vivo (SAP_COM_0720): {n} registros de datos maestros en total. Un guion (—) indica que ese tipo no expone una entidad de datos consultable o no devolvió volumen.',
  s3attrCols: ['MDT', 'Atributo', 'Descripción', 'Tipo', 'Long.', 'Categoría'],
  s4cols: ['Planning Level', 'Descripción', 'N.º attrs', 'Atributos (muestra)'],
  s8cols: ['Perfil', 'Descripción', 'Desde', 'Hasta', 'N.º', 'Operador', 'KF ID', 'KF Nombre'],
}

/** Los diccionarios por idioma. El inglés de v7 (`T.en`) se añade aquí en la fase de idioma. */
export const TEXTOS = Object.freeze({ es })

/** El idioma con el que se genera hoy: el único que hay. */
export const IDIOMA_DEL_DOCUMENTO = 'es'

/** El diccionario de un idioma; lo que no tenga se lee del español, como hacía `tr` de v7. */
export const textosDe = (idioma = IDIOMA_DEL_DOCUMENTO) => ({ ...es, ...(TEXTOS[idioma] ?? {}) })

/** Sustituye los `{marcadores}` de un texto. Los que no se dan quedan como están. */
export const interpolar = (texto, valores) => String(texto).replace(
  /\{(\w+)\}/g,
  (marca, clave) => (valores && clave in valores ? String(valores[clave]) : marca),
)
