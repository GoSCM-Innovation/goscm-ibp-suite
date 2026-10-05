// @vitest-environment jsdom
//
// El detalle de la corrida: cabecera con estado, hora y duración totales; por paso, hora, duración
// «Xm Ys», `#` del id de SAP y los textos del botón de logs de v9.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RunDetail from './RunDetail.jsx'

const ORQUESTACION = {
  nodes: [
    { id: 'a', type: 'task', data: { taskName: 'CARGA' } },
    { id: 'g', type: 'group', data: { label: 'Grupo 1' } },
    { id: 'h', type: 'task', parentId: 'g', data: { taskName: 'HIJA' } },
  ],
}

const RUN = {
  status: 'error',
  startedAt: '2026-10-05T10:00:00.000Z',
  finishedAt: '2026-10-05T10:05:30.000Z',
  nodes: {
    a: {
      status: 'success', type: 'task', sapRunId: '9876543210',
      startedAt: '2026-10-05T10:00:00.000Z', finishedAt: '2026-10-05T10:00:45.000Z',
    },
    g: {
      status: 'error', type: 'group', children: {
        h: {
          status: 'error', error: 'se cayó', sapRunId: '555',
          startedAt: '2026-10-05T10:01:00.000Z', finishedAt: '2026-10-05T10:03:10.000Z',
        },
      },
    },
  },
}

let contenedor
let raiz

async function montar(props) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(RunDetail, { orquestacion: ORQUESTACION, run: RUN, ...props }))
  })
}

afterEach(() => {
  act(() => raiz?.unmount())
  contenedor?.remove()
})

const texto = () => contenedor.textContent
const boton = (contiene) => [...contenedor.querySelectorAll('button')].find((b) => b.textContent.includes(contiene))
const abrir = () => act(async () => { boton('Detalle por paso').click() })

describe('RunDetail', () => {
  it('sin corrida no dibuja nada', async () => {
    await montar({ run: null })
    expect(contenedor.textContent).toBe('')
  })

  it('plegado solo muestra el botón; abierto, la cabecera de v9', async () => {
    await montar()
    expect(contenedor.querySelector('.ej-detalle-cab')).toBeNull()
    await abrir()

    const cabecera = contenedor.querySelector('.ej-detalle-cab')
    expect(cabecera.textContent).toContain('Log de ejecución')
    expect(cabecera.textContent).toContain('Error')
    // La hora (es-CL) y la duración total: 5 min 30 s.
    expect(cabecera.querySelector('.ej-detalle-tiempo').textContent).toMatch(/\d{1,2}:\d{2}:\d{2}.* · 5m 30s$/)
  })

  it('cada fila lleva hora, duración «Xm Ys» o «Ns» y # de los últimos seis dígitos', async () => {
    await montar()
    await abrir()

    const filas = [...contenedor.querySelectorAll('tbody tr')]
    expect(filas).toHaveLength(3)

    const [a, grupo, hija] = filas
    expect(a.textContent).toContain('CARGA')
    expect(a.textContent).toContain('45s')
    expect(a.textContent).toContain('#543210')
    expect(a.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/)

    expect(grupo.textContent).toContain('grupo')
    expect(hija.textContent).toContain('2m 10s')
    expect(hija.textContent).toContain('#555')
    expect(hija.textContent).toContain('se cayó')
  })

  it('un paso que no corrió muestra guiones', async () => {
    await montar({ run: { ...RUN, nodes: { a: { status: 'pending', type: 'task' } } } })
    await abrir()
    const fila = contenedor.querySelector('tbody tr')
    expect(fila.querySelectorAll('td')[2].textContent).toBe('—')
    expect(fila.querySelectorAll('td')[3].textContent).toBe('—')
  })

  it('sin pasos dice «Sin nodos ejecutados»', async () => {
    await montar({ orquestacion: { nodes: [] }, run: { ...RUN, nodes: {} } })
    await abrir()
    expect(texto()).toContain('Sin nodos ejecutados')
    expect(contenedor.querySelector('table')).toBeNull()
  })
})

describe('el botón de logs', () => {
  it('dice «📄 Logs SAP», trae el registro al abrirlo y luego «ocultar logs»', async () => {
    const leerRegistro = vi.fn().mockResolvedValue([{ nombre: 'monitorLog', lineas: ['linea 1', 'linea 2'] }])
    await montar({ leerRegistro })
    await abrir()

    // Solo los pasos con id de SAP lo tienen: el grupo no.
    expect([...contenedor.querySelectorAll('button')].filter((b) => b.textContent === '📄 Logs SAP')).toHaveLength(2)

    await act(async () => { boton('📄 Logs SAP').click() })
    expect(leerRegistro).toHaveBeenCalledTimes(1)
    expect(leerRegistro.mock.calls[0][0]).toMatchObject({ sapRunId: '9876543210' })
    expect(texto()).toContain('monitorLog')
    expect(texto()).toContain('linea 1')
    expect(boton('ocultar logs')).toBeTruthy()

    await act(async () => { boton('ocultar logs').click() })
    expect(texto()).not.toContain('linea 1')
    // Abrir de nuevo no vuelve a pedirlo a SAP.
    await act(async () => { boton('📄 Logs SAP').click() })
    expect(leerRegistro).toHaveBeenCalledTimes(1)
  })

  it('si falla, dice «Error: …»', async () => {
    const leerRegistro = vi.fn().mockRejectedValue(new Error('SAP no contesta'))
    await montar({ leerRegistro })
    await abrir()
    await act(async () => { boton('📄 Logs SAP').click() })
    expect(texto()).toContain('Error: SAP no contesta')
  })

  it('sin lector de registro no hay botón', async () => {
    await montar({ leerRegistro: undefined })
    await abrir()
    expect(boton('Logs SAP')).toBeUndefined()
    // Pero el identificador de SAP sí se ve.
    expect(texto()).toContain('#543210')
  })
})
