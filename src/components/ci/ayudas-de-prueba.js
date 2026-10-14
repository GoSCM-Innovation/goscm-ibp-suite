// Lo que comparten las pruebas de pantalla de CI Tools.
//
// Se monta con `react-dom` a secas —el proyecto no trae React Testing Library— y con `createElement`, igual que
// el resto de las pruebas de pantalla. No es una prueba (no termina en `.test.js`): solo la caja de herramientas.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

let contenedor = null
let raiz = null

/** Monta un componente y devuelve el contenedor. Termina cuando React asentó el primer dibujo. */
export async function montar(Componente, props = {}) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  await act(async () => {
    raiz = createRoot(contenedor)
    raiz.render(createElement(Componente, props))
  })
  return contenedor
}

/** Lo desmonta y limpia. Se llama en `afterEach`. */
export async function desmontar() {
  await act(async () => { raiz?.unmount() })
  contenedor?.remove()
  contenedor = null
  raiz = null
}

/** Vuelve a dibujar el componente montado con otras props. */
export async function redibujar(Componente, props) {
  await act(async () => { raiz.render(createElement(Componente, props)) })
}

export const dom = () => contenedor

/** Deja que se resuelvan las promesas pendientes (una carga simulada, un guardado). */
export const asentar = () => act(async () => { await Promise.resolve() })

/** El botón cuyo texto visible es `texto`. */
export const boton = (texto) => [...contenedor.querySelectorAll('button')].find((uno) => uno.textContent.trim() === texto)

/** El control con ese `aria-label`. */
export const porEtiqueta = (etiqueta) => contenedor.querySelector(`[aria-label="${etiqueta}"]`)

export const todosPorEtiqueta = (etiqueta) => [...contenedor.querySelectorAll(`[aria-label="${etiqueta}"]`)]

export const pulsar = async (elemento) => {
  await act(async () => { elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

/**
 * Escribe en un campo como escribiría una persona: con el asignador nativo y no con `campo.value = …`, porque
 * React lleva su propia copia del valor y, si se asigna por encima, decide que no cambió nada y no llama a
 * `onChange`. La prueba pasaría con el valor viejo y no avisaría de nada.
 */
export const escribir = async (campo, texto) => {
  const prototipo = campo instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const asignar = Object.getOwnPropertyDescriptor(prototipo, 'value').set
  await act(async () => {
    asignar.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Pulsa una tecla en un campo. */
export const teclear = async (campo, key) => {
  await act(async () => { campo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
}

/** Elige una opción de un `<select>`. */
export const elegir = async (selector, valor) => {
  const asignar = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  await act(async () => {
    asignar.call(selector, valor)
    selector.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Marca o desmarca una casilla. */
export const marcar = async (casilla) => {
  await act(async () => { casilla.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

/** El texto visible de todo el contenedor, con los espacios normalizados. */
export const texto = () => contenedor.textContent.replace(/\s+/g, ' ').trim()
