// @vitest-environment jsdom
//
// El diálogo de «Ejecutar»: el último control antes de una carga a SAP IBP.

import { afterEach, describe, expect, it, vi } from 'vitest'
import DialogoDeEjecucion from './DialogoDeEjecucion.jsx'
import { asentar, boton, desmontar, dom, escribir, marcar, montar, pulsar, texto } from './ayudas-de-prueba.js'

afterEach(desmontar)

const DESARROLLO = { name: 'CPI desarrollo', baseUrl: 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: false }
const PRODUCCION = { ...DESARROLLO, name: 'CPI producción', isProduction: true }
const FACTURAS = { nombre: 'FACTURAS', comando: 'REPLACE' }

const props = (extra = {}) => ({
  titulo: 'Ejecutar «FACTURAS»',
  conexion: DESARROLLO,
  integraciones: [FACTURAS],
  variables: [],
  iniciales: {},
  onEjecutar: vi.fn(async () => ({ resultado: 'success', httpStatus: 200, duracionMs: 21_000, mensaje: 'OK', mplId: null })),
  onCerrar: vi.fn(),
  ...extra,
})

describe('qué se va a ejecutar y dónde', () => {
  // Elegir el tenant equivocado no da un error: da una carga en otro sistema.
  it('dice contra qué conexión, su dirección y si es productiva', async () => {
    await montar(DialogoDeEjecucion, props())
    expect(texto()).toContain('CPI desarrollo')
    expect(texto()).toContain('acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com')
    expect(texto()).toContain('Desarrollo / Calidad')
    expect(texto()).not.toContain('PRODUCCIÓN')
  })

  it('en producción lo dice en grande', async () => {
    await montar(DialogoDeEjecucion, props({ conexion: PRODUCCION }))
    expect(texto()).toContain('PRODUCCIÓN')
    expect(dom().querySelector('.ci-ambiente-prod')).not.toBeNull()
  })

  it('enseña el comando del body tal como está, sin interpretarlo', async () => {
    await montar(DialogoDeEjecucion, props())
    expect(texto()).toContain('FACTURAS')
    expect(texto()).toContain('REPLACE')
  })

  it('una orquestación lista todo lo que ejecutará', async () => {
    await montar(DialogoDeEjecucion, props({
      esOrquestacion: true,
      integraciones: [FACTURAS, { nombre: 'PRODUCTOS', comando: 'INSERT_UPDATE' }],
    }))
    expect(texto()).toContain('Se ejecutarán, por etapas (2)')
    expect(texto()).toContain('PRODUCTOS')
    expect(texto()).toContain('INSERT_UPDATE')
  })
})

describe('producción', () => {
  it('no se puede ejecutar sin marcar que se entiende', async () => {
    const p = props({ conexion: PRODUCCION })
    await montar(DialogoDeEjecucion, p)
    expect(boton('▶ Ejecutar').disabled).toBe(true)

    await marcar(dom().querySelector('.ci-confirmar-prod input'))
    expect(boton('▶ Ejecutar').disabled).toBe(false)
  })

  it('en desarrollo no pide esa confirmación', async () => {
    await montar(DialogoDeEjecucion, props())
    expect(dom().querySelector('.ci-confirmar-prod')).toBeNull()
    expect(boton('▶ Ejecutar').disabled).toBe(false)
  })
})

