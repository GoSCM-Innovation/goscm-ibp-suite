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
| Production Analyzer | `prodAnalyzer.js` | 2.789 | **Portado (la hoja de productos)** — `core/ibp/production-rules.js` + `production-analysis.js` + `data/ProductionAnalyzer.jsx` |
| Network Visualizer | `visualizer.js` | 1.448 | **Portado** — `core/ibp/supply-network.js` + `src/lib/network-load.js` + `data/SupplyNetwork.jsx` |
| Network Analyzer | `analyzer.js` + `snWebView.js` | 3.531 | **Portado (la hoja de productos)** — `core/ibp/network-analysis.js` + `src/lib/network-analyze.js` |
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

## Cómo se porta la red de suministro

Tres reglas, cada una con prueba:

1. Una ubicación **no** se clasifica por su nombre ni por dónde aparece, sino por el maestro:
   `LOCTYPE = V` es proveedor; si fabrica el producto, planta; el resto, ubicación.
2. Un arco de proveedor solo se dibuja si va a una **planta** y si lo que trae es de verdad un
   componente de la receta **de esa planta**. Sin eso, cualquier proveedor del tenant cuelga de
   cualquier planta y la red deja de decir nada.
3. Los arcos de un mismo proveedor a una misma planta se juntan en **uno** que lista los componentes.
   Un proveedor que trae once materiales son once flechas encima de la misma.

### Diferencias deliberadas

- **Columnas en vez de lienzo.** v7 usaba `vis-network` desde un CDN y colocaba los nodos con
  baricentros para reducir cruces. Aquí se dibujan cinco columnas —proveedores, plantas, ubicaciones,
  producto, clientes— porque una red de suministro se lee de izquierda a derecha, y un lienzo con nodos
  arrastrables invita a moverlos: dos personas mirando el mismo dato acaban viendo dibujos distintos.
- **Los arcos también se listan.** En una red real son decenas. «¿De dónde le llega a esta planta?» se
  contesta antes leyendo una lista que persiguiendo flechas.
- **Los nodos sueltos se nombran.** En v7 aparecían en una esquina y nadie decía qué eran. Un nodo sin
  arcos es un dato incompleto en SAP, y decirlo es más útil que dibujarlo.

### Dos campos que hubo que añadir a la descarga

Ninguno se inventó: los dos son los que leía v7, comprobados antes en el tenant.

- `LOCTYPE` en el maestro de ubicaciones. Es lo único que distingue un proveedor de una planta. En el
  tenant de pruebas, 137 de 481 ubicaciones son proveedores.
- El **maestro de clientes** (`AS1CUSTOMER`, 631 filas) con su descripción. Sin él la red enseñaba
  códigos de cliente, y un mapa de a quién le vendés en el que los clientes son números no sirve para
  hablarlo con nadie.

## Cómo se porta el analizador de la jerarquía

Lo que hace es contestar, producto a producto: **¿está listo para que SAP planifique con él?** Y la
respuesta depende de **qué es** el material, que es lo que decide la matriz de
`core/ibp/production-rules.js`.

Esa matriz es la pieza con más criterio de negocio del proyecto y la que menos código tiene: cuatro
categorías —producto terminado, semiterminado, materia prima, mercadería— por trece comprobaciones,
y cada casilla dice si eso es error, aviso o **no se mira**. El `no se mira` es tan importante como el
rojo: es lo que evita que una materia prima salga con veinte errores por no tener receta.

Decisiones que se conservan de v7:

- **La clasificación la hace el consultor, no se adivina.** Los tipos de material son del cliente
  (`FERT`, `HALB`, `ROH`, `ZEMP`…) y sin saber qué son el informe no vale. Se dice una vez por área de
  planificación y se guarda.
- **Un tipo en dos categorías gana la exigencia más suave.** Marcar en rojo algo que en una de sus
  lecturas es correcto llena el informe de ruido, y un informe con ruido no se lee.
- **Un tipo sin clasificar no se calla ni se marca en rojo**: lo que a otros sería error, a él le sale
  como aviso. Nadie ha dicho todavía qué es.

Diferencias deliberadas:

- **No se bajan las tablas por tercera vez.** v7 bajaba PSH, PSI y PSR otra vez para este análisis,
  además de las del árbol y las de la red. Aquí se cruzan las ya descargadas: bajar tres veces la
  misma tabla es exactamente la duplicación que esta arquitectura vino a quitar.
- **Una fila por producto, no una por problema.** Un producto con cinco cosas mal es un producto que
  hay que arreglar, no cinco. Sale con la severidad peor y la lista de lo que le falta.
- **El informe se guarda en la base local y se lee por tramos.** Es la arquitectura de IndexedDB que ya
  usaba el resto: la tabla de vista guarda la fila calculada con su severidad indexada, así que filtrar
  «solo los errores» no recorre nada.
- **Se dice qué comprobación falla más.** Si nueve de cada diez rojos son la misma cosa, el trabajo no
  es revisar mil productos: es cargar una tabla.

### El analizador de la red

Es el hermano del anterior y comparte con él la clasificación de tipos de material: se hace **una vez**
y sirve para los dos. v7 tenía dos pantallas y pedía clasificar dos veces, con lo que las dos podían
acabar diciendo cosas distintas del mismo material.

Lo que contesta son preguntas de **grafo**, las que no se pueden ver en una tabla:

- ¿Desde las plantas que lo fabrican se llega a algún cliente?
- ¿Hay bodegas que reciben producto y no lo mandan a ninguna parte? (**callejones**)
- ¿Hay bodegas alimentadas cuya salida no lleva a ningún cliente? (**nodos sin salida útil** — el
  hallazgo que nadie ve a mano: la bodega existe, tiene entrada y salida, y el producto que entra no
  puede terminar en un cliente)
- ¿Hay **ciclos**: A manda a B, B a C y C vuelve a A?
- ¿Hay plantas que fabrican y no tienen salida hacia ningún cliente?

Todas salen de recorrer el grafo dos veces: hacia adelante desde las plantas y hacia atrás desde los
clientes. Lo que queda fuera de la intersección es lo que hay que arreglar.

La **máquina de estados** de v7 se conserva con sus nombres —«Red completa», «Semiterminado local»,
«Abastecimiento parcial», «Huérfano»…— porque cada rama contesta la pregunta que le toca a ese tipo de
material: un terminado necesita ruta a cliente, un insumo un arco de abastecimiento, un semiterminado
consumo local o transferencia. Preguntarles lo mismo a los tres no diría nada de ninguno.

### Lo que falta de estos dos módulos

v7 sacaba un Excel de ocho hojas: una por entidad (producto, ubicación, recurso, recurso-ubicación,
cabecera, componente, recurso de receta) más la de tipos excluidos. **Aquí está la de productos**, que
es la que contesta la pregunta del consultor —«qué materiales están mal armados»—; las otras siete son
vistas por tabla de los mismos problemas. Quedan pendientes, y el andamio para ellas ya existe: las
tablas de vista `pa_location_web`, `pa_resource_web`, `pa_resloc_web`, `pa_psh_web`, `pa_psi_web` y
`pa_psr_web` están declaradas en el esquema local.

## Sin estrenar

Nada del árbol escribe en SAP: trabaja sobre lo que quedó descargado en el navegador.
