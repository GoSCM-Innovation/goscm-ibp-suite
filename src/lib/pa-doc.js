// El documento de un área de planificación: de los CSV de SAP a un .docx que se entrega.
//
// Portado de `paDoc.js` de v7 con la MISMA estructura y los MISMOS textos: portada, tabla de contenido,
// diez secciones numeradas con prosa y subsecciones, y dos anexos (secciones 5, 7 y 8 de aquel archivo).
// Decisión del usuario del 2026-10-01: «Data Tools tiene que ser idéntico a v7».
//
// El modelo —qué secciones, cómo se leen los CSV, los análisis— está en `core/ibp/pa-doc-model.js`; el
// XML de Word, en `docx.js`; los textos, en `pa-doc-textos.js`. Aquí se juntan.
//
// Dos cosas de v7 que se conservan aunque parezcan descuidos, porque son el documento que los clientes
// ya conocen:
//   - NO hay tope de filas por tabla. Un anexo de mil cifras clave sale con las mil.
//   - Las tablas de resumen llevan etiquetas en inglés («Key Figures», «Planning Levels»…).

import {
  agregarCsv, categoriasDeOperador, clasificarCifras, get, getLike, modulosDetectados,
  nivelesDistintos, tiposDeDatoMaestro,
} from '../../core/ibp/pa-doc-model.js'
import {
  armarDocx, imagen, indice, parrafo, parrafoVacio, prosa, saltoDePagina, tabla, tablaCampoValor, titulo,
} from './docx.js'
import { IDIOMA_DEL_DOCUMENTO, interpolar, textosDe } from './pa-doc-textos.js'

/** Cuántos caracteres de una definición de cálculo se enseñan en el Anexo A. */
export const MAX_DEFINICION = 220

const recortar = (valor, tope) => {
  const texto = String(valor || '')
  return texto.length > tope ? `${texto.slice(0, tope)}…` : texto
}

/** `shortHdr` de v7: abrevia los encabezados largos de las tablas pequeñas. */
const abreviar = (encabezado) => String(encabezado)
  .replace(/Planning Area Attribute/i, 'Attr')
  .replace(/Master Data Type/i, 'MDT')

/** Un número con separadores, como lo escribe v7 (`es-CO`). */
export const numero = (valor, idioma = IDIOMA_DEL_DOCUMENTO) => {
  try {
    return Number(valor).toLocaleString(idioma === 'en' ? 'en-US' : 'es-CO')
  } catch {
    return String(valor)
  }
}

/** La fecha de la portada: `es-CO` con el mes en letras («1 de octubre de 2026»). */
export const fechaDeGeneracion = (ahora = new Date(), idioma = IDIOMA_DEL_DOCUMENTO) => ahora.toLocaleDateString(
  idioma === 'en' ? 'en-US' : 'es-CO',
  { year: 'numeric', month: 'long', day: 'numeric' },
)

// ── Lectura de archivos ──────────────────────────────────────────────────────────────────────────

/**
 * Suma al estado los archivos que se sueltan: CSV sueltos o un ZIP con todos.
 *
 * `archivos` son objetos con `name` y los métodos de un `File` (`text()` y `arrayBuffer()`). El estado
 * no se recibe sino que se LEE y se GUARDA con cada CSV (`obtenerEstado` y `guardarEstado`): así dos
 * tandas de archivos soltadas casi a la vez no se pisan entre sí. `registro` recibe `(clase, mensaje)`
 * con los mismos mensajes de v7: `Detectado: <sección>`, `ZIP → <sección>`, `No reconocido: <archivo>` y
 * `Error con <archivo>: …`. Un archivo que falla no detiene a los demás.
 */
