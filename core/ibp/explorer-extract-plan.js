// Qué se baja de SAP a la base local, de qué tabla y con qué campos.
//
// Portado de `doFetchAll` de `main.js` de v7 y de la fase 1 de `analyzer.js`, donde estaba repartido
// entre dos funciones largas con el orden, los campos y los filtros entremezclados con el registro de
// progreso y el manejo de la interfaz.
//
// Aquí es una DECLARACIÓN: qué tabla local, de qué papel, con qué campos y qué filas se descartan.
// Que sea declaración es lo que permite comprobar el plan sin bajar nada y, sobre todo, contestar
// antes de empezar: "esto no se va a poder bajar, y por eso".
//
// Sin dependencias: lo usan el servidor, la pantalla y las pruebas.

import { armarSelect, campoReal } from './explorer-fields.js'

/**
 * Las filas que SAP marca como inválidas se descartan DESPUÉS de bajarlas.
 *
 * No se filtran en el `$filter` a propósito, y no es un descuido: en este servicio cualquier
 * predicado sobre un campo descarta también las filas donde ese campo está VACÍO, y lo normal es que
 * una fila válida tenga la marca vacía en vez de tenerla en `''`. Filtrar en SAP se llevaría casi
 * todo. Se baja todo y se descarta aquí, que es lo que hacía v7.
 */
export const MARCA_DE_INVALIDA = 'X'

/** Descarta las filas cuya marca de invalidez está puesta. */
export function descartarInvalidas(filas, campo) {
  if (!campo) return filas ?? []
  return (filas ?? []).filter((una) => una[campo] !== MARCA_DE_INVALIDA)
}

/** El valor de un campo como texto comparable. */
const clave = (valor) => (valor === null || valor === undefined ? '' : String(valor).trim())

/**
 * Se queda solo con las filas cuyo `campo` está en `claves`.
 *
 * Es cómo v7 ataba los componentes, la validez y los recursos a su cabecera: una receta que no
 * sobrevivió a `PINVALID` no debe dejar sus piezas sueltas en la base local. Y no es cosmético —
 * los analizadores recorren esas tablas ENTERAS, así que un componente que solo consume una receta
 * descartada contaría como consumido, y un recurso que solo usa una receta descartada contaría como
 * usado. Justo los veredictos que el informe da como hallazgo.
 */
export function soloDeClavesVivas(filas, campo, claves) {
  if (!campo || !claves) return filas ?? []
  return (filas ?? []).filter((una) => claves.has(clave(una[campo])))
}

/**
 * Qué campo tiene que recordar cada tabla porque otro paso se ata a ella.
 *
 * Se deduce de los `atadoA` del propio plan en vez de declararse aparte: una lista a mano y otra
 * derivada acaban discrepando, y el día que discrepen el paso dependiente se queda sin claves y
 * borra todas sus filas en silencio.
 */
export function clavesQueOtrosNecesitan(pasos) {
  const porTabla = new Map()
  for (const uno of pasos ?? []) {
    if (uno?.atadoA?.tabla && uno.atadoA.campo) porTabla.set(uno.atadoA.tabla, uno.atadoA.campo)
  }
  return porTabla
}

/** Las claves de `campo` que aparecen en `filas`, para atar a ellas los pasos que dependan. */
export function clavesDe(filas, campo) {
  const vistas = new Set()
  for (const una of filas ?? []) {
    const valor = clave(una[campo])
    if (valor) vistas.add(valor)
  }
  return vistas
}

/**
 * Lo que se baja para cada módulo.
 *
 * `papel` es el que resuelve `explorer-entities.js`; `campos` son los CANÓNICOS y el mapa los traduce
 * a los de este tenant. `descartarSi` es el campo de invalidez, si la tabla tiene uno.
 *
 * `esencial` distingue lo que hace inútil al módulo de lo que solo lo empobrece: sin la cabecera de
 * receta no hay árbol que dibujar; sin la validez de los componentes el árbol se dibuja igual, solo
 * que sin fechas. Es lo que permite decir "se puede seguir, pero sin esto" en vez de parar todo.
 *
 * `atadoA` dice que las filas de este paso solo valen si su clave está en una tabla ya bajada. El
 * paso del que dependen va ANTES en esta lista, y de eso depende que funcione.
 *
 * `tambienPara` son los grupos que además necesitan el paso. Los dos maestros compartidos —productos
 * y ubicaciones— los baja cualquiera de los dos grupos, porque en v7 la descarga de la red también
 * los traía y las pantallas de red los leen. Sin esto, bajar solo «Red de suministro» dejaba la red
 * sin descripciones y sin `LOCTYPE`, que es lo único que distingue un proveedor de una planta.
 */
