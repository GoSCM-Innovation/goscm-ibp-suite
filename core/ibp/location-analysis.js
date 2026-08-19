// La calidad de los datos vista desde la UBICACIÓN: qué papel juega cada una y qué le falta.
//
// Portado de la hoja de ubicaciones de `prodAnalyzer.js` de v7. Es la misma información que el informe
// de productos, mirada desde el otro lado, y contesta una pregunta distinta: no «¿a este material le
// falta algo?» sino «¿esta planta está bien montada?». Es la que se lleva a una reunión con el dueño de
// una planta.
//
// Lo que aporta de propio, y es lo que hace que valga la pena: el ROL de una ubicación no se lee de un
// campo, se DEDUCE de cómo se comporta en los datos. SAP tiene `LOCTYPE`, pero solo distingue al
// proveedor; que una ubicación sea planta, nodo de transferencia o punto final no está escrito en
// ninguna parte: se ve en que tiene recetas, en que manda material que el destino consume, o en que
// recibe y no reenvía.
//
// Y una ubicación puede tener VARIOS roles a la vez —una planta que además transfiere a otra— y
// entonces se le exige lo de cada uno.

import { texto } from './production-analysis.js'

/** Los roles que se deducen del comportamiento. */
export const ROLES = Object.freeze({
  planta: 'Planta de producción',
  proveedor: 'Proveedor',
  transferencia: 'Nodo de transferencia',
  receptor: 'Nodo receptor',
  recursos: 'Nodo de recursos',
  sinActividad: 'Sin actividad',
})

/**
 * Qué papeles juega una ubicación.
 *
 * El orden de la lista no es casual: primero lo que produce, después lo que mueve, y al final lo que
 * solo recibe. Es como se lee una red.
 *
 * La diferencia entre PROVEEDOR y NODO DE TRANSFERENCIA es la que más cuesta ver y la más útil: las dos
 * mandan material a otro sitio, pero un proveedor manda algo que el destino CONSUME en una receta, y un
 * nodo de transferencia manda algo que el destino no usa. Lo segundo casi siempre es un arco de más o un
 * componente que falta en el BOM del destino.
 */
export function rolesDe(hechos) {
  const roles = []

  if ((hechos?.recetas?.length ?? 0) > 0) roles.push(ROLES.planta)
  if (hechos?.mandaLoQueSeConsume) roles.push(ROLES.proveedor)
  if (hechos?.mandaLoQueNoSeConsume) roles.push(ROLES.transferencia)

  // Receptor solo si no es planta y no manda nada: si manda, ya está descrito por lo de arriba.
  const soloRecibe = (hechos?.recibe?.length ?? 0) > 0
    && (hechos?.recetas?.length ?? 0) === 0
    && !hechos?.mandaLoQueSeConsume
    && !hechos?.mandaLoQueNoSeConsume
  if (soloRecibe) roles.push(ROLES.receptor)

  if ((hechos?.recursos?.length ?? 0) > 0) roles.push(ROLES.recursos)

  return roles.length > 0 ? roles : [ROLES.sinActividad]
}

/**
 * Qué se le exige a cada rol. Es la matriz de este informe.
 *
 * Va como TABLA y no como una cadena de `if`, por lo mismo que la matriz de tipos de material: el
 * glosario la lee de acá para explicarla, así que no puede quedarse contando una versión vieja de las
 * reglas. Si mañana una comprobación cambia de rojo a aviso, la guía de lectura lo dice sin que nadie
 * la toque.
 *
 * `campo` es la lista de códigos que la dispara —si está vacía, no hay problema— y `texto` es lo que se
 * lee en el informe, con el número delante y los códigos detrás. El orden dentro de cada rol es el que
 * sale en la fila: primero lo que falta para producir, después lo que sobra.
 */
export const EXIGENCIAS = Object.freeze({
  [ROLES.planta]: Object.freeze([
    { campo: 'recetasSinComponentes', severidad: 'red', texto: 'recetas sin componentes' },
    { campo: 'recetasSinRecurso', severidad: 'red', texto: 'recetas sin recurso asignado' },
    {
      campo: 'componentesSinArco',
      severidad: 'red',
      texto: 'componentes sin arco de abastecimiento hacia acá',
    },
    { campo: 'recetasConPlazoCero', severidad: 'red', texto: 'recetas con plazo de producción en cero' },
    // Un recurso asignado a la planta que ninguna receta usa no es un error: es capacidad que nadie
    // planifica.
    { campo: 'recursosOciosos', severidad: 'yel', texto: 'recursos asignados que ninguna receta usa' },
    // Un material clasificado como comprado que tiene receta acá: o la clasificación está mal, o la
    // receta no debería existir. Las dos cosas hay que mirarlas, ninguna es concluyente.
    {
      campo: 'fabricaLoQueSeCompra',
      severidad: 'yel',
      texto: 'materiales clasificados como comprados que se fabrican acá',
    },
  ]),
  [ROLES.proveedor]: Object.freeze([
    {
      campo: 'mandaSinCobertura',
      severidad: 'red',
      texto: 'materiales que manda sin cobertura en el destino',
    },
  ]),
  [ROLES.transferencia]: Object.freeze([
    // Que el destino sea una planta y no use lo que le llega es peor que que sea una bodega: en la
    // bodega puede ser tránsito legítimo, en la planta falta el componente en el BOM.
    {
      campo: 'transfiereAPlantaSinConsumo',
      severidad: 'red',
      texto: 'materiales transferidos a una planta que no los usa en ninguna receta',
    },
    {
      campo: 'transfiereANodoSinProduccion',
      severidad: 'yel',
      texto: 'materiales transferidos a un nodo sin producción',
    },
  ]),
  [ROLES.receptor]: Object.freeze([
    {
      campo: 'recibeSinCobertura',
      severidad: 'red',
      texto: 'materiales que recibe sin cobertura en Location Product',
    },
    {
      campo: 'recibeComponentesSinProducir',
      severidad: 'yel',
      texto: 'componentes que recibe y no se fabrica nada acá',
    },
  ]),
  // Este no tiene lista: el hecho de no aparecer en ninguna parte ES el aviso.
  [ROLES.sinActividad]: Object.freeze([
    {
      campo: null,
      severidad: 'info',
      texto: 'Está en el maestro de ubicaciones y no aparece en ninguna otra parte',
    },
  ]),
})

