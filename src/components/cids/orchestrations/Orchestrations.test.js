// @vitest-environment jsdom
//
// La lista de orquestaciones y su importar/exportar con la forma de v9 (revisión de paridad del
// 2026-10-05): los títulos de cada control, crear con `prompt`, borrar con `confirm`, el panel que
// se contrae, el diálogo de importar con sus píldoras y sus entradas omitidas, y el aviso de cada
// cosa. El lienzo y el editor del teléfono se sustituyen por muñecos: aquí se prueba la pantalla que
// los reparte, no ellos.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listOrchestrations = vi.fn()
const createOrchestration = vi.fn()
const deleteOrchestration = vi.fn()
const duplicateOrchestration = vi.fn()
const saveOrchestration = vi.fn()
vi.mock('../../../lib/orchestrations.js', () => ({
  listOrchestrations: (...args) => listOrchestrations(...args),
  createOrchestration: (...args) => createOrchestration(...args),
  deleteOrchestration: (...args) => deleteOrchestration(...args),
  duplicateOrchestration: (...args) => duplicateOrchestration(...args),
  saveOrchestration: (...args) => saveOrchestration(...args),
}))

// Bajar el archivo de verdad necesita `URL.createObjectURL`, que jsdom no tiene.
const downloadFile = vi.fn()
vi.mock('../../../lib/orchestration-file.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  downloadFile: (...args) => downloadFile(...args),
}))

// Lo que el lienzo recibió la última vez, para llamar a sus avisos como lo haría él.
let propsDelLienzo = null
vi.mock('./OrchestrationCanvas.jsx', () => ({
  default: (props) => {
    propsDelLienzo = props
    return createElement('div', { 'data-lienzo': props.orquestacion.id }, `Lienzo de ${props.orquestacion.name}`)
  },
}))
vi.mock('./MobileEditor.jsx', () => ({ default: () => createElement('div', null, 'Editor móvil') }))
vi.mock('./TaskPalette.jsx', () => ({ default: () => null }))

const { default: Orchestrations } = await import('./Orchestrations.jsx')

const DESTINO = { id: 'c1:sandbox', connectionId: 'c1', production: false, name: 'CLARO', label: 'CLARO · Sandbox' }

const una = (id, name, extra = {}) => ({ id, name, nodes: [], edges: [], ...extra })

let contenedor
let raiz

const esperar = (ms = 20) => act(async () => { await new Promise((resolver) => setTimeout(resolver, ms)) })

async function montar(props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Orchestrations, { destino: DESTINO, transportadas: null, ...props }))
  })
  await esperar()
}

beforeEach(() => {
  localStorage.clear()
  propsDelLienzo = null
  for (const mock of [listOrchestrations, createOrchestration, deleteOrchestration, duplicateOrchestration, saveOrchestration, downloadFile]) {
    mock.mockReset()
  }
  listOrchestrations.mockResolvedValue([])
})

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const texto = () => contenedor.textContent
const porTitulo = (titulo) => contenedor.querySelector(`[title="${titulo}"]`)
const filas = () => [...contenedor.querySelectorAll('.orq-item')]
const nombresEnLista = () => filas().map((fila) => fila.querySelector('.orq-item-nombre').textContent)
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.includes(contiene))
const clic = (elemento) => act(async () => { elemento.click() })