export const EXTRACCIONES = Object.freeze([
  // ── Árbol de materiales ────────────────────────────────────────────────────
  {
    tabla: 'bom_psh',
    grupo: 'arbol',
    papel: 'header',
    etiqueta: 'Cabecera de receta',
    campos: ['PRDID', 'SOURCEID', 'LOCID', 'SOURCETYPE', 'OUTPUTCOEFFICIENT', 'PINVALID'],
    descartarSi: 'PINVALID',
    esencial: true,
  },
  {
    tabla: 'bom_psi',
    grupo: 'arbol',
    papel: 'item',
    etiqueta: 'Componentes de la receta',
    campos: ['SOURCEID', 'PRDID', 'COMPONENTCOEFFICIENT', 'ISALTITEM'],
    atadoA: { tabla: 'bom_psh', campo: 'SOURCEID' },
    esencial: true,
  },
  {
    tabla: 'bom_psi_validity',
    grupo: 'arbol',
    papel: 'itemValidity',
    etiqueta: 'Validez de los componentes',
    campos: ['SOURCEID', 'PRDID', 'COMPVALIDFR', 'COMPVALIDTO'],
    atadoA: { tabla: 'bom_psh', campo: 'SOURCEID' },
    esencial: false,
  },
  {
    tabla: 'bom_psisub',
    grupo: 'arbol',
    papel: 'itemSub',
    etiqueta: 'Sustitutos de componentes',
    campos: ['SOURCEID', 'PRDFR', 'SPRDFR'],
    esencial: false,
  },
  {
    tabla: 'bom_psr',
    grupo: 'arbol',
    papel: 'resource',
    etiqueta: 'Recursos de la receta',
    campos: ['SOURCEID', 'RESID'],
    atadoA: { tabla: 'bom_psh', campo: 'SOURCEID' },
    esencial: false,
  },
  {
    tabla: 'bom_prd',
    grupo: 'arbol',
    papel: 'product',
    etiqueta: 'Maestro de productos',
    campos: ['PRDID', 'PRDDESCR', 'MATTYPEID', 'UOMID', 'UOMDESCR'],
    // También lo baja el grupo de red: el analizador de la red clasifica por tipo de material y el
    // visualizador enseña la descripción. En v7 la descarga de la red traía su propio Product.
    tambienPara: ['red'],
    esencial: true,
  },
  {
    tabla: 'bom_loc',
    grupo: 'arbol',
    papel: 'locMaster',
    etiqueta: 'Maestro de ubicaciones',
    // `LOCTYPE` es lo que distingue un PROVEEDOR de una planta o un almacén: en SAP vale `V` para los
    // proveedores y viene vacío para el resto. Sin él, la red de suministro no puede dibujar de dónde
    // entra la materia prima, que es media red.
    campos: ['LOCID', 'LOCDESCR', 'LOCTYPE', 'LOCVALID'],
    descartarSi: 'LOCVALID',
    // Igual que el maestro de productos: la red lo lee entero por cursor y sin `LOCTYPE` no puede
    // dibujar de dónde entra la materia prima.
    tambienPara: ['red'],
    esencial: false,
  },
  {
    tabla: 'bom_res',
    grupo: 'arbol',
    papel: 'resMaster',
    etiqueta: 'Maestro de recursos',
    // El maestro de recursos tiene el código y la descripción, y nada más que sirva aquí. En particular
    // NO tiene el tipo de recurso: comprobado contra dos tenants, el tipo vive en `RESOURCETYPE` de
    // Resource Location, porque en IBP un mismo recurso puede ser de un tipo distinto en cada planta.
    campos: ['RESID', 'RESDESCR'],
    esencial: false,
  },
  {
    tabla: 'bom_resloc',
    grupo: 'arbol',
    papel: 'resLoc',
    etiqueta: 'Recurso por ubicación',
    // Estas dos son tablas de cientos de filas, no de decenas de miles, y son lo único que permite
    // ver un recurso ASIGNADO a una planta que ninguna receta usa. `bom_psr` solo trae los recursos
    // que ya están en una receta, así que por definición no puede enseñar los que sobran.
    campos: ['RESID', 'LOCID', 'RESOURCETYPE'],
    esencial: false,
  },

  // ── Red de suministro ──────────────────────────────────────────────────────
  {
    tabla: 'sn_loc',
    grupo: 'red',
    papel: 'location',
    etiqueta: 'Arcos entre ubicaciones',
    campos: ['LOCID', 'LOCFR', 'PRDID', 'TLEADTIME', 'TINVALID'],
    descartarSi: 'TINVALID',
    esencial: true,
  },
  {
    tabla: 'sn_cust',
    grupo: 'red',
    papel: 'customer',
    etiqueta: 'Arcos hacia clientes',
    campos: ['LOCID', 'PRDID', 'CUSTID', 'CLEADTIME', 'CINVALID'],
    descartarSi: 'CINVALID',
    esencial: true,
  },
  {
    tabla: 'sn_plant',
    grupo: 'red',
    papel: 'sourceProd',
    etiqueta: 'Recetas por planta',
    campos: ['SOURCEID', 'PRDID', 'LOCID', 'PLEADTIME', 'PRATIO', 'PINVALID'],
    descartarSi: 'PINVALID',
    esencial: true,
  },
  {
    tabla: 'sn_psi',
    grupo: 'red',
    papel: 'sourceItem',
    etiqueta: 'Componentes de la receta',
    campos: ['SOURCEID', 'PRDID', 'COMPONENTCOEFFICIENT'],
    // La nota de v7 en este mismo paso decía «Solo SOURCEIDs activos en PSH».
    atadoA: { tabla: 'sn_plant', campo: 'SOURCEID' },
    esencial: false,
  },
  {
    tabla: 'sn_loc_prod',
    grupo: 'red',
    papel: 'locProd',
    etiqueta: 'Producto por ubicación',
    campos: ['LOCID', 'PRDID'],
    esencial: false,
  },
  {
    tabla: 'sn_cust_prod',
    grupo: 'red',
    papel: 'custProd',
    etiqueta: 'Producto por cliente',
    campos: ['CUSTID', 'PRDID'],
    esencial: false,
  },
  {
    tabla: 'sn_cust_master',
    grupo: 'red',
    papel: 'custMaster',
    etiqueta: 'Maestro de clientes',
    // Sin la descripción, la red enseña códigos de cliente. Un mapa de a quién le vendes en el que
    // los clientes son números no sirve para hablarlo con nadie.
    campos: ['CUSTID', 'CUSTDESCR', 'CUSTVALID'],
    descartarSi: 'CUSTVALID',
    esencial: false,
  },
])

