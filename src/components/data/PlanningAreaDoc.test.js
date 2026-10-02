// @vitest-environment jsdom
//
// Planning Area Documenter, la pantalla: cuatro paneles con los textos y controles de v7, el estado de las
// 13 secciones, el registro paso a paso y el interruptor de datos en vivo.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Lo que toca el navegador de verdad (descargar, leer una imagen, pedir el logo) se sustituye; el resto
// —leer los CSV, armar el documento— es el código real.
vi.mock('../../lib/pa-doc.js', async (original) => ({
  ...(await original()),
  descargarDocumento: vi.fn(),
  cargarMarca: vi.fn(async () => null),
  leerLogo: vi.fn(),
}))
vi.mock('../../lib/ibp-pa-doc.js', () => ({
  fetchEntidadesDeTipos: vi.fn(),
  fetchVolumetria: vi.fn(),
  fetchApplicationJobs: vi.fn(),
}))

const { default: PlanningAreaDoc } = await import('./PlanningAreaDoc.jsx')
const { descargarDocumento, leerLogo } = await import('../../lib/pa-doc.js')
const { fetchApplicationJobs, fetchEntidadesDeTipos, fetchVolumetria } = await import('../../lib/ibp-pa-doc.js')
const { conectar, desconectar } = await import('../../lib/conexion-activa.js')
const { reiniciarTodo } = await import('../../lib/pa-doc-sesion.js')

let contenedor
let raiz

const montar = async () => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(PlanningAreaDoc))
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  reiniciarTodo()
  desconectar()
  await montar()
})

afterEach(async () => {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
})

const texto = () => contenedor.textContent
const boton = (parte) => [...contenedor.querySelectorAll('button')].find((b) => b.textContent.includes(parte))
const lineasDelRegistro = () => [...contenedor.querySelectorAll('.padoc-log > div')].map((d) => d.textContent)

/** Espera a que algo se cumpla, sin depender de cuánto tarde la máquina en leer o armar. */
async function esperar(condicion) {
  for (let i = 0; i < 200 && !condicion(); i += 1) {
    await act(async () => { await new Promise((listo) => { setTimeout(listo, 25) }) })
  }
}

/**
 * Suelta archivos en la zona de carga como lo hace el navegador, y espera a que `hasta` se cumpla
 * (la lectura es asíncrona).
 */
async function soltar(archivos, entrada = contenedor.querySelector('.drop-zone input'), hasta = null) {
  Object.defineProperty(entrada, 'files', { value: archivos, configurable: true })
  await act(async () => { entrada.dispatchEvent(new Event('change', { bubbles: true })) })
  await esperar(hasta ?? (() => lineasDelRegistro().length >= archivos.length))
}

const csv = (name, contenido) => ({ name, text: async () => contenido })

const KEYFIGURES = 'ID;Name;Base Planning Level;Stored Key Figure;Calculated Key Figure\nKF1;Demanda;PL_A;X;\nKF2;Pronóstico;PL_A;;X\n'
const MAESTROS = 'Master Data Type ID;Name;Type;Used in Planning Area;Attribute ID\nPRODUCT;Producto;Simple;X;PRDID\nLOCATION;Ubicación;Simple;X;LOCID\n'

const cargarLoBasico = () => soltar([csv('MIAREA_KEYFIGURES.csv', KEYFIGURES), csv('MIAREA_MASTERDATATYPES.csv', MAESTROS)])

async function generar() {
  await act(async () => { boton('Generar documento Word').click() })
  // Termina cuando el botón vuelve a poder pulsarse: es lo último que hace `generar`.
  await esperar(() => { const b = contenedor.querySelector('.btn-row .btn-primary'); return b && !b.disabled && b.textContent.includes('Generar') })
}

