import { describe, expect, it } from 'vitest'
import {
  GRUPOS_DE_CLIENTE,
  GRUPOS_DE_CONEXION,
  GRUPOS_DE_PERSONA,
  agrupar,
  grupoDeCliente,
  grupoDePersona,
  resumenDeNombres,
} from './admin-grupos.js'

describe('grupoDePersona', () => {
  const persona = (cambios) => ({ status: 'active', isAdmin: false, isPlatformAdmin: false, ...cambios })

  it('cae en el permiso más alto que tiene', () => {
    expect(grupoDePersona(persona({}))).toBe('usuario')
    expect(grupoDePersona(persona({ isAdmin: true }))).toBe('admin')
    expect(grupoDePersona(persona({ isPlatformAdmin: true }))).toBe('plataforma')
    expect(grupoDePersona(persona({ isAdmin: true, isPlatformAdmin: true }))).toBe('plataforma')
  })

  it('quien está de baja va aparte, tenga el permiso que tenga', () => {
    expect(grupoDePersona(persona({ status: 'disabled', isPlatformAdmin: true, isAdmin: true }))).toBe('baja')
    expect(grupoDePersona(persona({ status: 'cualquier otra cosa' }))).toBe('baja')
  })
})

describe('grupoDeCliente', () => {
  it('activos y suspendidos; lo que no es activo cuenta como suspendido', () => {
    expect(grupoDeCliente({ status: 'active' })).toBe('activos')
    expect(grupoDeCliente({ status: 'suspended' })).toBe('suspendidos')
    expect(grupoDeCliente({ status: 'otra' })).toBe('suspendidos')
  })
})

describe('agrupar', () => {
  const conexiones = [
    { name: 'A', kind: 'ci' }, { name: 'B', kind: 'ibp' }, { name: 'C', kind: 'ibp' }, { name: 'D', kind: 'cids' },
  ]
  const nombres = (grupo) => grupo.elementos.map((uno) => uno.name)

  it('reparte en el orden de los grupos y conserva el orden de cada uno', () => {
    const grupos = agrupar(conexiones, GRUPOS_DE_CONEXION, (uno) => uno.kind)
    expect(grupos.map((g) => [g.id, nombres(g)])).toEqual([['ibp', ['B', 'C']], ['cids', ['D']], ['ci', ['A']]])
  })

  it('todos los grupos salen, también los vacíos', () => {
    const grupos = agrupar([], GRUPOS_DE_CONEXION, (uno) => uno.kind)
    expect(grupos.map((g) => g.id)).toEqual(['ibp', 'cids', 'ci'])
    expect(grupos.every((g) => g.elementos.length === 0)).toBe(true)
  })

  // Un tipo nuevo que esta lista no conoce no puede quedar invisible.
  it('lo que no cae en ningún grupo va a «Otros», que solo existe si hace falta', () => {
    const con = agrupar([...conexiones, { name: 'Z', kind: 'nuevo' }], GRUPOS_DE_CONEXION, (uno) => uno.kind)
    expect(con.at(-1)).toMatchObject({ id: 'otros', titulo: 'Otros' })
    expect(nombres(con.at(-1))).toEqual(['Z'])
    expect(agrupar(conexiones, GRUPOS_DE_CONEXION, (uno) => uno.kind).some((g) => g.id === 'otros')).toBe(false)
  })

  it('no repite ni pierde a nadie', () => {
    const todos = agrupar(conexiones, GRUPOS_DE_CONEXION, (uno) => uno.kind).flatMap(nombres).sort()
    expect(todos).toEqual(['A', 'B', 'C', 'D'])
  })

  it('los grupos de persona y de cliente tienen el orden pensado', () => {
    expect(GRUPOS_DE_PERSONA.map((g) => g.id)).toEqual(['plataforma', 'admin', 'usuario', 'baja'])
    expect(GRUPOS_DE_CLIENTE.map((g) => g.id)).toEqual(['activos', 'suspendidos'])
  })
})

describe('resumenDeNombres', () => {
  it('enseña los primeros y cuenta el resto', () => {
    expect(resumenDeNombres(['a', 'b'])).toBe('a, b')
    expect(resumenDeNombres(['a', 'b', 'c'])).toBe('a, b, c')
    expect(resumenDeNombres(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2')
    expect(resumenDeNombres(['a', 'b', 'c', 'd'], 1)).toBe('a +3')
  })

  it('sin nombres, nada', () => {
    expect(resumenDeNombres([])).toBe('')
  })
})
