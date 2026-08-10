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

/**
 * Lo que se baja para cada módulo.
 *
 * `papel` es el que resuelve `explorer-entities.js`; `campos` son los CANÓNICOS y el mapa los traduce
 * a los de este tenant. `descartarSi` es el campo de invalidez, si la tabla tiene uno.
 *
 * `esencial` distingue lo que hace inútil al módulo de lo que solo lo empobrece: sin la cabecera de
 * receta no hay árbol que dibujar; sin la validez de los componentes el árbol se dibuja igual, solo
 * que sin fechas. Es lo que permite decir "se puede seguir, pero sin esto" en vez de parar todo.
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
    esencial: true,
  },
  {
    tabla: 'bom_psi_validity',
    grupo: 'arbol',
    papel: 'itemValidity',
    etiqueta: 'Validez de los componentes',
    campos: ['SOURCEID', 'PRDID', 'COMPVALIDFR', 'COMPVALIDTO'],
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
    esencial: false,
  },
  {
    tabla: 'bom_prd',
    grupo: 'arbol',
    papel: 'product',
    etiqueta: 'Maestro de productos',
    campos: ['PRDID', 'PRDDESCR', 'MATTYPEID', 'UOMID', 'UOMDESCR'],
    esencial: true,
  },
  {
    tabla: 'bom_loc',
    grupo: 'arbol',
    papel: 'locMaster',
    etiqueta: 'Maestro de ubicaciones',
    campos: ['LOCID', 'LOCDESCR', 'LOCVALID'],
    descartarSi: 'LOCVALID',
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
])

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
  const pasos = (EXTRACCIONES.filter((una) => grupos.includes(una.grupo))).map((una) => {
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
