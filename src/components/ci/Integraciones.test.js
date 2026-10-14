// @vitest-environment jsdom
//
// La biblioteca de integraciones en la pantalla de verdad: el árbol, abrir y guardar, ejecutar con
// confirmación, crear y borrar.
//
// Lo que se mira es lo que ninguna prueba de `core/ci` puede ver:
//   - que «Ejecutar» ejecute LO GUARDADO (y esté apagado con cambios pendientes);
//   - que no se tiren cambios sin preguntar;
//   - que el error de borrar una integración en uso diga cuál orquestación la usa.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ci = {
  listIntegraciones: vi.fn(),
  getIntegracion: vi.fn(),
  crearIntegracion: vi.fn(),
  guardarIntegracion: vi.fn(),
  duplicarIntegracion: vi.fn(),
  borrarIntegracion: vi.fn(),
  renombrarCarpeta: vi.fn(),
  ejecutarIntegracion: vi.fn(),
  ultimasVariablesDeIntegracion: vi.fn(),
}
vi.mock('../../lib/ci.js', async (importOriginal) => ({ ...(await importOriginal()), ...ci }))

const { default: Integraciones } = await import('./Integraciones.jsx')
const { plantillaDeBody } = await import('../../../core/ci/campos.js')
const { resumenDeBody } = await import('../../../core/ci/body.js')
const {
  asentar, boton, desmontar, dom, escribir, marcar, montar, porEtiqueta, pulsar, texto,
} = await import('./ayudas-de-prueba.js')

const CONEXION = { id: 'conn-1', name: 'CPI desarrollo', baseUrl: 'https://acme.it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2', isProduction: false }

const BODY_FACTURAS = JSON.stringify({
  KEYFIGURE: {
    BatchCommand: 'REPLACE', BatchName: 'FACTURAS_Z', TypeOfData: 'KEYFIGURES', PlanningArea: 'AREA_DEMO',
    FilterForTheDataSource: "KEYFIGUREDATE BT '{{DESDE}}' '{{HASTA}}'",
  },
}, null, 2)

const completa = (id, name, folder, body) => ({ id, connectionId: 'conn-1', name, folder, body, updatedAt: '2026-10-14T10:00:00Z' })
const resumida = (id, name, folder, body) => ({ id, connectionId: 'conn-1', name, folder, updatedAt: '2026-10-14T10:00:00Z', resumen: resumenDeBody(body) })

const FACTURAS = completa('i-1', 'FACTURAS', 'AREA/Cifras', BODY_FACTURAS)
const PRODUCTOS = completa('i-2', 'PRODUCTOS', 'AREA/Maestros', plantillaDeBody('MASTERDATA'))
const SUELTA = completa('i-3', 'SUELTA', '', plantillaDeBody('KEYFIGURES'))
const TODAS = [FACTURAS, PRODUCTOS, SUELTA]