export async function ingerirArchivos(archivos, { JSZip, obtenerEstado, guardarEstado, registro = () => {} }) {
  const sumar = (nombre, texto) => {
    const salida = agregarCsv(obtenerEstado(), nombre, texto)
    guardarEstado(salida.estado)
    return salida.seccion
  }

  for (const archivo of archivos ?? []) {
    const nombre = archivo.name || ''
    try {
      if (/\.zip$/i.test(nombre)) {
        const zip = await JSZip.loadAsync(await archivo.arrayBuffer())
        const dentro = Object.keys(zip.files).filter((una) => /\.csv$/i.test(una) && !zip.files[una].dir)
        for (const cual of dentro) {
          const seccion = sumar(cual.split('/').pop(), await zip.files[cual].async('string'))
          if (seccion) registro('ok', `ZIP → ${seccion}`)
        }
      } else if (/\.csv$/i.test(nombre)) {
        const seccion = sumar(nombre, await archivo.text())
        registro(seccion ? 'ok' : 'warn', seccion ? `Detectado: ${seccion}` : `No reconocido: ${nombre}`)
      }
    } catch (error) {
      registro('err', `Error con ${nombre}: ${error.message}`)
    }
  }
}

// ── Logos ────────────────────────────────────────────────────────────────────────────────────────

/**
 * La extensión REAL de una imagen: se mira el contenido, no el nombre.
 *
 * v7 decidía por el nombre del archivo y, si no era `.png` ni `.jpg`, daba por hecho que era PNG: un
 * `.webp` renombrado acababa dentro del Word como «PNG» y la imagen salía rota. Se reconocen las
 * firmas de PNG y de JPEG; si no es ninguna de las dos se devuelve `null`. (Guarda de integridad.)
 */
export function extensionDeImagen(base64) {
  if (String(base64).startsWith('iVBORw0KGgo')) return 'png'
  if (String(base64).startsWith('/9j/')) return 'jpeg'
  return null
}

/** Lee un archivo como base64. */
export function leerComoBase64(blob) {
  return new Promise((listo, falla) => {
    const lector = new FileReader()
    lector.onload = () => listo(String(lector.result).split(',')[1] || '')
    lector.onerror = () => falla(lector.error)
    lector.readAsDataURL(blob)
  })
}

/** Las dimensiones de una imagen; si no se pueden leer, las de respaldo. */
function dimensionesDe(url, ancho, alto) {
  return new Promise((listo) => {
    const img = new Image()
    img.onload = () => listo({ ancho: img.naturalWidth, alto: img.naturalHeight })
    img.onerror = () => listo({ ancho, alto })
    img.src = url
  })
}

/**
 * Lee el logo del cliente: `{ base64, extension, ancho, alto, nombre }` o `null` si no es PNG ni JPEG.
 * Sin dimensiones usa 200×80, como v7.
 */
export async function leerLogo(archivo) {
  const base64 = await leerComoBase64(archivo)
  const extension = extensionDeImagen(base64)
  if (!extension) return null

  const medidas = await dimensionesDe(`data:image/${extension};base64,${base64}`, 200, 80)
  return {
    base64,
    extension,
    ancho: medidas.ancho || 200,
    alto: medidas.alto || 80,
    nombre: archivo.name,
  }
}

/** El logo de GoSCM, que viaja con la aplicación. `null` si no se puede leer: el documento sale sin él. */
export async function cargarMarca(url) {
  try {
    const respuesta = await fetch(url)
    if (!respuesta.ok) return null
    const blob = await respuesta.blob()
    const base64 = await leerComoBase64(blob)
    const extension = (blob.type.indexOf('jpeg') >= 0 || /\.jpe?g$/i.test(url)) ? 'jpeg' : 'png'
    const medidas = await dimensionesDe(`data:image/${extension};base64,${base64}`, 300, 120)
    return { base64, extension, ancho: medidas.ancho || 300, alto: medidas.alto || 120 }
  } catch {
    return null
  }
}

// ── El cuerpo del documento ──────────────────────────────────────────────────────────────────────

/**
 * Arma los bloques del documento. Cada función de abajo es un `b…` de v7.
 *
 * Todo cuelga de un contexto `{ datos, paId, enriquecimiento, textos, idioma, … }` para no depender de
 * variables globales, como hacía v7.
 */
function contexto({ estado, enriquecimiento, logo, marca, idioma }) {
  const textos = textosDe(idioma)
  const datos = estado.datos ?? {}
  return {
    datos,
    paId: estado.paId ?? '',
    enriquecimiento,
    logo,
    marca,
    idioma,
    tr: (clave) => textos[clave] ?? clave,
    trf: (clave, valores) => interpolar(textos[clave] ?? clave, valores),
    seccion: (id) => datos[id] || null,
    objetos: (id) => datos[id]?.objetos ?? [],
  }
}

