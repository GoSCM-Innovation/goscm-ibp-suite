// Las hojas de la red que se guardan en disco: las dos de arcos (Location Source y Customer Source), que no
// caben en memoria, y las tres acotadas (Product, Location y Customer), que v7 también paginaba desde el
// disco (`sn_product_web`, `sn_location_web`, `sn_customer_web`).
//
// Portado del manejo de las hojas «grandes» de `analyzeAndStreamExcel` de v7 (`_lsWebBuf`,
// `_lsWebWrites`, `WEB_IDB_BATCH`, `WEB_IDB_MAX_LOTS`, `WEB_CAP_BIG`). Una red real tiene cientos de miles
// de arcos y decenas de miles de productos, así que esas hojas NUNCA se retienen enteras:
//
//   - para el Excel, cada fila se vuelve XML en cuanto llega y se guarda por partes (`crearEscritorDeTabla`
//     de `xlsx-analisis.js`), partiendo la hoja a las 900.000 filas;
//   - para la vista web, cada fila se guarda en la base local (`sn_loc_web` / `sn_cust_web`) en lotes de
//     8.000, y la pantalla las pide por páginas (`origen`), sin cargarlas;
//   - en memoria solo quedan las primeras 20.000 filas, de respaldo por si la base local falla.
//
// Es el `crearHojaGrande` que recibe `analizarRed` (`core/ibp/network-analyzer.js`): devuelve una hoja con
// la misma forma que las demás (`agregar`, contadores `total / red / yel / ok`), más `cerrar()` para
// esperar las escrituras pendientes. Cuando `cerrar()` termina, la hoja trae:
//
//   hoja.partes   el XML del Excel, una entrada por hoja de Excel
//   hoja.origen   cómo paginar la vista web desde la base local (solo si se pidió vista web y no falló)
//   hoja.filas    las primeras 20.000 filas, para la vista de respaldo (solo si se pidió vista web)
//   hoja.capada   verdadero si hay más filas que las que están en `hoja.filas`

import { crearHojaDeTabla, limpiarXml, severidadDeRelleno } from '../../core/ibp/analisis-hojas.js'
import { INDICE_DE_SEVERIDAD } from './explorer-schema.js'
import { buscarEnTabla, guardar, leerTramo } from './explorer-db.js'
import { crearEscritorDeTabla } from './xlsx-analisis.js'

/** Filas por lote de escritura a la base local (`WEB_IDB_BATCH`). */
export const FILAS_POR_LOTE_WEB = 8000

/** Cuántos lotes pueden estar en vuelo antes de rendirse (`WEB_IDB_MAX_LOTS`): ~96.000 filas. */
export const LOTES_EN_VUELO = 12

/** Cuántas filas se guardan en memoria como respaldo (`WEB_CAP_BIG`). */
export const FILAS_DE_RESPALDO = 20000

/** En qué tabla de vista se guarda cada hoja grande. */
export const TABLA_DE_VISTA_DE = Object.freeze({
  'Location Source': 'sn_loc_web',
  'Customer Source': 'sn_cust_web',
  Product: 'sn_product_web',
  Location: 'sn_location_web',
  Customer: 'sn_customer_web',
})

/**
 * Cómo pagina la vista web una hoja guardada: `pagina` pide un tramo (con el filtro de severidad) y
 * `buscar` recorre por cursor con tope (`idbCursorPage` e `idbCursorScanMatch` de v7).
 */
export function crearOrigenPaginado(tabla, { tramo = leerTramo, buscar = buscarEnTabla } = {}) {
  const dePor = (sev) => (sev === 'all' ? {} : { indice: INDICE_DE_SEVERIDAD, valor: sev })
  return {
    pagina: (sev, desde, cuantos) => tramo(tabla, { desde, cuantos, ...dePor(sev) }),
    buscar: (sev, prueba, maximo, escanear) => buscar(tabla, prueba, { maximo, escanear, ...dePor(sev) }),
  }
}

/**
 * La fábrica de hojas grandes.
 *
 * `web` dice si se pidió vista web (si no, solo se escribe el Excel y no se toca la base local).
 * `registrar(clase, texto)` recibe los avisos de la vista web. `guardarLote` y `origenDe` se inyectan para
 * las pruebas.
 */
export function crearFabricaDeHojasGrandes({
  web = false,
  registrar = () => {},
  guardarLote = guardar,
  origenDe = crearOrigenPaginado,
  filasPorLote = FILAS_POR_LOTE_WEB,
  lotesEnVuelo = LOTES_EN_VUELO,
  filasDeRespaldo = FILAS_DE_RESPALDO,
} = {}) {
  return function crearHojaGrande(cfg) {
    const hoja = crearHojaDeTabla(cfg)
    const escritor = crearEscritorDeTabla({
      color: cfg.color, encabezados: cfg.encabezados, notas: cfg.notas, grupos: cfg.grupos,
      limpiarEncabezados: cfg.limpiarEncabezados,
    })
    const tabla = TABLA_DE_VISTA_DE[cfg.nombre] ?? null

    let webActiva = web && Boolean(tabla)
    let lote = []
    let pendientes = 0
    const escrituras = []

    /** Guarda el lote en la base local, sin esperar; cuenta los que van en vuelo. */
    function volcar() {
      pendientes += 1
      // El rechazo se re-lanza al esperar todas las escrituras en `cerrar()`: un fallo deja la vista sin
      // `origen` y cae a la de respaldo. El `catch` vacío solo evita el aviso de «rechazo sin atender».
      const escritura = guardarLote(tabla, lote).then(
        () => { pendientes -= 1 },
        (error) => { pendientes -= 1; throw error },
      )
      escritura.catch(() => {})
      escrituras.push(escritura)
      lote = []
    }

    hoja.agregar = (datos, relleno = null) => {
      const sev = severidadDeRelleno(relleno)
      const celdas = datos.map(limpiarXml)
      hoja.total += 1
      hoja[sev] += 1
      escritor.agregar(celdas, sev)

      if (web) {
        // Lo que la vista guarda es texto: la celda vacía es '' y los números ya son su texto (`String`).
        const registro = { c: celdas.map((v) => (v == null ? '' : String(v))), s: sev }
        if (hoja.filas.length < filasDeRespaldo) hoja.filas.push(registro)
        else hoja.capada = true

        if (webActiva) {
          lote.push(registro)
          if (lote.length >= filasPorLote) {
            volcar()
            // Demasiadas escrituras sin terminar: el disco no da abasto. Se sigue con el Excel y la
            // vista queda parcial (las primeras filas), como v7.
            if (pendientes > lotesEnVuelo) {
              webActiva = false
              registrar('warn', `Vista web ${cfg.nombre}: volumen alto, se usará vista parcial (descarga Excel para el 100%).`)
            }
          }
        }
      }
      return sev
    }

    hoja.cerrar = async () => {
      hoja.partes = escritor.cerrar()
      if (!(web && webActiva)) return
      try {
        if (lote.length > 0) volcar()
        await Promise.all(escrituras)
        hoja.origen = origenDe(tabla)
      } catch (error) {
        webActiva = false
        registrar('warn', `Vista web (detalle completo ${cfg.nombre}) no disponible: ${error && error.message}`)
      }
    }

    return hoja
  }
}
