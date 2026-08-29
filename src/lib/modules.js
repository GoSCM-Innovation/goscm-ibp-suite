// Los módulos que se venden, con su nombre visible y su icono, y las aplicaciones de cada uno.
//
// Los identificadores tienen que coincidir con los del backend (`core/auth/guards.js`) y con
// los de la base. El icono viene del estilo de v7: un emoji por módulo, reconocible de un
// vistazo y sin depender de ninguna librería.

// Los identificadores (`explorer`, `jobs`, `cids`) son los que viajan a la base y a las
// guardas del servidor: NO se tocan. Lo que se ve por pantalla es `name`, y cambiarlo no
// exige ninguna migración.

/**
 * Las seis aplicaciones de v7, con SUS nombres, SUS iconos y SU orden.
 *
 * Son las del menú lateral de v7 (`public/index.html`, `nav.bom`…`nav.padoc`), copiadas tal cual. Los
 * nombres se quedan en inglés aunque el resto de la suite esté en español porque son los que el
 * cliente lleva años viendo: renombrar «Production Analyzer» a «Calidad de datos» no traduce nada,
 * cambia el nombre de un producto que ya está en uso.
 *
 * `requiereConexion` marca las que no pueden hacer nada sin un tenant detrás: son las que en v7
 * llevaban el candado y la pantalla de «Módulo restringido». El glosario y el documentador no lo
 * llevaban —el primero explica los informes y el segundo trabaja sobre los CSV de configuración—.
 */
export const APPS_EXPLORER = [
  {
    id: 'bom',
    name: 'Production Visualizer',
    icon: '📦',
    requiereConexion: true,
    banner: 'Explora la estructura de producción BOM de cualquier material desde SAP IBP. Navega cada '
      + 'nivel de la jerarquía, identifica co-productos y componentes, y visualiza las plantas de '
      + 'producción asociadas.',
    bloqueado: 'La jerarquía de producción requiere leer datos en tiempo real. Por favor, conéctate a '
      + 'tu entorno de SAP IBP para acceder.',
  },
  {
    id: 'pa',
    name: 'Production Analyzer',
    icon: '🔬',
    requiereConexion: true,
    banner: 'Analiza la consistencia y calidad de la configuración de producción en SAP IBP. Detecta '
      + 'insumos sin red de compras, productos no habilitados en plantas, componentes sin Lead Time y '
      + 'más. Descarga un Excel con todos los hallazgos clasificados por severidad.',
    bloqueado: 'El analizador de producción requiere acceso a múltiples entidades de SAP IBP. Por '
      + 'favor, conéctate primero.',
  },
  {
    id: 'visualizer',
    name: 'Network Visualizer',
    icon: '🔭',
    requiereConexion: true,
    banner: 'Visualiza interactivamente la red logística de un material específico. Confirma el mapeo '
      + 'para cargar el catálogo de materiales, selecciona uno y pulsa «Cargar red logística» para ver '
      + 'su diagrama.',
    bloqueado: 'El visualizador dinámico requiere extraer nodos y dependencias. Por favor, conéctate a '
      + 'tu entorno de SAP IBP para acceder.',
  },
  {
    id: 'network',
    name: 'Network Analyzer',
    icon: '🌐',
    requiereConexion: true,
    banner: 'Descarga y analiza la red logística completa de todos los materiales. Genera un informe '
      + 'Excel con métricas de resiliencia, nodos críticos, ghost nodes y calidad general de la red de '
      + 'suministro.',
    bloqueado: 'El análisis de red evalúa múltiples entidades. Por favor, conéctate a tu entorno de '
      + 'SAP IBP para acceder.',
  },
  {
    id: 'glosario',
    name: 'Glosario Analyzers',
    icon: '📖',
    requiereConexion: false,
    banner: 'Qué significa cada campo de los informes de los analizadores y qué comprueba cada '
      + 'análisis.',
  },
  {
    id: 'padoc',
    name: 'Planning Area Documenter',
    icon: '📑',
    requiereConexion: false,
    banner: 'Genera el documento del área de planificación a partir de los CSV de configuración que '
      + 'exporta SAP IBP, y lo enriquece con la volumetría real y los Application Jobs del tenant.',
  },
]

export const MODULES = [
  {
    id: 'explorer',
    name: 'Data Tools',
    icon: '📦',
    summary: 'Jerarquía de producción, red logística y analizadores de calidad de datos.',
    apps: APPS_EXPLORER,
  },
  {
    id: 'jobs',
    name: 'IBP Tools',
    icon: '⚙️',
    summary: 'Application Jobs y migración de dato maestro, transaccional y key figures.',
  },
  {
    id: 'cids',
    name: 'CI-DS Tools',
    icon: '🧪',
    summary: 'Monitoreo y orquestación de tareas, explorador de integraciones y documentación.',
  },
]

export const moduleById = (id) => MODULES.find((m) => m.id === id) ?? null

/** La aplicación de un módulo por su identificador. */
export const appById = (moduleId, appId) => (
  moduleById(moduleId)?.apps?.find((una) => una.id === appId) ?? null
)

/**
 * Parte una dirección `modulo/app` en sus dos mitades.
 *
 * La app se descarta si el módulo no tiene ninguna con ese identificador: una dirección vieja o
 * escrita a mano no debe dejar la pantalla en blanco, tiene que caer en la primera app del módulo.
 */
export function partirRuta(ruta) {
  const [moduleId, appId] = String(ruta ?? '').split('/')
  const module = moduleById(moduleId)
  if (!module) return { moduleId, appId: null }
  if (!module.apps) return { moduleId, appId: null }
  return { moduleId, appId: appById(moduleId, appId) ? appId : module.apps[0].id }
}
