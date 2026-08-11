// Qué cifras clave se copian de un tenant a otro, a qué nivel, y qué puede salir mal.
//
// Portado de la parte de decisión de `KeyFigureMigration.jsx` de v8, que la tenía dentro de un
// componente de 1.549 líneas mezclada con el progreso y los estilos.
//
// Migrar una cifra clave NO es como migrar dato maestro, y la diferencia que importa es el NIVEL:
// una cifra no tiene "filas" propias. Existe a la vez a nivel de producto, de producto y ubicación, de
// producto por semana… y el `$select` decide cuál se lee. Elegir mal el nivel no da un error: da un
// número creíble y equivocado, normalmente más chico, porque SAP suma sin avisar.
//
// Por eso aquí el nivel es una decisión explícita y con nombre, no un detalle del `$select`.
//
// Sin dependencias: lo usan el servidor, la pantalla y las pruebas.

/**
 * Los niveles de tiempo de IBP, del más fino al más grueso.
 *
 * Los nombres son los de SAP y no significan nada por sí solos: `PERIODID4_TSTAMP` es la semana. Que
 * el número no siga el orden del calendario —4 es semana, 3 mes, 0 día— es de SAP, no un error de
 * transcripción.
 */
export const NIVELES_DE_TIEMPO = Object.freeze([
  { campo: 'PERIODID0_TSTAMP', clave: 'dia', etiqueta: 'Día' },
  { campo: 'PERIODID4_TSTAMP', clave: 'semana', etiqueta: 'Semana' },
  { campo: 'PERIODID5_TSTAMP', clave: 'semanaTecnica', etiqueta: 'Semana técnica' },
  { campo: 'PERIODID3_TSTAMP', clave: 'mes', etiqueta: 'Mes' },
  { campo: 'PERIODID2_TSTAMP', clave: 'trimestre', etiqueta: 'Trimestre' },
  { campo: 'PERIODID1_TSTAMP', clave: 'anio', etiqueta: 'Año' },
])

/** Los campos de tiempo, para reconocerlos dentro de un nivel. */
export const CAMPOS_DE_TIEMPO = Object.freeze(NIVELES_DE_TIEMPO.map((uno) => uno.campo))

export const esCampoDeTiempo = (campo) => CAMPOS_DE_TIEMPO.includes(campo)

/**
 * Atributos que NO se pueden escribir.
 *
 * La versión y el escenario viajan en el contexto de la transacción, no como columnas. `AGGREGATE` y
 * las fechas de auditoría las pone SAP. Mandarlos hace que rechace el envío.
 */
export const ATRIBUTOS_DE_SOLO_LECTURA = Object.freeze([
  'VERSIONID', 'VERSIONNAME', 'SCENARIOID', 'SCENARIONAME',
  'MASTER_DATA_TYPE', 'AGGREGATE', 'LASTMODIFIEDDATE', 'CREATEDDATE',
])

/**
 * A partir de cuántas filas conviene partir la lectura por periodo.
 *
 * Con volúmenes grandes, un `$skip` muy profundo se vuelve caro y frágil. Partir por periodo acota
 * cada consulta a un tramo de tiempo, que además es la forma natural del dato.
 */
export const UMBRAL_PARA_PARTIR_POR_TIEMPO = 100_000

/** Filas leídas por segmento. Cada segmento es una transacción propia que se confirma sola. */
export const FILAS_POR_SEGMENTO = 20_000

/**
 * Las cifras de una lista pegada, clasificadas.
 *
 * Portado de la ventana de pegar de `KeyFigureMigration.jsx` de v8. Una migración de verdad son
 * treinta o cincuenta cifras que vienen de una hoja de cálculo o de un correo; marcarlas de a una en
 * un catálogo de mil ciento treinta y siete es donde se cometen los errores.
 *
 * Se parte por cualquier separador razonable —salto de línea, coma, punto y coma, tabulación— porque
 * de dónde viene el texto pegado no se controla: de Excel viene con tabulaciones, de un correo con
 * comas, de una consulta con saltos de línea.
 *
 * Y devuelve las tres listas por separado en vez de agregar lo que encaja y callar el resto: si de
 * cincuenta nombres cuatro no existen en el origen, eso hay que verlo. Callarlo dejaría una migración
 * que parece completa y le faltan cuatro.
 */
