// Lo que hace falta antes de cualquier prueba.
//
// `act` de React se niega a funcionar si el entorno no se declara como entorno de pruebas: avisa con
// «The current testing environment is not configured to support act(...)» y deja pasar la prueba con
// el árbol a medio renderizar, que es peor que fallar.
//
// Es inofensivo para las pruebas de `core/`, que no montan nada.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
