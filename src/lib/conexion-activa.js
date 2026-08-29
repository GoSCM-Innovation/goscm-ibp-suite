// Contra qué tenant, área y versión se está trabajando. Es el `CFG` global de v7 (`state.js`).
//
// POR QUÉ ES GLOBAL Y NO ESTADO DE UNA PANTALLA. En v7 se elige UNA vez —el asistente de conexión de
// tres pasos— y a partir de ahí se entra y se sale de las seis aplicaciones sin volver a elegir nada.
// Esa es la forma de la herramienta, no un detalle: el consultor abre el árbol de un material, salta
// al analizador para ver por qué le falta algo, vuelve al árbol. Pedirle el destino en cada pantalla
// convierte seis aplicaciones en seis formularios.
//
// Lo que NO se guarda aquí, y en v7 sí: la dirección, el usuario y la contraseña. Viven cifradas en
// Postgres y solo el servidor las descifra; el navegador dice a qué conexión, nunca cuál es. Por eso
// el paso ① del asistente pasó de «escribe tus credenciales» a «elige la conexión»: es la única
// diferencia deliberada con v7 en todo el asistente, y viene de una regla de seguridad, no de gusto.
//
// Vive fuera de React —igual que en v7— para que sobreviva a cambiar de módulo, que desmonta el árbol
// entero de la pantalla. Se lee con `useSyncExternalStore`, que es la forma que React 19 tiene de
// suscribirse a un estado externo sin desincronizarse.

import { useSyncExternalStore } from 'react'

import { versionParaSap } from './version-elegida.js'

/** Nadie conectado: el estado con el que arranca la aplicación. */
const VACIO = Object.freeze({
  connectionId: '',
  nombre: '',
  baseUrl: '',
  planningArea: '',
  /** El identificador interno, que puede ser `VERSION_BASE`. Lo que va a SAP sale de `destinoDe`. */
  version: '',
  esProduccion: false,
})

let estado = VACIO
const suscritos = new Set()

function avisar() {
  for (const cual of suscritos) cual()
}

function suscribir(alCambiar) {
  suscritos.add(alCambiar)
  return () => { suscritos.delete(alCambiar) }
}

const leer = () => estado

/** Deja fijado contra qué se trabaja. Lo llama el asistente al terminar su paso ③. */
export function conectar({ connectionId, nombre, baseUrl, planningArea, version, esProduccion }) {
  estado = Object.freeze({
    connectionId: String(connectionId ?? ''),
    nombre: String(nombre ?? ''),
    baseUrl: String(baseUrl ?? ''),
    planningArea: String(planningArea ?? ''),
    version: String(version ?? ''),
    esProduccion: Boolean(esProduccion),
  })
  avisar()
}

/** Vuelve a «desconectado». Lo llama la salida de la sesión. */
export function desconectar() {
  estado = VACIO
  avisar()
}

/** Hay conexión cuando están las tres cosas: sin cualquiera de ellas no se puede consultar nada. */
export const estaConectado = (cual = estado) => Boolean(
  cual.connectionId && cual.planningArea && cual.version,
)

/**
 * El destino tal como lo esperan `core/` y los handlers: con la versión ya traducida para SAP.
 *
 * La base viaja como cadena vacía porque en SAP «la versión base» es no mandar `VersionID`. Ver
 * `version-elegida.js`.
 */
export const destinoDe = (cual = estado) => ({
  connectionId: cual.connectionId,
  planningArea: cual.planningArea,
  versionId: versionParaSap(cual.version),
})

/** La conexión activa, redibujando la pantalla cuando cambia. */
export function useConexionActiva() {
  return useSyncExternalStore(suscribir, leer, leer)
}

// ── El asistente ─────────────────────────────────────────────────────────────────────────────────
//
// Se abre desde dos sitios que no comparten estado de React: el botón del menú lateral y el botón
// «Conectar a SAP IBP» de la pantalla de módulo restringido de cada aplicación. En v7 los dos
// llamaban a `openConnectDialog()`, que era global; aquí el equivalente es este par.

let abierto = false
const mirando = new Set()

const suscribirAsistente = (alCambiar) => {
  mirando.add(alCambiar)
  return () => { mirando.delete(alCambiar) }
}

const leerAsistente = () => abierto

/** Abre o cierra el asistente de conexión. */
export function verAsistente(quiero) {
  abierto = Boolean(quiero)
  for (const cual of mirando) cual()
}

/** Si el asistente está abierto. Lo pinta quien lo tenga montado. */
export function useAsistenteAbierto() {
  return useSyncExternalStore(suscribirAsistente, leerAsistente, leerAsistente)
}

/** Sin React: lo usan las funciones sueltas que necesitan el destino y no son componentes. */
export const conexionActiva = () => estado
