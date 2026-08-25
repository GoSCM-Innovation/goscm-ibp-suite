import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Carga TODAS las variables de entorno (no solo las VITE_) en process.env para que los
// handlers de api/*.js — que leen process.env.X en el top-level — funcionen al montarlos
// en el dev server. No pisa las que ya estén definidas en el entorno real.
const fileEnv = loadEnv('development', process.cwd(), '')
for (const [k, v] of Object.entries(fileEnv)) {
  if (process.env[k] === undefined) process.env[k] = v
}

function readBody(req) {
  return new Promise((res, rej) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => res(data))
    req.on('error', rej)
  })
}

// Añade al res de Connect los helpers que esperan los handlers estilo Vercel.
function decorateRes(res) {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = (data) => {
    if (data === undefined || data === null) { res.end(); return res }
    if (typeof data === 'string' || Buffer.isBuffer(data)) { res.end(data); return res }
    return res.json(data)
  }
  return res
}

/**
 * Carga un handler de `api/` **en su versión actual**, no en la que se cargó al arrancar.
 *
 * Esto existe por un fallo que costó una tarde de diagnóstico. `import()` de Node memoriza cada
 * módulo por su dirección y no lo suelta nunca en la vida del proceso. Así que el dev server servía
 * el backend con el que arrancó: se editaba un endpoint o algo de `core/`, el archivo cambiaba en el
 * disco, y el servidor seguía ejecutando el viejo. Y en silencio — el frontend SÍ se recargaba solo,
 * así que quedaba una mezcla de frontend nuevo con backend viejo, que es lo peor de los dos mundos:
 * la pantalla se ve como esperás y los datos vienen de otro código.
 *
 * `ssrLoadModule` de Vite sí sabe qué archivos cambiaron —lleva el grafo de módulos y lo invalida al
 * guardar—, así que recarga el handler y todo lo que importa de `core/`.
 *
 * Con respaldo a `import()` a propósito: si una versión de Vite deja de ofrecer ese cargador,
 * preferible un dev server que necesite reiniciarse a mano que uno que no arranca. Cuando cae en el
 * respaldo lo avisa, para que nadie vuelva a perder la tarde.
 */
let avisoDeRespaldoDado = false

async function cargarHandler(server, file) {
  if (typeof server.ssrLoadModule === 'function') {
    return server.ssrLoadModule(file)
  }
  if (!avisoDeRespaldoDado) {
    avisoDeRespaldoDado = true
    server.config.logger.warn(
      '[dev-api] Esta versión de Vite no ofrece ssrLoadModule: los cambios en api/ y core/ NO se '
      + 'recargan solos. Reiniciá `npm run dev` después de editarlos.',
    )
  }
  return import(pathToFileURL(file).href)
}

// Plugin SOLO de desarrollo: monta los handlers de api/*.js en el dev server de Vite para
// que `npm run dev` sirva frontend + /api en un único puerto. En producción se usan las
// funciones de Vercel; este plugin no participa del build (apply: 'serve').
function devApiPlugin() {
  const apiDir = resolve(process.cwd(), 'api')
  const handlersDir = resolve(process.cwd(), 'handlers')
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || ''
        if (!rawUrl.startsWith('/api/')) return next()

        const url = new URL(rawUrl, 'http://localhost')
        const segments = url.pathname.slice('/api/'.length).split('/').filter(Boolean)
        if (segments.length === 0) return next()
        // El filtro es también la defensa contra rutas con ".." que se escapen de api/.
        if (!segments.every((segment) => /^[a-zA-Z0-9_-]+$/.test(segment))) return next()

        // Se resuelve por la MISMA TABLA que en producción.
        //
        // Si el área tiene mostrador —`handlers/<área>/index.js`— la operación sale de su tabla, que
        // es exactamente la que lee la función de Vercel. Antes acá se resolvía por sistema de
        // archivos y allá también, así que coincidían solas; con mostradores hay que compartir la
        // tabla a propósito, o se llega a «en mi máquina funciona» por el peor camino: el frontend
        // igual y el backend resolviendo distinto.
        //
        // Si no hay mostrador, se cae al archivo suelto de `api/<a>.js`, que es como siguen
        // sirviéndose las tres operaciones de la raíz.
        let file = null
        let enTabla = null
        let pathParam = null

        if (segments.length >= 2) {
          const tabla = resolve(handlersDir, segments[0], 'index.js')
          if (existsSync(tabla)) {
            file = tabla
            enTabla = segments.slice(1).join('/')
          }
        }
        if (!file) {
          const flat = resolve(apiDir, `${segments[0]}.js`)
          if (existsSync(flat)) {
            file = flat
            pathParam = segments[1]
          }
        }
        if (!file) return next()
        const name = segments.join('/')

        try {
          const bodyText = await readBody(req)
          if (bodyText) {
            try {
              req.body = JSON.parse(bodyText)
            } catch {
              decorateRes(res).status(400).json({ error: 'JSON inválido en el cuerpo' })
              return
            }
          } else {
            req.body = {}
          }
          req.query = Object.fromEntries(url.searchParams)
          // Segmento sobrante de la ruta, para handlers tipo /api/recurso/:id
          if (pathParam) req.query.id = pathParam

          decorateRes(res)
          const mod = await cargarHandler(server, file)

          // Con mostrador, la operación se busca en su tabla; lo que no está en ella no existe, igual
          // que en producción. Sin mostrador, es el `export default` del archivo suelto.
          const operacion = enTabla === null
            ? mod.default
            : (Object.hasOwn(mod.RUTAS ?? {}, enTabla) ? mod.RUTAS[enTabla] : null)

          if (typeof operacion !== 'function') {
            decorateRes(res).status(404).json({ error: 'Esa operación no existe.' })
            return
          }

          await operacion(req, res)
        } catch (err) {
          server.config.logger.error(`[dev-api] ${name}: ${err.stack || err.message}`)
          if (!res.headersSent) {
            decorateRes(res).status(500).json({ error: 'Error interno del servidor (dev-api)' })
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // El transformador que usan las PRUEBAS no pasa por el plugin de React, así que hay que decirle a
  // esbuild que el JSX es del runtime automático. Sin esto, un componente montado en una prueba sale
  // con `React.createElement` y muere con «React is not defined», que no dice nada del problema real.
  // En el build no cambia nada: allí el plugin transforma el JSX antes de que esbuild lo vea.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    // Montar un componente de verdad exige que el entorno se declare como entorno de `act`. Es una
    // bandera global de React, no una opción de Vitest, y va antes de que se cargue cualquier prueba.
    setupFiles: ['./src/test-setup.js'],
  },
})
