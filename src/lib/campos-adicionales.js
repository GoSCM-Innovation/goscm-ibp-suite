// Los campos adicionales del paso ④, guardados por TENANT y por área de planificación.
//
// Portado de `extraFields.js` de v7 (`efSaveEntity`, `efLoadAll`, `efGetSelect`). Se guardan en
// `localStorage` (ver `clave` abajo): v7 usaba solo el área y esa clave no distinguía tenants. Es una
// preferencia de trabajo, no un dato del cliente.
//
// Las claves de entidad son las de v7 (`product`, `location`, `resource`, `resourceLocation`, `psh`,
// `psi`, `psr`); `TABLA_DE_ENTIDAD` las lleva a las tablas del plan de extracción.

/** Qué tabla del plan de extracción corresponde a cada entidad del paso ④ del Production Analyzer. */
export const TABLA_DE_ENTIDAD = Object.freeze({
  product: 'bom_prd',
  location: 'bom_loc',
  resource: 'bom_res',
  resourceLocation: 'bom_resloc',
  psh: 'bom_psh',
  psi: 'bom_psi',
  psr: 'bom_psr',
})

/**
 * Lo mismo para el Network Analyzer: de qué tabla del plan sale cada entidad del paso ④ (las cinco de
 * `EF_ENTITY_META.sn` de v7).
 */
export const TABLA_DE_ENTIDAD_RED = Object.freeze({
  product: 'bom_prd',
  location: 'bom_loc',
  customer: 'sn_cust_master',
  locationSource: 'sn_loc',
  customerSource: 'sn_cust',
})

/**
 * Dónde se guarda lo elegido. Lleva la CONEXIÓN además del área: los campos del maestro son de cada tenant,
 * y pedirle a SAP un campo que el otro tenant no tiene hace que rechace la consulta entera. v7 lo guardaba
 * solo por área (`ef_sel_<ns>_<entidad>_<área>`). Sin conexión o sin área no hay clave (`null`).
 */
const clave = (ns, entidad, conexionId, area) => (
  conexionId && area ? `ef_sel:${ns}:${entidad}:${conexionId}:${area}` : null
)

/** Lo elegido para un área: `{ product: ['CAMPO'], … }`, con todas las entidades presentes. */
export function leerCamposAdicionales(ns, entidades, conexionId, area) {
  const salida = {}
  for (const entidad of entidades) {
    salida[entidad] = []
    const donde = clave(ns, entidad, conexionId, area)
    if (!donde) continue
    try {
      const crudo = localStorage.getItem(donde)
      const leido = crudo ? JSON.parse(crudo) : null
      if (Array.isArray(leido)) salida[entidad] = leido.filter((c) => typeof c === 'string')
    } catch {
      // Ilegible o sin acceso: se parte de cero, no se para el análisis.
    }
  }
  return salida
}

/** Guarda lo elegido de UNA entidad. Que no se pueda guardar no invalida el análisis. */
export function guardarCamposAdicionales(ns, entidad, conexionId, area, campos) {
  const donde = clave(ns, entidad, conexionId, area)
  if (!donde) return
  try {
    localStorage.setItem(donde, JSON.stringify(campos))
  } catch {
    // Sin espacio o en modo privado: habrá que repetirlo la próxima vez.
  }
}

/**
 * Convierte `{ product: [...] }` a `{ bom_prd: [...] }` para el plan de extracción, sin vacíos.
 * `tablaDe` dice qué tabla es cada entidad: la del Production Analyzer por defecto.
 */
export function extrasPorTabla(extras, tablaDe = TABLA_DE_ENTIDAD) {
  const salida = {}
  for (const [entidad, tabla] of Object.entries(tablaDe)) {
    if ((extras?.[entidad] ?? []).length > 0) salida[tabla] = [...extras[entidad]]
  }
  return salida
}

/** Cuántos campos adicionales hay elegidos en total. */
export const totalDeExtras = (extras) =>
  Object.values(extras ?? {}).reduce((suma, lista) => suma + (lista?.length ?? 0), 0)
