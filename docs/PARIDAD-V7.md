# Paridad con v7 (`ibp-bom-v7`)

Inventario recorrido contra `origin/master` de v7, en `GoSCM-Innovation/ibp-bom-v7` —**no** el clon
local, que está anidado un nivel más abajo (`ibp-bom-v7/ibp-bom-v7`) y puede estar atrasado—.

Última revisión: 2026-08-18, contra `6d027d2` de v7 —el mismo commit que la vez anterior: v7 no ha
cambiado—. Son **20 archivos** en `public/js/` que suman **20.643 líneas** de JavaScript sin build, más
`server.js` y las plantillas de `public/`.

v7 es la migración más grande de las tres: casi tanto código como v8 y v9 juntos, y sin una sola
prueba. Por eso se porta módulo a módulo, y cada uno con sus pruebas antes de darlo por hecho.

**Los ocho módulos están portados, y con ellos v7 queda cerrado.** De las ocho hojas del Excel que
sacaban los analizadores se portaron las tres que contestan una pregunta propia —producto, ubicación y
recurso—; las otras cuatro eran la misma información vista desde otra tabla y se descartan a propósito,
con el motivo escrito en [Los informes por entidad](#los-informes-por-entidad).

## Los ocho módulos de v7

| Módulo (nombre en su menú) | Archivo | Líneas | Estado |
|---|---|---|---|
| Production Visualizer | `bom.js` | 1.594 | **Portado** — `core/ibp/bom-tree.js` + `src/lib/bom-load.js` + `data/BomTree.jsx` |
| Production Analyzer | `prodAnalyzer.js` | 2.789 | **Portado** — `core/ibp/production-rules.js` + `production-analysis.js` + `location-analysis.js` + `resource-analysis.js` + `data/ProductionAnalyzer.jsx` |
| Network Visualizer | `visualizer.js` | 1.448 | **Portado** — `core/ibp/supply-network.js` + `src/lib/network-load.js` + `data/SupplyNetwork.jsx` |
| Network Analyzer | `analyzer.js` + `snWebView.js` | 3.531 | **Portado** — `core/ibp/network-analysis.js` + `src/lib/network-analyze.js` |
| Glosario Analyzers | `glosario.js` | 1.409 | **Portado** — `data/Glosario.jsx`, derivado del código |
| Planning Area Documenter | `paDoc.js` | 1.055 | **Portado** — `core/ibp/pa-doc-model.js` + `src/lib/docx.js` + `pa-doc.js` + `data/PlanningAreaDoc.jsx` |
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

### Los informes por entidad

v7 sacaba un Excel de ocho hojas: una por entidad (producto, ubicación, recurso, recurso-ubicación,
cabecera, componente, recurso de receta) más la de tipos excluidos. Aquí las tres que contestan una
pregunta propia son pestañas de la misma pantalla; las otras cuatro eran vistas por tabla de los mismos
datos y no se portan (ver más abajo).

**Por ubicación** (`core/ibp/location-analysis.js`, pestaña 4) es el que más criterio propio tiene, y no
por las comprobaciones sino por lo que hace antes: el **rol de una ubicación no se lee de ningún campo
de SAP, se deduce de cómo se comporta**. SAP tiene `LOCTYPE`, pero solo distingue al proveedor; que algo
sea planta, nodo de transferencia o punto final no está escrito en ninguna parte.

| Rol | De qué se deduce |
| --- | --- |
| Planta de producción | Tiene recetas |
| Proveedor | Manda un producto que el destino **consume** en una receta suya |
| Nodo de transferencia | Manda un producto que el destino **no** consume |
| Nodo receptor | Recibe, y no produce ni manda |
| Nodo de recursos | Tiene recursos asignados o usados |
| Sin actividad | Solo está en el maestro |

La distinción entre **proveedor** y **nodo de transferencia** es la que da valor a la hoja: las dos
mandan material, pero solo una lo manda a donde se usa. La otra casi siempre esconde un arco de más o un
componente que falta en el BOM del destino. Una ubicación puede tener varios roles a la vez y entonces
se le exige lo de cada uno; preguntarle a todas lo mismo daría cientos de errores falsos, igual que en
el informe de productos.

**Por recurso** (`core/ibp/resource-analysis.js`, pestaña 5) son tres comprobaciones y aun así es el que
más rápido encuentra algo, porque un recurso vive en dos tablas que nadie mira juntas: la que dice qué
máquinas **usan** las recetas (`PRODUCTIONSOURCERESOURCE`) y la que dice qué máquinas están
**asignadas** a una planta (`RESOURCELOCATION`). Estar en una y no en la otra da un plan que no se puede
ejecutar —capacidad que no restringe, o capacidad que nunca se va a cargar— y SAP no lo avisa. El
universo que se recorre es la **unión** de las tres tablas y no el maestro: un recurso que una receta usa
y que no está en el maestro es justo el caso que se perdería.

Estas dos tablas se agregaron a la descarga del grupo «Árbol de materiales» (`bom_res`, `bom_resloc`).
Son de cientos de filas, no de decenas de miles. Comprobado contra dos tenants: el maestro de recursos
**no tiene el tipo de recurso**; está en `RESOURCETYPE` de Resource Location, porque en IBP el mismo
recurso puede ser de un tipo distinto en cada planta.

### Medido contra el tenant de pruebas

`my400444`, área `ASIBPTS`, con los cuatro tipos clasificados (`FERT` terminado, `HALB` semiterminado,
`ROH` insumo, `HAWA` mercadería). Los dos papeles nuevos resolvieron **por sus campos**, no por el
nombre: `AS1RESOURCE` y `AS1RESOURCELOCATION`.

| | Ubicaciones | Recursos |
|---|---|---|
| Analizados | 478 en 4,3 s | 545 en 0,3 s |
| Error / Aviso / Nota / Bien | 135 / 70 / 232 / 41 | 4 / 335 / 0 / 206 |

Lo que sale de ahí, y que es lo que hace creíble la deducción de roles:

- **144 nodos de transferencia y 45 proveedores**, y **27 ubicaciones con los dos roles a la vez** —
  mandan material que el destino consume *y* material que no—. Es el caso que el diseño predecía, y
  aparece solo porque los roles se acumulan en vez de elegir uno.
- Los 45 proveedores **no** son los 137 que tienen `LOCTYPE = V`: son los que además mandan algo que en
  el destino de verdad se consume. La diferencia es el hallazgo, no un error de conteo.
- **232 ubicaciones solo están en el maestro** y en ninguna otra tabla. Salen como nota, no como error:
  media ficha sin usar es normal en un maestro vivo.
- Con 7 plantas, las comprobaciones de planta dieron números pequeños y revisables: 7 recetas con plazo
  de producción en cero, 3 componentes sin arco que los traiga, 5 recursos asignados que nadie usa, 2
  recetas sin componentes y 2 sin recurso.
- De los 545 recursos, **335 no aparecen en ninguna receta** (aviso: capacidad que nadie planifica), **3
  están huérfanos** y **1 lo usan las recetas sin estar asignado a ninguna planta** (error: SAP no le
  aplica su restricción de capacidad).

Ninguna lista llegó al tope en este tenant, y las tres comprobaciones de coherencia cuadran: filas
guardadas = filas analizadas, suma de severidades = total, y todas las filas con las 11 columnas
declaradas.

**Lo que no se porta y por qué.** Las cuatro hojas restantes de v7 —recurso-ubicación, cabecera,
componente y recurso de receta— no contestan ninguna pregunta que las tres anteriores no contesten ya:
son la misma fila de datos vista desde la tabla en la que está guardada. La de cabeceras enumera las
recetas sin componentes que el informe por ubicación ya agrupa por planta; la de componentes enumera las
filas de `PSI` que el informe de productos ya cruza. Existían porque v7 volcaba un Excel y una hoja por
tabla era gratis; aquí cada pestaña cuesta una descarga y una explicación, y una que repite lo que la de
al lado ya dijo hace el informe peor, no más completo. Las tablas de vista `pa_resloc_web`,
`pa_psh_web`, `pa_psi_web` y `pa_psr_web` quedan declaradas en el esquema local por si un cliente las
pide con un motivo concreto.

## Cómo se porta el documentador del área

Produce un **Word** con la configuración del área: portada con el logo del cliente, índice, resumen
ejecutivo y una sección por cada parte de la configuración, más dos anexos.

Por qué los datos vienen de archivos y no de la API: la configuración de un área —los niveles de
planificación, las definiciones de cálculo, los operadores— **no está expuesta** en los servicios de
comunicación de IBP. Se exporta desde la pantalla de configuración del área, que saca una carpeta de
CSV. Es una limitación de SAP, no una decisión de esta herramienta, y la pantalla lo dice en vez de
dejar al consultor buscando un botón que no existe.

Lo que **sí** se lee en vivo son los trabajos programados, que tienen API —la misma de `SAP_COM_0326`
que usa el monitor—, así que el documento dice además con qué se carga y se ejecuta el área. De las 396
plantillas del tenant de pruebas, se quedan las 268 del cliente: las que empiezan por `/IBP/` son
estándar de SAP y no documentan nada de este cliente.

El `.docx` se arma sin librerías de terceros, en `src/lib/docx.js`: un documento de Word es un ZIP con
XML dentro, y JSZip ya estaba en el proyecto para leer los exports de CI-DS. Es el mismo criterio que
`xlsx.js`, y por la misma razón: traer una librería de documentos para escribir párrafos y tablas sería
añadir megabytes al paquete para doscientas líneas de XML.

Tres detalles que se ganan leyendo el formato:

- El **índice** no lo calcula el generador: se guarda la instrucción y Word lo rellena al abrir, porque
  los ajustes piden actualizar campos. Sin eso hay que hacerlo a mano.
- El **encabezado de cada tabla se repite** en cada página. Una tabla de cifras clave son cuarenta filas
  y sin eso la segunda página es una lista de valores sin nombre.
- Un carácter sin escapar rompe el archivo entero y Word solo dice «el documento está dañado», sin decir
  dónde. Por eso todo el texto pasa por el escapado y hay una prueba que lo comprueba.

El lector de CSV es el de SAP: separador punto y coma, y un salto de línea dentro de un campo
entrecomillado es parte del campo —las definiciones de cálculo los llevan—, así que partir por líneas
antes de mirar las comillas rompería esas filas.

## El glosario, derivado del código

v7 tenía el glosario escrito a mano en HTML, en paralelo a las reglas del analizador: dos textos que
hablan de lo mismo y que nadie mantiene a la vez. Se cambia una regla, el glosario sigue explicando la
vieja, y el consultor le explica al cliente algo que la herramienta ya no hace.

Aquí el glosario **se deriva** de `core/ibp/production-rules.js`, `network-analysis.js`,
`location-analysis.js` y `resource-analysis.js`, que son los mismos módulos que juzgan. La tabla de «qué
se le exige a cada categoría» es la matriz resuelta, no una copia: comprobado en el navegador, sus 13
filas son las 13 comprobaciones de `MATRIZ`, y la fila de «sin receta propia» dice
Error / Error / — / — / Aviso, que es exactamente lo que devuelve `reglasDe()` para cada categoría. Si
mañana una comprobación cambia de rojo a aviso, esa pantalla lo dice sin que nadie la toque.

Por lo mismo, las comprobaciones por ubicación se declaran como tabla (`EXIGENCIAS`) y no como una
cadena de `if`: el glosario las lee de ahí, y hay una prueba que recorre la tabla entrada por entrada y
comprueba que cada una dispara de verdad su severidad. Sin esa prueba, renombrar un campo dejaría al
glosario prometiendo una comprobación que ya no existe —que es exactamente lo que le pasaba a v7—.

## Un número que no se puede escribir como si fuera un total

Corriendo el informe por ubicación contra un tenant real, 155 de 167 ubicaciones decían exactamente
«400 materiales que recibe sin cobertura». Ninguna tenía 400: **400 es el tope** de la lista que se
guarda por ubicación, y el tope existe porque la tabla de arcos de ese tenant son **4,3 millones de
filas** y guardar el conjunto completo por ubicación tira la pestaña.

El tope se queda; lo que se arregla es lo que se escribe. Cuando una lista se topa, la fila dice «más de
400» y no «400». Un tope disfrazado de dato es peor que no dar el dato, porque el consultor se lo lleva
a la reunión como si lo hubiera contado.

## Un hallazgo que no es de estos módulos: las familias de tablas mezcladas

En el tenant `my301282`, área `ASIBPTS`, la detección de papeles eligió los arcos de la familia `GMX*`
(`GMXSOURCELOCATION`) y la cobertura de la familia `GID*` (`GIDLOCATIONPRODUCT`). El área tiene los dos
juegos de tipos de dato maestro, y **cruzar dos familias compara universos distintos**: de ahí venían los
155 «sin cobertura».

No se toca la detección en esta iteración: afecta igual al analizador de la red, que se verificó contra
otro tenant, y elegir familia por su cuenta sería decidir por el consultor. Queda anotado como lo que
hay que resolver —probablemente ofrecer la familia en la pantalla de correcciones, que ya existe— y es
otro caso del mismo principio: **los nombres de tabla no son iguales entre tenants, y ninguna pantalla
puede dar por supuesto cuál eligió**.

## Huecos abiertos

Ninguno. El último —los informes por entidad de los dos analizadores— se cerró el 2026-08-18 con las
pestañas por ubicación y por recurso, y con el motivo escrito de por qué las otras cuatro hojas de v7 no
se portan.

Recorrido de `origin/master` (`6d027d2`) el 2026-08-18: los **20 archivos** de `public/js/` están todos
asignados, y las otras piezas del repo también —`server.js` a `api/ibp/*`, `public/index.html` y
`public/css/styles.css` a React, y los cuatro JSON de `public/i18n/` a la fase de idioma, que es
deliberadamente la última—.

## Sin estrenar

Nada de estos módulos escribe en SAP: los cuatro informes, el árbol y la red trabajan sobre lo que quedó
descargado en el navegador, y el documentador del área escribe un `.docx` en el disco del consultor.