function portada(c, meta) {
  const { tr, objetos } = c
  const bloques = []

  if (c.logo) bloques.push(imagen('rIdLogo', c.logo, 240))
  bloques.push(parrafo(meta.cliente || tr('metaClient'), {
    alineado: 'center', negrita: true, tamano: 20, color: 'E8622A', despues: 120,
  }))
  bloques.push(parrafo(tr('docTitle'), {
    alineado: 'center', tamano: 26, negrita: true, color: '1F3864', despues: 40,
  }))
  bloques.push(parrafo(c.paId || 'SAP IBP', {
    alineado: 'center', tamano: 30, negrita: true, color: '1F3864', despues: 200,
  }))

  const general = objetos('GENERAL_INFO')[0]
  if (general) {
    bloques.push(parrafo(getLike(general, 'Description'), {
      alineado: 'center', cursiva: true, tamano: 13, despues: 240,
    }))
  }

  bloques.push(parrafo(tr('subtitle'), { alineado: 'center', tamano: 12, color: '808080', despues: 240 }))
  bloques.push(tablaCampoValor([tr('colField'), tr('colValue')], [
    [tr('metaClient'), meta.cliente || ''],
    [tr('metaPA'), c.paId || ''],
    [tr('metaAuthor'), meta.autor || ''],
    [tr('metaVersion'), meta.version || '1.0'],
    [tr('metaDate'), meta.fecha],
    [tr('metaGen'), 'GoSCM · PA Documenter'],
  ]))

  if (c.marca) {
    bloques.push(parrafoVacio())
    bloques.push(imagen('rIdGoscm', c.marca, 150))
  }
  bloques.push(parrafo(tr('genBy'), { alineado: 'center', tamano: 9, color: '808080' }))
  bloques.push(saltoDePagina())
  return bloques
}

function tablaDeContenido(c) {
  return [titulo(c.tr('toc'), 1), indice(c.tr('tocHint')), saltoDePagina()]
}

function resumen(c) {
  const { tr, trf, datos, seccion } = c
  const bloques = [titulo(tr('s1'), 1)]

  bloques.push(prosa(trf('s1intro', { pa: c.paId ? `“${c.paId}”` : '' })))
  const modulos = modulosDetectados(datos)
  if (modulos.length > 0) bloques.push(prosa(trf('s1mods', { mods: modulos.join(', ') })))

  bloques.push(titulo(tr('s1figs'), 2))
  bloques.push(prosa(tr('s1figsIntro')))

  const cifras = seccion('KEYFIGURES')
  const estado = cifras ? clasificarCifras(datos) : null
  const filas = []

  if (cifras) {
    filas.push(['Key Figures', String(cifras.filas.length),
      estado ? `${estado.stored} stored · ${estado.calc} calc · ${estado.helper} helper · ${estado.alert} alert` : ''])
  }
  const niveles = nivelesDistintos(datos)
  if (niveles !== null) filas.push(['Planning Levels', String(niveles), ''])
  const tipos = tiposDeDatoMaestro(datos)
  if (tipos !== null) filas.push(['Master Data Types', String(tipos.count), `${tipos.attrs} attrs`])
  if (seccion('PA_ATTRIBUTES')) filas.push([tr('s3attr').replace(/^3\.2 /, ''), String(seccion('PA_ATTRIBUTES').filas.length), ''])
  if (seccion('OPERATORS')) filas.push(['Operators', String(seccion('OPERATORS').filas.length), `${categoriasDeOperador(datos).length} cat.`])
  if (seccion('SNAPSHOTS')) filas.push(['Snapshots', String(seccion('SNAPSHOTS').filas.length), ''])
  if (seccion('VERSIONS')) filas.push(['Versions (KF)', String(seccion('VERSIONS').filas.length), ''])

  const general = c.objetos('GENERAL_INFO')[0]
  const perfil = general ? getLike(general, 'Time Profile') : ''
  if (perfil) filas.push([tr('s2tp').replace(/^2\.2 /, ''), perfil, ''])

  bloques.push(tabla([tr('colObject'), tr('colQty'), tr('colDetail')], filas, { relleno: '1F3864', tamano: 10 }))
  bloques.push(saltoDePagina())
  return bloques
}

