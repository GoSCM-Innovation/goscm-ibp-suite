// La base local del explorador: guardar los conjuntos de dato maestro y recorrerlos por cursor.
//
// Portado de los ayudantes de IndexedDB de `public/js/api.js` de v7. Tres detalles de ahí no son
// adorno y se conservan porque cada uno tapa un fallo que cuesta encontrar:
//
//   1. Una transacción que se ABORTA rechaza la promesa. Sin esto, la promesa se queda colgada para
//      siempre y la pantalla se ve "cargando" sin fin. Pasa de verdad: si otra pestaña de la misma
//      aplicación pide una actualización del esquema, esta conexión se cierra y las transacciones en
//      vuelo se abortan.
//   2. Al recibir `versionchange` se cierra la conexión. Si no, es ESTA pestaña la que bloquea a la
//      otra, y la otra se queda esperando indefinidamente sin decir por qué.
//   3. Los conjuntos grandes se recorren POR CURSOR y no con `getAll`. `getAll` construye un arreglo
//      con todo en memoria, que es exactamente lo que esta arquitectura evita.
//
// Y una cosa que v7 no necesitaba: la base lleva marca de a qué tenant, área y versión pertenece lo
// guardado. v7 trabajaba contra una conexión a la vez; aquí hay varias, y mezclar los datos de dos
// tenants sin avisar es la clase de error que hace desconfiar de toda la pantalla.

import {
  NOMBRE_DE_LA_BASE,
  TABLA_DE_ORIGEN,
  TABLAS_DE_VISTA_A_RECREAR,
  TABLAS_OBSOLETAS,
  VERSION_DEL_ESQUEMA,
  existeLaTabla,
  marcaDeOrigen,
  mismoOrigen,
  todasLasTablas,
} from './explorer-schema.js'

/** Cuántos registros se escriben por transacción. */
export const POR_LOTE = 2000

let conexion = null

/**
 * La marca de origen que ESTA pestaña escribió o conectó por última vez, o `null` si ninguna.
 *
 * La base local es una sola para todas las pestañas del navegador, y su marca de origen es una sola
 * fila. Si otra pestaña conecta o descarga OTRO tenant, vacía y reescribe lo de esta; sin esto, esta
 * pestaña seguiría leyendo —y analizando— datos del otro tenant como si fueran suyos. Con esto, cada
 * lectura y cada escritura comprueba que la marca guardada siga siendo la de esta pestaña.
 */
let esperado = null

/** Lo que se lanza cuando otra pestaña cambió el origen de lo guardado. */
export class OrigenCambiado extends Error {
  constructor() {
    super('Los datos guardados en este navegador ya no son de este tenant: otra pestaña conectó a otro '
      + 'destino. Vuelve a conectar y a descargar en esta pestaña para no mezclar datos de dos tenants.')
    this.name = 'OrigenCambiado'
  }
}

/** Rechaza la promesa si la transacción se aborta o falla, en vez de dejarla colgada. */
function alFallar(tx, rechazar) {
  tx.onabort = () => rechazar(tx.error ?? new Error('La base local abortó la operación.'))
  tx.onerror = () => rechazar(tx.error ?? new Error('La base local falló.'))
}

/** Envuelve una petición de IndexedDB en una promesa. */
function comoPromesa(peticion, tx) {
  return new Promise((resolver, rechazar) => {
    if (tx) alFallar(tx, rechazar)
    peticion.onsuccess = () => resolver(peticion.result)
    peticion.onerror = () => rechazar(peticion.error)
  })
}

