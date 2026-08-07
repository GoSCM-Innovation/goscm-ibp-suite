// A qué entidad de IBP corresponde una integración, y qué campos se le pueden pedir.
//
// Portado de `resolveTargetEntity` de `docs.js` de v9.
//
// Está separado de `sample-row.js` —que es quien consulta— porque no depende de nada y lo necesitan
// los dos lados: el navegador, que decide qué preguntar, y el servidor, que pregunta. Duplicar esta
// regla sería exactamente lo que esta arquitectura viene a eliminar.
//
// La regla al resolver a qué entidad preguntar es conservadora a propósito: ante la duda no se
// consulta nada. Un ejemplo en blanco es un hueco; un ejemplo de la tabla equivocada es un error que
// nadie va a notar hasta que alguien construya sobre él.

/** Los prefijos con los que CI-DS nombra sus tablas de staging. */
const PREFIJOS_DE_STAGING = [/^SOPMD_STAG_/, /^SOPDD_STAGING_KFTAB_/]

/** Un nombre de entidad más corto que esto empareja con cualquier cosa. */
const LARGO_MINIMO = 4

/**
 * A qué entidad de IBP hay que preguntarle por una integración.
 *
 * Para key figures la entidad es el área de planificación misma, y no se cae a dato maestro: un
 * emparejamiento equivocado ahí devuelve un 404 de segmento, que es ruido.
 *
 * Para dato maestro la tabla destino es la de staging de CI-DS (`SOPMD_STAG_AS1PRODUCT`) y la
 * entidad es el tipo sin ese prefijo (`AS1PRODUCT`). Se prueban tres formas, de más segura a menos,
 * y se abandona en cuanto una queda ambigua.
 */
export function resolveTargetEntity(integracion, entitySets, planAreaElegida = '') {
  if (!entitySets?.length) return null

  const tipo = (integracion.tipoIntegracion || '').toUpperCase()
  const planArea = String(planAreaElegida || integracion.planArea || '').trim()
  if (tipo === 'FILE' || !planArea) return null

  const areaUC = planArea.toUpperCase()

  if (tipo === 'KF') {
    const hit = entitySets.find((uno) => uno.service === 'PLANNING_DATA_API_SRV' && uno.nameUC === areaUC)
    return hit ? { service: hit.service, entitySet: hit.name, planArea } : null
  }

  const destinoUC = (integracion.targetTable || '').toUpperCase()
  if (!destinoUC) return null

  let nucleo = destinoUC
  for (const prefijo of PREFIJOS_DE_STAGING) nucleo = nucleo.replace(prefijo, '')

  const candidatos = entitySets.filter((uno) => (
    uno.service === 'MASTER_DATA_API_SRV' && !uno.nameUC.endsWith('TRANS') && !uno.nameUC.endsWith('MESSAGE')
  ))
  const elegir = (uno) => ({ service: uno.service, entitySet: uno.name, planArea })

  // 1. Coincidencia exacta, con el núcleo o con el nombre entero.
  const exacto = candidatos.find((uno) => uno.nameUC === nucleo) ?? candidatos.find((uno) => uno.nameUC === destinoUC)
  if (exacto) return elegir(exacto)

  // 2. La entidad termina con el núcleo: el área va como prefijo del tipo de dato maestro.
  const terminan = candidatos.filter((uno) => uno.nameUC.endsWith(nucleo))
  if (terminan.length === 1) return elegir(terminan[0])
  if (terminan.length > 1) {
    const delArea = terminan.filter((uno) => uno.nameUC.includes(areaUC))
    if (delArea.length === 1) return elegir(delArea[0])
  }

  // 3. Al revés: el núcleo termina con la entidad. Gana la más larga, y solo si no hay empate.
  const alReves = candidatos
    .filter((uno) => uno.nameUC.length >= LARGO_MINIMO && nucleo.endsWith(uno.nameUC))
    .sort((a, b) => b.nameUC.length - a.nameUC.length)

  if (alReves.length === 1) return elegir(alReves[0])
  if (alReves.length > 1 && alReves[0].nameUC.length > alReves[1].nameUC.length) return elegir(alReves[0])

  return null
}

/**
 * Qué campos se pueden pedir en el `$select`.
 *
 * En datos de planificación el `$select` es obligatorio y solo admite propiedades que existan en la
 * entidad; los campos de staging de CI-DS que no existen se descartan. En dato maestro no se manda
 * `$select` y se trae la fila entera.
 */
export function selectFieldsFor(destino, campos, entityProps) {
  if (destino.service !== 'PLANNING_DATA_API_SRV') return []
  const propias = entityProps?.[destino.entitySet.toUpperCase()]
  return propias ? campos.filter((uno) => propias.has(uno.toUpperCase())) : campos
}
