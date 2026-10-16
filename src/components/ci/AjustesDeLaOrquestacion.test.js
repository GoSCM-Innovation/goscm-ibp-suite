// @vitest-environment jsdom
//
// Los ajustes de toda la orquestación: la franja plegada arriba del editor.
//
// Lo que se mira:
//   - que por omisión no cambie nada y esté cerrada, diciendo «Sin cambios»;
//   - que cada campo arranque en «como en cada integración» y se pueda quitar;
//   - que con fechas diga QUÉ pasos se afectan y cómo quedan sus fechas, paso por paso;
//   - que REPLACE avise.

import { createElement, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { opcionesDeAjustes } from '../../lib/ci-ajustes.js'
import { grupoNuevo, pasoDeIntegracion, tareasDeLosPasos } from '../../lib/ci-pasos.js'
import AjustesDeLaOrquestacion from './AjustesDeLaOrquestacion.jsx'
import { boton, desmontar, dom, elegir, escribir, montar, porEtiqueta, pulsar, texto } from './ayudas-de-prueba.js'

const FECHAS = [{ campo: 'KEYFIGUREDATE', tipo: 'entre', desde: '20260101', hasta: '20271231' }]
const resumen = (extra = {}) => ({
  valido: true, areaDePlanificacion: 'STARBRANDS', version: 'PVSMD', comando: 'INSERT_UPDATE', sistemaOrigen: 'PRD', sistemaDestino: 'IBP',
  condiciones: FECHAS, ...extra,
})
const INTEGRACIONES = [
  { id: 'int-a', name: 'FACTURAS', folder: '', resumen: resumen() },
  { id: 'int-b', name: 'PRODUCCION', folder: '', resumen: resumen({ version: 'PV2', sistemaOrigen: 'QAS' }) },
  { id: 'int-c', name: 'MAESTRO', folder: '', resumen: resumen({ condiciones: [{ campo: 'AUART', tipo: 'igual', valores: ['ZVEX'] }] }) },
]
const porId = new Map(INTEGRACIONES.map((una) => [una.id, una]))

const paso = (id, integracion, extra = {}) => ({ ...pasoDeIntegracion(porId.get(integracion), id), ...extra })
const PASOS = [paso('p1', 'int-a'), { ...grupoNuevo('g'), children: [paso('p2', 'int-b'), paso('p3', 'int-c')] }]

/** La franja con su estado, como la maneja el editor. `alCambiar` anota lo que sube. */
function Con({ inicial = {}, alCambiar, pasos = PASOS }) {
  const [ajustes, setAjustes] = useState(inicial)
  return createElement(AjustesDeLaOrquestacion, {
    ajustes,
    onCambiar: (nuevos) => { setAjustes(nuevos); alCambiar?.(nuevos) },
    tareas: tareasDeLosPasos(pasos),
    porId,
    opciones: opcionesDeAjustes(INTEGRACIONES),
  })
}

const montarCon = async (propiedades = {}) => {
  const alCambiar = vi.fn()
  await montar(Con, { alCambiar, ...propiedades })
  return alCambiar
}
const abrir = () => pulsar(dom().querySelector('.ci-orq-ajustes-cabeza'))
const campo = (clave) => dom().querySelector(`#ci-lote-${clave}`)

afterEach(desmontar)

describe('por omisión', () => {
  it('está cerrada y dice que no cambia nada', async () => {
    await montarCon()
    expect(texto()).toContain('Ajustes de la orquestación')
    expect(texto()).toContain('Sin cambios: cada integración usa lo suyo')
    expect(dom().querySelector('.ci-orq-ajustes-cuerpo')).toBeNull()
    expect(dom().querySelector('.ci-orq-ajustes-chip')).toBeNull()
    expect(dom().querySelector('.ci-orq-ajustes-cabeza').getAttribute('aria-expanded')).toBe('false')
  })

  it('al abrirla, cada campo arranca en «como en cada integración»', async () => {
    const alCambiar = await montarCon()
    await abrir()
    expect(dom().querySelector('.ci-orq-ajustes-cabeza').getAttribute('aria-expanded')).toBe('true')

    for (const clave of ['version', 'comando', 'origen', 'destino']) {
      expect(campo(clave).value).toBe('__sin_cambio__')
      expect(campo(clave).options[0].textContent).toBe('Como en cada integración')
    }
    expect(alCambiar).not.toHaveBeenCalled()
  })

  it('las listas traen lo que ya usan las integraciones, y la versión ofrece la base', async () => {
    await montarCon()
    await abrir()
    const opciones = (clave) => [...campo(clave).options].map((una) => una.textContent)
    expect(opciones('version')).toEqual(['Como en cada integración', 'Versión base (vacío)', 'PV2', 'PVSMD', 'Otro valor…'])
    expect(opciones('comando')).toEqual(['Como en cada integración', 'INSERT_UPDATE', 'REPLACE', 'Otro valor…'])
    expect(opciones('origen')).toEqual(['Como en cada integración', 'PRD', 'QAS', 'Otro valor…'])
    // Solo la versión tiene «base»: un comando o un sistema vacío no existe.
    expect(opciones('destino')).not.toContain('Versión base (vacío)')
  })
})

describe('cambiar un campo', () => {
  it('elegir un valor lo guarda, lo enseña en la franja cerrada y lo marca', async () => {
    const alCambiar = await montarCon()
    await abrir()
    await elegir(campo('version'), 'PV2')

    expect(alCambiar).toHaveBeenLastCalledWith({ version: 'PV2' })
    expect(texto()).toContain('Versión PV2')
    expect(texto()).toContain('1 ajuste')
    expect(dom().querySelector('.ci-orq-ajustes').classList.contains('con-cambios')).toBe(true)
    expect(campo('version').closest('.ci-ajuste').classList.contains('cambiado')).toBe(true)
  })

  it('la versión base («») es un valor: se puede elegir y se lee «base»', async () => {
    const alCambiar = await montarCon()
    await abrir()
    await elegir(campo('version'), '__base__')
    expect(alCambiar).toHaveBeenLastCalledWith({ version: '' })
    expect(texto()).toContain('Versión base')
  })

  it('volver a «como en cada integración» o pulsar ↺ lo quita', async () => {
    const alCambiar = await montarCon({ inicial: { version: 'PV2', origen: 'QAS' } })
    await abrir()
    expect(texto()).toContain('2 ajustes')

    await elegir(campo('version'), '__sin_cambio__')
    expect(alCambiar).toHaveBeenLastCalledWith({ origen: 'QAS' })

    await pulsar(porEtiqueta('Restablecer Origen'))
    expect(alCambiar).toHaveBeenLastCalledWith({})
    expect(texto()).toContain('Sin cambios')
  })

  it('«Otro valor…» deja escribirlo a mano, también una variable, y «Lista» vuelve', async () => {
    const alCambiar = await montarCon()
    await abrir()
    await elegir(campo('origen'), '__otro__')

    const manual = porEtiqueta('Origen: valor a mano')
    expect(manual).not.toBeNull()
    await escribir(manual, 'DEV')
    expect(alCambiar).toHaveBeenLastCalledWith({ origen: 'DEV' })
    await escribir(porEtiqueta('Origen: valor a mano'), '{{ORIGEN}}')
    expect(alCambiar).toHaveBeenLastCalledWith({ origen: '{{ORIGEN}}' })

    await pulsar(boton('Lista'))
    expect(alCambiar).toHaveBeenLastCalledWith({})
    expect(campo('origen').tagName).toBe('SELECT')
  })

  it('un valor que no es de la lista (guardado antes) se enseña a mano, sin perderlo', async () => {
    await montarCon({ inicial: { destino: 'OTRO_IBP' } })
    await abrir()
    expect(porEtiqueta('Destino: valor a mano').value).toBe('OTRO_IBP')
  })

  it('vaciar el campo a mano quita el ajuste', async () => {
    const alCambiar = await montarCon({ inicial: { destino: 'OTRO_IBP' } })
    await abrir()
    await escribir(porEtiqueta('Destino: valor a mano'), '')
    expect(alCambiar).toHaveBeenLastCalledWith({})
  })
})

describe('REPLACE', () => {
  it('avisa cuántos pasos pasan a REPLACE con este ajuste', async () => {
    await montarCon()
    await abrir()
    expect(texto()).not.toContain('REPLACE puede reemplazar')
    await elegir(campo('comando'), 'REPLACE')
    expect(texto()).toContain('REPLACE puede reemplazar los datos que ya hay. Este ajuste lo pone en 3 pasos')
  })

  it('no avisa si el paso ya cargaba con REPLACE', async () => {
    const todos = [paso('p1', 'int-a')]
    const ya = new Map([['int-a', { id: 'int-a', name: 'FACTURAS', resumen: resumen({ comando: 'REPLACE' }) }]])
    porId.set('int-a', ya.get('int-a'))
    try {
      await montarCon({ pasos: todos })
      await abrir()
      await elegir(campo('comando'), 'REPLACE')
      expect(texto()).not.toContain('REPLACE puede reemplazar')
    } finally {
      porId.set('int-a', INTEGRACIONES[0])
    }
  })
})

describe('las fechas del lote', () => {
  const desde = () => dom().querySelector('#ci-lote-fecha-desde')
  const hasta = () => dom().querySelector('#ci-lote-fecha-hasta')

  it('se eligen con calendario y se guardan como AAAAMMDD', async () => {
    const alCambiar = await montarCon()
    await abrir()
    expect(desde().type).toBe('date')

    await escribir(desde(), '2026-03-01')
    expect(alCambiar).toHaveBeenLastCalledWith({ fechas: { desde: '20260301' } })
    await escribir(hasta(), '2026-03-31')
    expect(alCambiar).toHaveBeenLastCalledWith({ fechas: { desde: '20260301', hasta: '20260331' } })
    expect(texto()).toContain('Fechas 01-03-2026 → 31-03-2026')
    expect(texto()).toContain('2 ajustes')
  })

  it('pueden ser una variable, que se pide al ejecutar', async () => {
    const alCambiar = await montarCon()
    await abrir()
    await pulsar(boton('Variable'))
    await escribir(dom().querySelector('#ci-lote-fecha-desde'), '{{DESDE}}')
    expect(alCambiar).toHaveBeenLastCalledWith({ fechas: { desde: '{{DESDE}}' } })
  })

  it('sin fechas elegidas no hay tabla de pasos', async () => {
    await montarCon()
    await abrir()
    expect(dom().querySelector('.ci-ajustes-fechas')).toBeNull()
  })

  // Lo que el usuario pidió: saber qué fechas se ven afectadas por paso.
  it('con fechas, dice qué fechas quedan en CADA paso, y cuáles no se tocan', async () => {
    await montarCon()
    await abrir()
    await escribir(desde(), '2026-03-01')
    await escribir(hasta(), '2026-03-31')

    const filas = [...dom().querySelectorAll('.ci-ajustes-fechas tbody tr')].map((fila) => fila.textContent.replace(/\s+/g, ' ').trim())
    expect(filas).toHaveLength(3)
    // Una integración con KEYFIGUREDATE: antes y después.
    expect(filas[0]).toContain('FACTURAS')
    expect(filas[0]).toContain('01-01-2026 → 31-12-2027')
    expect(filas[0]).toContain('01-03-2026 → 31-03-2026')
    // Dentro de un grupo se nota con ∥.
    expect(filas[1]).toContain('2 ∥ PRODUCCION')
    // Una que no filtra por fecha: no se toca.
    expect(filas[2]).toContain('MAESTRO')
    expect(filas[2]).toContain('No filtra por fecha: no se toca')
    expect(dom().querySelectorAll('.ci-fecha-cambiada')).toHaveLength(2)
  })

  it('con solo un lado, el otro queda como en la integración', async () => {
    await montarCon()
    await abrir()
    await escribir(hasta(), '2026-06-30')
    const primera = dom().querySelector('.ci-ajustes-fechas tbody tr').textContent
    expect(primera).toContain('01-01-2026 → 30-06-2026')
  })

  it('un paso con fechas propias lo dice: sus fechas mandan sobre las del lote', async () => {
    const conPropias = [paso('p1', 'int-a', { ajustes: { filtro: { KEYFIGUREDATE: { desde: '20260601', hasta: '20260630' } } } })]
    await montarCon({ pasos: conPropias })
    await abrir()
    await escribir(desde(), '2026-03-01')
    await escribir(hasta(), '2026-03-31')
    const fila = dom().querySelector('.ci-ajustes-fechas tbody tr').textContent
    expect(fila).toContain('01-06-2026 → 30-06-2026')
    expect(fila).toContain('fechas propias del paso')
  })

  it('una integración con el body roto no rompe la tabla', async () => {
    porId.set('int-a', { id: 'int-a', name: 'ROTA', resumen: { valido: false, error: 'x' } })
    try {
      await montarCon({ pasos: [paso('p1', 'int-a')] })
      await abrir()
      await escribir(desde(), '2026-03-01')
      expect(dom().querySelector('.ci-ajustes-fechas tbody').textContent).toContain('Sin datos de la integración')
    } finally {
      porId.set('int-a', INTEGRACIONES[0])
    }
  })
})

describe('restablecer', () => {
  it('«Restablecer todo» lo deja sin cambios, y solo está si hay algo', async () => {
    const alCambiar = await montarCon()
    await abrir()
    expect(boton('Restablecer todo')).toBeUndefined()

    await elegir(campo('version'), 'PV2')
    await escribir(dom().querySelector('#ci-lote-fecha-desde'), '2026-03-01')
    await pulsar(boton('Restablecer todo'))
    expect(alCambiar).toHaveBeenLastCalledWith({})
    expect(texto()).toContain('Sin cambios')
    expect(boton('Restablecer todo')).toBeUndefined()
  })

  it('↺ de una fecha quita solo esa', async () => {
    const alCambiar = await montarCon({ inicial: { fechas: { desde: '20260301', hasta: '20260331' } } })
    await abrir()
    await pulsar(porEtiqueta('Restablecer la fecha desde'))
    expect(alCambiar).toHaveBeenLastCalledWith({ fechas: { hasta: '20260331' } })
  })
})
