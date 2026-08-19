// El análisis de la red de suministro: ¿lo que se fabrica llega a alguien?
//
// Portado de `analyzer.js` y `snWebView.js` de v7 (3.531 líneas). Es el hermano del analizador de la
// jerarquía y comparte con él las categorías de material de `production-rules.js`: lo que se le exige a
// la red de un producto depende de qué es ese producto.
//
// La diferencia con el otro analizador es que aquí las preguntas son de GRAFO, y son las que no se
// pueden contestar mirando una tabla:
//
//   ¿Desde las plantas que lo fabrican se llega a algún cliente?
//   ¿Hay bodegas que reciben producto y no lo mandan a ninguna parte?
//   ¿Hay bodegas alimentadas que no llevan a ningún cliente —producto que entra y se queda?
//   ¿Hay ciclos: A manda a B, B manda a C y C vuelve a A?
//   ¿Hay plantas que fabrican y no tienen salida hacia ningún cliente?
//
// Todas se contestan recorriendo el grafo dos veces: hacia adelante desde las plantas, y hacia atrás
// desde los clientes. La intersección de esas dos respuestas es la red que de verdad funciona; lo que
// queda fuera es lo que hay que arreglar.

import { texto } from './production-analysis.js'

/** Cuántos ciclos se listan. Con tres ya se entiende que la red tiene un problema estructural. */
export const MAX_CICLOS = 3

/** El grafo de un producto: plantas, arcos entre ubicaciones y arcos a clientes. */
export function grafoVacio() {
  return {
    plantas: [],
    ubicaciones: [],
    arcos: {},
    arcosACliente: {},
    plazoDeArco: {},
    plazoDeCliente: {},
    plazoDePlanta: {},
  }
}

/**
 * Los dos conjuntos que lo explican todo.
 *
 * `alimentados`: a dónde llega el producto saliendo de sus plantas. Se calcula hacia ADELANTE.
 * `utiles`: desde dónde se puede llegar a un cliente. Se calcula hacia ATRÁS, y es el que descubre los
 * problemas: una bodega que no está aquí es una bodega donde el producto entra y no sale.
 */
export function conjuntosDeRed(grafo) {
  const alimentados = new Set(grafo?.plantas ?? [])

  // Hacia adelante hasta que no cambie nada. La red de un producto tiene decenas de nodos, no miles.
  let cambio = true
  while (cambio) {
    cambio = false
    for (const [desde, hacia] of Object.entries(grafo?.arcos ?? {})) {
      if (!alimentados.has(desde)) continue
      for (const uno of hacia) {
        if (!alimentados.has(uno)) { alimentados.add(uno); cambio = true }
      }
    }
  }

  // Hacia atrás: útil es quien entrega a un cliente, o quien manda a alguien útil.
  const utiles = new Set()
  for (const [donde, clientes] of Object.entries(grafo?.arcosACliente ?? {})) {
    if (clientes?.length > 0) utiles.add(donde)
  }

  cambio = true
  while (cambio) {
    cambio = false
    for (const [desde, hacia] of Object.entries(grafo?.arcos ?? {})) {
      if (utiles.has(desde)) continue
      if (hacia.some((uno) => utiles.has(uno))) { utiles.add(desde); cambio = true }
    }
  }

  return { alimentados, utiles }
}

/**
 * Nodos fantasma: les llega producto, tienen salida, y por esa salida NO se llega a ningún cliente.
 *
 * Es el hallazgo más útil de este análisis y el que nadie ve a mano: la bodega existe, tiene arcos de
 * entrada y de salida, todo parece configurado, y el producto que entra no puede terminar en un cliente.
 */
export function nodosFantasma(grafo, conjuntos) {
  const plantas = new Set(grafo?.plantas ?? [])
  const { alimentados, utiles } = conjuntos ?? conjuntosDeRed(grafo)

  return (grafo?.ubicaciones ?? []).filter((donde) => {
    if (plantas.has(donde)) return false
    if (!alimentados.has(donde)) return false
    if (utiles.has(donde)) return false
    const salidas = (grafo.arcos?.[donde]?.length ?? 0) + (grafo.arcosACliente?.[donde]?.length ?? 0)
    return salidas > 0
  })
}

