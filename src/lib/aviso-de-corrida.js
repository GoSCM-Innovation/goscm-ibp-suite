// El aviso del navegador cuando una orquestación termina.
//
// Portado de `fireNotification` de `useOrchestration.js` de v9. Existe por el caso de uso real: una
// orquestación de CI-DS tarda entre minutos y horas, así que nadie se queda mirando la pantalla. Sin
// el aviso hay que volver a la pestaña a comprobar, y eso convierte una espera en una vigilancia.
//
// Dos decisiones que se conservan de v9:
//
//   - El permiso se pide al ARRANCAR una corrida, no al abrir la pantalla. Pedirlo sin que la persona
//     haya hecho nada es lo que hace que lo niegue de entrada, y una vez negado no se puede volver a
//     preguntar desde la página.
//   - Si no hay permiso no pasa nada: el aviso es una comodidad, no la forma de saber el resultado.
//     El estado siempre está en la pantalla.

/** Qué dice el aviso según cómo terminó. Los mismos tres estados terminales del motor. */
const CUERPO = Object.freeze({
  success: 'Completada correctamente',
  error: 'Finalizó con error',
  cancelled: 'Cancelada',
})

/**
 * Si este navegador sabe avisar.
 *
 * Se comprueba la clave antes de tocarla porque no todos los navegadores traen `Notification` —y en
 * las pruebas, con jsdom, directamente no está—.
 */
const disponible = () => typeof window !== 'undefined' && 'Notification' in window

/** Pide permiso, si todavía no se decidió. Se llama al arrancar una corrida. */
export function pedirPermisoDeAviso() {
  if (!disponible()) return
  if (window.Notification.permission === 'default') window.Notification.requestPermission()
}

/** Avisa de que una corrida terminó. Sin permiso, no hace nada. */
export function avisarFinDeCorrida(nombre, estado) {
  if (!disponible() || window.Notification.permission !== 'granted') return
  new window.Notification(nombre || 'Orquestación', { body: CUERPO[estado] ?? estado })
}
