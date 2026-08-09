// Cómo se le pregunta a SAP por una cifra clave, y por qué así y no de otra forma.
//
// Portado de `services/planningDataApi.js` de v8. Sin dependencias: lo necesitan el servidor y la
// pantalla.
//
// Este servicio es el más traicionero de los que usa la aplicación, porque casi todos sus fallos son
// SILENCIOSOS: devuelve un resultado creíble que no es el que se pidió. Todo lo de aquí está
// comprobado contra un tenant real (área ASIBPTS), y los números de los comentarios son de ahí.

/** Los conjuntos que el servicio expone y NO son un área de planificación. */
const CONJUNTOS_GENERICOS = new Set(['KeyFigureDeltaDefinitionSet', 'ValueResultSet'])

/**
 * Con cuántas filas se cuenta. Nunca cero.
 *
 * `$top=0` con `$inlinecount` puede tumbar el tenant con `TSV_TNEW_PAGE_ALLOC_FAILED` al contar a un
 * nivel detallado. En el tenant de pruebas no llegó a pasar —contó 106.996 filas sin quejarse— pero
 * obedecer la regla cuesta 300 ms sobre 2,2 s, así que no hay nada que ganar arriesgándose.
 */
export const FILAS_PARA_CONTAR = 2

/**
 * Los atributos de conversión y el campo de filtro que le corresponde a cada uno.
 *
 * Una cifra de cantidad exige una unidad de destino y una de valor exige una moneda. Sin eso, SAP
 * contesta 400 —"requires conversion attribute … to be filled"— y no hay lectura que valga.
 */
export const ATRIBUTOS_DE_CONVERSION = Object.freeze([
  { id: 'UOM', campo: 'UOMTOID', etiqueta: 'Unidad de medida' },
  { id: 'CURR', campo: 'CURRTOID', etiqueta: 'Moneda' },
])

/**
 * Un valor cualquiera que satisface la comprobación de SAP sin acotar nada.
 *
 * La comprobación del árbol de filtros mira que el atributo ESTÉ, no qué vale. Comprobado: con
 * `UOMTOID eq 'ZZZ'` la petición pasa y devuelve cero filas, que es justo lo que hace falta para
 * detectar qué conversión pide una cifra sin traer datos.
 */
export const VALOR_DE_SONDEO = 'ZZZ'

/** El área de planificación se llama como el conjunto; lo demás no lo es. */
export const areasDesdeConjuntos = (conjuntos) => (conjuntos ?? [])
  .filter((uno) => !CONJUNTOS_GENERICOS.has(uno) && !uno.endsWith('Trans') && !uno.endsWith('Message'))
  .sort()

const atributo = (tag, nombre) => (new RegExp(`${nombre}="([^"]*)"`).exec(tag) ?? [])[1]

/**
 * Las dimensiones y las cifras clave de un área, sacadas del `$metadata`.
 *
 * SAP las distingue con `sap:aggregation-role`. Cuando falta, se cae al tipo de dato: un decimal es
 * una cifra. En el tenant de pruebas salen 222 dimensiones y 1.137 cifras.
 */
export function parseKfMetadata(xml, area) {
  const bloques = [...String(xml ?? '').matchAll(/<EntityType\b[^>]*>[\s\S]*?<\/EntityType>/g)]
  const suyo = bloques.find((uno) => atributo(uno[0].match(/<EntityType\b[^>]*>/)[0], 'Name') === area)
  if (!suyo) return null

  const dims = []
  const cifras = []
  const etiquetas = {}

  for (const match of suyo[0].matchAll(/<Property\b[^>]*>/g)) {
    const tag = match[0]
    const nombre = atributo(tag, 'Name')
    if (!nombre) continue

    etiquetas[nombre] = atributo(tag, 'sap:label') || nombre
    const rol = atributo(tag, 'sap:aggregation-role')
    const tipo = atributo(tag, 'Type') || ''

    if (rol === 'measure' || (!rol && tipo.endsWith('Decimal'))) cifras.push(nombre)
    else dims.push(nombre)
  }

  return { dims: dims.sort(), cifras: cifras.sort(), etiquetas }
}

