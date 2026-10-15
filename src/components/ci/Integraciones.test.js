// @vitest-environment jsdom
//
// La biblioteca de integraciones en la pantalla de verdad: el árbol, abrir y guardar, ejecutar con
// confirmación, crear y borrar.
//
// Lo que se mira es lo que ninguna prueba de `core/ci` puede ver:
//   - que «Ejecutar» ejecute LO GUARDADO (y esté apagado con cambios pendientes);
//   - que no se tiren cambios sin preguntar;
//   - que el error de borrar una integración en uso diga cuál orquestación la usa.

import { act } from 'react'
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
const { normalizarBody, resumenDeBody } = await import('../../../core/ci/body.js')
const {
  asentar, boton, desmontar, dom, elegir, escribir, marcar, montar, porEtiqueta, pulsar, texto,
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

  // Antes era un cuadro de texto con las sugerencias del navegador, que no se notaban: no se sabía que se podía elegir.
  it('la carpeta se elige entre las existentes, con «Sin carpeta» primero, y guarda solo la carpeta', async () => {
    ci.guardarIntegracion.mockResolvedValue({ ...FACTURAS, folder: 'AREA/Maestros' })
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')

    const carpeta = dom().querySelector('#ci-carpeta')
    expect(carpeta.tagName).toBe('SELECT')
    expect([...carpeta.options].map((o) => o.value)).toEqual(['', 'AREA', 'AREA/Cifras', 'AREA/Maestros'])
    expect(carpeta.value).toBe('AREA/Cifras')

    await elegir(carpeta, 'AREA/Maestros')
    await pulsar(boton('Guardar'))
    await asentar()
    expect(ci.guardarIntegracion).toHaveBeenCalledWith('i-1', { folder: 'AREA/Maestros' })
  })

  it('el botón «+» deja escribir una ruta que no existe, sin avisos', async () => {
    ci.guardarIntegracion.mockResolvedValue({ ...FACTURAS, folder: 'OTRA/Nueva' })
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')

    await pulsar(dom().querySelector('#ci-carpeta').parentElement.querySelector('button'))
    await escribir(dom().querySelector('#ci-carpeta'), 'OTRA/Nueva')
    expect(dom().querySelector('.ci-aviso-fila')).toBeNull()

    await pulsar(boton('Guardar'))
    await asentar()
    expect(ci.guardarIntegracion).toHaveBeenCalledWith('i-1', { folder: 'OTRA/Nueva' })
  })

  it('una integración sin carpeta se muestra con «Sin carpeta» elegido', async () => {
    await montarBiblioteca()
    await abrirIntegracion('SUELTA')
    const carpeta = dom().querySelector('#ci-carpeta')
    expect(carpeta.tagName).toBe('SELECT')
    expect(carpeta.value).toBe('')
    expect(carpeta.options[carpeta.selectedIndex].textContent).toBe('Sin carpeta')
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
    // DESDE y HASTA van en una condición sobre KEYFIGUREDATE: son fechas y se piden con un calendario.
    expect(dom().querySelector('#ci-var-DESDE').type).toBe('date')
    expect(dom().querySelector('#ci-var-DESDE').value).toBe('2026-10-05')

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

  it('elegir una fecha en el calendario manda AAAAMMDD', async () => {
    ci.ejecutarIntegracion.mockResolvedValue({ resultado: 'success', httpStatus: 200, duracionMs: 1, mensaje: 'OK' })
    await abrirFacturas()
    await pulsar(boton('▶ Ejecutar'))
    await asentar()

    await escribir(dom().querySelector('#ci-var-DESDE'), '2026-11-20')
    const confirmar = [...dom().querySelectorAll('.modal button')].find((uno) => uno.textContent.trim() === '▶ Ejecutar')
    await pulsar(confirmar)
    await asentar()
    expect(ci.ejecutarIntegracion.mock.calls[0][0].variables).toEqual({ DESDE: '20261120', HASTA: '20270412' })
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
    await elegir(dom().querySelector('#ci-nueva-carpeta'), 'AREA/Cifras')
    await pulsar(dom().querySelector('input[name="ci-tipo-nuevo"]:not(:checked)'))
    await pulsar(boton('Crear'))
    await asentar()

    expect(ci.crearIntegracion).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-1', folder: 'AREA/Cifras', name: 'NUEVA' }))
    const body = JSON.parse(ci.crearIntegracion.mock.calls[0][0].body)
    expect(Object.keys(body)).toEqual(['KEYFIGURE'])
    expect(dom().querySelector('#ci-nombre').value).toBe('NUEVA')
  })

  it('crear: la carpeta se elige entre las existentes, o se escribe una nueva con el botón «+»', async () => {
    ci.crearIntegracion.mockResolvedValue(completa('i-9', 'NUEVA', 'OTRA/Sub', plantillaDeBody('MASTERDATA')))
    await montarBiblioteca()
    await pulsar(dom().querySelector('.ci-nueva-boton'))

    const carpeta = dom().querySelector('#ci-nueva-carpeta')
    expect(carpeta.tagName).toBe('SELECT')
    expect([...carpeta.options].map((o) => o.value)).toEqual(['', 'AREA', 'AREA/Cifras', 'AREA/Maestros'])
    expect(carpeta.value).toBe('')

    await pulsar(dom().querySelector('#ci-nueva-carpeta').parentElement.querySelector('button'))
    await escribir(dom().querySelector('#ci-nueva-carpeta'), 'OTRA/Sub')
    await escribir(dom().querySelector('#ci-nueva-nombre'), 'NUEVA')
    await pulsar(boton('Crear'))
    await asentar()

    expect(ci.crearIntegracion).toHaveBeenCalledWith(expect.objectContaining({ folder: 'OTRA/Sub', name: 'NUEVA' }))
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
    await pulsar(porEtiqueta('Duplicar'))
    await asentar()

    expect(ci.duplicarIntegracion).toHaveBeenCalledWith('i-1')
    expect(dom().querySelector('#ci-nombre').value).toBe('FACTURAS (copia)')
  })

  it('borrar pide confirmar y la saca de la lista', async () => {
    ci.borrarIntegracion.mockResolvedValue(undefined)
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(porEtiqueta('Eliminar'))
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
    await pulsar(porEtiqueta('Eliminar'))
    await asentar()

    expect(texto()).toContain('la usa «Carga diaria»')
    expect(dom().querySelector('#ci-nombre').value).toBe('FACTURAS')
  })

  it('si no se confirma, no borra', async () => {
    window.confirm.mockReturnValue(false)
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
    await pulsar(porEtiqueta('Eliminar'))
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

describe('ordenar por destino', () => {
  const maestro = (id, name, folder, tipo) => completa(id, name, folder, JSON.stringify({
    A: { TypeOfData: 'MASTERDATA', BatchCommand: 'INSERT_UPDATE', MasterDataPrefix: 'SB', MasterDataType: tipo },
  }))
  const cifra = (id, name, folder, kf) => completa(id, name, folder, JSON.stringify({
    K: { TypeOfData: 'KEYFIGURES', BatchCommand: 'REPLACE', FieldMapping: `PRDID:PRDID,KFVALUE:${kf}` },
  }))
  const DESTINOS = [
    maestro('m1', 'PRODUCTOS DEV', 'DM', 'PRODUCT'),
    maestro('m2', 'PRODUCTOS PRD', 'PRD', 'PRODUCT'),
    maestro('m3', 'UOMTO', 'DM', 'UOMTO'),
    cifra('k1', 'FACTURAS', 'Cifras', 'ZFACTURAS'),
    completa('s1', 'A MEDIAS', '', plantillaDeBody('MASTERDATA')),
  ]

  beforeEach(() => {
    ci.listIntegraciones.mockResolvedValue(DESTINOS.map(({ id, name, folder, body }) => resumida(id, name, folder, body)))
    ci.getIntegracion.mockImplementation(async (id) => DESTINOS.find((una) => una.id === id))
  })

  const nodos = () => [...dom().querySelectorAll('.ci-arbol-carpeta .ci-arbol-fila')]
  const nodo = (destino) => nodos().find((uno) => uno.querySelector('.ci-arbol-nombre')?.textContent === destino)
  const verPorDestino = async () => { await pulsar(boton('Destino')) }
  const nombresVisibles = () => [...dom().querySelectorAll('.ci-arbol-integracion .ci-arbol-nombre')].map((uno) => uno.textContent)

  it('empieza por carpeta, como siempre, y el conmutador dice cuál está activa', async () => {
    await montarBiblioteca()
    expect(boton('Carpeta').getAttribute('aria-pressed')).toBe('true')
    expect(boton('Destino').getAttribute('aria-pressed')).toBe('false')
    expect(dom().querySelector('.ci-arbol-grupo')).toBeNull()
  })

  it('por destino: tablas, cifras y «Sin destino», con cada destino cerrado y su cantidad', async () => {
    await montarBiblioteca()
    await verPorDestino()

    expect([...dom().querySelectorAll('.ci-arbol-grupo')].map((g) => g.textContent)).toEqual([
      'Tablas de dato maestro', 'Cifras clave', 'Sin destino',
    ])
    expect(nodos().map((n) => n.textContent.replace('▸', ''))).toEqual(['SBPRODUCT2', 'SBUOMTO1', 'ZFACTURAS1'])
    // Los destinos empiezan cerrados; «Sin destino» no tiene nodos, sus integraciones cuelgan del grupo.
    expect(nombresVisibles()).toEqual(['A MEDIAS'])
  })

  it('abrir un destino enseña las integraciones que cargan a él, con su configuración', async () => {
    await montarBiblioteca()
    await verPorDestino()
    await pulsar(nodo('SBPRODUCT'))

    expect(nombresVisibles()).toEqual(['PRODUCTOS DEV', 'PRODUCTOS PRD', 'A MEDIAS'])
    // La segunda línea de cada fila es su configuración, sin la carpeta (ya no es lo que agrupa y se ve en el cuadro al pasar el cursor).
    // Los dos primeros bodies no dicen área, versión ni sistemas (lo que no dicen no se escribe); «A MEDIAS» es la plantilla, que trae PRD → IBP.
    const secundarios = [...dom().querySelectorAll('.ci-arbol-sub')].map((c) => c.textContent)
    expect(secundarios).toEqual(['INSERT_UPDATE', 'INSERT_UPDATE', 'INSERT_UPDATE · PRD → IBP'])

    await pulsar(nodo('SBPRODUCT'))
    expect(nombresVisibles()).toEqual(['A MEDIAS'])
  })

  it('elegir una integración desde esta vista la abre en el editor', async () => {
    await montarBiblioteca()
    await verPorDestino()
    await pulsar(nodo('SBUOMTO'))
    await abrirIntegracion('UOMTO')

    expect(ci.getIntegracion).toHaveBeenCalledWith('m3')
    expect(dom().querySelector('#ci-nombre').value).toBe('UOMTO')
  })

  it('buscar abre todos los destinos y deja solo lo que coincide, también por destino', async () => {
    await montarBiblioteca()
    await verPorDestino()
    await escribir(porEtiqueta('Buscar integraciones'), 'sbuomto')

    expect(nombresVisibles()).toEqual(['UOMTO'])
    expect(nodos().map((n) => n.querySelector('.ci-arbol-nombre').textContent)).toEqual(['SBUOMTO'])
  })

  it('una búsqueda sin resultados lo dice', async () => {
    await montarBiblioteca()
    await verPorDestino()
    await escribir(porEtiqueta('Buscar integraciones'), 'zzz')
    expect(texto()).toContain('Ninguna integración coincide con «zzz»')
  })

  it('en esta vista no hay carpetas que renombrar', async () => {
    await montarBiblioteca()
    await verPorDestino()
    expect(dom().querySelector('[aria-label^="Renombrar la carpeta"]')).toBeNull()
  })

  it('volver a «Carpeta» devuelve el árbol de siempre', async () => {
    await montarBiblioteca()
    await verPorDestino()
    await pulsar(boton('Carpeta'))

    expect(dom().querySelector('.ci-arbol-grupo')).toBeNull()
    expect(texto()).toContain('DM')
    expect(dom().querySelector('[aria-label="Renombrar la carpeta DM"]')).not.toBeNull()
  })

  it('cambiar de vista no toca lo que se está editando', async () => {
    await montarBiblioteca()
    await verPorDestino()
    await pulsar(nodo('SBUOMTO'))
    await abrirIntegracion('UOMTO')
    await escribir(dom().querySelector('#ci-nombre'), 'UOMTO NUEVO')

    await pulsar(boton('Carpeta'))
    expect(dom().querySelector('#ci-nombre').value).toBe('UOMTO NUEVO')
    expect(texto()).toContain('Cambios sin guardar')
  })
})

// El servidor limpia lo que recibe y devuelve esa versión. Si el editor no la muestra, sigue creyendo que hay cambios
// sin guardar por un espacio o una sangría: «Ejecutar» queda apagado y al salir pregunta si se descartan.
describe('tras guardar, el editor muestra lo que el servidor guardó', () => {
  /** Lo que haría el servidor: nombre sin espacios, carpeta ordenada y el body con sangría de 2. */
  const comoElServidor = (cambios) => ({
    ...FACTURAS,
    ...(cambios.name !== undefined ? { name: cambios.name.trim() } : {}),
    ...(cambios.folder !== undefined ? { folder: cambios.folder.split('/').map((p) => p.trim()).filter(Boolean).join('/') } : {}),
    ...(cambios.body !== undefined ? { body: normalizarBody(cambios.body) } : {}),
  })

  beforeEach(() => {
    ci.guardarIntegracion.mockImplementation(async (_id, cambios) => comoElServidor(cambios))
  })

  const abrirFacturas = async () => {
    await montarBiblioteca()
    await escribir(porEtiqueta('Buscar integraciones'), 'factu')
    await abrirIntegracion('FACTURAS')
  }
  const guardar = async () => { await pulsar(boton('Guardar')); await asentar() }

  it('un body con otra sangría: tras guardar ya no hay cambios sin guardar, «Ejecutar» se enciende y se ve el JSON guardado', async () => {
    await abrirFacturas()
    await pulsar([...dom().querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'JSON'))
    const con4 = JSON.stringify(JSON.parse(BODY_FACTURAS), null, 4)
    await escribir(porEtiqueta('Body en JSON'), con4)
    expect(texto()).toContain('Cambios sin guardar')
    expect(boton('▶ Ejecutar').disabled).toBe(true)

    await guardar()
    expect(texto()).not.toContain('Cambios sin guardar')
    expect(boton('▶ Ejecutar').disabled).toBe(false)
    expect(porEtiqueta('Body en JSON').value).toBe(normalizarBody(con4))
  })

  it('un nombre con espacios sobrantes: se ve sin ellos', async () => {
    await abrirFacturas()
    await escribir(dom().querySelector('#ci-nombre'), '  FACTURAS NUEVAS  ')
    await guardar()

    expect(dom().querySelector('#ci-nombre').value).toBe('FACTURAS NUEVAS')
    expect(texto()).not.toContain('Cambios sin guardar')
  })

  it('una carpeta escrita con espacios y barras sobrantes: se ve ordenada', async () => {
    await abrirFacturas()
    await pulsar(dom().querySelector('#ci-carpeta').parentElement.querySelector('button'))
    await escribir(dom().querySelector('#ci-carpeta'), 'MASTER DATA / Sub/')
    await guardar()

    expect(dom().querySelector('#ci-carpeta').value).toBe('MASTER DATA/Sub')
    expect(texto()).not.toContain('Cambios sin guardar')
  })

  it('después de guardar, cambiar de integración ya no pregunta si se descartan los cambios', async () => {
    await abrirFacturas()
    await escribir(dom().querySelector('#ci-nombre'), 'FACTURAS NUEVAS ')
    await guardar()

    window.confirm.mockClear()
    await escribir(porEtiqueta('Buscar integraciones'), '')
    await abrirIntegracion('SUELTA')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(dom().querySelector('#ci-nombre').value).toBe('SUELTA')
  })

  // Lo escrito mientras se guardaba es trabajo nuevo: no se pisa, y sigue contando como cambios sin guardar.
  it('si se escribe algo mientras se guarda, eso no se pierde y sigue sin guardar', async () => {
    let terminar
    ci.guardarIntegracion.mockImplementation((_id, cambios) => new Promise((resolver) => {
      terminar = () => resolver(comoElServidor(cambios))
    }))
    await abrirFacturas()
    await escribir(dom().querySelector('#ci-nombre'), 'PRIMERO ')
    await pulsar(boton('Guardar'))
    await escribir(dom().querySelector('#ci-nombre'), 'PRIMERO Y MÁS')

    terminar()
    await asentar()
    expect(dom().querySelector('#ci-nombre').value).toBe('PRIMERO Y MÁS')
    expect(texto()).toContain('Cambios sin guardar')
  })

  it('si el guardado falla, no cambia nada: el texto queda como estaba y se dice el error', async () => {
    ci.guardarIntegracion.mockRejectedValue(new Error('No se pudo guardar.'))
    await abrirFacturas()
    await escribir(dom().querySelector('#ci-nombre'), '  CON ESPACIOS  ')
    await guardar()

    expect(dom().querySelector('#ci-nombre').value).toBe('  CON ESPACIOS  ')
    expect(texto()).toContain('No se pudo guardar.')
    expect(texto()).toContain('Cambios sin guardar')
  })

  it('un guardado normal (sin diferencias) sigue funcionando', async () => {
    await abrirFacturas()
    await escribir(dom().querySelector('#ci-nombre'), 'OTRO NOMBRE')
    await guardar()
    expect(dom().querySelector('#ci-nombre').value).toBe('OTRO NOMBRE')
    expect(texto()).not.toContain('Cambios sin guardar')
  })
})

describe('el árbol se adapta a lo que se ve', () => {
  const divisor = () => dom().querySelector('[role="separator"]')
  const ancho = () => dom().querySelector('.ci-biblioteca').style.getPropertyValue('--ancho-arbol')
  const tecla = async (key, extra = {}) => {
    await act(async () => { divisor().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })) })
  }

  it('el árbol empieza en 360 px, con un divisor que dice cuánto mide', async () => {
    await montarBiblioteca()
    expect(ancho()).toBe('360px')
    expect(divisor().getAttribute('aria-valuenow')).toBe('360')
  })

  it('las flechas lo mueven de 16 en 16 (48 con Mayús), Inicio lo devuelve y no se sale de los límites', async () => {
    await montarBiblioteca()
    await tecla('ArrowRight')
    expect(ancho()).toBe('376px')
    await tecla('ArrowLeft', { shiftKey: true })
    expect(ancho()).toBe('328px')
    await tecla('Home')
    expect(ancho()).toBe('360px')

    for (let i = 0; i < 30; i += 1) await tecla('ArrowRight', { shiftKey: true })
    expect(ancho()).toBe('560px')
    for (let i = 0; i < 30; i += 1) await tecla('ArrowLeft', { shiftKey: true })
    expect(ancho()).toBe('220px')
  })

  it('doble clic vuelve al ancho original', async () => {
    await montarBiblioteca()
    await tecla('ArrowRight', { shiftKey: true })
    await act(async () => { divisor().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(ancho()).toBe('360px')
  })

  it('el nombre completo sale al pasar el cursor, porque en la lista puede cortarse', async () => {
    await montarBiblioteca()
    await abrirCarpeta('AREA')
    await abrirCarpeta('Cifras')
    const fila = [...dom().querySelectorAll('.ci-arbol-integracion')].find((uno) => uno.textContent.includes('FACTURAS'))
    expect(fila.getAttribute('title').split('\n')[0]).toBe('FACTURAS')
  })

  it('el buscador es corto de texto y explica al pasar el cursor por qué se puede buscar', async () => {
    await montarBiblioteca()
    const buscador = porEtiqueta('Buscar integraciones')
    expect(buscador.getAttribute('placeholder')).toBe('Buscar…')
    expect(buscador.getAttribute('title')).toContain('destino')
  })
})

// En el árbol manda el nombre: su configuración va debajo, en otra línea, y no le quita ancho.
describe('el nombre manda en cada fila del árbol', () => {
  const filas = () => [...dom().querySelectorAll('.ci-arbol-integracion')]
  const COMPLETA = completa('i-9', 'COMPLETA', 'AREA/Cifras', JSON.stringify({
    K: {
      TypeOfData: 'KEYFIGURES', BatchCommand: 'REPLACE', PlanningArea: 'STARBRANDS', PlanningAreaVersion: 'PVSMD',
      DataSource: 'ZIBP_PEDIDOSVTA_KF', DestinationforAddon: 'PRD', DestinationforSAPIBP: 'IBP',
    },
  }))

  it('por carpeta, el nombre va en su línea y la configuración en otra, pequeña, debajo', async () => {
    await montarBiblioteca()
    await abrirCarpeta('AREA')
    await abrirCarpeta('Cifras')
    const fila = filas().find((una) => una.textContent.includes('FACTURAS'))
    const [nombre, secundario] = [...fila.querySelectorAll('.ci-arbol-texto > span')]
    expect(nombre.className).toBe('ci-arbol-nombre')
    expect(nombre.textContent).toBe('FACTURAS')
    expect(secundario.className).toBe('ci-arbol-sub')
    // Planning area, versión (sin versión en el body: la base) y comando. Este body no dice sistemas.
    expect(secundario.textContent).toBe('AREA_DEMO · base · REPLACE')
  })

  it('por destino, igual: el nombre en su línea y la configuración debajo, sin la carpeta', async () => {
    await montarBiblioteca()
    await pulsar(boton('Destino'))
    const fila = filas()[0]
    const [nombre, secundario] = [...fila.querySelectorAll('.ci-arbol-texto > span')]
    expect(nombre.className).toBe('ci-arbol-nombre')
    expect(secundario.className).toBe('ci-arbol-sub')
    // El nombre es lo único que hay en su línea.
    expect(nombre.textContent).toBe(fila.querySelector('.ci-arbol-nombre').textContent)
    expect(fila.querySelector('.ci-arbol-texto').children[0]).toBe(nombre)
    expect(secundario.textContent).not.toContain('AREA/')
  })

  it('con todo lo que dice el body, la línea es «área · versión · comando · origen → destino»', async () => {
    ci.listIntegraciones.mockResolvedValue([resumida(COMPLETA.id, COMPLETA.name, COMPLETA.folder, COMPLETA.body)])
    await montarBiblioteca()
    await abrirCarpeta('AREA')
    await abrirCarpeta('Cifras')
    expect(filas()[0].querySelector('.ci-arbol-sub').textContent).toBe('STARBRANDS · PVSMD · REPLACE · PRD → IBP')
  })

  it('al pasar el cursor sale todo, un dato por línea, con la carpeta', async () => {
    ci.listIntegraciones.mockResolvedValue([resumida(COMPLETA.id, COMPLETA.name, COMPLETA.folder, COMPLETA.body)])
    await montarBiblioteca()
    await abrirCarpeta('AREA')
    await abrirCarpeta('Cifras')
    expect(filas()[0].getAttribute('title').split('\n')).toEqual([
      'COMPLETA', 'Planning area: STARBRANDS', 'Versión: PVSMD', 'Comando: REPLACE', 'Origen: PRD', 'Destino: IBP',
      'Fuente de datos: ZIBP_PEDIDOSVTA_KF', 'Carpeta: AREA/Cifras',
    ])
  })

  it('se busca por la configuración: área, versión, comando, fuente de datos y sistemas', async () => {
    ci.listIntegraciones.mockResolvedValue([
      resumida(COMPLETA.id, COMPLETA.name, COMPLETA.folder, COMPLETA.body),
      resumida('i-8', 'OTRA', 'AREA/Cifras', JSON.stringify({ K: { TypeOfData: 'KEYFIGURES', BatchCommand: 'INSERT_UPDATE' } })),
    ])
    await montarBiblioteca()
    for (const buscado of ['starbrands', 'pvsmd', 'replace', 'pedidosvta', 'prd']) {
      await escribir(porEtiqueta('Buscar integraciones'), buscado)
      expect([...dom().querySelectorAll('.ci-arbol-integracion .ci-arbol-nombre')].map((n) => n.textContent), buscado).toEqual(['COMPLETA'])
    }
  })

  it('una integración con el body roto sigue mostrando su «!», sin segunda línea de comando', async () => {
    ci.listIntegraciones.mockResolvedValue([{ id: 'r', connectionId: 'conn-1', name: 'ROTA', folder: '', resumen: resumenDeBody('{ no') }])
    await montarBiblioteca()
    const fila = filas()[0]
    expect(fila.querySelector('.ci-arbol-alerta')).not.toBeNull()
    expect(fila.querySelector('.ci-arbol-sub')).toBeNull()
  })
})
