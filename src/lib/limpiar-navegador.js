// Lo que esta aplicación deja en el navegador, y cuándo se borra.
//
// La Suite atiende a varios clientes y cada uno tiene varios tenants. Lo que se descarga de SAP y lo que
// se recuerda de un tenant no puede quedar a la vista de quien use el mismo navegador después, ni mezclarse
// con lo de otro tenant. Aquí está la lista de lo que cuenta como DATO (se borra) y lo que es solo
// preferencia (se conserva).
//
// SE BORRA: la base local con el maestro descargado (`goscm_explorer`), los cachés de 24 h del catálogo
// y de los metadatos, la clasificación de tipos de material, los campos adicionales elegidos y los
// historiales de migración.
//
// SE CONSERVA: el tema, el menú, el formato de fechas, el tamaño de página, y las preferencias por
// conexión (tareas fijadas, favoritas, anchos y pestañas de los visores). Llevan el identificador de la
// conexión, que es de un solo cliente, y no contienen datos de SAP.

import { borrarBaseLocal } from './explorer-db.js'

/** Las claves que guardan DATOS de un tenant. Todo lo que empiece así se borra. */
export const PREFIJOS_DE_DATOS = Object.freeze([
  'ibp:vsmt:',
  'ibp:mdmeta:',
  'ibp:kfareas:',
  'ibp:kfcatalog:',
  'ibp:viewer:conv:',
  'ibp:attrmdt:',
  'ibp:kfmigrations:',
  'ibp:migrations:',
  'mattype:',
  'ef_sel:',
])

/**
 * Las claves de ANTES de separar por tenant: `mattype_<área>` y `ef_sel_<ns>_<entidad>_<área>`. No dicen de
 * qué tenant eran, así que no se pueden aprovechar sin arriesgarse a darle a un tenant los ajustes de otro.
 */
export const PREFIJOS_ANTIGUOS = Object.freeze(['mattype_', 'ef_sel_'])

/** Borra del `localStorage` toda clave que empiece por alguno de los prefijos. Devuelve cuántas. */
function borrarClaves(prefijos, almacen) {
  let borradas = 0
  try {
    for (let i = almacen.length - 1; i >= 0; i -= 1) {
      const clave = almacen.key(i)
      if (clave && prefijos.some((prefijo) => clave.startsWith(prefijo))) {
        almacen.removeItem(clave)
        borradas += 1
      }
    }
  } catch {
    // Sin acceso al almacenamiento (modo privado, sitio bloqueado): no hay nada guardado que borrar.
  }
  return borradas
}

/** Quita los ajustes guardados con el sistema anterior. Se llama al arrancar. */
export function olvidarAjustesAntiguos(almacen = globalThis.localStorage) {
  if (!almacen) return 0
  return borrarClaves(PREFIJOS_ANTIGUOS, almacen)
}

/** Quita del `localStorage` lo que son datos de un tenant. */
export function olvidarDatosGuardados(almacen = globalThis.localStorage) {
  if (!almacen) return 0
  return borrarClaves([...PREFIJOS_DE_DATOS, ...PREFIJOS_ANTIGUOS], almacen)
}

/**
 * Deja el navegador sin datos de ningún tenant: el `localStorage` de datos y la base local.
 *
 * Que la base local no se pueda borrar no impide seguir: se anota y se sale. Lo que importa es que el
 * `localStorage` quede limpio y que nada lo lea de vuelta como si fuera del usuario siguiente.
 */
export async function limpiarNavegador() {
  olvidarDatosGuardados()
  try {
    await borrarBaseLocal()
  } catch (fallo) {
    console.warn('[limpiarNavegador] no se pudo borrar la base local:', fallo)
  }
}