/** Escapa un literal de texto de OData: la comilla simple se duplica. */
const escapar = (valor) => String(valor ?? '').replace(/'/g, "''")

/**
 * El `$filter` de una consulta de cifras clave.
 *
 * `conversiones` es lo que la cifra EXIGE —la unidad o la moneda de destino—; sin eso no hay
 * lectura. `soloConValor` aprovecha una regla de SAP a propósito: ver `filtroDeCifra`.
 */
export function filtroDePlanificacion({ conversiones = {}, condiciones = [], cifra, soloConValor } = {}) {
  const partes = []

  for (const { campo } of ATRIBUTOS_DE_CONVERSION) {
    const valor = conversiones[campo]
    if (valor) partes.push(`${campo} eq '${escapar(valor)}'`)
  }

  for (const una of condiciones) {
    if (!una?.field) continue
    if (una.op === 'nb') {
      partes.push(`${una.field} gt ''`)
      continue
    }

    const valores = String(una.value ?? '').split(',').map((uno) => uno.trim()).filter(Boolean)
    if (valores.length === 0) continue

    if (una.op === 'sw') partes.push(`startswith(${una.field},'${escapar(valores[0])}')`)
    else if (valores.length === 1) partes.push(`${una.field} eq '${escapar(valores[0])}'`)
    else partes.push(`(${valores.map((uno) => `${una.field} eq '${escapar(uno)}'`).join(' or ')})`)
  }

  const deCifra = soloConValor ? filtroDeCifra(cifra) : ''
  if (deCifra) partes.push(deCifra)

  return partes.join(' and ')
}

/**
 * Cómo se pide "solo las filas donde la cifra tiene valor".
 *
 * NO se puede escribir `ne 0`: SAP lo IGNORA en silencio y devuelve todo. Comprobado contra el
 * tenant: sin filtro 1.594 filas, con `ne 0` las mismas 1.594 —y la primera vale 0,000000—, con
 * `gt 0` 235. Por eso se piden los dos lados por separado y unidos con `or`, que sí funciona.
 */
export const filtroDeCifra = (cifra) => (cifra ? `(${cifra} gt 0 or ${cifra} lt 0)` : '')

/** Un valor de cifra que SAP devuelve como texto: `"0.000000"` es cero. */
export const esCero = (valor) => Number.parseFloat(valor) === 0

/**
 * Descarta las filas cuya cifra vale cero.
 *
 * También del lado del cliente, y no solo por si acaso: un `or` de dos comparaciones deja pasar los
 * ceros de las filas donde la cifra no es la única del `$select`, y una tabla llena de ceros es
 * exactamente lo que quien pidió "solo con valor" no quiere ver.
 */
export const sinCeros = (filas, cifra) => (filas ?? []).filter((una) => !esCero(una[cifra]))

/**
 * A qué nivel va a agregar SAP la consulta.
 *
 * `$select` NO es una proyección: es el nivel de agregación. Pedir menos atributos hace que SAP sume
 * a un nivel más alto y devuelva menos filas con valores mayores, sin decir nada. Comprobado con la
 * misma cifra y el mismo filtro: solo producto 1.594 filas; producto y periodo 90.713; producto,
 * ubicación y periodo 106.996. Son los mismos datos vistos con tres lupas distintas.
 */
export const nivelDeAgregacion = (dimensiones) => (dimensiones ?? []).filter(Boolean).sort()

/** El `$select` completo: primero el nivel, después la cifra. */
export function selectDePlanificacion(dimensiones, cifra) {
  const nivel = nivelDeAgregacion(dimensiones)
  return cifra ? [...nivel, cifra] : nivel
}

/** Una fecha de OData v2 a texto legible; lo que no sea una fecha se devuelve tal cual. */
export function periodoLegible(valor) {
  const marca = /^\/Date\((-?\d+)/.exec(String(valor ?? ''))
  if (!marca) return String(valor ?? '')
  return new Date(Number.parseInt(marca[1], 10)).toISOString().slice(0, 10)
}

/** Un número de SAP como se lee: sin los seis decimales con los que viene. */
export function cifraLegible(valor) {
  const numero = Number.parseFloat(valor)
  if (!Number.isFinite(numero)) return String(valor ?? '')
  return numero.toLocaleString('es', { maximumFractionDigits: 3 })
}

/**
 * Qué atributo de conversión falta, leído del mensaje de error de SAP.
 *
 * SAP nombra UNO solo por respuesta, así que detectarlos exige sondear varias veces. Devuelve el
 * campo (`UOMTOID` o `CURRTOID`) o `null` si el error es de otra cosa.
 */
export function conversionQueFalta(mensaje) {
  const texto = String(mensaje ?? '')
  for (const { campo } of ATRIBUTOS_DE_CONVERSION) {
    if (texto.includes(campo)) return campo
  }
  return null
}