// El informe de una corrida de cifras clave: qué se copió, con qué configuración y cuánto tardó.
//
// Equivalente a `utils/kfReportPdf.js` de v8, pero **rediseñado**, no traducido, porque el modelo de
// corrida es distinto y traducir el de v8 habría dado un informe que miente:
//
//   - v8 copiaba UNA cifra por transacción, así que su informe tenía una fila por cifra con su estado,
//     su duración y sus tiempos por fase.
//   - Aquí varias cifras viajan en la MISMA fila de planificación —es como funciona el dato de
//     planificación: una combinación de atributos y periodo lleva todas sus cifras— y la unidad de
//     avance es el SEGMENTO. Una fila por cifra sería inventarse un dato que no existe: no hay «cuánto
//     tardó ADJUSTEDPRODUCTION» cuando las cinco cifras se escribieron juntas.
//
// Así que la tabla de resultados es por segmento, y las cifras se listan en la configuración. El
// segmento es además la unidad real de la transacción: si algo falla, lo que quedó escrito son los
// segmentos confirmados antes, y eso es exactamente lo que hay que poder leer al día siguiente.
//
// Sin dependencias: lo usan la pantalla, el generador de PDF y las pruebas. El texto sale en ASCII
// —`->` y no `→`— porque la fuente que trae jsPDF solo cubre WinAnsi y una flecha sale como un
// carácter roto en el archivo. Los acentos sí entran.

/** Un tiempo en milisegundos, escrito como se lee. */
export function duracionLegible(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000)
  if (total < 60) return `${total.toFixed(total < 10 ? 1 : 0)} s`

  const minutos = Math.floor(total / 60)
  const segundos = Math.round(total % 60)
  if (minutos < 60) return `${minutos} min ${segundos} s`

  return `${Math.floor(minutos / 60)} h ${minutos % 60} min`
}

/** Una marca de tiempo como se lee, o una raya si no hay. */
export const momentoLegible = (ms) => (ms ? new Date(ms).toLocaleString('es') : '—')

/** La versión base no tiene identificador; nombrarla «(vacío)» no dice nada. */
const versionLegible = (versionId) => versionId || 'version base';

/** Cómo acabó la corrida. Tres finales distintos, y el informe no los puede confundir. */
export function estadoDeCorrida(corrida) {
  if (corrida?.error) return { clave: 'error', etiqueta: 'Con error' }
  if (corrida?.cancelado) return { clave: 'cancelado', etiqueta: 'Cancelada' }
  if ((corrida?.mensajes?.length ?? 0) > 0) return { clave: 'conRechazos', etiqueta: 'Con filas rechazadas' }
  return { clave: 'ok', etiqueta: 'Completa' }
}

/**
 * El resumen de la corrida.
 *
 * `copiadas` se cuenta de los segmentos y no del acumulado de la pantalla: son la misma cifra, pero
 * si algún día dejan de serlo, el informe tiene que decir lo que SAP confirmó, no lo que la pantalla
 * creía.
 */
export function resumirCorrida(corrida) {
  const segmentos = corrida?.segmentos ?? []
  const conMs = segmentos.filter((uno) => Number(uno.ms) > 0)

  const masLento = conMs.reduce(
    (peor, uno) => ((uno.ms ?? 0) > (peor?.ms ?? 0) ? uno : peor),
    null,
  )

  return {
    estado: estadoDeCorrida(corrida),
    segmentos: segmentos.length,
    copiadas: segmentos.reduce((suma, uno) => suma + (Number(uno.filas) || 0), 0),
    rechazadas: corrida?.mensajes?.length ?? 0,
    duracion: (corrida?.fin ?? 0) - (corrida?.inicio ?? 0),
    // La media por segmento dice más que el total cuando hay que estimar una corrida mayor.
    mediaPorSegmento: conMs.length > 0
      ? Math.round(conMs.reduce((suma, uno) => suma + uno.ms, 0) / conMs.length)
      : 0,
    masLento,
  }
}

