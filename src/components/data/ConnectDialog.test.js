// @vitest-environment jsdom
//
// El asistente de conexión de v7, hasta el final: al conectar SE CIERRA y deja al consultor en el
// mapeo de entidades, y lo guardado de otro tenant ya no se ve. Eran dos fallos de la misma sesión:
// un cuadro «Conexión activa» que pedía «Cerrar», y un árbol «Árbol 1» con productos de otro sistema
// antes de haber confirmado nada.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/ibp.js', () => ({
  listIbpConnections: vi.fn(async () => [{ id: 'c-2', name: 'STARBRANDS QAS', baseUrl: 'https://x', isProduction: false }]),
}))
vi.mock('../../lib/ibp-master-data.js', () => ({
  fetchMasterCatalog: vi.fn(async () => ({ catalogo: { STARBRANDS: { desc: 'STARBRANDS', versions: [] } } })),
}))

const { default: ConnectDialog } = await import('./ConnectDialog.jsx')
const {
  conectar, desconectar, estaConectado, conexionActiva, verAsistente,
} = await import('../../lib/conexion-activa.js')
const { VERSION_BASE } = await import('../../lib/version-elegida.js')
const { contar, guardar, olvidarBase, reiniciarAlConectar } = await import('../../lib/explorer-db.js')

let raiz
let contenedor
const alCerrar = vi.fn()

/** Cambia un desplegable como lo haría quien lo toca: React solo se entera con el evento. */
async function elegir(id, valor) {
  // Cada paso aparece cuando termina una lectura asíncrona: se espera a que esté, no un tiempo fijo.
  await vi.waitFor(() => { if (!document.getElementById(id)) throw new Error(`falta #${id}`) })
  const select = document.getElementById(id)
  const poner = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  await act(async () => {
    poner.call(select, valor)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Deja correr lo asíncrono pendiente: las conexiones, el catálogo y la limpieza de la base. */
const esperar = () => act(async () => { await new Promise((listo) => { setTimeout(listo, 20) }) })

const pulsar = async (texto) => {
  const buscar = () => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes(texto) && !b.disabled)
  await vi.waitFor(() => { if (!buscar()) throw new Error(`falta el botón «${texto}»`) })
  await act(async () => { buscar().click() })
  await esperar()
}

async function montar() {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(ConnectDialog, { onClose: alCerrar }))
  })
  await esperar()
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  olvidarBase()
  desconectar()
  verAsistente(false)
  alCerrar.mockReset()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  olvidarBase()
})

async function recorrerAsistente() {
  await montar()
  await elegir('connSel', 'c-2')
  await pulsar('Continuar')
  await elegir('paSel', 'STARBRANDS')
  await pulsar('Continuar')
  await elegir('verSel', VERSION_BASE)
  await pulsar('Conectar')
  // Conectar limpia la base local antes de fijar el destino: termina un momento después del clic.
  await vi.waitFor(() => { expect(alCerrar).toHaveBeenCalled() })
}

describe('terminar el asistente', () => {
  it('conecta y CIERRA el diálogo, sin pasar por un cuadro de «Conexión activa»', async () => {
    await recorrerAsistente()
    expect(estaConectado(conexionActiva())).toBe(true)
    expect(alCerrar).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Conexión activa')
  })

  it('lo guardado de OTRO tenant se borra al conectar', async () => {
    await reiniciarAlConectar({ connectionId: 'c-1', planningArea: 'VIEJA', versionId: '' })
    await guardar('bom_psh', [{ SOURCEID: 'S1' }])

    await recorrerAsistente()
    await expect(contar('bom_psh')).resolves.toBe(0)
  })

  // Cambio del 2026-10-05: antes se conservaba, y al reconectar salía el buscador del Production
  // Visualizer con lo bajado en una sesión anterior, antes de descargar. En v7 cada conexión
  // arrancaba de cero (`resetAllModules`).
  it('lo guardado de ESTE mismo destino TAMBIÉN se borra: se arranca desde el primer paso', async () => {
    await reiniciarAlConectar({ connectionId: 'c-2', planningArea: 'STARBRANDS', versionId: '' })
    await guardar('bom_psh', [{ SOURCEID: 'S1' }])

    await recorrerAsistente()
    await expect(contar('bom_psh')).resolves.toBe(0)
  })
})

describe('abrirlo estando conectado', () => {
  it('enseña la conexión activa, que es lo único para lo que sirve ese panel', async () => {
    conectar({ connectionId: 'c-2', nombre: 'STARBRANDS QAS', planningArea: 'STARBRANDS', version: VERSION_BASE })
    await montar()
    expect(document.body.textContent).toContain('Conexión activa')
  })
})

// Pulsar la pestaña de un tenant (ver `DataTools.jsx`) abre el asistente con ESE tenant ya elegido y
// salta directo a sus áreas, en vez de volver a pedir la conexión.
describe('abrirlo desde la pestaña de un tenant', () => {
  it('arranca en el área del tenant elegido, sin pasar por el paso de la conexión', async () => {
    verAsistente(true, { conexionId: 'c-2' })
    await montar()

    await vi.waitFor(() => { if (!document.getElementById('paSel')) throw new Error('falta #paSel') })
    expect(document.getElementById('connSel')).toBeNull()
  })

  it('no arrastra el área ni la versión del tenant que estaba activo', async () => {
    conectar({ connectionId: 'c-1', nombre: 'OTRO', planningArea: 'DEL_OTRO', version: 'V1' })
    verAsistente(true, { conexionId: 'c-2' })
    await montar()

    await vi.waitFor(() => { if (!document.getElementById('paSel')) throw new Error('falta #paSel') })
    // Hay una sola área en el catálogo del tenant nuevo, así que se elige sola; la del otro no.
    expect(document.getElementById('paSel').value).toBe('STARBRANDS')
  })
})
