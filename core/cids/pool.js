// Ejecutar muchas cosas con un tope de cuántas van a la vez.
//
// Hace falta cada vez que se le pide a CI-DS una consulta por elemento: el fin y la duración de
// las ejecuciones de una página, o las tareas de todos los proyectos de un tenant. Sin tope serían
// cincuenta o cien consultas simultáneas a un tenant que además está trabajando.
//
// Portado del `runPool` que v9 tenía dentro del monitor. Aquí está una sola vez.

/**
 * Recorre `items` llamando a `worker` con cada uno, con como máximo `limit` en vuelo.
 *
 * No devuelve resultados a propósito: quien llama va acumulando lo que le interesa. Es lo que
 * permite que cada uso decida qué hacer con un elemento que falla —descartarlo, marcarlo— sin que
 * esta función tenga que saberlo.
 */
export async function runPool(items, limit, worker) {
  let siguiente = 0
  const carriles = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: carriles }, async () => {
    while (siguiente < items.length) {
      await worker(items[siguiente++])
    }
  }))
}
