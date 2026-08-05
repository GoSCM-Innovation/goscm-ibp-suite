// Los módulos que se venden, con su nombre visible y su icono.
//
// Los identificadores tienen que coincidir con los del backend (`core/auth/guards.js`) y con
// los de la base. El icono viene del estilo de v7: un emoji por módulo, reconocible de un
// vistazo y sin depender de ninguna librería.

export const MODULES = [
  {
    id: 'explorer',
    name: 'Explorer',
    icon: '📦',
    summary: 'Jerarquía de producción, red logística y analizadores de calidad de datos.',
  },
  {
    id: 'jobs',
    name: 'Jobs / Migración',
    icon: '⚙️',
    summary: 'Application Jobs y migración de dato maestro, transaccional y key figures.',
  },
  {
    id: 'cids',
    name: 'Integración CI-DS',
    icon: '🧪',
    summary: 'Monitoreo y orquestación de tareas, explorador de integraciones y documentación.',
  },
]

export const moduleById = (id) => MODULES.find((m) => m.id === id) ?? null