/** Callejones: reciben producto y no tienen NINGUNA salida. Distinto de un fantasma, que sí tiene. */
export function callejones(grafo) {
  const plantas = new Set(grafo?.plantas ?? [])
  const reciben = new Set()
  for (const hacia of Object.values(grafo?.arcos ?? {})) for (const uno of hacia) reciben.add(uno)

  return (grafo?.ubicaciones ?? []).filter((donde) => {
    if (plantas.has(donde) || !reciben.has(donde)) return false
    const salidas = (grafo.arcos?.[donde]?.length ?? 0) + (grafo.arcosACliente?.[donde]?.length ?? 0)
    return salidas === 0
  })
}

/** Plantas que fabrican y desde las que no se llega a ningún cliente. */
export function plantasAisladas(grafo, conjuntos) {
  const { utiles } = conjuntos ?? conjuntosDeRed(grafo)
  return (grafo?.plantas ?? []).filter((una) => !utiles.has(una))
}

/**
 * Ciclos en la red: A manda a B y B acaba mandando a A.
 *
 * Se buscan con un recorrido en profundidad y se cortan a tres: con tres ya está dicho que la red tiene
 * un problema estructural, y listar cuarenta variantes del mismo lío no ayuda a arreglarlo.
 */
export function ciclos(grafo, { maximo = MAX_CICLOS } = {}) {
  const encontrados = []
  const visitados = new Set()
  const enCamino = new Set()
  const camino = []

  const bajar = (nodo) => {
    if (encontrados.length >= maximo) return
    visitados.add(nodo)
    enCamino.add(nodo)
    camino.push(nodo)

    for (const siguiente of grafo?.arcos?.[nodo] ?? []) {
      if (encontrados.length >= maximo) break
      if (!visitados.has(siguiente)) {
        bajar(siguiente)
      } else if (enCamino.has(siguiente)) {
        const desde = camino.indexOf(siguiente)
        if (desde >= 0) encontrados.push([...camino.slice(desde), siguiente].join(' → '))
      }
    }

    camino.pop()
    enCamino.delete(nodo)
  }

  for (const nodo of [...(grafo?.plantas ?? []), ...(grafo?.ubicaciones ?? [])]) {
    if (!visitados.has(nodo) && encontrados.length < maximo) bajar(nodo)
  }

  return encontrados
}

/** Un plazo vacío o en cero. Los dos son lo mismo para planificar: SAP no espera nada. */
const plazoFalta = (valor) => {
  const crudo = texto(valor)
  if (!crudo) return true
  const suelto = Number.parseFloat(crudo.replace(',', '.'))
  return Number.isFinite(suelto) ? suelto === 0 : false
}

/** Los plazos que faltan, por dónde faltan. */
export function plazosFaltantes(grafo) {
  const faltan = []

  for (const [clave, valor] of Object.entries(grafo?.plazoDeArco ?? {})) {
    if (plazoFalta(valor)) {
      const [desde, hasta] = clave.split('|')
      faltan.push({ tipo: 'transporte', desde, hasta })
    }
  }
  for (const [clave, valor] of Object.entries(grafo?.plazoDeCliente ?? {})) {
    if (plazoFalta(valor)) {
      const [desde, hasta] = clave.split('|')
      faltan.push({ tipo: 'entrega', desde, hasta })
    }
  }
  for (const [donde, valor] of Object.entries(grafo?.plazoDePlanta ?? {})) {
    if (plazoFalta(valor)) faltan.push({ tipo: 'produccion', desde: donde })
  }

  return faltan
}

/** Si desde alguna planta del producto se llega a un cliente. */
export const llegaAUnCliente = (grafo, conjuntos) =>
  (grafo?.plantas ?? []).some((una) => (conjuntos ?? conjuntosDeRed(grafo)).utiles.has(una))

/**
 * El estado de la red de un producto, según lo que ES.
 *
 * Es la máquina de estados de v7, con sus nombres: cada rama contesta la pregunta que le corresponde a
 * ese tipo de material. Un terminado necesita ruta a cliente; un insumo, arco de abastecimiento; un
 * semiterminado, consumo local o transferencia. Preguntarles lo mismo a los tres no diría nada de
 * ninguno.
 */
