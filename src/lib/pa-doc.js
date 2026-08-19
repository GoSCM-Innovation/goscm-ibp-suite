// El documento de un área de planificación: de los CSV de SAP a un .docx que se entrega.
//
// Portado de `paDoc.js` de v7. El modelo —qué secciones, qué columnas, qué dice el resumen— está en
// `core/ibp/pa-doc-model.js`; el XML de Word en `src/lib/docx.js`. Aquí se juntan.

import {
  SECCIONES, campo, ingerirCsv, resumirArea,
} from '../../core/ibp/pa-doc-model.js'
import { armarDocx, imagen, indice, parrafo, saltoDePagina, tabla, titulo } from './docx.js'

const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Cuántas filas de una sección van al documento. Un anexo de mil filas no se lee ni se imprime. */
export const MAX_FILAS_POR_TABLA = 400

/** Cuántos caracteres de una definición de cálculo se enseñan. */
const MAX_TEXTO = 220

const recortar = (valor, tope = MAX_TEXTO) => {
  const crudo = String(valor ?? '')
  return crudo.length > tope ? `${crudo.slice(0, tope)}…` : crudo
}

/**
 * Lee los archivos que se sueltan: CSV sueltos o un ZIP con todos.
 *
 * SAP exporta la configuración de un área como una carpeta de CSV, y lo normal es que llegue comprimida.
 * Los archivos que no se reconocen se devuelven aparte en vez de ignorarse: si alguien suelta el ZIP
 * equivocado, decirlo es más útil que generar un documento vacío.
 */
export async function ingerirArchivos(archivos, { JSZip }) {
  const datos = {}
  const noReconocidos = []

  const meter = (nombre, texto) => {
    const leido = ingerirCsv(nombre, texto)
    if (!leido) { noReconocidos.push(nombre); return }
    datos[leido.seccion] = leido
  }

  // Los archivos llegan ya leídos como buffer. Se decodifican como UTF-8, que es como los exporta SAP.
  const decodificador = new TextDecoder('utf-8')
  const comoTexto = (archivo) => (archivo.text !== undefined
    ? archivo.text
    : decodificador.decode(archivo.data))

  for (const archivo of archivos ?? []) {
    const nombre = archivo.name ?? ''

    if (/\.zip$/i.test(nombre)) {
      const zip = await JSZip.loadAsync(archivo.data ?? archivo)
      const dentro = Object.keys(zip.files).filter((una) => /\.csv$/i.test(una) && !zip.files[una].dir)
      if (dentro.length === 0) noReconocidos.push(`${nombre} (sin CSV dentro)`)
      for (const cual of dentro) meter(cual.split('/').pop(), await zip.files[cual].async('string'))
      continue
    }

    if (/\.csv$/i.test(nombre)) { meter(nombre, comoTexto(archivo)); continue }
    noReconocidos.push(nombre)
  }

  return { datos, noReconocidos }
}

/** Lee una imagen como base64 y sus dimensiones, para poder escalarla en el documento. */
export function leerImagen(archivo) {
  return new Promise((listo, falla) => {
    const lector = new FileReader()
    lector.onerror = () => falla(lector.error)
    lector.onload = () => {
      const url = String(lector.result)
      const base64 = url.slice(url.indexOf(',') + 1)
      const extension = (archivo.name.split('.').pop() ?? 'png').toLowerCase()

      const img = new Image()
      img.onload = () => listo({ base64, extension, ancho: img.naturalWidth, alto: img.naturalHeight })
      // Sin dimensiones se pone un tamaño razonable: mejor un logo algo torcido que ningún documento.
      img.onerror = () => listo({ base64, extension, ancho: 600, alto: 200 })
      img.src = url
    }
    lector.readAsDataURL(archivo)
  })
}

/** La portada. */
function portada(resumen, meta, imagenes) {
  const bloques = []

  if (imagenes.some((una) => una.id === 'rIdLogo')) bloques.push(imagen('rIdLogo', meta.logo, 260))

  bloques.push(
    parrafo('Documentación del área de planificación', { negrita: true, tamano: 44, centrado: true, despues: 80 }),
    parrafo(resumen.area || 'SAP IBP', { negrita: true, tamano: 36, centrado: true, color: '2E74B5' }),
    parrafo(meta.cliente ? `Cliente: ${meta.cliente}` : '', { centrado: true, tamano: 24 }),
    parrafo(`Tenant: ${meta.tenant || '—'}`, { centrado: true, tamano: 20, color: '767171' }),
    parrafo(`Generado el ${new Date().toLocaleDateString('es')}`, { centrado: true, tamano: 20, color: '767171' }),
  )

  if (imagenes.some((una) => una.id === 'rIdGoscm')) bloques.push(imagen('rIdGoscm', meta.marca, 160))

  bloques.push(saltoDePagina())
  return bloques.filter(Boolean)
}

