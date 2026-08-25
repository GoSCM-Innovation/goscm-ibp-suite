// Expresiones de mapeo de CI-DS: de dónde sale cada campo y qué se le hace por el camino.
//
// Portado de `public/legacy/js/docs.js` de v9. Es la pieza más delicada del parser de exports de
// CI-DS, y la comparten el explorador de integraciones y el documentador.
//
// El problema que resuelve: en un dataflow, un campo destino casi nunca apunta a una tabla real.
// Apunta a `Transform3.CAMPO`, que a su vez apunta a `Transform1.OTRO`, que solo ahí apunta a
// `MARA.MATNR`. Para documentar de dónde sale un dato hay que seguir esa cadena hasta el fondo.
//
// Va en el navegador y no en `core/` porque el ZIP del proyecto nunca sale del equipo: se abre, se
// lee y se documenta ahí mismo. Es una propiedad que conviene conservar — un export de CI-DS lleva
// las definiciones de integración del cliente.

/**
 * Una referencia `TABLA.CAMPO`, en las tres formas en que aparece en el XMI.
 *
 *   1. `"entrecomillada"."campo"` o `"entrecomillada".campo` — InfoObjects de BW, que llevan "/".
 *   2. `sinComillas."campo-entrecomillado"` — namespaces de ABAP.
 *   3. `sinComillas.sinComillas` — el caso normal de SAP.
 *
 * Un nombre de campo SIN comillas no puede contener "/", y eso es deliberado: en una división sin
 * espacios (`TransformN.CAMPO_A/TransformN.CAMPO_B`) el "/" se tragaba el operador y la referencia
 * siguiente, dejando la expresión a medio expandir. Los nombres con "/" siempre vienen
 * entrecomillados en el XMI, así que los cubren los dos primeros casos.
 */
const REFERENCIA = /(?:"([^"]+)"\s*\.\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)))|(?:\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*"([^"]+)")|(?:\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))/g

/** Hasta dónde se sigue la cadena de transformaciones antes de rendirse. De v9. */
const PROFUNDIDAD_MAXIMA = 30

/** Saca el esquema y el campo de una coincidencia de `REFERENCIA`. */
function referenciaDe(coincidencia) {
  if (coincidencia[1] !== undefined) return { schema: coincidencia[1], field: coincidencia[2] || coincidencia[3] }
  if (coincidencia[4] !== undefined) return { schema: coincidencia[4], field: coincidencia[5] }
  return { schema: coincidencia[6], field: coincidencia[7] }
}

/**
 * ¿La expresión ya es un átomo —una referencia, un número, un literal, o una llamada a función
 * completa—? Si no lo es, hay que envolverla en paréntesis al sustituirla dentro de otra: sin eso,
 * `A+B` metido dentro de `X*…` daría `X*A+B`, que es otra cuenta.
 */
export function esAtomica(expresion) {
  const texto = String(expresion ?? '').trim()
  if (!texto) return true

  const ATOMO = /^(?:"[^"]+"|'[^']*'|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))*$/
  if (ATOMO.test(texto)) return true

  const abre = texto.indexOf('(')
  if (abre === -1 || !texto.endsWith(')')) return false

  // `func(...)` es un átomo; `a) + f(b` no lo es aunque empiece y termine parecido.
  const cabeza = texto.slice(0, abre).trim()
  if (cabeza && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cabeza)) return false

  let profundidad = 0
  for (let i = abre; i < texto.length; i += 1) {
    if (texto[i] === '(') profundidad += 1
    else if (texto[i] === ')') {
      profundidad -= 1
      if (profundidad === 0) return i === texto.length - 1
    }
  }
  return false
}

/**
 * Quita el paréntesis exterior cuando envuelve la expresión ENTERA.
 *
 * Los que agrega la expansión hacen falta dentro de una expresión mayor, pero en el nivel de arriba
 * sobran y ensucian lo que se muestra. Se respetan las comillas: un paréntesis dentro de un literal
 * de texto no cuenta.
 */
export function quitarParentesisExterior(expresion) {
  let texto = String(expresion ?? '').trim()

  for (;;) {
    if (!texto.startsWith('(') || !texto.endsWith(')')) return texto

    let profundidad = 0
    let comilla = ''
    for (let i = 0; i < texto.length; i += 1) {
      const caracter = texto[i]
      if (comilla) {
        if (caracter === comilla) comilla = ''
        continue
      }
      if (caracter === "'" || caracter === '"') { comilla = caracter; continue }
      if (caracter === '(') profundidad += 1
      else if (caracter === ')') {
        profundidad -= 1
        // Cerró antes del final: el paréntesis no envuelve todo. `(a)+(b)` se queda como está.
        if (profundidad === 0 && i < texto.length - 1) return texto
      }
    }
    if (profundidad !== 0) return texto
    texto = texto.slice(1, -1).trim()
  }
}

