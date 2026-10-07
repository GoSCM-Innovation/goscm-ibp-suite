// El criterio ÚNICO de la plataforma para elegir de una lista: corta, el control de siempre; extensa, una
// ventana emergente con buscador (`ui/VentanaDeSeleccion.jsx`).
//
// Pedido el 2026-10-06. Se decide por CANTIDAD de opciones y en tiempo de ejecución, no pantalla por
// pantalla: así la misma pantalla se comporta bien en tenants distintos (8 áreas se quedan en una lista,
// 5.000 filas o 40 campos pasan a ventana) y un control nuevo no tiene que acordarse de nada.
//
// 12 es lo que cabe en un desplegable sin desplazarse mucho. Es un solo número: cambiarlo aquí cambia
// el comportamiento de toda la web (Data Tools, CI-DS Tools e IBP Tools).

export const UMBRAL_LISTA_EXTENSA = 12

/** ¿Hay tantas opciones que conviene la ventana con buscador? */
export const esListaExtensa = (cantidad) => cantidad > UMBRAL_LISTA_EXTENSA