describe('la lista, con los títulos de v9', () => {
  it('la cabecera lleva importar, exportar, nueva y contraer', async () => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga')])
    await montar()

    expect(texto()).toContain('Orquestaciones')
    expect(porTitulo('Importar orquestaciones desde archivo')).toBeTruthy()
    expect(porTitulo('Exportar todas a archivo')).toBeTruthy()
    expect(porTitulo('Nueva orquestación')).toBeTruthy()
    expect(porTitulo('Contraer panel')).toBeTruthy()
  })

  it('cada fila lleva la estrella, duplicar (⎘) y eliminar (×)', async () => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga')])
    await montar()

    const fila = filas()[0]
    expect(fila.querySelector('[title="Agregar a favoritos"]').textContent).toBe('★')
    expect(fila.querySelector('[title="Duplicar orquestación"]').textContent).toBe('⎘')
    expect(fila.querySelector('[title="Eliminar"]').textContent).toBe('×')
  })

  it('sin orquestaciones dice «Sin orquestaciones.» con el enlace «Crear una», y exportar no se puede', async () => {
    await montar()

    expect(texto()).toContain('Sin orquestaciones.')
    expect(boton('Crear una')).toBeTruthy()
    const exportar = porTitulo('No hay orquestaciones para exportar')
    expect(exportar).toBeTruthy()
    expect(exportar.disabled).toBe(true)
  })

  it('el panel de la derecha, sin nada abierto, dice qué hacer', async () => {
    await montar()
    expect(texto()).toContain('⚙')
    expect(texto()).toContain('Selecciona una orquestación o crea una nueva')
  })

  it('las favoritas van primero y, dentro de cada grupo, en el orden del servidor', async () => {
    listOrchestrations.mockResolvedValue([una('1', 'Zeta'), una('2', 'Alfa'), una('3', 'Beta')])
    await montar()
    expect(nombresEnLista()).toEqual(['Zeta', 'Alfa', 'Beta'])

    await clic(filas()[2].querySelector('[title="Agregar a favoritos"]'))
    expect(nombresEnLista()).toEqual(['Beta', 'Zeta', 'Alfa'])
    expect(filas()[0].querySelector('[title="Quitar de favoritos"]')).toBeTruthy()
    expect(filas()[0].classList.contains('fav')).toBe(true)
  })

  it('las favoritas se recuerdan por destino', async () => {
    listOrchestrations.mockResolvedValue([una('1', 'Zeta'), una('2', 'Alfa')])
    await montar()
    await clic(filas()[1].querySelector('[title="Agregar a favoritos"]'))

    expect(JSON.parse(localStorage.getItem('ibp.cids.orq-favoritas.c1:sandbox'))).toEqual(['2'])
  })
})

describe('contraer el panel', () => {
  it('«‹» deja una barra con el título en vertical y «›»; al tocarla vuelve', async () => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga')])
    await montar()

    await clic(porTitulo('Contraer panel'))
    expect(filas()).toHaveLength(0)
    const barra = porTitulo('Expandir panel de orquestaciones')
    expect(barra).toBeTruthy()
    expect(barra.textContent).toContain('Orquestaciones')
    expect(barra.textContent).toContain('›')

    await clic(barra)
    expect(filas()).toHaveLength(1)
    expect(porTitulo('Contraer panel')).toBeTruthy()
  })
})

describe('crear, con prompt como v9', () => {
  it('«+» pide el nombre, lo recorta, crea y abre la nueva', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  Nueva carga  ')
    createOrchestration.mockResolvedValue(una('9', 'Nueva carga'))
    await montar()

    await clic(porTitulo('Nueva orquestación'))
    await esperar()

    expect(prompt).toHaveBeenCalledWith('Nombre de la nueva orquestación:')
    expect(createOrchestration).toHaveBeenCalledWith(DESTINO, 'Nueva carga')
    expect(nombresEnLista()).toEqual(['Nueva carga'])
    expect(texto()).toContain('Lienzo de Nueva carga')
  })

  it('cancelar el prompt, o dejarlo vacío, no crea nada', async () => {
    const prompt = vi.spyOn(window, 'prompt')
    await montar()

    prompt.mockReturnValue(null)
    await clic(porTitulo('Nueva orquestación'))
    prompt.mockReturnValue('   ')
    await clic(porTitulo('Nueva orquestación'))

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(createOrchestration).not.toHaveBeenCalled()
  })

  it('«Crear una» hace lo mismo que «+»', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    await montar()
    await clic(boton('Crear una'))
    expect(prompt).toHaveBeenCalledWith('Nombre de la nueva orquestación:')
  })

  it('si el servidor lo rechaza, el motivo sale arriba y la lista no cambia', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('X')
    createOrchestration.mockRejectedValue(new Error('Ya existe una con ese nombre.'))
    await montar()

    await clic(porTitulo('Nueva orquestación'))
    await esperar()
    expect(texto()).toContain('Ya existe una con ese nombre.')
    expect(filas()).toHaveLength(0)
  })
})

describe('borrar, con confirm como v9', () => {
  beforeEach(() => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga'), una('2', 'Cierre')])
  })

  it('no borra si se dice que no', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await montar()

    await clic(filas()[0].querySelector('[title="Eliminar"]'))
    expect(confirmar).toHaveBeenCalledWith('¿Eliminar esta orquestación?')
    expect(deleteOrchestration).not.toHaveBeenCalled()
    expect(filas()).toHaveLength(2)
  })

  it('borra si se dice que sí', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteOrchestration.mockResolvedValue(undefined)
    await montar()

    await clic(filas()[0].querySelector('[title="Eliminar"]'))
    await esperar()
    expect(deleteOrchestration).toHaveBeenCalledWith('1')
    expect(nombresEnLista()).toEqual(['Cierre'])
  })

  it('borrar la que está abierta deja el panel de la derecha vacío', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteOrchestration.mockResolvedValue(undefined)
    await montar()
    await clic(filas()[0])
    expect(texto()).toContain('Lienzo de Carga')

    await clic(filas()[0].querySelector('[title="Eliminar"]'))
    await esperar()
    expect(texto()).not.toContain('Lienzo de Carga')
    expect(texto()).toContain('Selecciona una orquestación o crea una nueva')
  })
})