export function cifrasPegadas(texto, delCatalogo = [], yaElegidas = []) {
  const catalogo = new Set(delCatalogo)
  const elegidas = new Set(yaElegidas)

  const nombres = String(texto ?? '')
    .split(/[\r\n,;\t]+/)
    .map((uno) => uno.trim().toUpperCase())
    .filter(Boolean)

  const nuevas = []
  const faltantes = []
  const repetidas = []
  const vistas = new Set()

  for (const nombre of nombres) {
    // Repetido DENTRO del texto pegado: se cuenta una vez y no se avisa dos.
    if (vistas.has(nombre)) continue
    vistas.add(nombre)

    if (!catalogo.has(nombre)) faltantes.push(nombre)
    else if (elegidas.has(nombre)) repetidas.push(nombre)
    else nuevas.push(nombre)
  }

  return { nuevas, faltantes, repetidas }
}

/**
 * Cómo se llama en el destino algo que en el origen se llama de otra forma.
 *
 * Dos tenants que se montaron por separado no usan los mismos nombres: la misma cifra puede ser
 * `CONSENSUSDEMANDQTY` en uno y `ZCONSENSOQTY` en el otro. Sin esto, migrar entre ellos exige
 * renombrar a mano en SAP, que es justo lo que no se puede hacer.
 *
 * Vale igual para las cifras y para los atributos del nivel: son nombres, y no se pisan entre sí.
 */
export const nombreEnDestino = (nombre, destinoDe) => (destinoDe ?? {})[nombre] || nombre

/** Qué se renombra de verdad: lo que tiene un nombre distinto en el destino. */
export const renombrados = (nombres, destinoDe) => (nombres ?? [])
  .map((uno) => ({ origen: uno, destino: nombreEnDestino(uno, destinoDe) }))
  .filter((par) => par.origen !== par.destino)

/** El nivel de tiempo que lleva un nivel, o `null` si el nivel no tiene tiempo. */
export const nivelDeTiempoDe = (dimensiones) =>
  NIVELES_DE_TIEMPO.find((uno) => (dimensiones ?? []).includes(uno.campo)) ?? null

/** Las dimensiones que se pueden escribir: sin las de solo lectura. */
export const dimensionesEscribibles = (dimensiones) =>
  (dimensiones ?? []).filter((uno) => !ATRIBUTOS_DE_SOLO_LECTURA.includes(uno))

/**
 * Revisa una migración de cifras clave y dice qué la impide y qué conviene mirar.
 *
 * Se contesta ANTES de leer nada, porque de lo contrario los problemas aparecen a mitad de una carga
 * de veinte minutos: una cifra que no existe en el destino, un nivel sin ninguna dimensión, o el caso
 * peligroso —un nivel SIN tiempo, que hace que SAP sume todo el horizonte en un solo valor por
 * producto y escriba eso—.
 */