/** Abre la base, creando las tablas que falten. Se reutiliza la conexión. */
export function abrirBase() {
  if (conexion) return Promise.resolve(conexion)

  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(NOMBRE_DE_LA_BASE, VERSION_DEL_ESQUEMA)

    peticion.onupgradeneeded = (evento) => {
      const base = peticion.result
      // Las tres tablas de vista de la red existían antes (versión 3) con otra forma. Al subir a 5 se
      // recrean: con datos de vistas viejas, un análisis nuevo se mezclaría con lo anterior.
      if ((evento.oldVersion ?? 0) > 0 && (evento.oldVersion ?? 0) < 5) {
        for (const nombre of TABLAS_DE_VISTA_A_RECREAR) {
          if (base.objectStoreNames.contains(nombre)) base.deleteObjectStore(nombre)
        }
      }
      // Migración: fuera las tablas de versiones anteriores que ya nadie lee. Solo las que se conocen por
      // su nombre; cualquier otra se deja como está.
      for (const nombre of TABLAS_OBSOLETAS) {
        if (base.objectStoreNames.contains(nombre)) base.deleteObjectStore(nombre)
      }
      for (const tabla of todasLasTablas()) {
        const almacen = base.objectStoreNames.contains(tabla.nombre)
          ? peticion.transaction.objectStore(tabla.nombre)
          : base.createObjectStore(tabla.nombre, tabla.clave
            ? { keyPath: tabla.clave }
            : { autoIncrement: true })

        for (const indice of tabla.indices ?? []) {
          if (!almacen.indexNames.contains(indice.nombre)) {
            almacen.createIndex(indice.nombre, indice.campo, { unique: false })
          }
        }
      }
    }

    peticion.onsuccess = () => {
      const base = peticion.result
      // Si otra pestaña necesita actualizar el esquema, esta conexión se aparta. Sin esto, es esta
      // pestaña la que la bloquea y la otra se queda esperando sin explicación.
      base.onversionchange = () => {
        try { base.close() } catch { /* ya estaba cerrada */ }
        conexion = null
      }
      conexion = base
      resolver(base)
    }

    peticion.onerror = () => rechazar(peticion.error)
    peticion.onblocked = () => rechazar(new Error(
      'Hay otra pestaña de la aplicación con la base local abierta. Ciérrala y vuelve a intentar.',
    ))
  })
}

/** Suelta la conexión. Para los tests y para cuando se quiere forzar una reapertura. */
export function olvidarBase() {
  try { conexion?.close() } catch { /* da igual */ }
  conexion = null
  esperado = null
}

/** La marca que hay guardada, leída sin pasar por la comprobación (la usa la propia comprobación). */
async function marcaGuardada() {
  const base = await abrirBase()
  const tx = base.transaction(TABLA_DE_ORIGEN, 'readonly')
  const fila = await comoPromesa(tx.objectStore(TABLA_DE_ORIGEN).get('actual'), tx)
  return fila?.marca ?? null
}

/**
 * Comprueba que lo guardado siga siendo del origen que esta pestaña espera. Si no hay origen esperado
 * —nadie conectó todavía— no hay con qué comparar y no se comprueba nada.
 */
async function exigirOrigen() {
  if (esperado === null) return
  if ((await marcaGuardada()) !== esperado) throw new OrigenCambiado()
}

/** Comprueba el nombre antes de abrir una transacción condenada a fallar. */
function exigirTabla(tabla) {
  if (!existeLaTabla(tabla)) throw new Error(`No existe la tabla local "${tabla}".`)
}

/** Vacía una tabla. */
export async function vaciar(tabla) {
  exigirTabla(tabla)
  const base = await abrirBase()
  const tx = base.transaction(tabla, 'readwrite')
  await comoPromesa(tx.objectStore(tabla).clear(), tx)
}

/**
 * Guarda registros, en lotes.
 *
 * Se parte porque una transacción con cientos de miles de `put` mantiene todo pendiente hasta el
 * final: con lotes, lo escrito se va confirmando y la memoria no crece con el conjunto.
 */
export async function guardar(tabla, registros) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const filas = registros ?? []
  if (filas.length === 0) return 0

  const base = await abrirBase()

  for (let desde = 0; desde < filas.length; desde += POR_LOTE) {
    const lote = filas.slice(desde, desde + POR_LOTE)
    // Un lote por vez y esperando: es justamente lo que acota la memoria. Lanzarlos todos a la vez
    // dejaría de nuevo el conjunto entero pendiente, que es lo que se quería evitar.
    await new Promise((resolver, rechazar) => {
      const tx = base.transaction(tabla, 'readwrite')
      const almacen = tx.objectStore(tabla)
      alFallar(tx, rechazar)
      tx.oncomplete = () => resolver()
      for (const fila of lote) almacen.put(fila)
    })
  }

  return filas.length
}

/** Un registro por su clave. */
export async function leerUno(tabla, clave) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const base = await abrirBase()
  const tx = base.transaction(tabla, 'readonly')
  return comoPromesa(tx.objectStore(tabla).get(clave), tx)
}

