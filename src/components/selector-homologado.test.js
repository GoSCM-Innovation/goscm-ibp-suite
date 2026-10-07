// La garantía de que elegir de una lista se comporta IGUAL en Data Tools, CI-DS Tools e IBP Tools.
//
// El criterio (`lib/lista-extensa.js`): hasta 12 opciones, el control de siempre; más, la ventana con
// buscador. Lo cumple `ui/SelectorDeLista.jsx` (y, en IBP, `SearchSelect`). Un `<select>` escrito a mano se
// salta el criterio sin que nada avise: con 40 opciones sería otra vez el desplegable largo e incómodo.
//
// Por eso esta prueba recorre todos los componentes y falla si encuentra un `<select>` suelto. Los que
// de verdad son una lista cerrada y corta (la estrategia de error, el tamaño de página, el operador de un
// filtro) se declaran con el comentario `select-fijo` en las dos líneas anteriores, que es la forma de
// decir «lo pensé, no crece con los datos». Si un `<select>` nuevo crece con los datos, se escribe con
// `SelectorDeLista`.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(import.meta.dirname)

function archivosJsx(carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre)
    if (statSync(ruta).isDirectory()) return archivosJsx(ruta)
    return /\.jsx$/.test(nombre) ? [ruta] : []
  })
}

// El único sitio donde un `<select>` nativo es el trabajo: es el sustituto de todos los demás.
const PERMITIDOS = new Set(['ui/SelectorDeLista.jsx'])

describe('elegir de una lista: un solo criterio en toda la web', () => {
  it('no hay `<select>` sueltos: son SelectorDeLista o están declarados select-fijo', () => {
    const sueltos = []
    for (const archivo of archivosJsx(RAIZ)) {
      const clave = relative(RAIZ, archivo).split(sep).join('/')
      if (PERMITIDOS.has(clave)) continue
      const lineas = readFileSync(archivo, 'utf8').split('\n')
      lineas.forEach((linea, i) => {
        // Comentarios que MENCIONAN `<select>` no cuentan: solo el que se abre como etiqueta.
        if (!/<select[\s>]/.test(linea) || /^\s*(\/\/|\*|\{\/\*)/.test(linea)) return
        const antes = lineas.slice(Math.max(0, i - 2), i).join('\n')
        if (!antes.includes('select-fijo')) sueltos.push(`${clave}:${i + 1}`)
      })
    }
    expect(sueltos, `Cada <select> debe ser <SelectorDeLista> o llevar el comentario select-fijo:\n${sueltos.join('\n')}`).toEqual([])
  })
})