beforeEach(() => {
  vi.clearAllMocks()
  ci.listIntegraciones.mockResolvedValue(TODAS.map(({ id, name, folder, body }) => resumida(id, name, folder, body)))
  ci.getIntegracion.mockImplementation(async (id) => TODAS.find((una) => una.id === id))
  ci.ultimasVariablesDeIntegracion.mockResolvedValue({ DESDE: '20261005', HASTA: '20270412' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'prompt').mockReturnValue(null)
})

afterEach(async () => {
  await desmontar()
  vi.restoreAllMocks()
})

const montarBiblioteca = async () => {
  await montar(Integraciones, { connection: CONEXION })
  await asentar()
}

/** Abre una carpeta del árbol por su nombre. */
const abrirCarpeta = async (nombre) => {
  const fila = [...dom().querySelectorAll('.ci-arbol-carpeta .ci-arbol-fila')].find((uno) => uno.textContent.includes(nombre))
  await pulsar(fila)
}

const abrirIntegracion = async (nombre) => {
  const fila = [...dom().querySelectorAll('.ci-arbol-integracion')].find((uno) => uno.textContent.includes(nombre))
  await pulsar(fila)
  await asentar()
}

describe('el árbol', () => {
  it('pide las integraciones de la conexión y las muestra en carpetas, con las sueltas al final', async () => {
    await montarBiblioteca()
    expect(ci.listIntegraciones).toHaveBeenCalledWith('conn-1')
    expect(texto()).toContain('AREA')
    expect(texto()).toContain('SUELTA')
    // Las carpetas empiezan cerradas: lo de dentro no se ve hasta abrirlas.
    expect(texto()).not.toContain('FACTURAS')

    await abrirCarpeta('AREA')
    await abrirCarpeta('Cifras')
    expect(texto()).toContain('FACTURAS')
  })

  it('buscar abre todas las carpetas y deja solo lo que coincide', async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    expect(texto()).toContain('FACTURAS')
    expect(texto()).not.toContain('PRODUCTOS')
    expect(texto()).not.toContain('SUELTA')
  })

  it('una búsqueda sin resultados lo dice', async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'zzz')
    expect(texto()).toContain('Ninguna integración coincide con «zzz»')
  })

  it('sin integraciones invita a crear la primera', async () => {
    ci.listIntegraciones.mockResolvedValue([])
    await montarBiblioteca()
    expect(texto()).toContain('Todavía no hay integraciones')
    expect(boton('Crea la primera')).toBeDefined()
  })

  it('un body inválido se marca con una alerta', async () => {
    ci.listIntegraciones.mockResolvedValue([resumida('i-9', 'ROTA', '', '{ roto')])
    await montarBiblioteca()
    expect(dom().querySelector('.ci-arbol-alerta')).not.toBeNull()
  })

  it('si la lista falla, lo dice', async () => {
    ci.listIntegraciones.mockRejectedValue(new Error('Tu empresa no tiene contratado ese módulo.'))
    await montarBiblioteca()
    expect(texto()).toContain('Tu empresa no tiene contratado ese módulo.')
  })
})

describe('abrir y guardar', () => {
  it('abrir una integración trae su body entero y la muestra en el formulario', async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')

    expect(ci.getIntegracion).toHaveBeenCalledWith('i-1')
    expect(dom().querySelector('#ci-nombre').value).toBe('FACTURAS')
    expect(dom().querySelector('#ci-carpeta').value).toBe('AREA/Cifras')
    expect(dom().querySelector('#ci-BatchName').value).toBe('FACTURAS_Z')
  })

  it('«Guardar» está apagado sin cambios, y con ellos manda solo lo que cambió', async () => {
    ci.guardarIntegracion.mockResolvedValue({ ...FACTURAS, name: 'FACTURAS NUEVAS' })
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')

    expect(boton('Guardar').disabled).toBe(true)
    await escribir(dom().querySelector('#ci-nombre'), 'FACTURAS NUEVAS')
    expect(texto()).toContain('Cambios sin guardar')
    expect(boton('Guardar').disabled).toBe(false)

    await pulsar(boton('Guardar'))
    await asentar()
    expect(ci.guardarIntegracion).toHaveBeenCalledWith('i-1', { name: 'FACTURAS NUEVAS' })
    expect(texto()).not.toContain('Cambios sin guardar')
  })

  it('un error al guardar se dice dentro del editor', async () => {
    ci.guardarIntegracion.mockRejectedValue(new Error('Ya hay una integración con ese nombre en esa carpeta.'))
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await escribir(dom().querySelector('#ci-nombre'), 'PRODUCTOS')
    await pulsar(boton('Guardar'))
    await asentar()

    expect(texto()).toContain('Ya hay una integración con ese nombre')
    expect(texto()).toContain('Cambios sin guardar')
  })

  it('no deja guardar un body que no es JSON', async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar([...dom().querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'JSON'))
    await escribir(porEtiqueta('Body en JSON'), '{ roto')

    expect(boton('Guardar').disabled).toBe(true)
    expect(texto()).toContain('El body no es un JSON válido')
  })

  it('cambiar de integración con cambios pendientes pregunta, y si no se confirma no cambia', async () => {
    window.confirm.mockReturnValue(false)
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'a')
    await abrirIntegracion('FACTURAS')
    await escribir(dom().querySelector('#ci-nombre'), 'CAMBIADO')

    const otra = [...dom().querySelectorAll('.ci-arbol-integracion')].find((uno) => uno.textContent.includes('PRODUCTOS'))
    await pulsar(otra)
    expect(window.confirm).toHaveBeenCalled()
    expect(dom().querySelector('#ci-nombre').value).toBe('CAMBIADO')
  })

  it('las variables del body se listan arriba', async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    expect(texto()).toContain('{{DESDE}}')
    expect(texto()).toContain('{{HASTA}}')
  })
})