export function revisarMigracionDeCifras({
  origen = {}, destino = {}, cifras = [], dimensiones = [], cifrasDelDestino = [], dimensionesDelDestino = [],
  destinoDe = {}, desde = '', hasta = '',
} = {}) {
  const impedimentos = []
  const avisos = []

  if (cifras.length === 0) impedimentos.push('No hay ninguna cifra clave elegida.')

  const nivel = dimensionesEscribibles(dimensiones)
  if (nivel.length === 0) {
    impedimentos.push('El nivel está vacío: hay que elegir al menos un atributo, o SAP sumaría todo en un solo valor.')
  }

  // El caso que muerde en silencio. No se impide —hay cifras que de verdad no tienen tiempo— pero se
  // dice con todas las letras, porque el resultado es creíble y está mal.
  if (nivel.length > 0 && !nivelDeTiempoDe(nivel)) {
    avisos.push(
      'El nivel no incluye ningún periodo. SAP va a sumar TODO el horizonte en un solo valor por '
      + 'combinación, y eso es lo que se va a escribir en el destino. Si no es lo que querés, agregá '
      + 'un nivel de tiempo.',
    )
  }

  // Se comprueba el nombre que va a tener EN EL DESTINO, no el del origen: si se renombró, el que
  // tiene que existir allá es el nuevo.
  const faltanEnDestino = cifras
    .map((una) => nombreEnDestino(una, destinoDe))
    .filter((una) => cifrasDelDestino.length > 0 && !cifrasDelDestino.includes(una))
  if (faltanEnDestino.length > 0) {
    impedimentos.push(`El destino no tiene ${faltanEnDestino.length === 1 ? 'la cifra' : 'las cifras'} ${faltanEnDestino.join(', ')}.`)
  }

  const dimsFaltantes = nivel
    .map((uno) => nombreEnDestino(uno, destinoDe))
    .filter((uno) => dimensionesDelDestino.length > 0 && !dimensionesDelDestino.includes(uno))
  if (dimsFaltantes.length > 0) {
    impedimentos.push(`El destino no tiene ${dimsFaltantes.length === 1 ? 'el atributo' : 'los atributos'} ${dimsFaltantes.join(', ')}.`)
  }

  // Un renombrado no es un problema, pero SÍ hay que verlo escrito antes de copiar: es la clase de
  // cosa que se configura una vez y se olvida, y escribe en una cifra que no era.
  const cambios = renombrados([...cifras, ...nivel], destinoDe)
  if (cambios.length > 0) {
    avisos.push(`Se escribe con otro nombre: ${cambios.map((par) => `${par.origen} → ${par.destino}`).join(', ')}.`)
  }

  // Un rango al revés no da error en SAP: da cero filas, que se lee como «no hay datos».
  if (desde && hasta && desde > hasta) {
    impedimentos.push(`El rango de fechas está al revés: ${desde} es posterior a ${hasta}.`)
  }

  const descartadas = (dimensiones ?? []).filter((uno) => ATRIBUTOS_DE_SOLO_LECTURA.includes(uno))
  if (descartadas.length > 0) {
    avisos.push(`${descartadas.join(', ')} no se ${descartadas.length === 1 ? 'puede' : 'pueden'} escribir y se ${descartadas.length === 1 ? 'quita' : 'quitan'} del nivel: la versión y el escenario viajan en la transacción.`)
  }

  // Copiar un tenant sobre sí mismo con la misma área y versión es escribir lo leído donde estaba.
  if (origen.connectionId === destino.connectionId
    && origen.area === destino.area
    && (origen.versionId ?? '') === (destino.versionId ?? '')) {
    impedimentos.push('El origen y el destino son el mismo tenant, área y versión.')
  }

  return {
    nivel,
    nivelDeTiempo: nivelDeTiempoDe(nivel),
    cifras,
    impedimentos,
    avisos,
    sePuede: impedimentos.length === 0,
  }
}

/**
 * El `$select` de la lectura: el nivel y después las cifras.
 *
 * El orden importa para `AggregationLevelFieldsString`, que es la lista del nivel tal cual: si las
 * dos no coinciden, SAP escribe a un nivel distinto del que se leyó.
 */
export const selectDeLaMigracion = (nivel, cifras) => [...(nivel ?? []), ...(cifras ?? [])]

/**
 * Cuántos segmentos hacen falta y si conviene partir por periodo.
 *
 * Se decide con la cuenta de filas y no con una corazonada: por debajo del umbral, `$skip` es más
 * simple y funciona; por encima se parte por tiempo, que acota cada consulta a un tramo.
 */
export function planificarSegmentos(totalFilas, { porSegmento = FILAS_POR_SEGMENTO } = {}) {
  const total = Math.max(0, Number(totalFilas) || 0)
  return {
    total,
    segmentos: total > 0 ? Math.ceil(total / porSegmento) : 0,
    porSegmento,
    partirPorTiempo: total > UMBRAL_PARA_PARTIR_POR_TIEMPO,
  }
}

/**
 * Deja una fila lista para escribir: solo el nivel y las cifras, sin lo que SAP rechaza.
 *
 * Se hace fila por fila y no con un `$select` recortado porque la lectura SÍ necesita traer el nivel
 * completo —es lo que define la agregación— y en cambio la escritura no admite los atributos de solo
 * lectura que ese nivel puede incluir.
 */
export function filaParaEscribir(fila, nivel, cifras, destinoDe) {
  const salida = {}
  for (const campo of [...(nivel ?? []), ...(cifras ?? [])]) {
    // La fila viene leída con los nombres del ORIGEN y se escribe con los del destino.
    if (fila?.[campo] !== undefined) salida[nombreEnDestino(campo, destinoDe)] = fila[campo]
  }
  return salida
}