describe('las variables', () => {
  const conVariables = (extra = {}) => props({ variables: ['DESDE', 'HASTA'], iniciales: { DESDE: '20261005' }, ...extra })

  it('se proponen con los valores de la última vez', async () => {
    await montar(DialogoDeEjecucion, conVariables())
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('20261005')
    expect(dom().querySelector('#ci-var-HASTA').value).toBe('')
  })

  // Nunca se envía un body con un {{…}} sin resolver.
  it('con una sin valor no se puede ejecutar', async () => {
    await montar(DialogoDeEjecucion, conVariables())
    expect(boton('▶ Ejecutar').disabled).toBe(true)
    await escribir(dom().querySelector('#ci-var-HASTA'), '20270412')
    expect(boton('▶ Ejecutar').disabled).toBe(false)
  })

  it('un valor con comillas no vale y se dice por qué', async () => {
    await montar(DialogoDeEjecucion, conVariables())
    await escribir(dom().querySelector('#ci-var-HASTA'), "1' ,X EQ 'y")
    expect(boton('▶ Ejecutar').disabled).toBe(true)
    expect(texto()).toContain('comillas')
  })

  it('manda los valores sin espacios en los extremos, pero deja escribir espacios en medio', async () => {
    const p = conVariables()
    await montar(DialogoDeEjecucion, p)
    await escribir(dom().querySelector('#ci-var-DESDE'), '  20261014  ')
    await escribir(dom().querySelector('#ci-var-HASTA'), 'a b')
    expect(dom().querySelector('#ci-var-HASTA').value).toBe('a b')

    await pulsar(boton('▶ Ejecutar'))
    expect(p.onEjecutar).toHaveBeenCalledWith({ DESDE: '20261014', HASTA: 'a b' })
  })
})

describe('ejecutar una integración', () => {
  it('muestra el resultado en el mismo diálogo, con el código HTTP y la duración', async () => {
    await montar(DialogoDeEjecucion, props())
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('Completada')
    expect(texto()).toContain('HTTP 200')
    expect(texto()).toContain('21 s')
    expect(boton('Cerrar')).toBeDefined()
    expect(boton('▶ Ejecutar')).toBeUndefined()
  })

  it('un error de CPI se enseña con su MPL ID', async () => {
    const p = props({
      onEjecutar: vi.fn(async () => ({ resultado: 'error', httpStatus: 500, duracionMs: 21_430, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K', mensaje: 'An internal server error occured' })),
    })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('Error')
    expect(texto()).toContain('HTTP 500')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
    expect(texto()).toContain('An internal server error occured')
  })

  // Pedido del usuario (2026-10-15): una respuesta distinta de OK no es necesariamente un error; IBP pudo rechazar un registro.
  it('una respuesta distinta de OK se enseña como advertencia, no como error, y dice qué mirar', async () => {
    const p = props({
      onEjecutar: vi.fn(async () => ({ resultado: 'warning', httpStatus: 500, duracionMs: 16_000, mplId: 'AGrOoIkGv-d7sJej0DVu0bhXLV8K', mensaje: 'An internal server error occured' })),
    })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('Con advertencias')
    expect(texto()).not.toContain('Error')
    expect(dom().querySelector('.ci-estado-aviso')).not.toBeNull()
    expect(texto()).toContain('HTTP 500')
    expect(texto()).toContain('AGrOoIkGv-d7sJej0DVu0bhXLV8K')
    expect(texto()).toContain('CPI respondió 500 y no 200 (OK)')
    expect(texto()).toContain('no es necesariamente un error')
    // No es una alerta: no hay nada que repetir a ciegas ni que corregir de inmediato.
    expect(dom().querySelector('[role="alert"]')).toBeNull()
  })

  // No es lo mismo que un error: la carga pudo haber entrado.
  it('una carga sin confirmar avisa de revisar antes de repetir', async () => {
    const p = props({
      onEjecutar: vi.fn(async () => ({ resultado: 'unconfirmed', httpStatus: null, duracionMs: 270_000, mensaje: 'CPI no contestó' })),
    })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('Sin confirmar')
    expect(texto()).toContain('antes de repetirla')
  })

  it('mientras espera a CPI dice qué pasa y no deja ejecutar otra vez', async () => {
    let terminar
    const p = props({ onEjecutar: vi.fn(() => new Promise((resolver) => { terminar = () => resolver({ resultado: 'success', duracionMs: 1 }) })) })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))

    expect(texto()).toContain('Esperando la respuesta de CPI')
    expect(boton('Ejecutando…').disabled).toBe(true)
    expect(boton('Cancelar').disabled).toBe(true)

    await pulsar(boton('Ejecutando…'))
    expect(p.onEjecutar).toHaveBeenCalledTimes(1)

    await act0(terminar)
    await asentar()
    expect(texto()).toContain('Completada')
  })

  it('si la petición falla, lo dice y deja volver a intentar', async () => {
    const p = props({ onEjecutar: vi.fn().mockRejectedValueOnce(new Error('Sesión vencida')).mockResolvedValue({ resultado: 'success', duracionMs: 1 }) })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('Sesión vencida')
    expect(boton('▶ Ejecutar').disabled).toBe(false)
  })

  it('cancelar cierra sin ejecutar', async () => {
    const p = props()
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('Cancelar'))
    expect(p.onCerrar).toHaveBeenCalled()
    expect(p.onEjecutar).not.toHaveBeenCalled()
  })

  it('no ejecuta si no hay nada que ejecutar', async () => {
    await montar(DialogoDeEjecucion, props({ integraciones: [] }))
    expect(boton('▶ Ejecutar').disabled).toBe(true)
  })
})

