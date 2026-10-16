// @vitest-environment jsdom
//
// Los ajustes de UN paso: lo que la orquestación cambia de esa integración, sin tocar la integración original.
//
// Lo que se mira:
//   - que cada campo diga qué valdría («como en la integración (PVSMD)», o «de la orquestación (PV2)»);
//   - que el filtro se edite condición por condición (fechas con calendario) y diga qué decía antes;
//   - que lo que no cambia nada no se guarde, y que se pueda volver a lo original.

import { createElement, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AjustesDePaso from './AjustesDePaso.jsx'
import { boton, desmontar, dom, elegir, escribir, montar, porEtiqueta, pulsar, texto } from './ayudas-de-prueba.js'

const INTEGRACION = {
  id: 'int-a',
  name: 'FACTURAS',
  folder: '',
  resumen: {
    valido: true, areaDePlanificacion: 'STARBRANDS', version: 'PVSMD', comando: 'REPLACE', sistemaOrigen: 'PRD', sistemaDestino: 'IBP',
    condiciones: [
      { campo: 'AUART', tipo: 'igual', valores: ['ZVEX'] },
      { campo: 'MATTYPEID', tipo: 'igual', valores: ['ZFER', 'ZHAW'] },
      { campo: 'KEYFIGUREDATE', tipo: 'entre', desde: '20260101', hasta: '20271231' },
      { campo: 'ZPERIODO', tipo: 'entre', desde: 'A1', hasta: 'B9' },
    ],
  },
}
const OPCIONES = { version: ['PV2', 'PVSMD'], comando: ['INSERT_UPDATE', 'REPLACE'], origen: ['PRD', 'QAS'], destino: ['IBP'] }

/** El panel con su estado, como lo maneja la tarjeta. `alCambiar` anota los ajustes que suben. */
function Con({ inicial = {}, lote = {}, integracion = INTEGRACION, alCambiar }) {
  const [ajustes, setAjustes] = useState(inicial)
  const paso = { id: 'p1', type: 'task', integrationId: integracion.id, label: integracion.name, ajustes }
  return createElement(AjustesDePaso, {
    paso,
    integracion,
    ajustesDelLote: lote,
    opciones: OPCIONES,
    onCambiar: (nuevos) => { setAjustes(nuevos); alCambiar?.(nuevos) },
  })
}

const montarCon = async (propiedades = {}) => {
  const alCambiar = vi.fn()
  await montar(Con, { alCambiar, ...propiedades })
  return alCambiar
}
const campo = (clave) => dom().querySelector(`#ci-p1-${clave}`)
const opciones = (clave) => [...campo(clave).options].map((una) => una.textContent)

afterEach(desmontar)

describe('los cuatro campos', () => {
  it('cada uno arranca «como en la integración», con lo que dice la integración', async () => {
    const alCambiar = await montarCon()
    expect(opciones('version')[0]).toBe('Como en la integración (PVSMD)')
    expect(opciones('comando')[0]).toBe('Como en la integración (REPLACE)')
    expect(opciones('origen')[0]).toBe('Como en la integración (PRD)')
    expect(opciones('destino')[0]).toBe('Como en la integración (IBP)')
    expect(alCambiar).not.toHaveBeenCalled()
    expect(boton('Restablecer los ajustes de este paso')).toBeUndefined()
  })

  it('una integración en la versión base lo dice «base»', async () => {
    const enBase = { ...INTEGRACION, resumen: { ...INTEGRACION.resumen, version: '' } }
    await montarCon({ integracion: enBase })
    expect(opciones('version')[0]).toBe('Como en la integración (base)')
  })

  it('elegir un valor lo guarda en el paso', async () => {
    const alCambiar = await montarCon()
    await elegir(campo('version'), 'PV2')
    expect(alCambiar).toHaveBeenLastCalledWith({ version: 'PV2' })
    expect(campo('version').closest('.ci-ajuste').classList.contains('cambiado')).toBe(true)
    expect(boton('Restablecer los ajustes de este paso')).toBeDefined()
  })

  // Un ajuste que deja todo como está no cambia nada: no se guarda.
  it('elegir el valor que la integración ya tiene no guarda nada', async () => {
    const alCambiar = await montarCon()
    await elegir(campo('version'), 'PVSMD')
    expect(alCambiar).toHaveBeenLastCalledWith({})
  })

  it('si la orquestación cambia ese dato, lo dice, y el paso puede volver al original', async () => {
    const alCambiar = await montarCon({ lote: { version: 'PV2', comando: 'INSERT_UPDATE' } })
    expect(opciones('version')[0]).toBe('De la orquestación (PV2)')
    expect(opciones('comando')[0]).toBe('De la orquestación (INSERT_UPDATE)')
    // Lo que no cambia la orquestación sigue diciendo lo de la integración.
    expect(opciones('origen')[0]).toBe('Como en la integración (PRD)')

    // Volver al original de la integración es un ajuste (el lote lo cambiaría): se guarda.
    await elegir(campo('version'), 'PVSMD')
    expect(alCambiar).toHaveBeenLastCalledWith({ version: 'PVSMD' })
    // Elegir lo mismo que dice el lote no hace falta: se quita.
    await elegir(campo('version'), 'PV2')
    expect(alCambiar).toHaveBeenLastCalledWith({})
  })

  it('«Otro valor…» deja escribirlo a mano', async () => {
    const alCambiar = await montarCon()
    await elegir(campo('destino'), '__otro__')
    await escribir(porEtiqueta('Destino: valor a mano'), 'IBP2')
    expect(alCambiar).toHaveBeenLastCalledWith({ destino: 'IBP2' })
  })
})

describe('el filtro de la integración', () => {
  it('lista cada condición con su campo y lo que dice', async () => {
    await montarCon()
    const campos = [...dom().querySelectorAll('.ci-ajuste-condicion-campo')].map((c) => c.textContent)
    expect(campos).toEqual(['AUART', 'MATTYPEID', 'KEYFIGUREDATE', 'ZPERIODO'])
    expect(porEtiqueta('Valores de MATTYPEID (2)').value).toBe('ZFER, ZHAW')
    expect(porEtiqueta('KEYFIGUREDATE desde').type).toBe('date')
    expect(porEtiqueta('KEYFIGUREDATE desde').value).toBe('2026-01-01')
    expect(porEtiqueta('KEYFIGUREDATE hasta').value).toBe('2027-12-31')
    // Un rango que no es de fechas son dos textos.
    expect(porEtiqueta('ZPERIODO desde').type).not.toBe('date')
    expect(porEtiqueta('ZPERIODO desde').value).toBe('A1')
  })

  it('una integración sin filtro lo dice', async () => {
    await montarCon({ integracion: { ...INTEGRACION, resumen: { ...INTEGRACION.resumen, condiciones: [] } } })
    expect(texto()).toContain('Esta integración no tiene filtro.')
  })

  it('cambiar los valores de una condición guarda SOLO esa, y dice qué decía antes', async () => {
    const alCambiar = await montarCon()
    await escribir(porEtiqueta('Valores de MATTYPEID (2)'), 'ZNEW, ZOLD')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { MATTYPEID: { valores: ['ZNEW', 'ZOLD'] } } })
    const fila = porEtiqueta('Valores de MATTYPEID (2)').closest('.ci-ajuste-condicion')
    expect(fila.classList.contains('cambiado')).toBe(true)
    expect(fila.textContent).toContain('antes: ZFER, ZHAW')
    // Las demás condiciones no se tocaron.
    expect(porEtiqueta('Valores de AUART (1)').closest('.ci-ajuste-condicion').classList.contains('cambiado')).toBe(false)
  })

  it('se puede escribir una coma sin que el campo se corrija a media frase', async () => {
    await montarCon()
    await escribir(porEtiqueta('Valores de AUART (1)'), 'ZVEX,')
    expect(porEtiqueta('Valores de AUART (1)').value).toBe('ZVEX,')
    await escribir(porEtiqueta('Valores de AUART (1)'), 'ZVEX, ZNEW')
    expect(porEtiqueta('Valores de AUART (1)').value).toBe('ZVEX, ZNEW')
  })

  it('escribir otra vez lo original quita el ajuste', async () => {
    const alCambiar = await montarCon()
    await escribir(porEtiqueta('Valores de MATTYPEID (2)'), 'ZNEW')
    await escribir(porEtiqueta('Valores de MATTYPEID (2)'), 'ZFER,ZHAW')
    expect(alCambiar).toHaveBeenLastCalledWith({})
  })

  it('dejar los valores vacíos no guarda nada (una condición sin valores no se escribe)', async () => {
    const alCambiar = await montarCon()
    await escribir(porEtiqueta('Valores de AUART (1)'), '')
    expect(alCambiar).not.toHaveBeenCalled()
  })

  it('las fechas del filtro se cambian con calendario, un lado a la vez', async () => {
    const alCambiar = await montarCon()
    await escribir(porEtiqueta('KEYFIGUREDATE desde'), '2026-03-01')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { KEYFIGUREDATE: { desde: '20260301' } } })
    await escribir(porEtiqueta('KEYFIGUREDATE hasta'), '2026-03-31')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { KEYFIGUREDATE: { desde: '20260301', hasta: '20260331' } } })
    const fila = porEtiqueta('KEYFIGUREDATE desde').closest('.ci-ajuste-condicion')
    expect(fila.textContent).toContain('antes: 01-01-2026 → 31-12-2027')
  })

  it('una fecha puede ser una variable', async () => {
    const alCambiar = await montarCon()
    const fila = porEtiqueta('KEYFIGUREDATE desde').closest('.ci-ajuste-condicion')
    await pulsar([...fila.querySelectorAll('button')].find((b) => b.textContent === 'Variable'))
    await escribir(porEtiqueta('KEYFIGUREDATE desde'), '{{DESDE}}')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { KEYFIGUREDATE: { desde: '{{DESDE}}' } } })
  })

  it('un rango que no es de fechas se cambia como texto', async () => {
    const alCambiar = await montarCon()
    await escribir(porEtiqueta('ZPERIODO hasta'), 'C3')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { ZPERIODO: { hasta: 'C3' } } })
  })

  it('↺ vuelve una condición a lo de la integración', async () => {
    const alCambiar = await montarCon({ inicial: { filtro: { MATTYPEID: { valores: ['ZNEW'] }, AUART: { valores: ['X'] } } } })
    await pulsar(porEtiqueta('Restablecer MATTYPEID'))
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { AUART: { valores: ['X'] } } })
  })
})

