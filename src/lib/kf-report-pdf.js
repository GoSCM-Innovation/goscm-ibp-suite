// Dibuja el informe de una corrida de cifras clave en un PDF.
//
// Lo que va en el informe y cómo se redacta está en `core/ibp/kf-run-report.js`, que se puede probar.
// Aquí queda solo el dibujo, que no se prueba con aserciones: se mira.
//
// `jspdf` y `jspdf-autotable` se cargan con un import DINÁMICO. Son unos cientos de kilobytes y solo
// hacen falta cuando alguien pulsa el botón; en el paquete principal serían peso muerto para todos los
// que nunca migran cifras.
//
// AVISO DE CARACTERES: la Helvetica que trae jsPDF solo cubre WinAnsi (cp1252). Los acentos y la ñ
// entran; las flechas y los símbolos matemáticos (→ ≠ ✓ ⚠ ×) NO, y salen como un carácter roto. El
// núcleo ya devuelve el texto con `->` en ASCII; aquí no hay que volver a meter símbolos.

import {
  duracionLegible,
  filasDeConfiguracion,
  filasDeSegmentos,
  mensajesAgrupados,
  momentoLegible,
  nombreDelInforme,
  resumirCorrida,
} from '../../core/ibp/kf-run-report.js'

const MARGEN = 40
const ANCHO = 595.28
const ALTO = 841.89
const PIE = ALTO - 22

/** El color de cada final. Un informe se hojea: el estado se ve antes de leerlo. */
const COLOR_DE_ESTADO = {
  ok: [27, 142, 74],
  conRechazos: [193, 132, 16],
  cancelado: [110, 110, 110],
  error: [198, 44, 44],
}

const ACENTO = [235, 137, 8]
const numero = (valor) => Number(valor ?? 0).toLocaleString('es')

/** Dónde puede empezar el bloque siguiente. */
const siguienteY = (doc) => (doc.lastAutoTable ? doc.lastAutoTable.finalY : MARGEN) + 20

function titulo(doc, texto) {
  let y = siguienteY(doc)
  if (y > ALTO - 90) { doc.addPage(); y = MARGEN + 10 }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(40)
  doc.text(texto, MARGEN, y)
  return y + 8
}

/** Un bloque de etiqueta y valor, como los resúmenes de la pantalla. */
function paresClaveValor(autoTable, doc, y, filas, opciones = {}) {
  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN, bottom: 40 },
    theme: 'plain',
    body: filas,
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 3, bottom: 3, left: 0, right: 8 },
      textColor: [55, 55, 55],
      overflow: 'linebreak',
    },
    columnStyles: { 0: { cellWidth: 155, fontStyle: 'bold', textColor: [115, 115, 115] } },
    ...opciones,
  })
}

/**
 * Construye el documento y lo devuelve sin descargarlo.
 *
 * Separado de la descarga a propósito: así se puede abrir en una pestaña o adjuntarlo sin pasar por
 * el disco, y sobre todo se puede mirar sin que el navegador guarde un archivo cada vez.
 */
export async function construirInforme(corrida) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const resumen = resumirCorrida(corrida)
  const color = COLOR_DE_ESTADO[resumen.estado.clave] ?? [55, 55, 55]

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(25)
  doc.text('Copia de cifras clave entre tenants', MARGEN, MARGEN + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(130)
  doc.text(`Informe generado el ${new Date().toLocaleString('es')}`, MARGEN, MARGEN + 18)

  doc.setDrawColor(...ACENTO)
  doc.setLineWidth(1.2)
  doc.line(MARGEN, MARGEN + 26, ANCHO - MARGEN, MARGEN + 26)

  paresClaveValor(autoTable, doc, MARGEN + 38, [
    ['Como acabo', resumen.estado.etiqueta],
    ['Filas escritas', numero(resumen.copiadas)],
    ['Empezo', momentoLegible(corrida?.inicio)],
    ['Termino', momentoLegible(corrida?.fin)],
    ['Duracion', duracionLegible(resumen.duracion)],
    ['Segmentos', `${numero(resumen.segmentos)} · media de ${duracionLegible(resumen.mediaPorSegmento)} cada uno`],
    ...(resumen.rechazadas > 0 ? [['Filas rechazadas por SAP', numero(resumen.rechazadas)]] : []),
    ...(corrida?.error ? [['Error', String(corrida.error).slice(0, 400)]] : []),
  ], {
    // El estado en color: se ve antes de leer el informe.
    didParseCell: (dato) => {
      if (dato.row.index === 0 && dato.column.index === 1) {
        dato.cell.styles.textColor = color
        dato.cell.styles.fontStyle = 'bold'
      }
    },
  })

  paresClaveValor(autoTable, doc, titulo(doc, 'Con que se corrio'), filasDeConfiguracion(corrida))

  // Los segmentos: es la unidad de la transacción, y lo que quedó escrito si algo se cortó a mitad.
  const segmentos = filasDeSegmentos(corrida)
  if (segmentos.length > 0) {
    autoTable(doc, {
      startY: titulo(doc, `Segmentos (${numero(segmentos.length)})`),
      margin: { left: MARGEN, right: MARGEN, bottom: 40 },
      head: [['#', 'Desde la fila', 'Filas', 'Transaccion', 'Estado', 'Duracion']],
      body: segmentos,
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 22, halign: 'right' },
        1: { cellWidth: 70, halign: 'right' },
        2: { cellWidth: 55, halign: 'right' },
        3: { cellWidth: 150, fontSize: 6.5 },
        5: { halign: 'right' },
      },
      theme: 'striped',
    })

    if (resumen.masLento) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(140)
      doc.text(
        `El mas lento fue el de la fila ${numero(resumen.masLento.desde)}, con `
        + `${duracionLegible(resumen.masLento.ms)}. Cada segmento es una transaccion propia que SAP `
        + 'confirma sola: si la corrida se corta, lo escrito son los segmentos de arriba.',
        MARGEN,
        siguienteY(doc) - 10,
        { maxWidth: ANCHO - 2 * MARGEN },
      )
    }
  }

  // Los mensajes agrupados: cien iguales son un problema, no cien.
  const mensajes = mensajesAgrupados(corrida?.mensajes)
  if (mensajes.length > 0) {
    autoTable(doc, {
      startY: titulo(doc, `Lo que dijo SAP (${numero(mensajes.length)} distintos)`),
      margin: { left: MARGEN, right: MARGEN, bottom: 40 },
      head: [['Veces', 'Mensaje']],
      body: mensajes.slice(0, 40).map((uno) => [numero(uno.veces), uno.texto]),
      styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [198, 44, 44], textColor: 255 },
      columnStyles: { 0: { cellWidth: 40, halign: 'right' } },
      theme: 'striped',
    })

    if (mensajes.length > 40) {
      doc.setFontSize(7)
      doc.setTextColor(140)
      doc.text(`y ${numero(mensajes.length - 40)} mensajes distintos mas.`, MARGEN, siguienteY(doc) - 10)
    }
  }

  const paginas = doc.getNumberOfPages()
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    doc.setPage(pagina)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(150)
    doc.text('GoSCM Suite', MARGEN, PIE)
    doc.text(`Pagina ${pagina} de ${paginas}`, ANCHO - MARGEN, PIE, { align: 'right' })
  }

  return doc
}

/** Construye el informe y lo descarga. Devuelve el nombre del archivo. */
export async function descargarInforme(corrida) {
  const doc = await construirInforme(corrida)
  const nombre = nombreDelInforme(corrida)
  doc.save(nombre)
  return nombre
}
