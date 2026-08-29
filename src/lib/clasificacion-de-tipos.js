// Qué es cada tipo de material, guardado por área de planificación.
//
// Portado de `mattype-config.js` de v7, que lo guardaba igual. Sale de dentro del Production Analyzer
// porque ahora lo usan los DOS analizadores —el de producción y el de la red—, que en v7 eran dos
// aplicaciones distintas y pedían clasificar dos veces. Clasificar dos veces es cómo se llega a que
// dos informes del mismo tenant digan cosas distintas del mismo material.
//
// Por área y no por tenant: los tipos de material y lo que significan son de cada área. Y en
// `localStorage` y no en el servidor porque es una preferencia de trabajo, no un dato del cliente:
// quien la cambia quiere ver otro corte del mismo informe, no corregir nada.

/** Dónde se guarda. La clave es la de v7, para no perder lo que ya tuviera guardado quien migre. */
export const claveGuardada = (area) => `mattype_${area || 'default'}`

/** Lo guardado para un área, o `null` si no hay nada o está ilegible. */
export function leerGuardada(area) {
  try {
    const crudo = localStorage.getItem(claveGuardada(area))
    return crudo ? JSON.parse(crudo) : null
  } catch {
    return null
  }
}

/** Guarda la clasificación. Que no se pueda guardar no invalida el análisis; habrá que repetirla. */
export function guardarClasificacion(area, configuracion) {
  try {
    localStorage.setItem(claveGuardada(area), JSON.stringify(configuracion))
  } catch {
    // Sin espacio o en modo privado. No hay nada que hacer y no vale la pena parar el análisis.
  }
}

/**
 * Junta lo detectado en el tenant con lo que alguien guardó.
 *
 * Lo guardado manda, pero SOLO para los tipos que siguen existiendo. Un tipo que ya no está en el
 * tenant no debe reaparecer por estar en `localStorage`: el informe lo contaría con cero productos y
 * quien lo lea creería que se dejó de usar cuando en realidad se renombró.
 */
export function mezclarClasificacion(inicial, guardada) {
  if (!guardada) return inicial ?? {}

  const salida = {}
  for (const [tipo, suya] of Object.entries(inicial ?? {})) {
    salida[tipo] = guardada[tipo]
      ? {
        ...suya,
        excluido: Boolean(guardada[tipo].excluido),
        categorias: guardada[tipo].categorias ?? [],
      }
      : suya
  }
  return salida
}

/** Todo dentro y sin categorizar: lo que hace el botón «Restablecer» de los pasos ② y ③. */
export function restablecer(configuracion, { excluidos = true, categorias = true } = {}) {
  const salida = {}
  for (const [tipo, suya] of Object.entries(configuracion ?? {})) {
    salida[tipo] = {
      ...suya,
      excluido: excluidos ? false : suya.excluido,
      categorias: categorias ? [] : (suya.categorias ?? []),
    }
  }
  return salida
}

/** El resumen de una línea del paso ②, el que se lee sin abrirlo. */
export function resumenDeExclusion(configuracion) {
  const tipos = Object.values(configuracion ?? {})
  const fuera = tipos.filter((una) => una.excluido).length
  if (tipos.length === 0) return 'Sin tipos de material'
  if (fuera === 0) return 'Todos los tipos incluidos — sin configurar'
  return fuera === 1 ? '1 tipo excluido' : `${fuera} tipos excluidos`
}

/** El resumen de una línea del paso ③. */
export function resumenDeCategorias(configuracion) {
  const dentro = Object.values(configuracion ?? {}).filter((una) => !una.excluido)
  const conCategoria = dentro.filter((una) => (una.categorias ?? []).length > 0).length
  if (dentro.length === 0) return 'Sin tipos que categorizar'
  if (conCategoria === 0) return 'Sin categorización — análisis estándar'
  if (conCategoria === dentro.length) return 'Todos los tipos categorizados'
  return `${conCategoria} de ${dentro.length} tipos categorizados`
}

/** El resumen de una línea del paso ④. */
export function resumenDeExtras(extras) {
  const cuantos = Object.values(extras ?? {}).reduce((suma, lista) => suma + (lista?.length ?? 0), 0)
  if (cuantos === 0) return 'Solo los campos que el análisis necesita'
  return cuantos === 1 ? '1 campo adicional' : `${cuantos} campos adicionales`
}