/**
 * Los registros que coinciden con un valor de un índice.
 *
 * Se usa para lo ACOTADO —los componentes de una fuente, las ubicaciones de un producto—, que es
 * pequeño por definición. Para recorrer una tabla entera está `porCursor`.
 */
export async function leerPorIndice(tabla, indice, valor) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const base = await abrirBase()
  const tx = base.transaction(tabla, 'readonly')
  return comoPromesa(tx.objectStore(tabla).index(indice).getAll(valor), tx)
}

/** Cuántos registros hay, sin traerlos. */
export async function contar(tabla, { indice, valor } = {}) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const base = await abrirBase()
  const tx = base.transaction(tabla, 'readonly')
  const almacen = tx.objectStore(tabla)
  const donde = indice ? almacen.index(indice) : almacen
  return comoPromesa(valor === undefined ? donde.count() : donde.count(valor), tx)
}

/**
 * Recorre una tabla entera pasando cada registro a `porCadaUno`, sin acumularla.
 *
 * Es la operación central de toda esta capa: es lo que permite analizar doscientas mil filas sin
 * tenerlas nunca juntas. Si `porCadaUno` devuelve `false`, se corta —sirve para "busca el primero
 * que cumpla" sin recorrer el resto—.
 */
export async function porCursor(tabla, porCadaUno, { indice, valor } = {}) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const base = await abrirBase()

  return new Promise((resolver, rechazar) => {
    const tx = base.transaction(tabla, 'readonly')
    alFallar(tx, rechazar)

    const almacen = tx.objectStore(tabla)
    const donde = indice ? almacen.index(indice) : almacen
    const peticion = valor === undefined ? donde.openCursor() : donde.openCursor(valor)

    let vistos = 0
    peticion.onsuccess = () => {
      const cursor = peticion.result
      if (!cursor) {
        resolver(vistos)
        return
      }

      vistos += 1
      if (porCadaUno(cursor.value, vistos - 1) === false) {
        resolver(vistos)
        return
      }
      cursor.continue()
    }
    peticion.onerror = () => rechazar(peticion.error)
  })
}

/**
 * Un tramo de una tabla, para paginar desde el disco (`idbCursorPage` de v7).
 *
 * Salta con `advance` en vez de traer todo y cortar: el navegador salta las filas sin entregarlas, que
 * es lo que hace barato llegar a la página 9.000 de 450.000 filas. Traer todo costaría la tabla entera
 * en memoria.
 */
export async function leerTramo(tabla, { desde = 0, cuantos = 100, indice, valor } = {}) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const base = await abrirBase()

  return new Promise((resolver, rechazar) => {
    const tx = base.transaction(tabla, 'readonly')
    alFallar(tx, rechazar)

    const almacen = tx.objectStore(tabla)
    const donde = indice ? almacen.index(indice) : almacen
    const peticion = valor === undefined ? donde.openCursor() : donde.openCursor(valor)

    const filas = []
    let saltado = desde <= 0
    peticion.onsuccess = () => {
      const cursor = peticion.result
      if (!cursor) { resolver(filas); return }
      if (!saltado) { saltado = true; cursor.advance(desde); return }
      filas.push(cursor.value)
      if (filas.length >= cuantos) { resolver(filas); return }
      cursor.continue()
    }
    peticion.onerror = () => rechazar(peticion.error)
  })
}

/**
 * Busca por cursor las filas que cumplen `prueba`, con tope de coincidencias y de filas revisadas
 * (`idbCursorScanMatch` de v7). Devuelve `{ filas, truncada }`: `truncada` es verdadera si se cortó por
 * alguno de los dos topes, y entonces el resultado es parcial. La memoria queda acotada por `maximo`.
 */