/** Una tabla con TODAS las columnas del archivo, como las trajo SAP. */
const tablaDelArchivo = (suya, columnasLegibles, opciones) => {
  const columnas = suya.encabezado.filter((una) => una)
  return tabla(columnasLegibles ? columnas.map(abreviar) : columnas,
    suya.objetos.map((objeto) => columnas.map((columna) => get(objeto, columna))), opciones)
}

function configuracionGeneral(c) {
  const { tr, objetos, seccion } = c
  const bloques = [titulo(tr('s2'), 1)]

  const general = objetos('GENERAL_INFO')[0]
  if (general) {
    bloques.push(titulo(tr('s2gi'), 2))
    bloques.push(prosa(tr('s2giIntro')))
    bloques.push(tablaCampoValor([tr('colField'), tr('colValue')],
      Object.keys(general).map((clave) => [clave, get(general, clave)])))
  }

  if (objetos('TIMEPROFILE').length > 0) {
    bloques.push(titulo(tr('s2tp'), 2))
    bloques.push(prosa(tr('s2tpIntro')))
    bloques.push(tablaDelArchivo(seccion('TIMEPROFILE'), false, { tamano: 9 }))
  }

  if (objetos('PLANNING_HORIZONS').length > 0) {
    bloques.push(titulo(tr('s2ph'), 2))
    bloques.push(prosa(tr('s2phIntro')))
    bloques.push(tablaDelArchivo(seccion('PLANNING_HORIZONS'), false, { tamano: 9 }))
  }

  bloques.push(saltoDePagina())
  return bloques
}

function datosMaestros(c) {
  const { tr, trf, objetos, idioma } = c
  const bloques = [titulo(tr('s3'), 1), prosa(tr('s3intro'))]

  const maestros = objetos('MASTERDATATYPES')
  if (maestros.length > 0) {
    const porTipo = {}
    maestros.forEach((objeto) => {
      const id = getLike(objeto, 'Master Data Type ID')
      if (!porTipo[id]) porTipo[id] = { name: getLike(objeto, 'Name'), type: '', attrs: 0, used: 0 }
      const tipo = get(objeto, 'Type')
      if (tipo && !porTipo[id].type) porTipo[id].type = tipo
      porTipo[id].attrs += 1
      if (getLike(objeto, 'Used in Planning Area') === 'X') porTipo[id].used += 1
    })

    bloques.push(titulo(tr('s3mdt'), 2))
    bloques.push(prosa(trf('s3mdtIntro', { n: Object.keys(porTipo).length, a: maestros.length })))

    // Volumetría en vivo: añade la columna de registros reales por tipo.
    const cuentas = c.enriquecimiento?.mdtCounts ?? null
    const columnas = [...tr('s3mdtCols')]
    if (cuentas) columnas.push(tr('s3mdtColRows'))

    let total = 0
    const filas = Object.keys(porTipo).sort().map((id) => {
      const fila = [id, porTipo[id].name, porTipo[id].type, String(porTipo[id].attrs), String(porTipo[id].used)]
      if (cuentas) {
        const cuenta = cuentas[id]
        if (typeof cuenta === 'number') { total += cuenta; fila.push(numero(cuenta, idioma)) } else { fila.push('—') }
      }
      return fila
    })

    bloques.push(tabla(columnas, filas, { tamano: 8 }))
    if (cuentas) bloques.push(prosa(trf('s3mdtVol', { n: numero(total, idioma) })))
  }

  const atributos = objetos('PA_ATTRIBUTES')
  if (atributos.length > 0) {
    bloques.push(titulo(tr('s3attr'), 2))
    bloques.push(prosa(tr('s3attrIntro')))
    const columnas = ['Master Data Type ID', 'Attribute ID', 'Planning Area Attribute Description', 'Data Type', 'Length', 'Attribute Category']
    bloques.push(tabla(tr('s3attrCols'), atributos.map((objeto) => columnas.map((columna) => getLike(objeto, columna))), { tamano: 8 }))
  }

  if (objetos('ATTRIBUTES_AS_KEYFIGURE').length > 0) {
    bloques.push(titulo(tr('s3aak'), 2))
    bloques.push(prosa(tr('s3aakIntro')))
    bloques.push(tablaDelArchivo(c.seccion('ATTRIBUTES_AS_KEYFIGURE'), true, { tamano: 8 }))
  }

  bloques.push(saltoDePagina())
  return bloques
}