describe('lanzar una orquestación', () => {
  it('arranca y se cierra: la ejecución se ve en la pantalla de la orquestación', async () => {
    const p = props({ esOrquestacion: true, variables: ['DESDE'], iniciales: { DESDE: '20261005' } })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(p.onEjecutar).toHaveBeenCalledWith({ DESDE: '20261005' })
    expect(p.onCerrar).toHaveBeenCalled()
  })

  it('si no se puede arrancar, el diálogo sigue abierto con el motivo', async () => {
    const p = props({ esOrquestacion: true, onEjecutar: vi.fn().mockRejectedValue(new Error('Ya hay una ejecución activa')) })
    await montar(DialogoDeEjecucion, p)
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('Ya hay una ejecución activa')
    expect(p.onCerrar).not.toHaveBeenCalled()
  })
})

/** Ejecuta una función dentro de `act` (para resolver una promesa pendiente desde fuera). */
async function act0(funcion) {
  const { act } = await import('react')
  await act(async () => { funcion() })
}

describe('las variables que son fechas', () => {
  const conFechas = (extra = {}) => props({ variables: ['DESDE', 'HASTA', 'LOTE'], variablesDeFecha: ['DESDE', 'HASTA'], iniciales: { DESDE: '20261005' }, ...extra })

  it('se piden con un calendario, con la última fecha como propuesta; las demás, como texto', async () => {
    await montar(DialogoDeEjecucion, conFechas())
    expect(dom().querySelector('#ci-var-DESDE').type).toBe('date')
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('2026-10-05')
    expect(dom().querySelector('#ci-var-HASTA').type).toBe('date')
    expect(dom().querySelector('#ci-var-HASTA').value).toBe('')
    expect(dom().querySelector('#ci-var-LOTE').type).not.toBe('date')
  })

  it('sin fecha no se puede ejecutar, y con ella se manda AAAAMMDD', async () => {
    const p = conFechas()
    await montar(DialogoDeEjecucion, p)
    await escribir(dom().querySelector('#ci-var-LOTE'), 'L1')
    expect(boton('▶ Ejecutar').disabled).toBe(true)

    await escribir(dom().querySelector('#ci-var-HASTA'), '2027-04-12')
    expect(boton('▶ Ejecutar').disabled).toBe(false)
    await pulsar(boton('▶ Ejecutar'))
    expect(p.onEjecutar).toHaveBeenCalledWith({ DESDE: '20261005', HASTA: '20270412', LOTE: 'L1' })
  })

  it('un valor de la vez anterior que no era una fecha no se pierde: se ve como texto', async () => {
    await montar(DialogoDeEjecucion, conFechas({ iniciales: { DESDE: 'ayer' } }))
    expect(dom().querySelector('#ci-var-DESDE').type).not.toBe('date')
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('ayer')
  })

  it('no hay botón para cambiar la fecha por una variable: aquí se pide una fecha', async () => {
    await montar(DialogoDeEjecucion, conFechas())
    expect(boton('Variable')).toBeUndefined()
  })
})
