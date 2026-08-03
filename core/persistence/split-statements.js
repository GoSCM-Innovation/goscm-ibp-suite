// Trocea un archivo .sql en sentencias sueltas.
//
// El driver HTTP de Neon manda una sentencia por petición, así que el runner de migraciones
// no puede enviar el archivo entero. El troceo entiende cadenas entre comillas simples (con
// '' como escape), identificadores entre comillas dobles y comentarios `--` y `/* */`, para
// no cortar en un punto y coma que viva dentro de alguno de ellos.
//
// NO entiende el entrecomillado con $$ (funciones, bloques DO). Si aparece, revienta en vez
// de partir mal el archivo: es mejor que la migración falle a que se aplique media
// sentencia. Si algún día hace falta una función, el runner tendrá que cambiar de enfoque.

export function splitStatements(sql) {
  const statements = []
  let current = ''
  let i = 0

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) statements.push(trimmed)
    current = ''
  }

  while (i < sql.length) {
    const char = sql[i]
    const next = sql[i + 1]

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end + 1
      current += '\n'
      continue
    }

    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end === -1) throw new Error('Comentario /* sin cerrar en el archivo SQL.')
      i = end + 2
      current += ' '
      continue
    }

    if (char === '$' && next === '$') {
      throw new Error('El troceador no soporta entrecomillado con $$ (funciones o bloques DO).')
    }

    if (char === "'" || char === '"') {
      const quote = char
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2 // comilla escapada duplicándola
            continue
          }
          break
        }
        j += 1
      }
      if (j >= sql.length) throw new Error(`Cadena sin cerrar (${quote}) en el archivo SQL.`)
      current += sql.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (char === ';') {
      flush()
      i += 1
      continue
    }

    current += char
    i += 1
  }

  flush()
  return statements
}
