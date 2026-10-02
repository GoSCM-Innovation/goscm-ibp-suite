// Qué tarjetas lleva el panel «MAPEO DE ENTIDADES» de cada aplicación, con los nombres de v7.
//
// En v7 eran cuatro paneles distintos (`panelMDT`, `panelPAMDT`, `panelVizMDT`, `panelSNMDT`) con sus
// propias tarjetas, y no se parecían tanto como parece: el visualizador de la jerarquía tiene ocho, con
// la validez de los componentes y SIN el recurso por ubicación; el analizador de la jerarquía tiene diez,
// al revés, y las dos últimas son de la RED (producto por ubicación y arcos entre ubicaciones).
//
// El papel y el grupo son los de `core/ibp/explorer-entities.js`: la detección es una sola. Lo que
// cambia aquí es solo qué papeles se enseñan y cómo se llaman. Los nombres van en inglés porque así
// estaban en v7 —son los nombres de las entidades de SAP— y no se traducen.

/** `maestro`: v7 le añadía «(maestro)» en pequeño a la etiqueta. */
const t = (grupo, papel, etiqueta, maestro = false) => ({ grupo, papel, etiqueta, maestro })

/** La red de suministro: las mismas nueve tarjetas en el visualizador y en el analizador. */
const TARJETAS_DE_RED = [
  t('red', 'location', 'Location Source'),
  t('red', 'customer', 'Customer Source'),
  t('red', 'product', 'Product'),
  t('red', 'sourceProd', 'Production Source Header'),
  t('red', 'locMaster', 'Location'),
  t('red', 'custMaster', 'Customer'),
  t('red', 'sourceItem', 'Production Source Item'),
  t('red', 'locProd', 'Location Product'),
  t('red', 'custProd', 'Customer Product'),
]

export const MAPEO_V7 = Object.freeze({
  // Production Visualizer
  pv: {
    pista: 'La auto-detección asignó las entidades más probables. Ajusta manualmente si es necesario.',
    tarjetas: [
      t('arbol', 'header', 'Production Source Header'),
      t('arbol', 'item', 'Production Source Item'),
      t('arbol', 'itemValidity', 'Production Source Item Validity'),
      t('arbol', 'itemSub', 'Production Source Item Sub'),
      t('arbol', 'resource', 'Production Source Resource'),
      t('arbol', 'product', 'Product'),
      t('arbol', 'locMaster', 'Location', true),
      t('arbol', 'resMaster', 'Resource', true),
    ],
  },
  // Production Analyzer
  pa: {
    pista: 'La auto-detección asignó las entidades más probables. Ajusta manualmente si es necesario.',
    tarjetas: [
      t('arbol', 'header', 'Production Source Header'),
      t('arbol', 'item', 'Production Source Item'),
      t('arbol', 'itemSub', 'Production Source Item Sub'),
      t('arbol', 'resource', 'Production Source Resource'),
      t('arbol', 'product', 'Product'),
      t('arbol', 'locMaster', 'Location', true),
      t('arbol', 'resMaster', 'Resource', true),
      t('arbol', 'resLoc', 'Resource Location', true),
      t('red', 'locProd', 'Location Product'),
      t('red', 'location', 'Location Source'),
    ],
  },
  // Network Visualizer
  nv: {
    pista: 'Selecciona las entidades. La auto-detección asignó las más probables. Confirma para cargar el catálogo de productos.',
    tarjetas: TARJETAS_DE_RED,
  },
  // Network Analyzer
  na: {
    pista: 'Selecciona las entidades de datos maestros para analizar la red de suministro. La auto-detección asignó las más probables.',
    tarjetas: TARJETAS_DE_RED,
  },
})