/** Cuántos códigos de ejemplo se enseñan de cada problema. Más no cabe y no añade nada. */
const CUANTOS_EJEMPLOS = 6

/**
 * Revisa una ubicación según los papeles que juega.
 *
 * A cada rol se le pide lo suyo, y solo lo suyo. Una planta tiene que tener sus recetas completas; un
 * proveedor, que lo que manda esté cubierto en el destino; un nodo que transfiere, que el destino de
 * verdad use lo que le llega. Preguntarle a todas lo mismo daría cientos de errores falsos, igual que
 * en el informe de productos: cada proveedor saldría con seis errores por no tener recetas.
 */
export function analizarUbicacion(hechos) {
  const roles = rolesDe(hechos)
  const problemas = []

  for (const rol of roles) {
    for (const exigencia of EXIGENCIAS[rol] ?? []) {
      if (exigencia.campo === null) {
        problemas.push({ severidad: exigencia.severidad, texto: exigencia.texto })
        continue
      }

      const suyos = hechos?.[exigencia.campo] ?? []
      if (suyos.length === 0) continue

      const ejemplos = suyos.slice(0, CUANTOS_EJEMPLOS).join(', ')
      const resto = suyos.length > CUANTOS_EJEMPLOS ? ` +${suyos.length - CUANTOS_EJEMPLOS}` : ''
      // Si la lista viene topada, el número NO es el total y no se puede escribir como si lo fuera.
      // Comprobado en un tenant real: sin esto, 155 ubicaciones decían «400 materiales» —que era el
      // tope de la lista— y el consultor se llevaba un número inventado a la reunión.
      const cuantos = (hechos?.topados ?? []).includes(exigencia.campo)
        ? `más de ${suyos.length}`
        : String(suyos.length)

      problemas.push({
        severidad: exigencia.severidad,
        texto: `${cuantos} ${exigencia.texto}: ${ejemplos}${resto}`,
      })
    }
  }

  const severidades = problemas.map((uno) => uno.severidad)
  return {
    roles,
    severidad: severidades.includes('red') ? 'red'
      : severidades.includes('yel') ? 'yel'
        : severidades.includes('info') ? 'info' : 'ok',
    problemas,
  }
}

/** Las columnas del informe de ubicaciones. */
export const COLUMNAS = Object.freeze([
  'Estado', 'Roles', 'Observaciones', 'LOCID', 'Descripción', 'Tipo en SAP',
  'Recetas', 'Productos que fabrica', 'Recursos', 'Manda a', 'Recibe de',
])

/** Una fila del informe. */
export function filaDeUbicacion(hechos, resultado) {
  const lista = (valores, cuantas = 5) => {
    const suyos = valores ?? []
    return suyos.slice(0, cuantas).join(', ') + (suyos.length > cuantas ? ` +${suyos.length - cuantas}` : '')
  }

  return {
    s: resultado.severidad,
    c: [
      resultado.severidad,
      resultado.roles.join(', '),
      resultado.problemas.map((uno) => uno.texto).join(' · '),
      texto(hechos?.locid),
      texto(hechos?.descripcion),
      texto(hechos?.loctype),
      String((hechos?.recetas ?? []).length),
      lista(hechos?.productos),
      lista(hechos?.recursos),
      lista(hechos?.manda),
      lista(hechos?.recibe),
    ],
  }
}

/** El resumen: cuántas de cada severidad, y cuántas de cada rol. */
export function resumirUbicaciones(resultados) {
  const porSeveridad = { red: 0, yel: 0, info: 0, ok: 0 }
  const porRol = {}
  const problemas = {}

  for (const uno of resultados ?? []) {
    porSeveridad[uno.severidad] = (porSeveridad[uno.severidad] ?? 0) + 1
    for (const rol of uno.roles ?? []) porRol[rol] = (porRol[rol] ?? 0) + 1

    // Se cuenta la clase de problema —el texto sin los códigos ni los números— para que el patrón se vea.
    for (const clase of new Set((uno.problemas ?? []).map((problema) => claseDeProblema(problema.texto)))) {
      problemas[clase] = (problemas[clase] ?? 0) + 1
    }
  }

  return {
    total: (resultados ?? []).length,
    porSeveridad,
    porEstado: Object.entries(porRol).sort((a, b) => b[1] - a[1]),
    masFrecuentes: Object.entries(problemas)
      .sort((a, b) => b[1] - a[1])
      .map(([clase, cuantos]) => ({ texto: clase, cuantos })),
  }
}

/** La clase de un problema: el texto sin el número del principio ni los códigos del final. */
export function claseDeProblema(aviso) {
  const crudo = texto(aviso)
  const sinNumero = crudo.replace(/^(más de )?\d+\s+/, '')
  const corte = sinNumero.indexOf(':')
  return corte > 0 ? sinNumero.slice(0, corte) : sinNumero
}