describe('ejecutar', () => {
  const abrirFacturas = async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
  }

  it('con cambios sin guardar no se puede ejecutar: se ejecuta lo guardado', async () => {
    await abrirFacturas()
    expect(boton('▶ Ejecutar').disabled).toBe(false)
    await escribir(dom().querySelector('#ci-BatchName'), 'OTRO')
    expect(boton('▶ Ejecutar').disabled).toBe(true)
    expect(boton('▶ Ejecutar').title).toContain('Guarda los cambios')
  })

  it('abre el diálogo con la conexión, el comando y los valores de la última vez, y ejecuta lo guardado', async () => {
    ci.ejecutarIntegracion.mockResolvedValue({ resultado: 'success', httpStatus: 200, duracionMs: 21_000, mensaje: 'OK' })
    await abrirFacturas()
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(ci.ultimasVariablesDeIntegracion).toHaveBeenCalledWith('i-1')
    expect(texto()).toContain('Ejecutar «FACTURAS»')
    expect(texto()).toContain('CPI desarrollo')
    expect(texto()).toContain('REPLACE')
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('20261005')

    const confirmar = [...dom().querySelectorAll('.modal button')].find((uno) => uno.textContent.trim() === '▶ Ejecutar')
    await pulsar(confirmar)
    await asentar()

    expect(ci.ejecutarIntegracion).toHaveBeenCalledWith({
      connectionId: 'conn-1', integrationId: 'i-1', variables: { DESDE: '20261005', HASTA: '20270412' },
    })
    expect(texto()).toContain('Completada')
  })

  it('si no se pueden leer los valores de la vez anterior, se escriben de cero', async () => {
    ci.ultimasVariablesDeIntegracion.mockRejectedValue(new Error('x'))
    await abrirFacturas()
    await pulsar(boton('▶ Ejecutar'))
    await asentar()
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('')
  })

  it('en una conexión productiva el diálogo lo dice y pide confirmar', async () => {
    await montar(Integraciones, { connection: { ...CONEXION, isProduction: true, name: 'CPI producción' } })
    await asentar()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    expect(texto()).toContain('PRODUCCIÓN')
    await marcar(dom().querySelector('.ci-confirmar-prod input'))
    expect(dom().querySelector('.ci-confirmar-prod input').checked).toBe(true)
  })
})