export function estadoDeRed(hechos, categorias) {
  const cats = categorias ?? []
  const esSemi = cats.includes('semi')
  const esRawmat = cats.includes('rawmat')
  const esTrading = cats.includes('trading')
  const esTerminado = cats.includes('finished')

  const { enPSH, enPSI, enLS, enCS, soloMaestro, llegaACliente, llegaAPlanta, consumeLocal } = hechos ?? {}

  if (soloMaestro) return 'Huérfano'

  if (esSemi) {
    if (!enPSH) return 'Sin producción'
    if (!enPSI) return 'Sin consumo en ninguna receta'
    if (!enLS) return consumeLocal ? 'Semiterminado local' : 'Semiterminado sin transferencia'
    return consumeLocal ? 'Semiterminado local con transferencia' : 'Semiterminado con transferencia'
  }

  if (enPSH) {
    if (llegaACliente) return 'Red completa'
    if (enCS) return 'Distribución sin ruta completa'
    return enLS ? 'Sin entrega a cliente' : 'Sin distribución'
  }

  if (enPSI) {
    if (!enLS) return 'Sin abastecimiento'
    return llegaAPlanta ? 'Abastecimiento completo' : 'Abastecimiento parcial'
  }

  if (esTerminado) return (enLS || enCS) ? 'Sin producción' : 'Sin arcos de red'
  if (esRawmat) return enLS ? 'Abastecimiento sin consumo en receta' : 'Sin abastecimiento'
  if (esTrading || cats.length === 0) {
    if (enLS && enCS) return 'Solo distribución y entrega'
    if (enLS) return 'Solo distribución'
    if (enCS) return 'Solo entrega'
    return 'Sin arcos de red'
  }

  return 'Sin arcos de red'
}

/** Qué estado se considera correcto para cada clase de material. */
export function estadoEsperado(categorias) {
  const cats = categorias ?? []
  if (cats.includes('semi')) {
    return ['Semiterminado local', 'Semiterminado con transferencia', 'Semiterminado local con transferencia']
  }
  if (cats.includes('trading')) return ['Solo distribución y entrega']
  if (cats.includes('rawmat')) return ['Abastecimiento completo']
  return ['Red completa']
}

/**
 * Analiza la red de UN producto.
 *
 * Los hallazgos de grafo —fantasmas, callejones, plantas aisladas— solo se le exigen a lo que necesita
 * llegar a un cliente. A una materia prima no se le pide que su bodega tenga salida hacia el cliente:
 * su trabajo es entrar en una planta.
 */
export function analizarRed(hechos, grafo, categorias) {
  const cats = categorias ?? []
  const sinClasificar = cats.length === 0
  const conjuntos = conjuntosDeRed(grafo)

  const estado = estadoDeRed(
    { ...hechos, llegaACliente: llegaAUnCliente(grafo, conjuntos) },
    cats,
  )

  const problemas = []
  const anotar = (severidad, aviso) => problemas.push({ severidad, texto: aviso })

  // Un tipo sin clasificar avisa en amarillo en vez de marcar en rojo: nadie ha dicho qué es.
  const grave = sinClasificar ? 'yel' : 'red'

  if (!estadoEsperado(cats).includes(estado)) anotar(grave, estado)

  for (const uno of ciclos(grafo)) anotar(grave, `Ciclo en la red: ${uno}`)

  // Solo a lo que tiene que llegar a un cliente.
  const necesitaLlegarACliente = cats.includes('finished') || cats.includes('trading') || sinClasificar
  if (necesitaLlegarACliente) {
    for (const uno of nodosFantasma(grafo, conjuntos)) {
      anotar(grave, `Le llega producto a ${uno} y desde ahí no se llega a ningún cliente`)
    }
    for (const uno of callejones(grafo)) {
      anotar(grave, `${uno} recibe producto y no lo manda a ninguna parte`)
    }
    for (const uno of plantasAisladas(grafo, conjuntos)) {
      anotar(grave, `La planta ${uno} fabrica y no tiene salida hacia ningún cliente`)
    }
  }

  // Los plazos son avisos: la red funciona, pero planifica con cero.
  for (const uno of plazosFaltantes(grafo)) {
    if (uno.tipo === 'produccion' && (esRawmatOTrading(cats))) continue
    anotar('yel', uno.tipo === 'produccion'
      ? `Sin plazo de producción en ${uno.desde}`
      : `Sin plazo de ${uno.tipo}: ${uno.desde} → ${uno.hasta}`)
  }

  if (!hechos?.enLocProduct && (hechos?.enPSH || hechos?.enLS)) {
    anotar(grave, 'Sin cobertura en Location Product')
  }
  if (!hechos?.enCustProduct && hechos?.enCS) {
    anotar(grave, 'Sin cobertura en Customer Product')
  }

  const severidades = problemas.map((uno) => uno.severidad)
  return {
    estado,
    severidad: severidades.includes('red') ? 'red' : severidades.includes('yel') ? 'yel' : 'ok',
    problemas,
    metricas: {
      plantas: (grafo?.plantas ?? []).length,
      ubicaciones: (grafo?.ubicaciones ?? []).length,
      clientes: new Set(Object.values(grafo?.arcosACliente ?? {}).flat()).size,
      fantasmas: nodosFantasma(grafo, conjuntos).length,
      callejones: callejones(grafo).length,
      plantasAisladas: plantasAisladas(grafo, conjuntos).length,
      ciclos: ciclos(grafo).length,
    },
  }
}

