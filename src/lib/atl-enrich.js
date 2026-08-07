// Cruzar lo que el proyecto HACE con el orden en que de verdad se EJECUTA.
//
// Portado de `applyAtlEnrichment` y `_computeAtlConflicts` de `explorer.js` de v9.
//
// El explorador deduce de los datos qué integración alimenta a cuál. El ATL dice en qué orden las
// corre CI-DS y cuáles van en paralelo. Cuando las dos cosas se contradicen, hay un problema real en
// la orquestación del cliente:
//
//   - **En paralelo**: A alimenta a B y las dos corren a la vez. B puede leer datos viejos.
//   - **Al revés**: A alimenta a B, pero el proceso ejecuta B primero. B siempre lee datos viejos.
//
// Es lo más útil que sale de cruzar las dos fuentes, y no se puede ver desde CI-DS.

/** Cómo se compara un nombre de dataflow entre las dos fuentes. */
const clave = (valor) => String(valor ?? '').toUpperCase().trim()

/** Los planes suelen llamarse `FLOWof_<algo>`; ese prefijo no le dice nada a quien lee. */
const nombreDeGrupo = (grupo) => (grupo.displayName || '').replace(/^FLOWof_/i, '') || grupo.name || ''

/**
 * Reparte las integraciones entre los procesos que declaran los ATL.
 *
 * Se empareja por GUID, que es único, y si falta se cae al nombre visible — pero solo cuando ese
 * nombre corresponde a UNA sola integración. Cuando un dataflow aparece en dos procesos, se queda
 * con el primero que lo reclama: no puede correr en dos sitios a la vez, y elegir el primero es al
 * menos consistente entre análisis.
 */
export function enrichWithAtl(integraciones, cadenas, archivos) {
  const porGuid = new Map()
  const porNombre = new Map()

  for (const una of integraciones) {
    const guid = (una.dataflowGuid || '').trim()
    if (guid && !porGuid.has(guid)) porGuid.set(guid, una)

    const nombre = clave(una.dataflowName)
    if (nombre) porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), una])
  }

  const procesos = []
  const orquestacion = new Map()

  archivos.forEach(({ nombre: archivo, atl }, procesoIdx) => {
    const proceso = {
      archivo,
      session: atl.sessionName || archivo,
      description: atl.description || '',
      variables: atl.variables ?? [],
      grupos: [],
      declarados: 0,
      emparejados: 0,
      faltantes: [],
    }

    let orden = 0

    for (const grupo of atl.groups ?? []) {
      const nombre = nombreDeGrupo(grupo)
      const propio = { nombre, parallel: Boolean(grupo.parallel), dataflows: [] }

      for (const dataflow of grupo.dataflows ?? []) {
        proceso.declarados += 1
        orden += 1

        let encontrada = dataflow.guid ? porGuid.get(dataflow.guid) ?? null : null
        if (!encontrada) {
          const candidatas = porNombre.get(clave(dataflow.displayName)) ?? []
          if (candidatas.length === 1) [encontrada] = candidatas
        }

        if (!encontrada) {
          proceso.faltantes.push({ grupo: nombre, displayName: dataflow.displayName, guid: dataflow.guid || '' })
          propio.dataflows.push({ idx: -1, displayName: dataflow.displayName, falta: true })
          continue
        }

        proceso.emparejados += 1
        propio.dataflows.push({ idx: encontrada._idx, displayName: dataflow.displayName, falta: false })

        if (!orquestacion.has(encontrada._idx)) {
          orquestacion.set(encontrada._idx, {
            session: proceso.session,
            grupo: nombre,
            parallel: Boolean(grupo.parallel),
            orden,
            procesoIdx,
          })
        }
      }

      proceso.grupos.push(propio)
    }

    procesos.push(proceso)
  })

  return {
    procesos,
    orquestacion,
    conflictos: detectarConflictos(cadenas, orquestacion),
    huerfanas: integraciones.filter((una) => !orquestacion.has(una._idx)).map((una) => una._idx),
  }
}

/**
 * Dónde la dependencia de datos contradice el orden de ejecución.
 *
 * Solo se comparan integraciones del MISMO proceso: dos procesos distintos pueden correr en momentos
 * distintos del día y el ATL no dice nada de eso, así que un orden "invertido" entre ellos no
 * significa nada.
 */
export function detectarConflictos(cadenas, orquestacion) {
  const conflictos = []

  for (const arista of cadenas) {
    const desde = orquestacion.get(arista.from)
    const hasta = orquestacion.get(arista.to)
    if (!desde || !hasta || desde.procesoIdx !== hasta.procesoIdx) continue

    if (desde.grupo === hasta.grupo && desde.parallel) {
      conflictos.push({ ...arista, reason: 'parallel' })
    } else if (desde.orden > hasta.orden) {
      conflictos.push({ ...arista, reason: 'reverse' })
    }
  }

  return conflictos
}

/** Los conflictos que tocan a una integración, mire de qué lado. */
export const conflictosDe = (conflictos, idx) => conflictos.filter((uno) => uno.from === idx || uno.to === idx)

/** Todas las integraciones metidas en algún conflicto, para poder filtrar por ellas. */
export function conConflicto(conflictos) {
  const idxs = new Set()
  for (const uno of conflictos) { idxs.add(uno.from); idxs.add(uno.to) }
  return idxs
}

/** Qué explicar de cada tipo de conflicto. */
export const MOTIVO_DEL_CONFLICTO = {
  parallel: 'corren a la vez en el mismo grupo, así que puede leer datos de la corrida anterior',
  reverse: 'el proceso la ejecuta ANTES que a su origen, así que siempre lee datos de la corrida anterior',
}
