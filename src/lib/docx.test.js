// El constructor de documentos de Word.
//
// Se comprueba el XML, no el aspecto: que un `.docx` sea un ZIP con las piezas que Word espera y que el
// texto vaya escapado. Un carácter sin escapar rompe el archivo entero y Word solo dice «el documento
// está dañado», sin decir dónde.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import {
  ANCHO_UTIL,
  EMU_POR_PIXEL,
  POR_PULGADA,
  armarDocx,
  documentoXml,
  imagen,
  indice,
  parrafo,
  partesDelDocumento,
  saltoDePagina,
  tabla,
  titulo,
} from './docx.js'

describe('parrafo', () => {
  it('escribe el texto dentro de un párrafo', () => {
    expect(parrafo('Hola')).toContain('<w:t xml:space="preserve">Hola</w:t>')
  })

  // Un carácter sin escapar rompe el archivo y Word solo dice «documento dañado».
  it('escapa lo que rompería el XML', () => {
    const salida = parrafo('a & b < c > "d"')
    expect(salida).toContain('&amp;')
    expect(salida).toContain('&lt;')
    expect(salida).not.toMatch(/<w:t[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/)
  })

  it('el tamaño va en medios puntos', () => {
    expect(parrafo('x', { tamano: 44 })).toContain('<w:sz w:val="44"/>')
  })

  it('la negrita y el centrado se piden aparte', () => {
    expect(parrafo('x', { negrita: true })).toContain('<w:b/>')
    expect(parrafo('x', { centrado: true })).toContain('<w:jc w:val="center"/>')
  })

  it('sin color no mete la etiqueta de color', () => {
    expect(parrafo('x')).not.toContain('w:color')
  })
})

describe('titulo', () => {
  it('usa el estilo del nivel, que es lo que alimenta el índice', () => {
    expect(titulo('Cifras clave', 1)).toContain('<w:pStyle w:val="Heading1"/>')
    expect(titulo('Detalle', 3)).toContain('<w:pStyle w:val="Heading3"/>')
  })

  it('escapa el texto', () => {
    expect(titulo('A & B')).toContain('&amp;')
  })
})

describe('indice', () => {
  // Word no calcula el índice al abrir: guarda la instrucción y el resultado.
  it('mete la instrucción de tabla de contenido', () => {
    expect(indice()).toContain('TOC')
    expect(indice()).toContain('fldCharType="begin"')
    expect(indice()).toContain('fldCharType="end"')
  })
})

describe('tabla', () => {
  const salida = tabla(['A', 'B'], [['1', '2'], ['3', '4']])

  it('lleva encabezado y una fila por dato', () => {
    expect(salida.match(/<w:tr>/g)).toHaveLength(3)
  })

  // Una tabla de cuarenta filas parte en dos páginas: sin esto la segunda no tiene títulos.
  it('el encabezado se repite en cada página', () => {
    expect(salida).toContain('<w:tblHeader/>')
  })

  it('las columnas se reparten el ancho útil', () => {
    expect(salida).toContain(`w:w="${Math.floor(ANCHO_UTIL / 2)}"`)
  })

  it('una fila corta rellena las celdas que faltan', () => {
    const corta = tabla(['A', 'B', 'C'], [['1']])
    // Tres celdas de encabezado y tres de la fila.
    expect(corta.match(/<w:tc>/g)).toHaveLength(6)
  })

  it('escapa el contenido de las celdas', () => {
    expect(tabla(['A'], [['x & y']])).toContain('&amp;')
  })

  it('sin columnas no dibuja nada', () => {
    expect(tabla([], [['1']])).toBe('')
    expect(tabla(undefined, undefined)).toBe('')
  })
})

describe('imagen', () => {
  it('convierte los píxeles a las unidades de Word', () => {
    const salida = imagen('rIdLogo', { ancho: 100, alto: 50 }, 100)
    expect(salida).toContain(`cx="${100 * EMU_POR_PIXEL}"`)
    expect(salida).toContain(`cy="${50 * EMU_POR_PIXEL}"`)
  })

  it('escala hacia abajo si no cabe, manteniendo la proporción', () => {
    const salida = imagen('rIdLogo', { ancho: 400, alto: 200 }, 200)
    expect(salida).toContain(`cx="${200 * EMU_POR_PIXEL}"`)
    expect(salida).toContain(`cy="${100 * EMU_POR_PIXEL}"`)
  })

  it('no agranda una imagen pequeña', () => {
    expect(imagen('rIdLogo', { ancho: 50, alto: 50 }, 200)).toContain(`cx="${50 * EMU_POR_PIXEL}"`)
  })

  it('apunta a la relación por su identificador', () => {
    expect(imagen('rIdGoscm', { ancho: 10, alto: 10 }, 10)).toContain('r:embed="rIdGoscm"')
  })
})

describe('documentoXml', () => {
  it('mete los bloques en el cuerpo', () => {
    expect(documentoXml([parrafo('Hola')])).toContain('Hola')
  })

  it('cierra con el tamaño de página y sus márgenes', () => {
    const salida = documentoXml([])
    expect(salida).toContain('<w:pgSz w:w="12240" w:h="15840"/>')
    expect(salida).toContain(`w:top="${POR_PULGADA}"`)
  })

  it('declara los espacios de nombres que hacen falta para imágenes y tablas', () => {
    const salida = documentoXml([])
    for (const cual of ['xmlns:w=', 'xmlns:r=', 'xmlns:wp=', 'xmlns:a=', 'xmlns:pic=']) {
      expect(salida).toContain(cual)
    }
  })

  it('sin bloques sigue siendo un documento válido', () => {
    expect(documentoXml()).toContain('<w:body>')
  })
})

describe('partesDelDocumento', () => {
  const partes = partesDelDocumento([parrafo('x')])

  it('están las cinco piezas que Word necesita', () => {
    for (const ruta of [
      '[Content_Types].xml', '_rels/.rels', 'word/document.xml',
      'word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels',
    ]) {
      expect(Object.keys(partes)).toContain(ruta)
    }
  })

  // Sin esto Word abre el documento con el índice en blanco y hay que actualizarlo a mano.
  it('los ajustes piden actualizar los campos al abrir', () => {
    expect(partes['word/settings.xml']).toContain('<w:updateFields w:val="true"/>')
  })

  it('los estilos definen los tres niveles de título', () => {
    for (const nivel of [1, 2, 3]) {
      expect(partes['word/styles.xml']).toContain(`w:styleId="Heading${nivel}"`)
    }
  })

  it('una imagen añade su relación y su tipo de contenido', () => {
    const conImagen = partesDelDocumento([], [{ id: 'rIdLogo', nombre: 'logo.png', datos: 'AAA' }])
    expect(conImagen['word/_rels/document.xml.rels']).toContain('media/logo.png')
    expect(conImagen['[Content_Types].xml']).toContain('Extension="png"')
  })

  it('un .jpg se declara como image/jpeg, que es su tipo real', () => {
    const conJpg = partesDelDocumento([], [{ id: 'rIdLogo', nombre: 'logo.jpg', datos: 'AAA' }])
    expect(conJpg['[Content_Types].xml']).toContain('ContentType="image/jpeg"')
  })

  it('sin imágenes no declara ningún tipo de imagen', () => {
    expect(partes['[Content_Types].xml']).not.toContain('image/')
  })
})

describe('armarDocx', () => {
  it('sale un ZIP con las piezas dentro, que es lo que es un .docx', async () => {
    const buffer = await armarDocx([titulo('Título', 1), parrafo('Texto'), saltoDePagina()])
    const zip = await JSZip.loadAsync(buffer)

    expect(Object.keys(zip.files)).toContain('word/document.xml')
    const documento = await zip.file('word/document.xml').async('string')
    expect(documento).toContain('Título')
    expect(documento).toContain('<w:br w:type="page"/>')
  })

  it('la imagen queda dentro, en su carpeta', async () => {
    const buffer = await armarDocx([], [{ id: 'rIdLogo', nombre: 'logo.png', datos: 'iVBORw0KGgo=' }])
    const zip = await JSZip.loadAsync(buffer)
    expect(Object.keys(zip.files)).toContain('word/media/logo.png')
  })

  it('un documento con una tabla grande se arma sin romperse', async () => {
    const filas = Array.from({ length: 300 }, (nada, i) => [`fila ${i}`, 'x & y', '<z>'])
    const buffer = await armarDocx([tabla(['A', 'B', 'C'], filas)])
    const zip = await JSZip.loadAsync(buffer)
    const documento = await zip.file('word/document.xml').async('string')

    expect(documento.match(/<w:tr>/g)).toHaveLength(301)
    expect(documento).toContain('&lt;z&gt;')
  })
})