export async function buscarEnTabla(tabla, prueba, { indice, valor, maximo = 2000, escanear = 300000 } = {}) {
  exigirTabla(tabla)
  if (tabla !== TABLA_DE_ORIGEN) await exigirOrigen()
  const base = await abrirBase()

  return new Promise((resolver, rechazar) => {
    const tx = base.transaction(tabla, 'readonly')
    alFallar(tx, rechazar)

    const almacen = tx.objectStore(tabla)
    const donde = indice ? almacen.index(indice) : almacen
    const peticion = valor === undefined ? donde.openCursor() : donde.openCursor(valor)

    const filas = []
    let revisadas = 0
    peticion.onsuccess = () => {
      const cursor = peticion.result
      if (!cursor) { resolver({ filas, truncada: false }); return }
      revisadas += 1
      if (prueba(cursor.value)) filas.push(cursor.value)
      if (filas.length >= maximo || revisadas >= escanear) { resolver({ filas, truncada: true }); return }
      cursor.continue()
    }
    peticion.onerror = () => rechazar(peticion.error)
  })
}

/** A qué tenant, área y versión pertenece lo guardado. `null` si no hay nada. */
export async function origenGuardado() {
  return marcaGuardada()
}

/** Anota de dónde salió lo que se acaba de guardar. */
export async function anotarOrigen(origen) {
  const base = await abrirBase()
  const tx = base.transaction(TABLA_DE_ORIGEN, 'readwrite')
  await comoPromesa(
    tx.objectStore(TABLA_DE_ORIGEN).put({ id: 'actual', marca: marcaDeOrigen(origen), fecha: new Date().toISOString() }),
    tx,
  )
  // Desde aquí, esta pestaña espera ESTE origen: si otro lo cambia, sus lecturas y escrituras fallan.
  esperado = marcaDeOrigen(origen)
}

/**
 * Borra TODA la base local, incluida la marca de origen. Es lo que se hace al cerrar la sesión: lo
 * descargado es del cliente, y no debe quedar en el navegador para quien use el equipo después.
 */
export async function borrarBaseLocal() {
  olvidarBase()
  await new Promise((resolver, rechazar) => {
    const peticion = indexedDB.deleteDatabase(NOMBRE_DE_LA_BASE)
    peticion.onsuccess = () => resolver()
    peticion.onerror = () => rechazar(peticion.error)
    // Otra pestaña la tiene abierta: su conexión se aparta sola al recibir `versionchange`, y el borrado
    // sigue en cuanto lo hace. No es un fallo, solo hay que esperar.
    peticion.onblocked = () => {}
  })
}

/** Vacía TODAS las tablas de datos y de vista, y olvida la marca de origen. */
export async function vaciarTodo() {
  // Una por una: vaciar treinta tablas en una sola transacción la deja tomada un rato largo, y
  // cualquier lectura que llegue mientras tanto espera.
  for (const tabla of todasLasTablas()) {
    await vaciar(tabla.nombre)
  }
}

/**
 * Deja la base lista para recibir los datos de ese origen.
 *
 * Si lo guardado es de otro tenant, otra área u otra versión, se borra: son datos de otro sitio, no
 * una versión vieja de los mismos, y mezclarlos no se notaría hasta que alguien lea un número raro.
 * Devuelve si había que borrar, para que la pantalla pueda decirlo.
 */
export async function prepararPara(origen) {
  const guardada = await origenGuardado()
  const sirve = mismoOrigen(guardada, origen)

  if (!sirve && guardada !== null) await vaciarTodo()
  await anotarOrigen(origen)

  return { seVacio: !sirve && guardada !== null, habiaOtro: guardada }
}

/**
 * Al CONECTAR: TODO lo guardado en este navegador se borra, sea de donde sea.
 *
 * Es el `resetAllModules()` que v7 llamaba al conectar: cada conexión arranca desde el primer paso del
 * mapeo, con la búsqueda y las tablas ocultas hasta que se pulsa «Descargar». Antes solo se borraba
 * lo de OTRO tenant, área o versión, y lo del mismo destino sobrevivía: al reconectar aparecía el
 * buscador del Production Visualizer con lo bajado en una sesión anterior, antes de descargar nada
 * (visto por el usuario el 2026-10-05). Por eso ya no se compara el origen.
 *
 * Solo corre al CONECTAR o cambiar de tenant, área o versión. Navegar entre las aplicaciones de Data
 * Tools no pasa por aquí, así que lo descargado en la sesión sigue ahí al volver. Y `prepararPara`
 * —la del momento de descargar— SÍ conserva lo del mismo origen: una segunda descarga de la sesión no
 * tiene por qué tirar la primera.
 */
export async function reiniciarAlConectar(origen) {
  await vaciarTodo()
  await anotarOrigen(origen)
  return { seVacio: true }
}
