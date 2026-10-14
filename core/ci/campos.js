// Los campos que el iFlow de CPI conoce, tal como aparecen en los bodies reales.
//
// Salen de TRES bodies que el usuario mostró (uno de dato maestro y dos de cifras clave) y de la captura de
// un cuarto. No son una lista cerrada: el iFlow puede aceptar más, y lo que un body traiga y esta lista no
// conozca se conserva y se edita en «Otros campos». Esta lista solo decide qué campos tienen su propio
// control en el formulario, en qué orden y con qué nombre.
//
// Pura, sin dependencias: la usan la pantalla y las pruebas.

/** Las dos familias de body que se vieron. `TypeOfData` es lo que las distingue. */
export const TIPOS_DE_DATO = Object.freeze({
  MASTERDATA: 'Dato maestro',
  KEYFIGURES: 'Cifras clave',
})

/**
 * Los campos con control propio, en el orden en que aparecen en los bodies reales.
 *
 * `solo` limita el campo a una familia (`TypeOfData`); sin él vale para todas. `ayuda` es lo que se dice debajo
 * del control, y solo lleva lo que se ve en los bodies: no se inventa qué hace cada campo en el iFlow.
 */
export const CAMPOS_CONOCIDOS = Object.freeze([
  { campo: 'BatchCommand', etiqueta: 'Comando', ayuda: 'Se vio INSERT_UPDATE en dato maestro y REPLACE en cifras clave.', sugerencias: ['INSERT_UPDATE', 'REPLACE'] },
  { campo: 'BatchName', etiqueta: 'Nombre del lote' },
  { campo: 'BatchKey', etiqueta: 'Clave del lote' },
  { campo: 'DataSource', etiqueta: 'Fuente de datos' },
  { campo: 'DestinationforAddon', etiqueta: 'Destino del add-on' },
  { campo: 'DestinationforSAPIBP', etiqueta: 'Destino en SAP IBP' },
  { campo: 'TypeOfData', etiqueta: 'Tipo de dato', fijo: true },
  { campo: 'MasterDataPrefix', etiqueta: 'Prefijo del maestro', solo: 'MASTERDATA' },
  { campo: 'MasterDataType', etiqueta: 'Tipo de maestro', solo: 'MASTERDATA' },
  { campo: 'TargetTimeProfileLevelinSAPIBP', etiqueta: 'Nivel del perfil de tiempo', solo: 'KEYFIGURES' },
  { campo: 'PlanningArea', etiqueta: 'Planning Area' },
  { campo: 'PlanningAreaVersion', etiqueta: 'Versión', ayuda: 'Se vio vacía y con un valor (PVSMD) en dato maestro.' },
  { campo: 'FileName', etiqueta: 'Nombre del archivo', solo: 'KEYFIGURES' },
  { campo: 'MaxPackageSize', etiqueta: 'Tamaño máximo del paquete' },
])

/** Los campos que se editan con controles propios y no entran en «Otros campos». */
export const CAMPOS_ESPECIALES = Object.freeze([
  'SourceFieldsfromAddon',
  'TargetFieldsInSAPIBP',
  'FieldMapping',
  'FilterForTheDataSource',
])

/** Los campos que tienen control propio, de todas las familias. */
export const NOMBRES_CON_CONTROL = new Set([
  ...CAMPOS_CONOCIDOS.map((una) => una.campo),
  ...CAMPOS_ESPECIALES,
])

/** Los campos conocidos que valen para una familia, en orden. Sin familia reconocida, todos. */
export const camposDe = (tipo) => CAMPOS_CONOCIDOS.filter((una) => !una.solo || una.solo === tipo)

/** El nombre de bloque con que se suele escribir cada familia. Es solo la propuesta al crear. */
export const BLOQUE_POR_TIPO = Object.freeze({ MASTERDATA: 'PRODUCT', KEYFIGURES: 'KEYFIGURE' })

/**
 * El body con que se empieza una integración nueva. Los valores por omisión son los que se repiten en todos
 * los ejemplos (destinos `PRD` e `IBP`, paquete de 100 MB); lo demás queda vacío para escribirlo.
 */
export function plantillaDeBody(tipo) {
  const esMaestro = tipo === 'MASTERDATA'
  const bloque = {
    BatchCommand: esMaestro ? 'INSERT_UPDATE' : 'REPLACE',
    BatchName: '',
    BatchKey: '',
    DataSource: '',
    DestinationforAddon: 'PRD',
    DestinationforSAPIBP: 'IBP',
    SourceFieldsfromAddon: '',
    TargetFieldsInSAPIBP: '',
    FieldMapping: '',
    TypeOfData: esMaestro ? 'MASTERDATA' : 'KEYFIGURES',
    ...(esMaestro
      ? { MasterDataPrefix: '', MasterDataType: '' }
      : { TargetTimeProfileLevelinSAPIBP: '' }),
    PlanningArea: '',
    PlanningAreaVersion: '',
    ...(esMaestro ? {} : { FileName: '' }),
    MaxPackageSize: '104857600',
    FilterForTheDataSource: '',
  }
  return JSON.stringify({ [BLOQUE_POR_TIPO[esMaestro ? 'MASTERDATA' : 'KEYFIGURES']]: bloque }, null, 2)
}