/**
 * Si lo que se bajó dice que la VERSIÓN está vacía, y no que falte una tabla suelta.
 *
 * Son dos cosas distintas y se leen igual en pantalla si nadie las separa. Que una tabla accesoria
 * venga en cero es normal —hay áreas sin producto por cliente—. Que vengan en cero TODAS las
 * esenciales no es un dato: es que se eligió una versión sin nada dentro.
 *
 * Medido en el tenant de pruebas: de las seis versiones con nombre de `ASIBPTS`, dos —`BACKUPVSEM` y
 * `UPSIDE`— no tienen ni una fila. Sin este aviso, elegir una de ellas deja un informe en blanco y
 * la herramienta parece rota; el consultor no tiene forma de saber que el problema es su elección.
 */
export function versionSinDatos(pasos, hechos) {
  const esenciales = (pasos ?? []).filter((uno) => uno.esencial && uno.sePuede)
  if (esenciales.length === 0) return { vacia: false, tablas: [] }

  const filasDe = (tabla) => (hechos ?? []).find((uno) => uno.tabla === tabla)

  // Si alguna esencial ni siquiera se intentó —cancelada o con error— no se puede concluir nada:
  // decir «la versión está vacía» cuando en realidad se cortó la descarga sería peor que callarse.
  const suyos = esenciales.map((uno) => filasDe(uno.tabla))
  if (suyos.some((uno) => !uno || uno.error || uno.cancelado)) return { vacia: false, tablas: [] }

  const vacia = suyos.every((uno) => (uno.bajadas ?? 0) === 0)
  return { vacia, tablas: vacia ? esenciales.map((uno) => uno.etiqueta) : [] }
}

