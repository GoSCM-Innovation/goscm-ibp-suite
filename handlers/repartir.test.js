// El reparto, y sobre todo: que ninguna operación se quede fuera de su tabla.
//
// Antes la resolución la hacía el sistema de archivos y era imposible equivocarse: si el archivo
// estaba, la dirección funcionaba. Ahora la hace una tabla, y una operación que no esté en su tabla
// simplemente no existe — sin error de compilación, sin aviso, nada. Estas pruebas son lo que
// reemplaza a esa imposibilidad.

import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { mostrador, nombreDeLaRuta } from './repartir.js'
import { RUTAS as RUTAS_ADMIN } from './admin/index.js'
import { RUTAS as RUTAS_AUTH } from './auth/index.js'
import { RUTAS as RUTAS_CIDS } from './cids/index.js'
import { RUTAS as RUTAS_IBP } from './ibp/index.js'

const AQUI = dirname(fileURLToPath(import.meta.url))

const AREAS = [
  ['admin', RUTAS_ADMIN],
  ['auth', RUTAS_AUTH],
  ['cids', RUTAS_CIDS],
  ['ibp', RUTAS_IBP],
]

/** Los archivos de handler de una carpeta: todo `.js` que no sea la tabla ni una prueba. */
const archivosDe = (area) => readdirSync(resolve(AQUI, area))
  .filter((uno) => uno.endsWith('.js') && uno !== 'index.js' && !uno.endsWith('.test.js'))
  .map((uno) => uno.replace(/\.js$/, ''))
  .sort()

/** Un `res` de mentira, con lo que usan los handlers. */
function resDeMentira() {
  const suyo = {
    codigo: null,
    cuerpo: null,
    status(codigo) { suyo.codigo = codigo; return suyo },
    json(cuerpo) { suyo.cuerpo = cuerpo; return suyo },
  }
  return suyo
}

describe('cada tabla cubre exactamente los archivos de su carpeta', () => {
  it.each(AREAS)('%s', (area, rutas) => {
    // Los nombres de la tabla son los que se ven en la dirección; los archivos, los que están en el
    // disco. Tienen que ser el mismo conjunto: si sobra un archivo, esa operación es inalcanzable, y
    // si sobra una entrada, apunta a algo que no existe.
    expect(Object.keys(rutas).sort()).toEqual(archivosDe(area))
  })

  it.each(AREAS)('%s: cada entrada es una función', (area, rutas) => {
    for (const [nombre, operacion] of Object.entries(rutas)) {
      expect(typeof operacion, `${area}/${nombre}`).toBe('function')
    }
  })
})

describe('de qué operación habla la petición', () => {
  it('la lee de los segmentos que entrega Vercel', () => {
    expect(nombreDeLaRuta({ query: { ruta: ['master-data'] } })).toBe('master-data')
    expect(nombreDeLaRuta({ query: { ruta: 'master-data' } })).toBe('master-data')
  })

  it('si no llegan, la saca de la dirección', () => {
    expect(nombreDeLaRuta({ url: '/api/ibp/master-data' })).toBe('master-data')
    expect(nombreDeLaRuta({ url: '/api/ibp/master-data?planningArea=X' })).toBe('master-data')
    expect(nombreDeLaRuta({ url: '/api/ibp/master-data/' })).toBe('master-data')
  })

  it('aguanta una petición sin nada', () => {
    expect(nombreDeLaRuta({})).toBe('')
    expect(nombreDeLaRuta(null)).toBe('')
  })
})

describe('el mostrador', () => {
  const rutas = Object.freeze({ 'master-data': vi.fn(), sample: vi.fn() })

  it('llama a la operación que le toca, con la petición y la respuesta', async () => {
    const reparte = mostrador(rutas, 'ibp')
    const req = { query: { ruta: ['sample'] } }
    const res = resDeMentira()

    await reparte(req, res)

    expect(rutas.sample).toHaveBeenCalledWith(req, res)
    expect(rutas['master-data']).not.toHaveBeenCalled()
  })

  it('deja el nombre de la operación a mano, sin pisar la consulta', async () => {
    const req = { query: { ruta: ['sample'], planningArea: 'ASIBPTS' } }
    await mostrador(rutas, 'ibp')(req, resDeMentira())

    expect(req.operacion).toBe('ibp/sample')
    expect(req.query.planningArea).toBe('ASIBPTS')
  })

  it('una dirección que no está en la tabla es 404', async () => {
    const res = resDeMentira()
    await mostrador(rutas, 'ibp')({ query: { ruta: ['no-existe'] } }, res)

    expect(res.codigo).toBe(404)
  })

  // Enumerar las operaciones de un backend a quien pregunta a ciegas es regalar el mapa.
  it('el 404 no dice qué direcciones sí existen', async () => {
    const res = resDeMentira()
    await mostrador(rutas, 'ibp')({ query: { ruta: ['no-existe'] } }, res)

    const dicho = JSON.stringify(res.cuerpo)
    expect(dicho).not.toContain('master-data')
    expect(dicho).not.toContain('sample')
  })

  // Sin esto, `/api/ibp/constructor` o `/api/ibp/toString` encontrarían algo que no es un endpoint.
  it('no se llega a lo que hereda todo objeto', async () => {
    for (const nombre of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const res = resDeMentira()
      await mostrador(rutas, 'ibp')({ query: { ruta: [nombre] } }, res)
      expect(res.codigo, nombre).toBe(404)
    }
  })

  it('una dirección vacía es 404, no la primera operación de la tabla', async () => {
    const res = resDeMentira()
    await mostrador(rutas, 'ibp')({ query: {} }, res)
    expect(res.codigo).toBe(404)
  })
})
