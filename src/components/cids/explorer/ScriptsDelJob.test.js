// @vitest-environment jsdom
//
// Los scripts pre/post-load en pantalla: la sección del detalle, la insignia 📜 de la lista y el
// interruptor que filtra. El parser y el buscador se prueban en `lib/cids-job-scripts.test.js`.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Interruptor from '../../ui/Interruptor.jsx'
import ExplorerMaster from './ExplorerMaster.jsx'
import IntegrationDetail from './IntegrationDetail.jsx'

const integracion = (extra = {}) => ({
  _idx: 0,
  _zipName: 'p.zip',
  jobName: 'JOB_A',
  jobDesc: '',
  dataflowName: 'DF_A',
  targetTable: 'PRODUCT',
  tipoIntegracion: 'MD',
  srcDSName: 'ERP',
  dstDSName: 'IBP',
  planArea: 'SAP1',
  mappings: [],
  filters: [],
  lookups: [],
  variables: [],
  diagram: { nodes: [], edges: [] },
  jobScripts: [],
  ...extra,
})

const SCRIPTS = [
  { name: 'NAME_SCRIPT_PRELOAD', kind: 'pre', description: 'Limpia la tabla', expression: 'truncate();' },
  { name: 'NAME_SCRIPT_POSTLOAD', kind: 'post', description: '', expression: '' },
  { name: 'OTRO', kind: '', description: '', expression: 'x();' },
]

let contenedor
let raiz

async function montar(elemento) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(elemento)
  })
}

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

const detalle = (una) => createElement(IntegrationDetail, {
  integracion: una,
  integraciones: [una],
  cadenas: [],
  transportadas: null,
  atl: null,
  indiceDeJobs: null,
  puedeVolver: false,
  onVolver: () => {},
  onInicio: () => {},
  onIr: () => {},
})

describe('la sección «Scripts pre/post-load» del detalle', () => {
  it('no existe si el job no tiene ninguno', async () => {
    await montar(detalle(integracion()))
    expect(contenedor.textContent).not.toContain('Scripts pre/post-load')
  })

  it('sale ABIERTA, con su contador, y lista todos los slots', async () => {
    await montar(detalle(integracion({ jobScripts: SCRIPTS })))
    expect(contenedor.textContent).toContain('📜 Scripts pre/post-load')
    expect(contenedor.querySelectorAll('.exp-script-item')).toHaveLength(3)
  })

  it('rotula Pre-load, Post-load y Script según lo que se decidió', async () => {
    await montar(detalle(integracion({ jobScripts: SCRIPTS })))
    const etiquetas = [...contenedor.querySelectorAll('.exp-script-kind')].map((uno) => uno.textContent)
    expect(etiquetas).toEqual(['Pre-load', 'Post-load', 'Script'])
    expect(contenedor.querySelector('.exp-script-kind.is-pre')).not.toBeNull()
    expect(contenedor.querySelector('.exp-script-kind.is-post')).not.toBeNull()
  })

  it('pinta el código en un <pre> y el slot vacío con su aviso, atenuado', async () => {
    await montar(detalle(integracion({ jobScripts: SCRIPTS })))
    expect(contenedor.querySelector('pre.exp-script-code').textContent).toBe('truncate();')
    const vacio = contenedor.querySelector('.exp-script-item.is-empty')
    expect(vacio.textContent).toContain('Slot de script definido pero sin contenido.')
  })

  it('enseña la descripción solo si la hay', async () => {
    await montar(detalle(integracion({ jobScripts: SCRIPTS })))
    expect(contenedor.querySelectorAll('.exp-script-desc')).toHaveLength(1)
  })

  // Corren fuera del dataflow y el preload es lo primero que ejecuta la tarea, así que van arriba.
  it('va ANTES del diagrama y de los mapeos', async () => {
    await montar(detalle(integracion({
      jobScripts: SCRIPTS,
      diagram: { nodes: [{ id: 'a', label: 'A', type: 'x' }], edges: [] },
    })))
    const texto = contenedor.textContent
    expect(texto.indexOf('Scripts pre/post-load')).toBeLessThan(texto.indexOf('Diagrama del DataFlow'))
    expect(texto.indexOf('Scripts pre/post-load')).toBeLessThan(texto.indexOf('Mappings'))
  })
})

describe('la insignia 📜 de la lista', () => {
  const lista = (integraciones) => createElement(ExplorerMaster, {
    dimension: 'integracion',
    integraciones,
    entradas: [],
    cadenas: [],
    transportadas: null,
    enConflicto: null,
    seleccion: null,
    claveElegida: null,
    onElegirIntegracion: () => {},
    onElegirClave: () => {},
  })

  it('sale en la fila de un job con un script con contenido', async () => {
    await montar(lista([integracion({ jobScripts: SCRIPTS })]))
    const insignia = contenedor.querySelector('.exp-script-badge')
    expect(insignia.title).toBe('El job tiene un script pre/post-load con contenido')
  })

  it('no sale si los slots están todos vacíos', async () => {
    await montar(lista([integracion({ jobScripts: [SCRIPTS[1]] })]))
    expect(contenedor.querySelector('.exp-script-badge')).toBeNull()
  })

  it('no sale en un job sin scripts', async () => {
    await montar(lista([integracion()]))
    expect(contenedor.querySelector('.exp-script-badge')).toBeNull()
  })
})

describe('el interruptor', () => {
  it('refleja su estado y avisa al cambiar', async () => {
    const alCambiar = vi.fn()
    await montar(createElement(Interruptor, { activo: false, onCambiar: alCambiar, titulo: 'ayuda' }, 'Texto'))

    expect(contenedor.querySelector('.interruptor-pastilla.on')).toBeNull()
    expect(contenedor.querySelector('.interruptor').title).toBe('ayuda')

    await act(async () => { contenedor.querySelector('input').click() })
    expect(alCambiar).toHaveBeenCalledWith(true)
  })

  it('encendido, la pastilla lleva la marca `on`', async () => {
    await montar(createElement(Interruptor, { activo: true, onCambiar: () => {} }, 'Texto'))
    expect(contenedor.querySelector('.interruptor-pastilla.on')).not.toBeNull()
  })
})
