// El constructor de documentos de Word.
//
// Se comprueba el XML, no el aspecto: que un `.docx` sea un ZIP con las piezas que Word espera y que el
// texto vaya escapado. Un carácter sin escapar rompe el archivo entero y Word solo dice «el documento
// está dañado», sin decir dónde. Y que el XML sea el de v7: mismos anchos, mismos colores.

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import {
  AZUL,
  EMU_POR_PIXEL,
  NARANJA,
  POR_PULGADA,
  armarDocx,
  documentoXml,
  ejecuciones,
  imagen,
  indice,
  parrafo,
  parrafoVacio,
  partesDelDocumento,
  prosa,
  saltoDePagina,
  tabla,
  tablaCampoValor,
  tipoDeImagen,
  titulo,
  xesc,
} from './docx.js'

describe('xesc', () => {
  it('escapa lo que rompería el XML, también el apóstrofo como v7', () => {
    expect(xesc(`a & b < c > "d" 'e'`)).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;')
  })

  it('lo que no hay es cadena vacía', () => {
    expect(xesc(null)).toBe('')
    expect(xesc(undefined)).toBe('')
  })

  // Un carácter de control en una definición de cálculo bastaría para dejar el documento «dañado».
  it('quita los caracteres que XML 1.0 no admite, y deja tabulador y saltos', () => {
    expect(xesc('a\u0000b\u0008c\td\ne')).toBe('abc\td\ne')
  })
})

describe('ejecuciones', () => {
  it('un salto de línea del texto es un salto de línea de Word', () => {
    const salida = ejecuciones('uno\ndos')
    expect(salida.match(/<w:r>/g)).toHaveLength(2)
    expect(salida).toContain('<w:br/>')
  })

  it('el formato va dentro de cada trozo', () => {
    expect(ejecuciones('x', '<w:b/>')).toBe('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">x</w:t></w:r>')
  })
})

describe('parrafo', () => {
  it('escribe el texto dentro de un párrafo', () => {
    expect(parrafo('Hola')).toContain('<w:t xml:space="preserve">Hola</w:t>')
  })

  it('escapa lo que rompería el XML', () => {
    const salida = parrafo('a & b < c')
    expect(salida).toContain('&amp;')
    expect(salida).toContain('&lt;')
  })

  // En v7 el tamaño se pide en puntos y se escribe en medios puntos.
  it('el tamaño se pide en puntos y va en medios puntos', () => {
    expect(parrafo('x', { tamano: 26 })).toContain('<w:sz w:val="52"/>')
  })

  it('negrita, cursiva y color van en el formato, en el orden de v7', () => {
    const salida = parrafo('x', { negrita: true, cursiva: true, color: 'E8622A', tamano: 10 })
    expect(salida).toContain('<w:rPr><w:b/><w:i/><w:color w:val="E8622A"/><w:sz w:val="20"/></w:rPr>')
  })

  it('el párrafo lleva estilo, espacio y alineación en el orden de v7', () => {
    const salida = parrafo('x', { estilo: 'Heading1', despues: 120, alineado: 'center' })
    expect(salida).toContain('<w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr>')
  })

  it('sin opciones no mete propiedades', () => {
    const salida = parrafo('x')
    expect(salida).not.toContain('<w:pPr>')
    expect(salida).not.toContain('<w:rPr>')
  })

  it('la prosa deja 120 de espacio', () => {
    expect(prosa('x')).toContain('<w:spacing w:after="120"/>')
  })
})

