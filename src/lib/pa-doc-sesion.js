// Lo que el documentador lleva cargado mientras se navega por la aplicación.
//
// POR QUÉ VIVE FUERA DE REACT. En v7 los CSV leídos, el logo, el registro y los campos de la portada
// viven en variables del módulo `PADoc` y en un panel que se oculta, no se destruye, al cambiar de
// pestaña: el consultor carga los archivos, salta al glosario a mirar algo y al volver todo sigue ahí.
// Aquí cada aplicación de Data Tools se monta y se desmonta al navegar, así que el estado de la pantalla
// se perdería. Vive como `conexion-activa.js`, con `useSyncExternalStore`.
//
// Y se vacía al cerrar la sesión (`reiniciarTodo`): los CSV son la configuración de un cliente, y quien
// entre después con otra cuenta no debe heredarlos.

import { useSyncExternalStore } from 'react'

import { estadoInicial } from '../../core/ibp/pa-doc-model.js'

/** Un registro vacío: `{ clase, mensaje, hora }` por línea. */
const NUEVA = () => Object.freeze({
  /** `{ datos, paId }`: lo leído de los CSV. */
  estado: estadoInicial(),
  /** El logo del cliente: `{ base64, extension, ancho, alto, nombre }` o `null`. */
  logo: null,
  /** El registro paso a paso. */
  lineas: [],
  cliente: '',
  autor: '',
  version: '1.0',
  /** El interruptor de datos en vivo. */
  enriquecer: false,
  generando: false,
})

let sesion = NUEVA()
const suscritos = new Set()

/** El logo de GoSCM, que se carga la primera vez que se genera y no se vuelve a pedir. */
let marca = null

const avisar = () => { for (const cual of suscritos) cual() }

function suscribir(alCambiar) {
  suscritos.add(alCambiar)
  return () => { suscritos.delete(alCambiar) }
}

const leer = () => sesion

/** La sesión del documentador, redibujando la pantalla cuando cambia. */
export const useSesionPaDoc = () => useSyncExternalStore(suscribir, leer, leer)

/** La sesión tal cual está ahora, sin React. */
export const sesionPaDoc = () => sesion

/** Cambia lo que se indique. */
export function cambiar(parche) {
  sesion = Object.freeze({ ...sesion, ...parche })
  avisar()
}

/** Añade una línea al registro: `registro('ok', '…')`. Lleva la hora, como `log` de v7. */
export function registrar(clase, mensaje) {
  cambiar({
    lineas: [...sesion.lineas, { clase, mensaje, hora: new Date().toLocaleTimeString() }],
  })
}

/**
 * `PADoc.reset()` de v7: vacía los archivos, el área, el logo, el registro y el enriquecimiento.
 *
 * No toca el cliente, el autor, la versión ni el interruptor: v7 tampoco los limpiaba.
 */
export function limpiar() {
  cambiar({ estado: estadoInicial(), logo: null, lineas: [] })
}

/** Lo de cerrar sesión: todo, incluidos los campos de la portada. */
export function reiniciarTodo() {
  sesion = NUEVA()
  marca = null
  avisar()
}

/** El logo de GoSCM ya cargado, o `null`. */
export const marcaGoscm = () => marca

/** Guarda el logo de GoSCM una vez cargado. */
export function guardarMarca(cual) { marca = cual }
