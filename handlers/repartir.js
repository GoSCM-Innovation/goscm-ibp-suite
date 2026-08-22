// El reparto de una petición a la operación que le toca.
//
// POR QUÉ EXISTE ESTO. Vercel cuenta una función por cada archivo de `api/`, y su plan gratuito
// permite 12. Este backend tiene 29 operaciones. Así que en vez de un archivo por operación hay un
// MOSTRADOR por área —`api/ibp/[...ruta].js` y sus tres hermanos— que recibe todas las de su área y
// las reparte con la tabla de `handlers/<área>/index.js`.
//
// Las direcciones no cambian: `/api/ibp/master-data` sigue siendo `/api/ibp/master-data`. El frontend
// no se enteró.
//
// Lo que sí cambia, y es lo que hay que cuidar: antes la resolución la hacía el sistema de archivos y
// era imposible equivocarse. Ahora la hace una tabla, y una operación que no esté en su tabla
// simplemente no existe. Por eso hay una prueba que compara cada tabla con los archivos de su
// carpeta: si alguien añade un handler y olvida la tabla, la prueba lo dice.

/**
 * De qué operación habla la petición.
 *
 * Vercel entrega los segmentos sobrantes en `req.query.ruta`, y puede venir como lista o como texto
 * con barras. Se lee de ahí y, si no llegó, de la dirección: en el servidor de desarrollo el reparto
 * lo hace otro código y conviene que esta función sirva igual en los dos.
 */
export function nombreDeLaRuta(req) {
  const deLaConsulta = req?.query?.ruta
  if (Array.isArray(deLaConsulta)) return deLaConsulta.join('/')
  if (typeof deLaConsulta === 'string' && deLaConsulta) return deLaConsulta

  const cruda = String(req?.url ?? '')
  const camino = cruda.split('?')[0].replace(/\/+$/, '')
  const partes = camino.split('/').filter(Boolean)
  // `/api/ibp/master-data` → «master-data»: se descarta `api` y el área.
  return partes.slice(2).join('/')
}

/**
 * Arma el mostrador de un área a partir de su tabla.
 *
 * Una dirección que no está en la tabla se contesta 404 y NO se dice qué direcciones sí existen:
 * enumerar las operaciones de un backend a quien pregunta a ciegas es regalar el mapa.
 */
export function mostrador(rutas, area) {
  return async function handler(req, res) {
    const nombre = nombreDeLaRuta(req)
    const operacion = Object.hasOwn(rutas, nombre) ? rutas[nombre] : null

    if (typeof operacion !== 'function') {
      return res.status(404).json({ error: 'Esa operación no existe.' })
    }

    // El nombre de la operación queda a mano para los registros del servidor, sin pisar la consulta.
    req.operacion = `${area}/${nombre}`
    return operacion(req, res)
  }
}
