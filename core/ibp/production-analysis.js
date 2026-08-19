// El análisis de calidad de la jerarquía de producción: qué producto está mal armado y por qué.
//
// Portado de `prodAnalyzer.js` de v7 (2.789 líneas). Aquí está el juicio; los datos los junta
// `src/lib/production-analyze.js` leyendo lo descargado.
//
// Lo que contesta es una sola pregunta, repetida producto a producto: **¿este material está listo para
// que SAP planifique con él?** Y la respuesta depende de qué ES el material, que es lo que decide la
// matriz de `production-rules.js`.
//
// Una decisión que hereda de v7 y que es la que hace el informe legible: cada producto sale con UNA
// severidad —la peor de sus problemas— y la LISTA de lo que le falta. No una fila por problema. Un
// producto con cinco cosas mal es un producto que hay que arreglar, no cinco.

import { reglasDe, TEXTOS } from './production-rules.js'

/** Un valor de SAP como texto limpio. */
export const texto = (valor) => String(valor ?? '').trim()

/** Si un número de SAP es cero o no está. Llegan como '0.000000'. */
export function esCeroOVacio(valor) {
  const crudo = texto(valor)
  if (!crudo) return true
  const suelto = Number.parseFloat(crudo.replace(',', '.'))
  return Number.isFinite(suelto) ? suelto === 0 : false
}

/** La peor severidad de una lista. Al revés que `laMasPermisiva`: aquí manda el problema más grave. */
export function laPeor(severidades) {
  const orden = ['red', 'yel', 'info']
  for (const cual of orden) if ((severidades ?? []).includes(cual)) return cual
  return 'ok'
}

/**
 * Analiza UN producto.
 *
 * `hechos` es lo que se sabe de él, ya cruzado:
 *   `mattype`            su tipo de material
 *   `enLocProduct`       si tiene cobertura en Location Product
 *   `plantas`            plantas donde tiene receta
 *   `recetas`            sus SOURCEID
 *   `componentes`        cuántos componentes suman sus recetas
 *   `recursos`           recursos asignados a sus recetas
 *   `soloCoproducto`     si solo existe como coproducto de otra receta
 *   `plazoDeProduccion`  el PLEADTIME de sus recetas (el primero no vacío)
 *   `coeficienteDeSalida` el OUTPUTCOEFFICIENT de sus recetas
 *   `plantasQueLoConsumen`  dónde lo consume alguna receta
 *   `plantasConArcoDeEntrada` de esas, a cuáles llega un arco de la red
 *   `esOrigenEnRed`      si alguna de sus plantas figura como origen
 *   `tieneArcosEnRed`    si aparece en la red, en cualquier sentido
 *   `plazoDeTransporte`  el TLEADTIME de sus arcos
 *   `loConsumeAlguien`   si alguna receta lo lleva como componente
 *   `seTransfiere`       si sale de su planta hacia otra
 *
 * Devuelve `{ severidad, problemas: [{ comprobacion, severidad, texto }] }`.
 */
export function analizarProducto(hechos, configuracion) {
  const tipo = texto(hechos?.mattype)
  const reglas = reglasDe(configuracion?.[tipo]?.categorias ?? [])
  const problemas = []

  /** Anota un problema si la regla lo pide. `none` no anota nada, que es el punto de la matriz. */
  const revisar = (comprobacion, falla, detalle = '') => {
    const severidad = reglas[comprobacion]
    if (!falla || !severidad || severidad === 'none') return
    problemas.push({
      comprobacion,
      severidad,
      texto: detalle ? `${TEXTOS[comprobacion]}: ${detalle}` : TEXTOS[comprobacion],
    })
  }

  const tieneReceta = (hechos?.recetas?.length ?? 0) > 0

  // Cobertura: lo único que se le pide a todos.
  revisar('requiresLocPrd', !hechos?.enLocProduct)

  // La receta como bloque. Si no la tiene se dice una vez; si la tiene, se mira qué le falta dentro.
  // Preguntar por los componentes de una receta que no existe daría dos errores por un solo problema.
  if (!tieneReceta) {
    revisar('requiresPSH', true)
  } else {
    revisar('requiresPSI', (hechos.componentes ?? 0) === 0)
    revisar('requiresPSR', (hechos.recursos?.length ?? 0) === 0)
    revisar('pleadtimeZero', esCeroOVacio(hechos.plazoDeProduccion))
    revisar('outputCoeffZero', esCeroOVacio(hechos.coeficienteDeSalida))
    revisar('requiresPlantAsOrigin', !hechos.esOrigenEnRed)
    revisar('hasPSHUnexpected', true)
  }

  // El abastecimiento: a qué plantas que lo consumen NO llega un arco.
  const sinArco = (hechos?.plantasQueLoConsumen ?? [])
    .filter((una) => !(hechos?.plantasConArcoDeEntrada ?? []).includes(una))
  revisar('requiresVendorArc', sinArco.length > 0, sinArco.slice(0, 8).join(', '))

  revisar('requiresAnyOriginDest', !hechos?.tieneArcosEnRed)
  revisar('isCoproductOnly', Boolean(hechos?.soloCoproducto))
  revisar('notConsumedInBOM', !hechos?.loConsumeAlguien)
  revisar('tleadtimeZero', hechos?.tieneArcosEnRed && esCeroOVacio(hechos?.plazoDeTransporte))

  // El caso del semiterminado: se fabrica y no va a ninguna parte. Es el que más cuesta ver a mano,
  // porque cada pieza por separado está bien: tiene receta, tiene componentes, tiene recurso.
  revisar('semiSinSalida', tieneReceta && !hechos?.loConsumeAlguien && !hechos?.seTransfiere)

  return { severidad: laPeor(problemas.map((uno) => uno.severidad)), problemas }
}