describe('la pantalla de v7', () => {
  it('trae los cuatro paneles con los títulos de v7', () => {
    const titulos = [...contenedor.querySelectorAll('.panel-title')].map((t) => t.textContent)
    expect(titulos).toEqual([
      '📥 Archivos de configuración (CSV)',
      '🎨 Portada del documento',
      '🔌 Enriquecer con datos en vivo · SAP IBP',
    ])
  })

  it('la zona de carga habla como v7, sin voseo', () => {
    expect(texto()).toContain('Arrastra los CSV aquí')
    expect(texto()).toContain('o haz click para seleccionar')
    expect(texto()).toContain('Múltiples archivos')
    expect(texto()).toContain('usa Download Configuration File y arrastra aquí los CSV resultantes (o un ZIP que los contenga).')
    expect(texto()).not.toMatch(/Soltá|Elegí|Pulsá|Volvé/)
  })

  it('la zona de carga acepta CSV y ZIP, varios a la vez', () => {
    const entrada = contenedor.querySelector('.drop-zone input')
    expect(entrada.accept).toBe('.csv,.zip')
    expect(entrada.multiple).toBe(true)
  })

  it('el panel de portada trae Cliente, Autor y Versión como v7', () => {
    const campos = [...contenedor.querySelectorAll('.padoc-field')]
    expect(campos.map((c) => c.querySelector('span').textContent)).toEqual([
      'Cliente', 'Autor', 'Versión del documento', 'Logo del cliente',
    ])
    expect(contenedor.querySelector('input[placeholder="Ej: Claro Colombia"]')).not.toBeNull()
    expect(contenedor.querySelector('input[placeholder="Nombre / área"]')).not.toBeNull()
    expect(contenedor.querySelectorAll('.padoc-field input[type="text"]')[2].value).toBe('1.0')
  })

  it('el logo solo admite PNG y JPG, y empieza con la invitación a subirlo', () => {
    expect(contenedor.querySelector('.padoc-field-logo input').accept).toBe('image/png,image/jpeg')
    expect(texto()).toContain('Subir logo del cliente')
    expect(texto()).toContain('PNG o JPG · click para elegir')
  })

  it('muestra las 13 secciones como «no provisto» y «Sin PA detectado aún»', () => {
    expect(contenedor.querySelectorAll('.padoc-chk')).toHaveLength(13)
    expect(contenedor.querySelectorAll('.padoc-chk.off')).toHaveLength(13)
    expect(texto()).toContain('Sin PA detectado aún')
    expect(texto()).toContain('no provisto')
  })

  it('las secciones salen en orden alfabético', () => {
    const nombres = [...contenedor.querySelectorAll('.padoc-chk-name')].map((n) => n.textContent)
    expect(nombres).toEqual([...nombres].sort())
    expect(nombres[0]).toBe('ATTRIBUTES_AS_KEYFIGURE')
  })

  it('el botón de generar nace deshabilitado y el de limpiar existe', () => {
    expect(boton('📝 Generar documento Word').disabled).toBe(true)
    expect(boton('🗑️ Limpiar')).toBeDefined()
  })

  it('el registro nace vacío', () => {
    expect(lineasDelRegistro()).toEqual([])
  })
})

describe('el interruptor de datos en vivo', () => {
  const interruptor = () => contenedor.querySelector('.padoc-toggle input')

  it('nace desactivado y deshabilitado, con la pista de v7', () => {
    expect(interruptor().checked).toBe(false)
    expect(interruptor().disabled).toBe(true)
    expect(texto()).toContain('Añadir datos en vivo (volumetría + Application Jobs)')
    expect(texto()).toContain('Requiere conexión a SAP IBP (botón «Conectar SAP IBP» de arriba).')
    expect(contenedor.querySelector('.padoc-phase2.on')).toBeNull()
    expect(texto()).toContain('Con una conexión activa a SAP IBP se añaden al documento la volumetría real')
  })

  it('con conexión activa se habilita, pero sigue sin marcar', async () => {
    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })

    expect(interruptor().disabled).toBe(false)
    expect(interruptor().checked).toBe(false)
    expect(contenedor.querySelector('.padoc-phase2.on')).not.toBeNull()
    expect(texto()).toContain('Conectado a SAP IBP: los Application Jobs se leerán al generar.')
    expect(contenedor.querySelector('.padoc-enrich-hint.ok')).not.toBeNull()
  })

  it('al perder la conexión se desmarca', async () => {
    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })
    await act(async () => { interruptor().click() })
    expect(interruptor().checked).toBe(true)

    await act(async () => { desconectar() })
    expect(interruptor().checked).toBe(false)
    expect(interruptor().disabled).toBe(true)

    // Y volver a conectar no lo deja marcado de antes.
    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })
    expect(interruptor().checked).toBe(false)
  })
})