/** Una sección que no vino: título, la nota y salto de página. */
const noProvista = (c, clave) => [titulo(c.tr(clave), 1), prosa(c.tr('notProvided')), saltoDePagina()]

function nivelesDePlanificacion(c) {
  const { tr, trf, objetos } = c
  const niveles = objetos('PLEVELS_ATTRS')
  if (niveles.length === 0) return noProvista(c, 's4')

  const porNivel = {}
  niveles.forEach((objeto) => {
    const nivel = getLike(objeto, 'Planning Level')
    if (!porNivel[nivel]) porNivel[nivel] = { descr: getLike(objeto, 'Description'), attrs: [] }
    const atributo = getLike(objeto, 'Attribute ID')
    if (atributo) porNivel[nivel].attrs.push(atributo)
  })

  const nombres = Object.keys(porNivel).sort()
  const filas = nombres.map((nombre) => [
    nombre,
    porNivel[nombre].descr,
    String(porNivel[nombre].attrs.length),
    porNivel[nombre].attrs.slice(0, 12).join(', ') + (porNivel[nombre].attrs.length > 12 ? ' …' : ''),
  ])

  return [
    titulo(tr('s4'), 1),
    prosa(trf('s4intro', { n: nombres.length })),
    tabla(tr('s4cols'), filas, { tamano: 8 }),
    saltoDePagina(),
  ]
}

function cifrasClave(c) {
  const { tr, datos, objetos } = c
  const cifras = objetos('KEYFIGURES')
  if (cifras.length === 0) return noProvista(c, 's5')

  const estado = clasificarCifras(datos)
  const porNivel = {}
  cifras.forEach((objeto) => {
    const nivel = getLike(objeto, 'Base Planning Level') || '(—)'
    porNivel[nivel] = (porNivel[nivel] || 0) + 1
  })
  const filasDeNivel = Object.entries(porNivel).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map((una) => [una[0], String(una[1])])

  return [
    titulo(tr('s5'), 1),
    prosa(tr('s5intro')),
    titulo(tr('s5cls'), 2),
    tabla([tr('s5clsColA'), tr('s5clsColB')], [
      [tr('s5cTotal'), String(cifras.length)],
      [tr('s5cStored'), String(estado.stored)],
      [tr('s5cCalc'), String(estado.calc)],
      [tr('s5cHelper'), String(estado.helper)],
      [tr('s5cAlert'), String(estado.alert)],
    ], { relleno: '1F3864', tamano: 10 }),
    titulo(tr('s5lvl'), 2),
    prosa(tr('s5lvlIntro')),
    tabla([tr('s5colLvl'), tr('s5colN')], filasDeNivel, { tamano: 9 }),
    saltoDePagina(),
  ]
}

function versiones(c) {
  const { tr, trf, objetos } = c
  const lista = objetos('VERSIONS')
  if (lista.length === 0) return noProvista(c, 's6')

  const porVersion = {}
  lista.forEach((objeto) => {
    const id = getLike(objeto, 'ID') || '(baseline)'
    porVersion[id] = (porVersion[id] || 0) + 1
  })
  const filas = Object.entries(porVersion).sort((a, b) => b[1] - a[1]).map((una) => [una[0], String(una[1])])

  return [
    titulo(tr('s6'), 1),
    prosa(trf('s6intro', { n: lista.length })),
    tabla([tr('s6colV'), tr('s6colN')], filas, { tamano: 9 }),
    saltoDePagina(),
  ]
}