describe('con las fechas de la orquestación', () => {
  const LOTE = { fechas: { desde: '20260301', hasta: '20260331' } }

  it('el filtro enseña lo que quedaría y dice de quién viene', async () => {
    await montarCon({ lote: LOTE })
    expect(porEtiqueta('KEYFIGUREDATE desde').value).toBe('2026-03-01')
    expect(porEtiqueta('KEYFIGUREDATE hasta').value).toBe('2026-03-31')
    const fila = porEtiqueta('KEYFIGUREDATE desde').closest('.ci-ajuste-condicion')
    expect(fila.textContent).toContain('de la orquestación')
    // No es un ajuste de este paso: no hay nada que restablecer aquí.
    expect(boton('Restablecer los ajustes de este paso')).toBeUndefined()
  })

  it('el paso puede ponerse sus propias fechas, que mandan', async () => {
    const alCambiar = await montarCon({ lote: LOTE })
    await escribir(porEtiqueta('KEYFIGUREDATE desde'), '2026-06-01')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { KEYFIGUREDATE: { desde: '20260601' } } })
    expect(porEtiqueta('KEYFIGUREDATE hasta').value).toBe('2026-03-31')
  })

  it('volver a las fechas de la integración, en un paso, es un ajuste: la orquestación las cambiaría', async () => {
    const alCambiar = await montarCon({ lote: LOTE })
    await escribir(porEtiqueta('KEYFIGUREDATE desde'), '2026-01-01')
    expect(alCambiar).toHaveBeenLastCalledWith({ filtro: { KEYFIGUREDATE: { desde: '20260101' } } })
  })
})

describe('restablecer', () => {
  it('«Restablecer los ajustes de este paso» los quita todos', async () => {
    const alCambiar = await montarCon({ inicial: { version: 'PV2', filtro: { AUART: { valores: ['X'] } } } })
    await pulsar(boton('Restablecer los ajustes de este paso'))
    expect(alCambiar).toHaveBeenLastCalledWith({})
    expect(boton('Restablecer los ajustes de este paso')).toBeUndefined()
  })
})