/** El resumen ejecutivo: lo que se lee cuando no se va a leer el resto. */
function resumenEjecutivo(resumen) {
  const filas = [
    ['Cifras clave', numero(resumen.cifras)],
    ['— guardadas', numero(resumen.guardadas)],
    ['— calculadas', numero(resumen.calculadas)],
    ['Tipos de dato maestro', numero(resumen.tiposDeDatoMaestro)],
    ['Atributos de dato maestro', numero(resumen.atributosDeMaestro)],
    ['Niveles de planificación', numero(resumen.nivelesDePlanificacion)],
    ['Versiones', numero(resumen.versiones)],
    ['Operadores', numero(resumen.operadores)],
    ['Snapshots', numero(resumen.snapshots)],
  ]
  if (resumen.auxiliares > 0) filas.splice(3, 0, ['— auxiliares', numero(resumen.auxiliares)])
  if (resumen.deAlerta > 0) filas.splice(3, 0, ['— de alerta', numero(resumen.deAlerta)])

  const bloques = [
    titulo('Resumen', 1),
    parrafo(
      `El área ${resumen.area || ''} tiene ${numero(resumen.cifras)} cifras clave `
      + `(${numero(resumen.guardadas)} guardadas y ${numero(resumen.calculadas)} calculadas) `
      + `repartidas en ${numero(resumen.nivelesDePlanificacion)} niveles de planificación, `
      + `sobre ${numero(resumen.tiposDeDatoMaestro)} tipos de dato maestro.`,
    ),
    tabla(['Qué', 'Cuántos'], filas, { tamano: 18 }),
  ]

  if (resumen.modulos.length > 0) {
    bloques.push(
      parrafo('Módulos de IBP que se deducen de las etiquetas de las cifras clave:', { negrita: true }),
      parrafo(resumen.modulos.join(' · ')),
    )
  }

  return bloques
}

/** Una sección con su tabla, o la nota de que no vino. */
function seccion(una, datos) {
  const suya = datos?.[una.id]
  const bloques = [titulo(una.titulo, 1)]

  if (!suya || suya.filas.length === 0) {
    bloques.push(parrafo('No se incluyó este archivo en la exportación.', { color: '767171' }))
    return bloques
  }

  bloques.push(parrafo(`${numero(suya.filas.length)} registros. Archivo: ${suya.archivo}.`, { color: '767171' }))

  // Con columnas declaradas se enseñan esas, en ese orden; si no, las que trajo el archivo. Declararlas
  // es lo que hace legible una tabla que en SAP tiene cuarenta campos.
  const columnas = una.columnas.length > 0 ? una.columnas : suya.encabezado.slice(0, 8)
  const filas = suya.objetos.slice(0, MAX_FILAS_POR_TABLA)
    .map((objeto) => columnas.map((columna) => recortar(campo(objeto, columna))))

  bloques.push(tabla(columnas.map((una2) => recortar(una2, 40)), filas, { tamano: 14 }))

  if (suya.filas.length > MAX_FILAS_POR_TABLA) {
    bloques.push(parrafo(
      `Se listan las primeras ${numero(MAX_FILAS_POR_TABLA)} de ${numero(suya.filas.length)}.`,
      { color: '767171' },
    ))
  }

  return bloques
}

/** Los Application Jobs, que sí se leen en vivo de SAP. */
function seccionDeTrabajos(trabajos) {
  const bloques = [
    titulo('Trabajos programados', 1),
    parrafo(
      'Leídos en vivo del tenant. Es la parte de la configuración que SAP sí expone por API, así que '
      + 'no hace falta exportarla: dice con qué se carga y se ejecuta el área.',
    ),
  ]

  if ((trabajos ?? []).length === 0) {
    bloques.push(parrafo('El tenant no devolvió ningún trabajo.', { color: '767171' }))
    return bloques
  }

  bloques.push(tabla(
    ['Trabajo', 'Tipo', 'Pasos'],
    trabajos.map((uno) => [uno.nombre, uno.tipo ?? '', String(uno.pasos ?? '')]),
    { tamano: 16 },
  ))
  return bloques
}

/**
 * Arma el documento entero.
 *
 * `meta` lleva el cliente, el tenant y los logos; `trabajos`, lo leído en vivo si se pidió.
 */
export async function generarDocumento({ datos, meta = {}, trabajos = null }) {
  const leido = resumirArea(datos)
  // El área del selector es el respaldo: sin `GENERAL_INFO` el documento no sabría de qué área es.
  const resumen = { ...leido, area: leido.area || meta.area || '' }

  const imagenes = []
  if (meta.logo?.base64) {
    imagenes.push({ id: 'rIdLogo', nombre: `logo_cliente.${meta.logo.extension}`, datos: meta.logo.base64 })
  }
  if (meta.marca?.base64) {
    imagenes.push({ id: 'rIdGoscm', nombre: `logo_goscm.${meta.marca.extension}`, datos: meta.marca.base64 })
  }

  const bloques = [
    ...portada(resumen, meta, imagenes),
    titulo('Índice', 1),
    indice(),
    saltoDePagina(),
    ...resumenEjecutivo(resumen),
  ]

  for (const una of SECCIONES) bloques.push(...seccion(una, datos))
  if (trabajos) bloques.push(...seccionDeTrabajos(trabajos))

  const buffer = await armarDocx(bloques, imagenes)
  return { buffer, resumen, nombre: nombreDelArchivo(resumen.area) }
}

/** El nombre del archivo: el área y la fecha, que es lo que se busca cuando hay varios. */
export function nombreDelArchivo(area) {
  const dos = (valor) => String(valor).padStart(2, '0')
  const hoy = new Date()
  const limpia = String(area || 'area').replace(/[^\w-]+/g, '_')
  return `documentacion_${limpia}_${hoy.getFullYear()}${dos(hoy.getMonth() + 1)}${dos(hoy.getDate())}.docx`
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
