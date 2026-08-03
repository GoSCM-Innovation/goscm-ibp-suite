import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitStatements } from './split-statements.js'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('splitStatements', () => {
  it('separa por punto y coma y descarta lo vacío', () => {
    expect(splitStatements('select 1; select 2;;')).toEqual(['select 1', 'select 2'])
  })

  it('no corta en un punto y coma dentro de una cadena', () => {
    const statements = splitStatements("insert into t (a) values ('uno; dos'); select 1")
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain("'uno; dos'")
  })

  it('entiende la comilla simple escapada duplicándola', () => {
    const statements = splitStatements("select 'it''s; fine'; select 2")
    expect(statements).toHaveLength(2)
    expect(statements[0]).toBe("select 'it''s; fine'")
  })

  it('no corta en un punto y coma dentro de un identificador entre comillas dobles', () => {
    expect(splitStatements('select "raro;nombre" from t')).toHaveLength(1)
  })

  it('descarta los comentarios de línea sin pegar los tokens vecinos', () => {
    expect(splitStatements('select 1 -- un; comentario\nfrom t')).toEqual(['select 1 \nfrom t'])
  })

  it('descarta los comentarios de bloque', () => {
    expect(splitStatements('select /* a; b */ 1')).toEqual(['select   1'])
  })

  it('revienta ante el entrecomillado con $$ en vez de partirlo mal', () => {
    expect(() => splitStatements('create function f() as $$ begin end; $$')).toThrow(/\$\$/)
  })

  it('revienta con una cadena sin cerrar', () => {
    expect(() => splitStatements("select 'abre y no cierra")).toThrow(/sin cerrar/)
  })

  it('revienta con un comentario de bloque sin cerrar', () => {
    expect(() => splitStatements('select 1 /* abre y no cierra')).toThrow(/sin cerrar/)
  })

  it('trocea la migración inicial en sentencias completas y ejecutables', () => {
    const sql = readFileSync(join(HERE, 'migrations', '001_initial.sql'), 'utf-8')
    const statements = splitStatements(sql)

    // 5 create table + 1 unique index + 3 create index
    expect(statements).toHaveLength(9)
    expect(statements.filter((s) => /^create table/i.test(s))).toHaveLength(5)
    expect(statements.filter((s) => /^create (unique )?index/i.test(s))).toHaveLength(4)
    for (const statement of statements) {
      expect(statement).not.toMatch(/^\s*$/)
      // Un corte mal hecho dejaría paréntesis descompensados.
      const opens = (statement.match(/\(/g) || []).length
      const closes = (statement.match(/\)/g) || []).length
      expect(opens).toBe(closes)
    }
  })
})
