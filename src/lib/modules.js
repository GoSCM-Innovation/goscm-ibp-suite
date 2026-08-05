// Los módulos que se venden, con su nombre visible y su icono.
//
// Los identificadores tienen que coincidir con los del backend (`core/auth/guards.js`) y con
// los de la base. El icono viene del estilo de v7: un emoji por módulo, reconocible de un
// vistazo y sin depender de ninguna librería.

// Los identificadores (`explorer`, `jobs`, `cids`) son los que viajan a la base y a las
// guardas del servidor: NO se tocan. Lo que se ve por pantalla es `name`, y cambiarlo no
// exige ninguna migración.
export const MODULES = [
  {
    id: 'explorer',
    name: 'Data Tools',
    icon: '📦',
    summary: 'Jerarquía de producción, red logística y analizadores de calidad de datos.',
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
