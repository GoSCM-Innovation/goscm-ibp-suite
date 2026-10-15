// @vitest-environment jsdom
//
// El campo de fecha: calendario para una fecha fija, texto para una variable, y un botón para pasar de uno a otro sin perder nada.

import { createElement, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import CampoDeFecha from './CampoDeFecha.jsx'
import { boton, desmontar, dom, escribir, montar, porEtiqueta, pulsar } from './ayudas-de-prueba.js'

afterEach(desmontar)

function Con({ inicial, alCambiar, ...resto }) {
  const [valor, setValor] = useState(inicial)
  return createElement(CampoDeFecha, { valor, ariaLabel: 'Fecha', onCambiar: (nuevo) => { setValor(nuevo); alCambiar?.(nuevo) }, ...resto })
}

describe('CampoDeFecha', () => {
  it('una fecha se ve en el calendario, en el formato del navegador', async () => {
    await montar(Con, { inicial: '20261005' })
    expect(porEtiqueta('Fecha').type).toBe('date')
    expect(porEtiqueta('Fecha').value).toBe('2026-10-05')
  })

  it('vacío empieza en el calendario', async () => {
    await montar(Con, { inicial: '' })
    expect(porEtiqueta('Fecha').type).toBe('date')
  })

  it('elegir una fecha avisa AAAAMMDD, y vaciarla avisa vacío', async () => {
    const cambios = []
    await montar(Con, { inicial: '', alCambiar: (v) => cambios.push(v) })
    await escribir(porEtiqueta('Fecha'), '2026-12-31')
    expect(cambios.at(-1)).toBe('20261231')
    await escribir(porEtiqueta('Fecha'), '')
    expect(cambios.at(-1)).toBe('')
  })

  it('una variable se ve como texto, tal cual', async () => {
    await montar(Con, { inicial: '{{FECHA_DESDE}}' })
    expect(porEtiqueta('Fecha').type).not.toBe('date')
    expect(porEtiqueta('Fecha').value).toBe('{{FECHA_DESDE}}')
  })

  it('cualquier texto que no es una fecha se conserva como texto', async () => {
    await montar(Con, { inicial: '20261399' })
    expect(porEtiqueta('Fecha').value).toBe('20261399')
  })

  it('«Variable» pasa a texto sin tocar el valor, y escribir una variable avisa', async () => {
    const cambios = []
    await montar(Con, { inicial: '20261005', alCambiar: (v) => cambios.push(v) })
    await pulsar(boton('Variable'))
    expect(porEtiqueta('Fecha').type).not.toBe('date')
    expect(porEtiqueta('Fecha').value).toBe('20261005')
    expect(cambios).toEqual([])

    await escribir(porEtiqueta('Fecha'), '{{DESDE}}')
    expect(cambios.at(-1)).toBe('{{DESDE}}')
  })

  it('«Calendario» conserva una fecha válida y vacía lo que no lo es', async () => {
    const cambios = []
    await montar(Con, { inicial: '{{DESDE}}', alCambiar: (v) => cambios.push(v) })
    await pulsar(boton('Calendario'))
    expect(cambios.at(-1)).toBe('')
    expect(porEtiqueta('Fecha').type).toBe('date')

    await pulsar(boton('Variable'))
    await escribir(porEtiqueta('Fecha'), '20270101')
    await pulsar(boton('Calendario'))
    expect(porEtiqueta('Fecha').value).toBe('2027-01-01')
  })

  it('sin `conVariable` no hay botón para pasar a variable', async () => {
    await montar(Con, { inicial: '20261005', conVariable: false })
    expect(boton('Variable')).toBeUndefined()
  })

  it('deshabilitado no deja cambiar nada', async () => {
    await montar(Con, { inicial: '20261005', deshabilitado: true })
    expect(porEtiqueta('Fecha').disabled).toBe(true)
    expect(boton('Variable')).toBeUndefined()
    expect(dom().querySelectorAll('button')).toHaveLength(0)
  })
})