describe('duplicar', () => {
  it('abre la copia, con el nombre que le dé el servidor', async () => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga')])
    duplicateOrchestration.mockResolvedValue(una('2', 'Carga (copia 2)'))
    await montar()

    await clic(filas()[0].querySelector('[title="Duplicar orquestación"]'))
    await esperar()
    expect(duplicateOrchestration).toHaveBeenCalledWith('1')
    expect(nombresEnLista()).toEqual(['Carga', 'Carga (copia 2)'])
    expect(texto()).toContain('Lienzo de Carga (copia 2)')
  })
})

describe('el contrato con el lienzo', () => {
  beforeEach(() => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga'), una('2', 'Cierre')])
  })

  it('le pasa lo transportado, y los avisos de renombrar y de cambios sin guardar', async () => {
    const transportadas = new Set(['CARGA'])
    await montar({ transportadas })
    await clic(filas()[0])

    expect(propsDelLienzo.transportadas).toBe(transportadas)
    expect(typeof propsDelLienzo.onRenombrar).toBe('function')
    expect(typeof propsDelLienzo.onSinGuardar).toBe('function')
  })

  it('renombrar guarda solo el nombre y lo cambia en la lista', async () => {
    saveOrchestration.mockResolvedValue(una('1', 'Carga nocturna'))
    await montar()
    await clic(filas()[0])

    await act(async () => { await propsDelLienzo.onRenombrar('Carga nocturna') })
    expect(saveOrchestration).toHaveBeenCalledWith('1', { name: 'Carga nocturna' })
    expect(nombresEnLista()).toEqual(['Carga nocturna', 'Cierre'])
  })

  it('si renombrar falla, lanza para que quien lo pidió enseñe el motivo', async () => {
    saveOrchestration.mockRejectedValue(new Error('Nombre repetido'))
    await montar()
    await clic(filas()[0])

    await expect(propsDelLienzo.onRenombrar('X')).rejects.toThrow('Nombre repetido')
    expect(nombresEnLista()).toEqual(['Carga', 'Cierre'])
  })

  it('con cambios sin guardar, cambiar de orquestación pregunta; si se dice que no, se queda', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await montar()
    await clic(filas()[0])
    await act(async () => { propsDelLienzo.onSinGuardar(true) })

    await clic(filas()[1])
    expect(confirmar).toHaveBeenCalledWith('Hay cambios sin guardar. ¿Descartarlos?')
    expect(texto()).toContain('Lienzo de Carga')

    confirmar.mockReturnValue(true)
    await clic(filas()[1])
    expect(texto()).toContain('Lienzo de Cierre')
  })

  it('sin cambios pendientes no pregunta nada', async () => {
    const confirmar = vi.spyOn(window, 'confirm')
    await montar()
    await clic(filas()[0])
    await clic(filas()[1])
    expect(confirmar).not.toHaveBeenCalled()
    expect(texto()).toContain('Lienzo de Cierre')
  })

  it('con cambios pendientes, borrar la abierta pregunta también por ellos', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
    await montar()
    await clic(filas()[0])
    await act(async () => { propsDelLienzo.onSinGuardar(true) })

    await clic(filas()[0].querySelector('[title="Eliminar"]'))
    expect(confirmar).toHaveBeenNthCalledWith(1, '¿Eliminar esta orquestación?')
    expect(confirmar).toHaveBeenNthCalledWith(2, 'Hay cambios sin guardar. ¿Descartarlos?')
    expect(deleteOrchestration).not.toHaveBeenCalled()
  })

  it('borrar OTRA orquestación no toca lo pendiente de la abierta', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteOrchestration.mockResolvedValue(undefined)
    await montar()
    await clic(filas()[0])
    await act(async () => { propsDelLienzo.onSinGuardar(true) })

    await clic(filas()[1].querySelector('[title="Eliminar"]'))
    await esperar()
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(deleteOrchestration).toHaveBeenCalledWith('2')
  })
})

