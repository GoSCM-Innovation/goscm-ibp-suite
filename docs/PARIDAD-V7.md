# Paridad con v7 (`ibp-bom-v7`)

Inventario recorrido contra `origin/master` de v7, en `GoSCM-Innovation/ibp-bom-v7` —**no** el clon
local, que está anidado un nivel más abajo (`ibp-bom-v7/ibp-bom-v7`) y puede estar atrasado—.

Última revisión: 2026-08-12, contra `6d027d2` de v7. Son **20 archivos** en `public/js/` que suman
**20.643 líneas** de JavaScript sin build, más `server.js` y las plantillas de `public/`.

v7 es la migración más grande de las tres: casi tanto código como v8 y v9 juntos, y sin una sola
prueba. Por eso se porta módulo a módulo, y cada uno con sus pruebas antes de darlo por hecho.

## Los ocho módulos de v7

| Módulo (nombre en su menú) | Archivo | Líneas | Estado |
|---|---|---|---|
| Production Visualizer | `bom.js` | 1.594 | **Portado** — `core/ibp/bom-tree.js` + `src/lib/bom-load.js` + `data/BomTree.jsx` |
| Production Analyzer | `prodAnalyzer.js` | 2.789 | Pendiente |
| Network Visualizer | `visualizer.js` | 1.448 | Pendiente |
| Network Analyzer | `analyzer.js` + `snWebView.js` | 3.531 | Pendiente |
| Glosario Analyzers | `glosario.js` | 1.409 | Pendiente |
| Planning Area Documenter | `paDoc.js` | 1.055 | Pendiente |
| Mapping Dataflow Generator | `docs.js` | 2.527 | **Portado** (llegó por v9) — `cids/documenter/*` |
| Integration Explorer | `explorer.js` | 1.724 | **Portado** (llegó por v9) — `cids/explorer/*` |

Los dos últimos ya estaban: v9 se los había llevado de v7, y al cerrar v9 quedaron reescritos a React.
Ver [`PARIDAD-V9.md`](PARIDAD-V9.md).

## Lo transversal, ya portado

| v7 | Aquí | Notas |
|---|---|---|
| `api.js` (cliente OData, paginación) | `core/ibp/*`, `core/transport/*` | |
| `server.js` (proxy Express monolítico) | `api/ibp/*` | Un endpoint por operación |
| `state.js` (`CFG` global con la conexión) | `core/connections/*` | Cifradas en Postgres, nunca en el navegador |
| `fieldmap.js`, `extraFields.js`, `mattype-config.js` | `core/ibp/explorer-entities.js`, `explorer-fields.js` | Resolución por papel, no por nombre fijo |
| `utils.js`, `theme.js`, `i18n.js` | `src/index.css`, `src/lib/*` | El idioma es una fase propia al final |
| `runSummary.js`, `statsSheet.js` | `src/lib/cids-stats.js`, `xlsx.js` | |

## Cómo se porta el árbol de materiales

Las cinco reglas de SAP que gobiernan el árbol están codificadas como guardas en
`core/ibp/bom-tree.js`, con una prueba por regla:

1. Una receta se identifica por `SOURCEID`, no por producto.
2. **La planta manda**: los componentes se buscan solo entre las recetas de la misma planta que la
   raíz. Sin eso, el árbol de una planta se llena de recetas de otra.
3. Un producto es raíz en una planta si tiene receta ahí y no es componente de nadie ahí.
4. Una receta se construye una vez por planta, aunque figure bajo varios productos.
5. Un componente sin receta en esa planta es una hoja: se compra o es materia prima.

### Dos cosas que se corrigen respecto de v7

- **Los ciclos se enseñan.** v7 detectaba que un componente volvía a una receta ya visitada y
  devolvía `null`: la rama desaparecía del árbol sin decir nada, y su lista de ciclos se declaraba
  (`var cycles = []`) y no se llenaba nunca. Un árbol al que le falta una rama en silencio se entrega
  como si estuviera completo. Aquí el nodo se devuelve marcado, con a qué receta vuelve, y la pantalla
  lista los ciclos encontrados.
- **La raíz de una receta con coproductos no la decide el alfabeto.** v7 recorría los productos
  ordenados y encabezaba la receta con el primero que pillaba, así que una receta cuyo producto
  principal es `TERMINADO` y su coproducto `ASERRIN` salía encabezada por el aserrín. Aquí encabeza el
  producto principal si él mismo puede ser raíz; si es componente en esa planta, encabeza el primer
  coproducto que sí pueda —que es correcto: la receta produce algo que nadie consume—.

## Sin estrenar

Nada del árbol escribe en SAP: trabaja sobre lo que quedó descargado en el navegador.
