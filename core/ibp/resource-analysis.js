// La calidad de los datos vista desde el RECURSO: qué máquinas están de verdad en el plan.
//
// Portado de la hoja de recursos de `prodAnalyzer.js` de v7. Es el informe más corto de todos —tres
// comprobaciones— y aun así es el que más rápido encuentra algo, porque un recurso vive en dos tablas
// que nadie mira juntas:
//
//   - `PRODUCTIONSOURCERESOURCE` dice qué recursos USAN las recetas.
//   - `RESOURCELOCATION` dice qué recursos están ASIGNADOS a una planta.
//
// Un recurso puede estar en una y no en la otra, y cada combinación es un problema distinto. Estar en
// las dos es lo normal; no estar en ninguna es un recurso que alguien creó y nadie usó.
//
// Por qué importa y no es una curiosidad: SAP planifica capacidad contra el recurso. Uno que las
// recetas usan pero que no está asignado a ninguna planta no restringe nada —la capacidad de esa
// máquina no entra en el cálculo—, y uno asignado que ninguna receta usa infla la capacidad
// disponible con una máquina que nunca se va a cargar. Las dos cosas dan un plan que no se puede
// ejecutar, y ninguna de las dos sale como error en SAP.

import { texto } from './production-analysis.js'

/** Los tres estados posibles de un recurso, con lo que hay que hacer con cada uno. */
export const ESTADOS = Object.freeze({
  huerfano: 'Recurso huérfano: sin uso en producción ni planta asignada',
  sinUso: 'Sin uso en producción (no aparece en ningún recurso de receta)',
  sinPlanta: 'Sin planta asignada en Resource Location',
})

/**
 * Revisa un recurso.
 *
 * El orden de las comprobaciones es excluyente a propósito, y es el de v7: si falta en las dos tablas
 * se dice UNA cosa —está huérfano— y no dos. Decirlo dos veces sería contar el mismo hecho como dos
 * problemas y triplicaría el número del resumen sin añadir nada.
 */
export function analizarRecurso(hechos) {
  const enRecetas = (hechos?.recetas?.length ?? 0) > 0
  const enPlantas = (hechos?.plantas?.length ?? 0) > 0

  if (!enRecetas && !enPlantas) {
    return { severidad: 'red', problemas: [{ severidad: 'red', texto: ESTADOS.huerfano }] }
  }
  if (!enRecetas) {
    return { severidad: 'yel', problemas: [{ severidad: 'yel', texto: ESTADOS.sinUso }] }
  }
  if (!enPlantas) {
    return { severidad: 'red', problemas: [{ severidad: 'red', texto: ESTADOS.sinPlanta }] }
  }
  return { severidad: 'ok', problemas: [] }
}

/** Las columnas del informe de recursos. */
export const COLUMNAS = Object.freeze([
  'Estado', 'Observaciones', 'RESID', 'Descripción', 'Tipo',
  'Plantas asignadas', 'Recetas que lo usan', 'Productos que fabrica',
])

/** Una fila del informe. */
export function filaDeRecurso(hechos, resultado) {
  const lista = (valores, cuantas = 6) => {
    const suyos = valores ?? []
    return suyos.slice(0, cuantas).join(', ') + (suyos.length > cuantas ? ` +${suyos.length - cuantas}` : '')
  }

  return {
    s: resultado.severidad,
    c: [
      resultado.severidad,
      resultado.problemas.map((uno) => uno.texto).join(' · '),
      texto(hechos?.resid),
      texto(hechos?.descripcion),
      texto(hechos?.tipo),
      lista(hechos?.plantas),
      // De las recetas solo interesa CUÁNTAS: los códigos de receta no le dicen nada a nadie en una
      // reunión, y los productos que salen de ellas sí.
      String((hechos?.recetas ?? []).length),
      lista(hechos?.productos),
    ],
  }
}

/** El resumen del informe de recursos. */
export function resumirRecursos(resultados) {
  const porSeveridad = { red: 0, yel: 0, info: 0, ok: 0 }
  const problemas = {}

  for (const uno of resultados ?? []) {
    porSeveridad[uno.severidad] = (porSeveridad[uno.severidad] ?? 0) + 1
    for (const problema of uno.problemas ?? []) {
      problemas[problema.texto] = (problemas[problema.texto] ?? 0) + 1
    }
  }

  return {
    total: (resultados ?? []).length,
    porSeveridad,
    porEstado: [],
    masFrecuentes: Object.entries(problemas)
      .sort((a, b) => b[1] - a[1])
      .map(([clase, cuantos]) => ({ texto: clase, cuantos })),
  }
}