describe('cargar archivos', () => {
  it('detecta las secciones, dice cuántas filas y detecta el área', async () => {
    await cargarLoBasico()

    expect(lineasDelRegistro().map((l) => l.split(' · ')[1])).toEqual([
      'Detectado: KEYFIGURES', 'Detectado: MASTERDATATYPES',
    ])
    expect(texto()).toContain('Planning Area: MIAREA')
    expect(contenedor.querySelector('.padoc-chk.on[title="KEYFIGURES"]').textContent).toContain('2 filas')
    expect(contenedor.querySelectorAll('.padoc-chk.on')).toHaveLength(2)
    expect(boton('Generar documento Word').disabled).toBe(false)
  })

  it('un archivo desconocido se avisa como «No reconocido»', async () => {
    await soltar([csv('cosas.csv', 'a;b')])
    expect(lineasDelRegistro()[0]).toContain('No reconocido: cosas.csv')
    expect(contenedor.querySelector('.padoc-log .warn')).not.toBeNull()
  })

  it('un ZIP se abre y dice «ZIP → sección»', async () => {
    const zip = new JSZip()
    zip.file('MIAREA_VERSIONS.csv', 'ID\nV1')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })

    await soltar([{ name: 'config.zip', arrayBuffer: async () => buffer }])
    expect(lineasDelRegistro()[0]).toContain('ZIP → VERSIONS')
    expect(contenedor.querySelector('.padoc-chk.on[title="VERSIONS"]')).not.toBeNull()
  })

  it('lo cargado sobrevive a salir de la pantalla y volver, como en v7', async () => {
    await cargarLoBasico()
    await act(async () => { raiz.unmount() })
    contenedor.remove()

    await montar()
    expect(texto()).toContain('Planning Area: MIAREA')
    expect(contenedor.querySelectorAll('.padoc-chk.on')).toHaveLength(2)
    expect(lineasDelRegistro()).toHaveLength(2)
  })
})

describe('el logo del cliente', () => {
  const logo = { base64: 'iVBORw0KGgo=', extension: 'png', ancho: 600, alto: 200, nombre: 'mi-logo.png' }
  const elegir = (archivo) => soltar(
    [archivo],
    contenedor.querySelector('.padoc-field-logo input'),
    () => contenedor.querySelector('.padoc-logo-thumb') || contenedor.querySelector('.padoc-log .err'),
  )

  it('se muestra la miniatura con su nombre y sus medidas, y el estado lo dice', async () => {
    leerLogo.mockResolvedValueOnce(logo)
    await elegir({ name: 'mi-logo.png' })

    expect(contenedor.querySelector('.padoc-logo-thumb')).not.toBeNull()
    expect(texto()).toContain('mi-logo.png')
    expect(texto()).toContain('600×200 px')
    expect(texto()).toContain('· Logo cargado (600×200)')
  })

  it('la ✕ lo quita', async () => {
    leerLogo.mockResolvedValueOnce(logo)
    await elegir({ name: 'mi-logo.png' })

    await act(async () => { contenedor.querySelector('.padoc-logo-clear').click() })
    expect(contenedor.querySelector('.padoc-logo-thumb')).toBeNull()
    expect(texto()).toContain('Subir logo del cliente')
    expect(texto()).not.toContain('Logo cargado')
  })

  it('una imagen que no es PNG ni JPG se rechaza y lo dice en el registro', async () => {
    leerLogo.mockResolvedValueOnce(null)
    await elegir({ name: 'foto.webp' })

    expect(contenedor.querySelector('.padoc-logo-thumb')).toBeNull()
    expect(contenedor.querySelector('.padoc-log .err').textContent).toContain('solo se admite PNG o JPG')
  })
})