/**
 * Sigue la cadena de transformaciones hasta llegar a tablas reales.
 *
 * `transformaciones` es `{ nombre: { fields: [{ name, proj }] } }`. Una referencia a algo que no
 * está ahí es una tabla de verdad y se deja como está.
 */
export function expandirExpresion(expresion, transformaciones, profundidad = 0) {
  if (profundidad > PROFUNDIDAD_MAXIMA || !expresion) return expresion || ''

  const expandida = expresion.replace(REFERENCIA, (...partes) => {
    const original = partes[0]
    const referencia = referenciaDe(partes)
    if (!(referencia.schema in transformaciones)) return original

    const campo = transformaciones[referencia.schema].fields.find((uno) => uno.name === referencia.field)
    if (!campo?.proj) return original

    // Referencia de tres partes de una llamada RFC: `Transform3.ET_BACKORDER.ID`, donde
    // ET_BACKORDER es la tabla que devuelve la función. Se conserva TABLA.CAMPO y se descarta el
    // nombre de la transformación, que no aporta nada a la documentación.
    const tresPartes = campo.proj.match(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)$/,
    )
    if (tresPartes && tresPartes[1] in transformaciones) return `${tresPartes[2]}.${tresPartes[3]}`

    const dentro = expandirExpresion(campo.proj, transformaciones, profundidad + 1)
    return esAtomica(dentro) ? dentro : `(${dentro})`
  })

  return profundidad === 0 ? quitarParentesisExterior(expandida) : expandida
}

/**
 * De dónde sale un campo destino: qué datastore, qué tabla, qué campos, y qué cuenta se les hace.
 *
 * `ops` queda vacío cuando el campo se copia tal cual. Solo se llena cuando de verdad hay funciones
 * u operadores, que es lo que hace útil esa columna: si todas las filas mostraran la expresión, la
 * columna no distinguiría nada.
 */
export function analizarCampo(proyeccion, transformaciones, mapaDeEsquemas = {}) {
  if (!proyeccion) return { srcDS: '', srcTable: '', srcField: '', ops: '' }

  const expandida = expandirExpresion(proyeccion, transformaciones)

  // Las referencias a tablas reales que quedaron, sin repetir: un mismo campo puede aparecer varias
  // veces dentro de un `ifthenelse` y la columna de origen lo tiene que listar una sola vez.
  const referencias = []
  const vistas = new Set()
  const buscador = new RegExp(REFERENCIA.source, 'g')

  let coincidencia = buscador.exec(expandida)
  while (coincidencia !== null) {
    const referencia = referenciaDe(Array.from(coincidencia))
    if (!(referencia.schema in transformaciones)) {
      const clave = `${referencia.schema}.${referencia.field}`
      if (!vistas.has(clave)) {
        vistas.add(clave)
        referencias.push({ tabla: referencia.schema, campo: referencia.field })
      }
    }
    coincidencia = buscador.exec(expandida)
  }

  // Ninguna referencia: es una función pura o una constante (`gen_uuid()`, `sysdate`, un literal).
  // Se muestra la expresión original como "origen", que es lo más honesto que se puede decir.
  if (referencias.length === 0) {
    return { srcDS: '', srcTable: '', srcField: proyeccion.replace(/\n/g, ' ').trim(), ops: '' }
  }

  const porTabla = new Map()
  for (const referencia of referencias) {
    if (!porTabla.has(referencia.tabla)) porTabla.set(referencia.tabla, mapaDeEsquemas[referencia.tabla]?.ds ?? '')
  }

  // Con varias tablas de origen, cada campo se muestra con la suya delante: si no, no se sabría de
  // cuál viene cada uno.
  const variasTablas = porTabla.size > 1

  // Si al quitar las referencias y los separadores no queda nada, el campo se copia tal cual.
  const resto = expandida
    .replace(new RegExp(REFERENCIA.source, 'g'), '')
    .replace(/[\s(),]+/g, '')
    .trim()

  return {
    srcDS: [...new Set([...porTabla.values()].filter(Boolean))].join(', '),
    srcTable: [...porTabla.keys()].join(', '),
    srcField: referencias
      .map((una) => (variasTablas ? `${una.tabla}.${una.campo}` : una.campo))
      .join(', '),
    ops: resto.length > 0 ? expandida.replace(/\n/g, ' ').trim() : '',
  }
}