function operadores(c) {
  const { tr, trf, objetos } = c
  const lista = objetos('OPERATORS')
  if (lista.length === 0) return noProvista(c, 's7')

  const columnaDeTipo = 'Operator Profile / Operator Type'
  const columnaDeNombre = 'Operator Profile Name / Operator Type Name'
  const porTipo = {}
  lista.forEach((objeto) => {
    const tipo = getLike(objeto, columnaDeTipo) || '(—)'
    const etiqueta = getLike(objeto, columnaDeNombre)
    if (!porTipo[tipo]) porTipo[tipo] = { label: etiqueta, items: [] }
    porTipo[tipo].items.push([getLike(objeto, 'Name'), getLike(objeto, 'Description')])
  })

  const tipos = Object.keys(porTipo).sort()
  const bloques = [
    titulo(tr('s7'), 1),
    prosa(trf('s7intro', { n: lista.length, c: tipos.length })),
    tabla([tr('s7colCat'), tr('s7colType'), tr('s7colN')],
      tipos.map((tipo) => [porTipo[tipo].label || tipo, tipo, String(porTipo[tipo].items.length)]),
      { relleno: '1F3864', tamano: 9 }),
  ]
  tipos.forEach((tipo, i) => {
    bloques.push(titulo(`7.${i + 1} ${porTipo[tipo].label || tipo}`, 2))
    bloques.push(tabla([tr('s7colName'), tr('s7colDescr')], porTipo[tipo].items, { tamano: 8 }))
  })
  bloques.push(saltoDePagina())
  return bloques
}

function snapshots(c) {
  const { tr, objetos } = c
  const lista = objetos('SNAPSHOTS')
  if (lista.length === 0) return noProvista(c, 's8')

  const columnas = ['Name', 'Description', 'From Period', 'To Period', 'Number of Snapshots', 'Operator ID', 'Key Figure ID', 'Key Figure Name']
  return [
    titulo(tr('s8'), 1),
    prosa(tr('s8intro')),
    tabla(tr('s8cols'), lista.map((objeto) => columnas.map((columna) => getLike(objeto, columna))), { tamano: 8 }),
    saltoDePagina(),
  ]
}

function conversiones(c) {
  const { tr, seccion } = c
  const bloques = [titulo(tr('s9'), 1), prosa(tr('s9intro'))]

  const unidades = seccion('UOM_CONVERSIONS')
  if (unidades && unidades.filas.length > 0) {
    bloques.push(titulo(tr('s9uom'), 2))
    bloques.push(tablaDelArchivo(unidades, true, { tamano: 8 }))
  } else {
    bloques.push(prosa(tr('s9noUom')))
  }

  const monedas = seccion('CURRENCY_CONVERSIONS')
  if (monedas && monedas.filas.length > 0) {
    bloques.push(titulo(tr('s9cur'), 2))
    bloques.push(tablaDelArchivo(monedas, true, { tamano: 8 }))
  } else {
    bloques.push(prosa(tr('s9noCur')))
  }

  bloques.push(saltoDePagina())
  return bloques
}

/** La sección 10, solo si hubo enriquecimiento en vivo. */
function applicationJobs(c) {
  const { tr, trf } = c
  const bloques = [titulo(tr('s10'), 1)]
  const jobs = Array.isArray(c.enriquecimiento?.appJobs) ? c.enriquecimiento.appJobs : []

  if (jobs.length === 0) {
    bloques.push(prosa(tr('s10none')))
    bloques.push(saltoDePagina())
    return bloques
  }

  bloques.push(prosa(trf('s10intro', { n: jobs.length })))
  bloques.push(titulo(tr('s10sum'), 2))
  bloques.push(tabla(tr('s10cols'), jobs.map((job) => {
    const pasos = job.steps || []
    return [job.text || job.name, job.name, String(pasos.length), String(pasos.filter((paso) => paso.cids).length)]
  }), { relleno: '1F3864', tamano: 9 }))

  jobs.forEach((job, i) => {
    bloques.push(titulo(`10.${i + 2} ${job.text || job.name}`, 2))
    const pasos = (job.steps || []).slice().sort((a, b) => a.pos - b.pos)
    const filas = pasos.length > 0
      ? pasos.map((paso) => [String(paso.pos || ''), paso.name || '', paso.type || '', paso.cids ? tr('s10yes') : ''])
      : [['', '—', '', '']]
    bloques.push(tabla(tr('s10stepCols'), filas, { tamano: 8 }))
  })

  bloques.push(saltoDePagina())
  return bloques
}