/**
 * Los grupos que necesitan un paso: el suyo, más los de `tambienPara`.
 *
 * `grupo` sigue siendo el dueño —de él sale la resolución del papel y de él depende que un grupo sea
 * imposible por faltarle algo esencial—. `tambienPara` solo AÑADE la descarga, y esa distinción es a
 * propósito: que la red no pueda dibujar descripciones no es motivo para prohibir bajar la red.
 */
export const gruposQueLoNecesitan = (paso) => (paso?.tambienPara?.length
  ? [paso.grupo, ...paso.tambienPara]
  : [paso.grupo])

/** Los grupos que se pueden bajar, con su nombre visible. */
export const GRUPOS_DE_EXTRACCION = Object.freeze([
  { id: 'arbol', label: 'Árbol de materiales' },
  { id: 'red', label: 'Red de suministro' },
])

/**
 * Convierte el plan en peticiones concretas contra ESTE tenant.
 *
 * Cada entrada sale con la tabla de SAP de verdad, los nombres de campo de verdad, y —si no se puede
 * bajar— el motivo. Lo que se salta se dice ANTES de empezar: enterarse a los seis minutos de que
 * falta la tabla principal, después de bajar tres tablas que no sirven sin ella, es la diferencia
 * entre una herramienta y un castigo.
 */
export function planificarExtraccion({ efectivo, mapa = {}, grupos = ['arbol', 'red'] } = {}) {
  const pasos = (EXTRACCIONES.filter((una) => gruposQueLoNecesitan(una)
    .some((grupo) => grupos.includes(grupo)))).map((una) => {
    const entidad = efectivo?.[una.grupo]?.[una.papel]?.entidad ?? null

    if (!entidad) {
      return {
        ...una,
        entidad: null,
        select: [],
        omitidos: [],
        sePuede: false,
        motivo: `No hay ninguna tabla de este tenant que cumpla el papel «${una.etiqueta}».`,
      }
    }

    const select = armarSelect(mapa, entidad, una.campos)
    // Los campos que este tenant no tiene. No impiden bajar: se avisa de qué se pierde con ellos.
    const omitidos = una.campos.filter((campo) => campoReal(mapa, entidad, campo) === null)

    return {
      ...una,
      entidad,
      select,
      omitidos,
      // La marca de invalidez solo se aplica si el campo existe de verdad; si no, no hay nada que
      // descartar y quedarse con todo es lo correcto.
      descartarSi: una.descartarSi && !omitidos.includes(una.descartarSi)
        ? campoReal(mapa, entidad, una.descartarSi)
        : null,
      sePuede: true,
      motivo: '',
    }
  })

  const faltanEsenciales = pasos.filter((uno) => !uno.sePuede && uno.esencial)

  return {
    pasos,
    // Qué grupos se pueden correr: uno al que le falta algo esencial no se puede.
    gruposPosibles: GRUPOS_DE_EXTRACCION
      .filter(({ id }) => grupos.includes(id) && !faltanEsenciales.some((uno) => uno.grupo === id))
      .map(({ id }) => id),
    // Lo que no se va a poder bajar, y lo que se va a bajar incompleto.
    avisos: [
      ...pasos.filter((uno) => !uno.sePuede)
        .map((uno) => `${uno.etiqueta}: ${uno.motivo}${uno.esencial ? ' Sin esto el módulo no funciona.' : ' Se puede seguir sin esto.'}`),
      ...pasos.filter((uno) => uno.sePuede && uno.omitidos.length > 0)
        .map((uno) => `${uno.etiqueta}: este tenant no tiene ${uno.omitidos.join(', ')}. Se baja sin esos campos.`),
    ],
  }
}