describe('exportar', () => {
  beforeEach(() => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga'), una('2', 'Cierre')])
  })

  it('baja el archivo con el nombre de v9 y avisa en verde cuántas salieron', async () => {
    await montar()
    await clic(porTitulo('Exportar todas a archivo'))

    expect(downloadFile).toHaveBeenCalledTimes(1)
    const [contenido, nombre] = downloadFile.mock.calls[0]
    expect(nombre).toMatch(/^ibp-orquestaciones-CLARO-\d{4}-\d{2}-\d{2}\.json$/)
    expect(contenido.orchestrations.map((o) => o.name)).toEqual(['Carga', 'Cierre'])
    const aviso = contenedor.querySelector('.orq-aviso.ok')
    expect(aviso.textContent).toContain('2 orquestaciones exportadas')
  })

  it('el aviso se quita solo a los 3,5 segundos', async () => {
    await montar()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await clic(porTitulo('Exportar todas a archivo'))
    expect(contenedor.querySelector('.orq-aviso')).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(3400) })
    expect(contenedor.querySelector('.orq-aviso')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(contenedor.querySelector('.orq-aviso')).toBeNull()
  })

  it('si falla, lo dice en rojo y no se quita solo', async () => {
    downloadFile.mockImplementation(() => { throw new Error('sin permiso') })
    await montar()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await clic(porTitulo('Exportar todas a archivo'))

    expect(contenedor.querySelector('.orq-aviso.error').textContent).toContain('No se pudo exportar: sin permiso')
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(contenedor.querySelector('.orq-aviso.error')).toBeTruthy()
  })
})