/** Anexo A: todas las cifras clave, sin tope de filas y con la definición recortada a 220. */
function anexoDeCifras(c) {
  const { tr, trf, objetos } = c
  const bloques = [titulo(tr('anexoA'), 1)]
  const cifras = objetos('KEYFIGURES')
  if (cifras.length === 0) { bloques.push(prosa(tr('notProvided'))); return bloques }

  bloques.push(prosa(trf('anexoAintro', { n: cifras.length })))
  bloques.push(tabla(tr('anexoAcols'), cifras.map((objeto) => [
    getLike(objeto, 'ID'),
    getLike(objeto, 'Name'),
    getLike(objeto, 'Base Planning Level'),
    (get(objeto, 'Stored Key Figure') === 'X' ? 'S' : '') + (get(objeto, 'Calculated Key Figure') === 'X' ? 'C' : ''),
    getLike(objeto, 'Aggregation Mode'),
    recortar(getLike(objeto, 'Calculation Definitions'), MAX_DEFINICION),
  ]), { tamano: 7 }))
  return bloques
}

/** Anexo B: los atributos de cada tipo de dato maestro. */
function anexoDeAtributos(c) {
  const { tr, objetos } = c
  const bloques = [titulo(tr('anexoB'), 1)]
  const maestros = objetos('MASTERDATATYPES')
  if (maestros.length === 0) { bloques.push(prosa(tr('notProvided'))); return bloques }

  bloques.push(prosa(tr('anexoBintro')))
  const columnas = ['Master Data Type ID', 'Attribute ID', 'Attribute Description', 'Data Type', 'Length', 'Key', 'Required', 'Referenced Master Data Type']
  bloques.push(tabla(tr('anexoBcols'), maestros.map((objeto) => columnas.map((columna) => getLike(objeto, columna))), { tamano: 7 }))
  return bloques
}

/**
 * Los bloques del documento, en el orden de v7: portada, índice, resumen, configuración, datos
 * maestros, niveles, cifras, versiones, operadores, snapshots, conversiones, [Application Jobs],
 * anexo A, anexo B.
 */
export function cuerpoDelDocumento({ estado, meta, enriquecimiento = null, logo = null, marca = null, idioma = IDIOMA_DEL_DOCUMENTO }) {
  const c = contexto({ estado, enriquecimiento, logo, marca, idioma })
  return [
    ...portada(c, meta),
    ...tablaDeContenido(c),
    ...resumen(c),
    ...configuracionGeneral(c),
    ...datosMaestros(c),
    ...nivelesDePlanificacion(c),
    ...cifrasClave(c),
    ...versiones(c),
    ...operadores(c),
    ...snapshots(c),
    ...conversiones(c),
    ...(enriquecimiento ? applicationJobs(c) : []),
    ...anexoDeCifras(c),
    ...anexoDeAtributos(c),
  ]
}

/** El nombre del archivo: `Documentacion_PA_<PA>_<AAAA-MM-DD>.docx`. */
export function nombreDelArchivo(paId, ahora = new Date()) {
  // Un identificador con una barra o dos puntos no es un nombre de archivo válido.
  const limpio = String(paId || 'IBP').replace(/[\\/:*?"<>|]/g, '_')
  return `Documentacion_PA_${limpio}_${ahora.toISOString().slice(0, 10)}.docx`
}

/**
 * Arma el documento entero.
 *
 * `meta` lleva `{ cliente, autor, version }`; la fecha de la portada se pone aquí. `enriquecimiento` es
 * `{ appJobs, mdtCounts }` si se pidieron datos en vivo y `null` si no.
 */
export async function generarDocumento({
  estado, meta = {}, enriquecimiento = null, logo = null, marca = null, idioma = IDIOMA_DEL_DOCUMENTO, ahora = new Date(),
}) {
  const bloques = cuerpoDelDocumento({
    estado,
    meta: { ...meta, fecha: fechaDeGeneracion(ahora, idioma) },
    enriquecimiento,
    logo,
    marca,
    idioma,
  })

  const imagenes = []
  if (logo) imagenes.push({ id: 'rIdLogo', nombre: `logo_cliente.${logo.extension}`, datos: logo.base64 })
  if (marca) imagenes.push({ id: 'rIdGoscm', nombre: `logo_goscm.${marca.extension}`, datos: marca.base64 })

  return { buffer: await armarDocx(bloques, imagenes), nombre: nombreDelArchivo(estado.paId, ahora) }
}

/** Descarga el documento. */
export function descargarDocumento(buffer, nombre) {
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  URL.revokeObjectURL(url)
}