describe('generar el documento', () => {
  it('sin datos no hay nada que generar', () => {
    expect(boton('Generar documento Word').disabled).toBe(true)
  })

  it('descarga Documentacion_PA_<área>_<fecha>.docx y lo dice paso a paso', async () => {
    await cargarLoBasico()
    await generar()

    const lineas = lineasDelRegistro().map((l) => l.split(' · ')[1])
    expect(lineas.slice(-2)).toEqual(['Construyendo documento (es)…', 'Documento generado y descargado.'])
    expect(descargarDocumento).toHaveBeenCalledTimes(1)
    expect(descargarDocumento.mock.calls[0][1]).toMatch(/^Documentacion_PA_MIAREA_\d{4}-\d{2}-\d{2}\.docx$/)
    expect(boton('Generar documento Word').disabled).toBe(false)
  })

  it('lleva a la portada el cliente, el autor y la versión escritos en el panel', async () => {
    await cargarLoBasico()
    const [cliente, autor, version] = contenedor.querySelectorAll('.padoc-field input[type="text"]')
    const escribir = async (entrada, valor) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(entrada, valor)
      entrada.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await escribir(cliente, 'ACME')
    await escribir(autor, 'Ana / Consultoría')
    await escribir(version, '3.0')
    await generar()

    const zip = await JSZip.loadAsync(descargarDocumento.mock.calls[0][0])
    const xml = await zip.file('word/document.xml').async('string')
    expect(xml).toContain('ACME')
    expect(xml).toContain('Ana / Consultoría')
    expect(xml).toContain('>3.0<')
  })

  it('con el interruptor apagado no llama a SAP y no hay sección 10', async () => {
    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })
    await cargarLoBasico()
    await generar()

    expect(fetchApplicationJobs).not.toHaveBeenCalled()
    const zip = await JSZip.loadAsync(descargarDocumento.mock.calls[0][0])
    expect(await zip.file('word/document.xml').async('string')).not.toContain('Application Jobs y procesos programados')
  })

  it('con datos en vivo: cuenta la volumetría, lee los jobs y los dice con los mensajes de v7', async () => {
    fetchEntidadesDeTipos.mockResolvedValue({ PRODUCT: 'PRODUCT', LOCATION: null })
    fetchVolumetria.mockResolvedValue({ PRODUCT: 1500 })
    fetchApplicationJobs.mockResolvedValue({
      entidades: { plantillas: 'JobTemplateSet', pasos: 'JobTemplateSequenceSet' },
      jobs: [{ name: 'ZA', text: 'Carga', steps: [{ pos: 1, name: 'Paso', type: 'DATA INTEGRATION', cids: true }] }],
    })

    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })
    await cargarLoBasico()
    await act(async () => { contenedor.querySelector('.padoc-toggle input').click() })
    await generar()

    const lineas = lineasDelRegistro().map((l) => l.split(' · ')[1])
    expect(lineas).toEqual(expect.arrayContaining([
      'Enriqueciendo: volumetría de datos maestros (SAP_COM_0720)…',
      '  ↳ Volumetría de 1/2 tipos de datos maestros…',
      'SAP_COM_0720 OK: volumetría de 1 tipo(s) de datos maestros.',
      'Enriqueciendo: Application Jobs (SAP_COM_0326)…',
      '  ↳ Plantillas de job (JobTemplateSet)…',
      '  ↳ Pasos (JobTemplateSequenceSet)…',
      'SAP_COM_0326 OK: 1 plantilla(s) de Application Jobs.',
      'Enriquecimiento completo: ambos acuerdos (SAP_COM_0720 + SAP_COM_0326) respondieron.',
    ]))
    expect(fetchVolumetria).toHaveBeenCalledWith('c1', ['PRODUCT'])

    const zip = await JSZip.loadAsync(descargarDocumento.mock.calls[0][0])
    const xml = await zip.file('word/document.xml').async('string')
    expect(xml).toContain('10. Application Jobs y procesos programados')
    expect(xml).toContain('Registros (en vivo)')
    expect(xml).toContain('1.500')
  })

  // Cada acuerdo es un servicio aparte: si uno falla, el documento sale igual con el otro.
  it('si un acuerdo no responde, el documento sale con lo que hay y el registro lo avisa', async () => {
    fetchEntidadesDeTipos.mockRejectedValue(new Error('SAP devolvió 403'))
    fetchApplicationJobs.mockResolvedValue({ entidades: { plantillas: 'A', pasos: 'B' }, jobs: [] })

    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })
    await cargarLoBasico()
    await act(async () => { contenedor.querySelector('.padoc-toggle input').click() })
    await generar()

    const lineas = lineasDelRegistro().map((l) => l.split(' · ')[1])
    expect(lineas).toContain('SAP_COM_0720 no disponible con este usuario/tenant (SAP devolvió 403). Se omite la volumetría de maestros.')
    expect(lineas).toContain('Enriquecimiento parcial: solo respondió SAP_COM_0326. Verifica que ambos acuerdos estén asignados al mismo Communication User.')
    expect(contenedor.querySelector('.padoc-log .warn')).not.toBeNull()
    expect(descargarDocumento).toHaveBeenCalledTimes(1)
  })

  it('si ningún acuerdo responde, lo dice y genera sin datos en vivo', async () => {
    fetchEntidadesDeTipos.mockRejectedValue(new Error('x'))
    fetchApplicationJobs.mockRejectedValue(new Error('y'))

    await act(async () => { conectar({ connectionId: 'c1', nombre: 'T', planningArea: 'PA', version: 'V1' }) })
    await cargarLoBasico()
    await act(async () => { contenedor.querySelector('.padoc-toggle input').click() })
    await generar()

    expect(lineasDelRegistro().map((l) => l.split(' · ')[1]))
      .toContain('Ningún acuerdo respondió; el documento se genera sin datos en vivo.')
    expect(descargarDocumento).toHaveBeenCalledTimes(1)
  })

  it('un fallo al armar el documento se dice como «Error al generar»', async () => {
    descargarDocumento.mockImplementationOnce(() => { throw new Error('sin permiso para descargar') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await cargarLoBasico()
    await generar()

    expect(contenedor.querySelector('.padoc-log .err').textContent).toContain('Error al generar: sin permiso para descargar')
    expect(boton('Generar documento Word').disabled).toBe(false)
  })
})

describe('limpiar', () => {
  it('vacía los archivos, el área, el logo y el registro, pero no el cliente', async () => {
    leerLogo.mockResolvedValueOnce({ base64: 'iVBORw0KGgo=', extension: 'png', ancho: 10, alto: 10, nombre: 'l.png' })
    await cargarLoBasico()
    await soltar([{ name: 'l.png' }], contenedor.querySelector('.padoc-field-logo input'), () => contenedor.querySelector('.padoc-logo-thumb'))
    const cliente = contenedor.querySelector('input[placeholder="Ej: Claro Colombia"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(cliente, 'ACME')
      cliente.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => { boton('🗑️ Limpiar').click() })

    expect(texto()).toContain('Sin PA detectado aún')
    expect(contenedor.querySelectorAll('.padoc-chk.on')).toHaveLength(0)
    expect(contenedor.querySelector('.padoc-logo-thumb')).toBeNull()
    expect(lineasDelRegistro()).toEqual([])
    expect(boton('Generar documento Word').disabled).toBe(true)
    // v7 no tocaba los campos de la portada.
    expect(contenedor.querySelector('input[placeholder="Ej: Claro Colombia"]').value).toBe('ACME')
  })
})