/**
 * La configuración con la que se corrió, como pares de etiqueta y valor.
 *
 * Es la mitad del valor del informe: dentro de un mes, «se copiaron 182.787 filas» no sirve de nada
 * sin saber a qué nivel, con qué tramo y en qué versión — que es justo lo que decide si el número
 * está bien o está sumado a un nivel equivocado.
 */
export function filasDeConfiguracion(corrida) {
  const c = corrida ?? {}
  const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

  const filas = [
    ['Origen', `${c.origen?.tenant ?? '—'} · ${c.origen?.area ?? '—'} · ${versionLegible(c.origen?.versionId)}`],
    ['Destino', `${c.destino?.tenant ?? '—'} · ${c.destino?.area ?? '—'} · ${versionLegible(c.destino?.versionId)}`],
    ['Cifras clave', (c.cifras ?? []).join(', ') || '—'],
    // El nivel es la decisión que más cambia el resultado: va con su periodo escrito aparte.
    ['Nivel de agregacion', (c.nivel ?? []).join(' x ') || '—'],
    ['Periodo del nivel', c.periodo || 'ninguno: SAP sumo todo el horizonte'],
  ]

  const tramo = [c.desdeFecha || '...', c.hastaFecha || '...']
  filas.push(['Tramo de tiempo', c.desdeFecha || c.hastaFecha ? tramo.join(' a ') : 'todo el horizonte'])

  const cambios = Object.entries(c.destinoDe ?? {}).filter(([origen, destino]) => destino && destino !== origen)
  filas.push(['Escrito con otro nombre', cambios.length > 0
    ? cambios.map(([origen, destino]) => `${origen} -> ${destino}`).join(', ')
    : 'no: los mismos nombres en los dos lados'])

  const conversiones = Object.entries(c.conversiones ?? {}).filter(([, valor]) => valor)
  if (conversiones.length > 0) {
    filas.push(['Conversion exigida', conversiones.map(([campo, valor]) => `${campo} = ${valor}`).join(', ')])
  }

  const condiciones = (c.condiciones ?? []).filter((una) => una?.field)
  if (condiciones.length > 0) {
    filas.push(['Filtro', condiciones.map((una) => `${una.field} = ${una.value}`).join('; ')])
  }

  if (c.previstas) filas.push(['Filas previstas al contar', numero(c.previstas)])
  filas.push(['Nombre de la transaccion', c.nombre || '—'])

  return filas
}

/** Una fila por segmento: es la unidad de la transacción y del reintento. */
export function filasDeSegmentos(corrida) {
  return (corrida?.segmentos ?? []).map((uno, indice) => [
    String(indice + 1),
    Number(uno.desde ?? 0).toLocaleString('es'),
    Number(uno.filas ?? 0).toLocaleString('es'),
    uno.transactionId || '—',
    uno.estado || '—',
    duracionLegible(uno.ms),
  ])
}

/** Cuántas veces dijo SAP cada cosa. Cien mensajes iguales son un problema, no cien. */
export function mensajesAgrupados(mensajes) {
  const cuenta = new Map()

  for (const uno of mensajes ?? []) {
    const texto = String(uno?.Message ?? uno?.MessageText ?? uno?.MsgText ?? JSON.stringify(uno ?? {})).slice(0, 400)
    cuenta.set(texto, (cuenta.get(texto) ?? 0) + 1)
  }

  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([texto, veces]) => ({ texto, veces }))
}

/** El nombre del archivo. Lleva el destino y la fecha, que es lo que se busca cuando hay varios. */
export function nombreDelInforme(corrida) {
  const dos = (valor) => String(valor).padStart(2, '0')
  const cuando = new Date(corrida?.fin || corrida?.inicio || 0)
  const destino = String(corrida?.destino?.tenant || 'tenant').replace(/[^\w-]+/g, '-')

  return `cifras_${destino}_${cuando.getFullYear()}${dos(cuando.getMonth() + 1)}${dos(cuando.getDate())}`
    + `-${dos(cuando.getHours())}${dos(cuando.getMinutes())}.pdf`
}