/** Las columnas del informe, en orden. La pantalla y el archivo usan las mismas. */
export const COLUMNAS = Object.freeze([
  'Estado', 'Observaciones', 'PRDID', 'Descripción', 'Tipo',
  'En Location Product', 'Plantas', 'Recetas', 'Componentes', 'Recursos',
  'Plazo producción', 'Coef. salida', 'Consumido en', 'Sin arco desde', 'En red', 'Plazo transporte',
])

/** Una fila del informe: la severidad para filtrar, y las celdas ya listas para dibujar. */
export function filaDelInforme(hechos, resultado) {
  const si = (valor) => (valor ? 'Sí' : 'No')
  const lista = (valores) => (valores ?? []).slice(0, 6).join(', ')
    + ((valores?.length ?? 0) > 6 ? ` +${valores.length - 6}` : '')

  const sinArco = (hechos?.plantasQueLoConsumen ?? [])
    .filter((una) => !(hechos?.plantasConArcoDeEntrada ?? []).includes(una))

  return {
    s: resultado.severidad,
    c: [
      resultado.severidad,
      resultado.problemas.map((uno) => uno.texto).join(' · '),
      texto(hechos?.prdid),
      texto(hechos?.descripcion),
      texto(hechos?.mattype),
      si(hechos?.enLocProduct),
      lista(hechos?.plantas),
      String(hechos?.recetas?.length ?? 0),
      String(hechos?.componentes ?? 0),
      lista(hechos?.recursos),
      texto(hechos?.plazoDeProduccion),
      texto(hechos?.coeficienteDeSalida),
      lista(hechos?.plantasQueLoConsumen),
      lista(sinArco),
      si(hechos?.tieneArcosEnRed),
      texto(hechos?.plazoDeTransporte),
    ],
  }
}

/**
 * El resumen del informe: cuántos de cada severidad, y qué comprobación falla más.
 *
 * Lo segundo es lo que convierte una lista de mil errores en una tarea: si nueve de cada diez rojos
 * son «sin cobertura en Location Product», el trabajo no es revisar mil productos, es cargar una
 * tabla.
 */
export function resumirAnalisis(resultados) {
  const porSeveridad = { red: 0, yel: 0, info: 0, ok: 0 }
  const porComprobacion = {}
  const porTipo = {}

  for (const uno of resultados ?? []) {
    porSeveridad[uno.severidad] = (porSeveridad[uno.severidad] ?? 0) + 1

    const tipo = texto(uno.mattype)
    porTipo[tipo] = porTipo[tipo] ?? { red: 0, yel: 0, info: 0, ok: 0 }
    porTipo[tipo][uno.severidad] += 1

    // Un producto con el mismo problema dos veces no lo cuenta dos veces.
    for (const cual of new Set((uno.problemas ?? []).map((problema) => problema.comprobacion))) {
      porComprobacion[cual] = (porComprobacion[cual] ?? 0) + 1
    }
  }

  const masFrecuentes = Object.entries(porComprobacion)
    .sort((a, b) => b[1] - a[1])
    .map(([comprobacion, cuantos]) => ({ comprobacion, cuantos, texto: TEXTOS[comprobacion] ?? comprobacion }))

  return {
    total: (resultados ?? []).length,
    porSeveridad,
    porTipo,
    masFrecuentes,
  }
}