describe('importar', () => {
  const archivo = (nombre, contenido) => ({
    name: nombre,
    text: async () => (typeof contenido === 'string' ? contenido : JSON.stringify(contenido)),
  })

  async function elegirArchivo(file) {
    const entrada = contenedor.querySelector('input[type="file"]')
    Object.defineProperty(entrada, 'files', { value: [file], configurable: true })
    await act(async () => { entrada.dispatchEvent(new Event('change', { bubbles: true })) })
    await esperar()
  }

  const grafo = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e' }] }

  beforeEach(() => {
    listOrchestrations.mockResolvedValue([una('1', 'Carga')])
  })

  it('enseña el archivo antes de crear nada: título, nombre, píldoras y una fila por orquestación', async () => {
    await montar()
    await elegirArchivo(archivo('mis.json', [
      { name: 'Carga', ...grafo },
      { name: 'Nueva', nodes: [{ id: 'a' }], edges: [] },
      { nodes: [] },
      null,
    ]))

    expect(createOrchestration).not.toHaveBeenCalled()
    expect(texto()).toContain('Importar orquestaciones')
    expect(texto()).toContain('mis.json')
    const pildoras = [...contenedor.querySelectorAll('.orq-imp-pildoras .orq-pildora')].map((p) => p.textContent)
    expect(pildoras).toEqual(['2 en archivo', '1 nuevas', '1 ya existen', '2 inválidas'])

    const filasImportar = [...contenedor.querySelectorAll('.orq-imp-fila')].map((f) => f.textContent)
    expect(filasImportar[0]).toContain('Carga')
    expect(filasImportar[0]).toContain('2 nodos · 1 conexion')
    expect(filasImportar[0]).toContain('OMITIR')
    expect(filasImportar[1]).toContain('Nueva')
    expect(filasImportar[1]).toContain('1 nodo · 0 conexiones')
    expect(filasImportar[1]).toContain('NUEVA')
  })

  it('las entradas inválidas salen con su motivo, y sobran se resumen en «…y N más»', async () => {
    await montar()
    await elegirArchivo(archivo('malo.json', [
      { name: 'ok', nodes: [] },
      null, { nodes: [] }, { name: 'X' }, { name: 'Y', nodes: [], edges: 3 }, 'texto', 7, 8,
    ]))

    const omitidas = contenedor.querySelector('.orq-imp-omitidas').textContent
    expect(omitidas).toContain('Entradas omitidas (7)')
    expect(omitidas).toContain('#2: no es un objeto')
    expect(omitidas).toContain('#3: falta el campo name')
    expect(omitidas).toContain('#4: nodes no es un array')
    expect(omitidas).toContain('#5: edges debe ser un array')
    expect(omitidas).not.toContain('#7:')
    expect(omitidas).toContain('…y 2 más')
  })

  it('«Importar N» crea las nuevas con su grafo y avisa «1 agregada, 1 omitida»', async () => {
    createOrchestration.mockResolvedValue(una('9', 'Nueva'))
    await montar()
    await elegirArchivo(archivo('mis.json', [{ name: 'Carga', ...grafo }, { name: 'Nueva', ...grafo }]))

    const importar = boton('Importar 1')
    expect(importar.disabled).toBe(false)
    await clic(importar)
    await esperar()

    expect(createOrchestration).toHaveBeenCalledTimes(1)
    expect(createOrchestration).toHaveBeenCalledWith(DESTINO, 'Nueva', { nodes: grafo.nodes, edges: grafo.edges })
    expect(contenedor.querySelector('.orq-imp-pildoras')).toBeNull()
    expect(contenedor.querySelector('.orq-aviso.ok').textContent).toContain('1 agregada, 1 omitida')
  })

  it('traer las repetidas las rotula RENOMBRAR y las crea con un número detrás; nada se pisa', async () => {
    createOrchestration.mockResolvedValue(una('9', 'x'))
    await montar()
    await elegirArchivo(archivo('mis.json', [{ name: ' carga ', ...grafo }]))
    expect(boton('Importar').disabled).toBe(true)

    await clic(contenedor.querySelector('.orq-imp-estrategia input'))
    expect(contenedor.querySelector('.orq-imp-fila').textContent).toContain('RENOMBRAR')
    await clic(boton('Importar 1'))
    await esperar()

    expect(createOrchestration).toHaveBeenCalledWith(DESTINO, 'carga (2)', expect.anything())
    expect(saveOrchestration).not.toHaveBeenCalled()
    expect(contenedor.querySelector('.orq-aviso.ok').textContent).toContain('1 agregada')
  })

  it('con todo repetido y sin traerlas, el botón queda deshabilitado', async () => {
    await montar()
    await elegirArchivo(archivo('mis.json', [{ name: 'Carga', ...grafo }]))
    expect(boton('Importar').disabled).toBe(true)
  })

  it('avisa del destino donde van a nacer, y del productivo', async () => {
    await montar({ destino: { ...DESTINO, production: true } })
    await elegirArchivo(archivo('mis.json', [{ name: 'Nueva', ...grafo }]))
    expect(texto()).toContain('el PRODUCTIVO')
  })

  it('si una falla, las demás entran y el aviso cuenta cuántas fallaron', async () => {
    createOrchestration
      .mockRejectedValueOnce(new Error('hay un ciclo'))
      .mockResolvedValueOnce(una('9', 'B'))
    await montar()
    await elegirArchivo(archivo('mis.json', [{ name: 'A', ...grafo }, { name: 'B', ...grafo }]))
    await clic(boton('Importar 2'))
    await esperar()

    expect(createOrchestration).toHaveBeenCalledTimes(2)
    expect(contenedor.querySelector('.orq-aviso.error').textContent).toContain('1 agregada, 1 con error')
    expect(texto()).toContain('A: hay un ciclo')
  })

  it('cancelar cierra el diálogo sin crear nada', async () => {
    await montar()
    await elegirArchivo(archivo('mis.json', [{ name: 'Nueva', ...grafo }]))
    await clic(boton('Cancelar'))
    expect(contenedor.querySelector('.orq-imp-pildoras')).toBeNull()
    expect(createOrchestration).not.toHaveBeenCalled()
  })

  describe('errores de archivo, con los textos de v9', () => {
    it('un archivo que no es JSON', async () => {
      await montar()
      await elegirArchivo(archivo('x.json', '{esto no'))
      expect(contenedor.querySelector('.orq-aviso.error').textContent).toContain('El archivo no es un JSON válido')
    })

    it('un JSON que no es un array de orquestaciones', async () => {
      await montar()
      await elegirArchivo(archivo('x.json', { otra: 'cosa' }))
      expect(contenedor.querySelector('.orq-aviso.error').textContent).toContain('El archivo no contiene un array de orquestaciones')
    })

    it('un array vacío', async () => {
      await montar()
      await elegirArchivo(archivo('x.json', []))
      expect(contenedor.querySelector('.orq-aviso.error').textContent).toContain('El archivo no contiene orquestaciones')
    })

    it('si TODAS son inválidas el diálogo se abre igual, para ver por qué', async () => {
      await montar()
      await elegirArchivo(archivo('x.json', [{ nodes: [] }]))
      expect(texto()).toContain('El archivo no contiene orquestaciones válidas')
      expect(texto()).toContain('#1: falta el campo name')
      expect(boton('Importar').disabled).toBe(true)
    })
  })
})