describe('titulo, salto de página y párrafo vacío', () => {
  it('el título usa el estilo del nivel, que es lo que alimenta el índice', () => {
    expect(titulo('Cifras clave', 1)).toContain('<w:pStyle w:val="Heading1"/>')
    expect(titulo('Detalle', 2)).toContain('<w:pStyle w:val="Heading2"/>')
  })

  it('escapa el texto del título', () => {
    expect(titulo('A & B', 1)).toContain('&amp;')
  })

  it('el salto de página y el párrafo vacío son los de v7', () => {
    expect(saltoDePagina()).toBe('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    expect(parrafoVacio()).toBe('<w:p/>')
  })
})

describe('indice', () => {
  // Word no calcula el índice al abrir: guarda la instrucción y el resultado.
  it('mete la instrucción de tabla de contenido y el texto de ayuda', () => {
    const salida = indice('Actualiza este campo')
    expect(salida).toContain('TOC \\o "1-3" \\h \\z \\u')
    expect(salida).toContain('fldCharType="begin"')
    expect(salida).toContain('fldCharType="end"')
    expect(salida).toContain('Actualiza este campo')
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

  it('el encabezado es naranja con letra blanca, como v7', () => {
    expect(salida).toContain(`w:fill="${NARANJA}"`)
    expect(salida).toContain('<w:b/><w:color w:val="FFFFFF"/>')
  })

  it('el ancho es porcentual y se reparte por igual', () => {
    expect(salida).toContain('<w:tblW w:w="5000" w:type="pct"/>')
    expect(salida).toContain('<w:tcW w:w="2500" w:type="pct"/>')
  })

  it('el tamaño de letra se pide en puntos', () => {
    expect(tabla(['A'], [['x']], { tamano: 7 })).toContain('<w:sz w:val="14"/>')
    expect(salida).toContain('<w:sz w:val="18"/>')
  })

  it('el color del encabezado se puede cambiar', () => {
    expect(tabla(['A'], [], { relleno: AZUL })).toContain(`w:fill="${AZUL}"`)
  })

  it('una fila corta rellena las celdas que faltan', () => {
    const corta = tabla(['A', 'B', 'C'], [['1']])
    expect(corta.match(/<w:tc>/g)).toHaveLength(6)
  })

  it('escapa el contenido de las celdas', () => {
    expect(tabla(['A'], [['x & y']])).toContain('&amp;')
  })

  it('sin columnas no dibuja nada, en vez de escribir «Infinity»', () => {
    expect(tabla([], [['1']])).toBe('')
    expect(tabla(undefined, undefined)).toBe('')
  })

  it('termina con un párrafo vacío para separar de lo siguiente', () => {
    expect(salida.endsWith('</w:tbl><w:p/>')).toBe(true)
  })

  it('la tabla de campo y valor lleva el encabezado azul', () => {
    const kv = tablaCampoValor(['Campo', 'Valor'], [['Cliente', 'ACME']])
    expect(kv).toContain(`w:fill="${AZUL}"`)
    expect(kv).toContain('ACME')
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

  it('sin imagen no dibuja nada', () => {
    expect(imagen('rIdLogo', null, 100)).toBe('')
  })
})

describe('tipoDeImagen', () => {
  it('png y jpeg', () => {
    expect(tipoDeImagen('png')).toBe('image/png')
    expect(tipoDeImagen('jpeg')).toBe('image/jpeg')
  })

  // `image/jpg` y `image/svg` no existen: Word rechaza el documento entero.
  it('jpg es image/jpeg y svg es image/svg+xml', () => {
    expect(tipoDeImagen('jpg')).toBe('image/jpeg')
    expect(tipoDeImagen('SVG')).toBe('image/svg+xml')
  })

  it('gif y webp tienen el suyo', () => {
    expect(tipoDeImagen('gif')).toBe('image/gif')
    expect(tipoDeImagen('webp')).toBe('image/webp')
  })

  it('una extensión desconocida no inventa un tipo', () => {
    expect(tipoDeImagen('xyz')).toBe('application/octet-stream')
    expect(tipoDeImagen(undefined)).toBe('application/octet-stream')
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

  it('están las piezas que Word necesita', () => {
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

  it('los estilos definen los tres niveles de título con los colores de v7', () => {
    for (const nivel of [1, 2, 3]) {
      expect(partes['word/styles.xml']).toContain(`w:styleId="Heading${nivel}"`)
    }
    expect(partes['word/styles.xml']).toContain(`<w:color w:val="${AZUL}"/><w:sz w:val="32"/>`)
  })

  it('una imagen añade su relación y su tipo de contenido', () => {
    const conImagen = partesDelDocumento([], [{ id: 'rIdLogo', nombre: 'logo.png', datos: 'AAA' }])
    expect(conImagen['word/_rels/document.xml.rels']).toContain('media/logo.png')
    expect(conImagen['[Content_Types].xml']).toContain('Extension="png" ContentType="image/png"')
  })

  it('un .jpeg se declara como image/jpeg', () => {
    const conJpeg = partesDelDocumento([], [{ id: 'rIdLogo', nombre: 'logo.jpeg', datos: 'AAA' }])
    expect(conJpeg['[Content_Types].xml']).toContain('Extension="jpeg" ContentType="image/jpeg"')
  })

  it('un .jpg y un .svg tampoco generan un tipo inválido', () => {
    const tipos = partesDelDocumento([], [
      { id: 'a', nombre: 'a.jpg', datos: '' },
      { id: 'b', nombre: 'b.svg', datos: '' },
    ])['[Content_Types].xml']
    expect(tipos).toContain('ContentType="image/jpeg"')
    expect(tipos).toContain('ContentType="image/svg+xml"')
    expect(tipos).not.toContain('image/jpg')
    expect(tipos).not.toMatch(/image\/svg"/)
  })

  it('dos imágenes del mismo formato declaran el tipo una sola vez', () => {
    const tipos = partesDelDocumento([], [
      { id: 'a', nombre: 'a.png', datos: '' },
      { id: 'b', nombre: 'b.png', datos: '' },
    ])['[Content_Types].xml']
    expect(tipos.match(/Extension="png"/g)).toHaveLength(1)
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