describe('crear, duplicar y borrar', () => {
  it('crear: pide nombre, carpeta y tipo, y abre la nueva con el cuerpo de la plantilla', async () => {
    const creada = completa('i-9', 'NUEVA', 'AREA/Cifras', plantillaDeBody('KEYFIGURES'))
    ci.crearIntegracion.mockResolvedValue(creada)
    await montarBiblioteca()
    await pulsar(dom().querySelector('.ci-nueva-boton'))

    expect(texto()).toContain('Nueva integración')
    await escribir(dom().querySelector('#ci-nueva-nombre'), 'NUEVA')
    await escribir(dom().querySelector('#ci-nueva-carpeta'), 'AREA/Cifras')
    await pulsar(dom().querySelector('input[name="ci-tipo-nuevo"]:not(:checked)'))
    await pulsar(boton('Crear'))
    await asentar()

    expect(ci.crearIntegracion).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-1', folder: 'AREA/Cifras', name: 'NUEVA' }))
    const body = JSON.parse(ci.crearIntegracion.mock.calls[0][0].body)
    expect(Object.keys(body)).toEqual(['KEYFIGURE'])
    expect(dom().querySelector('#ci-nombre').value).toBe('NUEVA')
  })

  it('crear con un nombre repetido enseña el motivo y deja el diálogo abierto', async () => {
    ci.crearIntegracion.mockRejectedValue(new Error('Ya hay una integración con ese nombre en esa carpeta.'))
    await montarBiblioteca()
    await pulsar(dom().querySelector('.ci-nueva-boton'))
    await escribir(dom().querySelector('#ci-nueva-nombre'), 'FACTURAS')
    await pulsar(boton('Crear'))
    await asentar()

    expect(texto()).toContain('Ya hay una integración con ese nombre')
    expect(boton('Crear')).toBeDefined()
  })

  it('«Crear» está apagado sin nombre', async () => {
    await montarBiblioteca()
    await pulsar(dom().querySelector('.ci-nueva-boton'))
    expect(boton('Crear').disabled).toBe(true)
  })

  it('duplicar abre la copia', async () => {
    ci.duplicarIntegracion.mockResolvedValue({ ...FACTURAS, id: 'i-copia', name: 'FACTURAS (copia)' })
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(boton('Duplicar'))
    await asentar()

    expect(ci.duplicarIntegracion).toHaveBeenCalledWith('i-1')
    expect(dom().querySelector('#ci-nombre').value).toBe('FACTURAS (copia)')
  })

  it('borrar pide confirmar y la saca de la lista', async () => {
    ci.borrarIntegracion.mockResolvedValue(undefined)
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(boton('Eliminar'))
    await asentar()

    expect(window.confirm.mock.calls.at(-1)[0]).toContain('FACTURAS')
    expect(ci.borrarIntegracion).toHaveBeenCalledWith('i-1')
    expect(texto()).toContain('Elige una integración o crea una nueva')
    expect(texto()).not.toContain('FACTURAS_Z')
  })

  // El servidor se niega si una orquestación la usa, y dice cuál.
  it('si una orquestación la usa, el motivo se lee y la integración sigue ahí', async () => {
    ci.borrarIntegracion.mockRejectedValue(new Error('No se puede borrar: la usa «Carga diaria». Quítala de ahí primero.'))
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(boton('Eliminar'))
    await asentar()

    expect(texto()).toContain('la usa «Carga diaria»')
    expect(dom().querySelector('#ci-nombre').value).toBe('FACTURAS')
  })

  it('si no se confirma, no borra', async () => {
    window.confirm.mockReturnValue(false)
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(boton('Eliminar'))
    expect(ci.borrarIntegracion).not.toHaveBeenCalled()
  })

  it('renombrar una carpeta pide el nombre nuevo y vuelve a leer la lista', async () => {
    window.prompt.mockReturnValue('AREA2')
    ci.renombrarCarpeta.mockResolvedValue(3)
    await montarBiblioteca()
    await pulsar(porEtiqueta('Renombrar la carpeta AREA'))
    await asentar()

    expect(ci.renombrarCarpeta).toHaveBeenCalledWith('conn-1', 'AREA', 'AREA2')
    expect(ci.listIntegraciones).toHaveBeenCalledTimes(2)
  })

  it('al crear se elige entre dato maestro y cifras clave, y empieza con el dato maestro', async () => {
    await montarBiblioteca()
    await pulsar(dom().querySelector('.ci-nueva-boton'))
    const tipos = [...dom().querySelectorAll('input[name="ci-tipo-nuevo"]')]
    expect(tipos).toHaveLength(2)
    expect(tipos.map((t) => t.checked)).toEqual([true, false])
  })
})