const esRawmatOTrading = (cats) => cats.includes('rawmat') || cats.includes('trading')

/** Las columnas del informe de red. */
export const COLUMNAS = Object.freeze([
  'Estado', 'Estado de la red', 'Observaciones', 'PRDID', 'Descripción', 'Tipo',
  'Plantas', 'Ubicaciones', 'Clientes', 'Nodos sin salida útil', 'Callejones',
  'Plantas aisladas', 'Ciclos',
])

/** Una fila del informe. */
export function filaDeRed(hechos, resultado) {
  return {
    s: resultado.severidad,
    c: [
      resultado.severidad,
      resultado.estado,
      resultado.problemas.map((uno) => uno.texto).join(' · '),
      texto(hechos?.prdid),
      texto(hechos?.descripcion),
      texto(hechos?.mattype),
      String(resultado.metricas.plantas),
      String(resultado.metricas.ubicaciones),
      String(resultado.metricas.clientes),
      String(resultado.metricas.fantasmas),
      String(resultado.metricas.callejones),
      String(resultado.metricas.plantasAisladas),
      String(resultado.metricas.ciclos),
    ],
  }
}

/** El resumen: cuántos de cada severidad, qué estados hay y qué problema aparece más. */
export function resumirRedes(resultados) {
  const porSeveridad = { red: 0, yel: 0, ok: 0 }
  const porEstado = {}
  const problemas = {}

  for (const uno of resultados ?? []) {
    porSeveridad[uno.severidad] = (porSeveridad[uno.severidad] ?? 0) + 1
    porEstado[uno.estado] = (porEstado[uno.estado] ?? 0) + 1

    // Se cuenta la CLASE de problema, no el texto: «Ciclo en la red: A → B → A» y otro ciclo distinto
    // son el mismo problema, y contarlos por separado esconde el patrón.
    for (const clase of new Set((uno.problemas ?? []).map((problema) => claseDeProblema(problema.texto)))) {
      problemas[clase] = (problemas[clase] ?? 0) + 1
    }
  }

  return {
    total: (resultados ?? []).length,
    porSeveridad,
    porEstado: Object.entries(porEstado).sort((a, b) => b[1] - a[1]),
    masFrecuentes: Object.entries(problemas)
      .sort((a, b) => b[1] - a[1])
      .map(([clase, cuantos]) => ({ texto: clase, cuantos })),
  }
}

/** La clase de un problema: su texto sin los códigos concretos. */
export function claseDeProblema(aviso) {
  const crudo = texto(aviso)
  const corte = crudo.indexOf(':')
  if (corte > 0) return crudo.slice(0, corte)
  // Los que llevan el código en medio se reconocen por su forma.
  if (crudo.startsWith('Le llega producto a')) return 'Producto que entra en una bodega sin salida útil'
  if (crudo.includes('recibe producto y no lo manda')) return 'Bodega que recibe y no reenvía'
  if (crudo.startsWith('La planta')) return 'Planta sin salida hacia ningún cliente'
  return crudo
}
