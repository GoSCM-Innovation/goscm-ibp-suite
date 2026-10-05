# Paridad de Data Tools con v7 — auditoría del 2026-10-01

Decisión del usuario (2026-10-01): **Data Tools debe ser idéntico a v7**, aplicación por aplicación. Esta
auditoría recorrió el flujo de v7 paso a paso (desde `origin/master`) y lo comparó control por control con
la suite. Es lectura de código: lo marcado «no confirmado» hay que verlo en pantalla.

Este documento es la lista de trabajo. Se tacha lo que se termina; no se contesta «ya está» de memoria.

## Estado

| Aplicación | Estado |
|---|---|
| Glosario Analyzers | ✅ Portado tal cual (2026-10-01) |
| Production Visualizer | ✅ Árbol, textos de descarga y pestañas como v7 (2026-10-01). Falta mirarlo en el tenant |
| Production Analyzer | ✅ Algoritmos, vista web, Excel, modal y pasos ②–⑤ como v7 (2026-10-01). Falta mirarlo en el tenant |
| Network Visualizer | ✅ Igualado a v7 (2026-10-01), con las diferencias dichas abajo. Falta mirarlo en el tenant |
| Network Analyzer | ✅ Algoritmos, vista web (con las hojas de arcos paginadas desde IndexedDB), Excel partido a 900.000 filas, modal y pasos ②–⑤ como v7 (2026-10-05). Falta mirarlo en el tenant |
| Planning Area Documenter | ✅ Hecho (2026-10-01) — ver abajo |

## Production Visualizer — hecho

Pestaña «Nueva búsqueda» (luego el código del producto), buscador «BUSCAR PRODUCTO» con hasta 30
coincidencias por código o descripción, «⊟ Colapsar / ⬇ Exportar / ✕ Limpiar», contadores Raíces /
Visibles / Prof.máx, mensaje inicial 🔍, spinner con «Escaneando nivel…», y una tabla con las once
columnas de v7 (más vigencia si la descarga la trajo), colores por nivel, insignias de tipo y de
recursos, coproductos y el divisor «↓ Componentes PSI (N)». Línea de estado de la descarga sin
contador de filas y con «✓ N productos en caché local…» al final.

Lo que se conserva de la suite aunque v7 no lo tenía, por ser un fallo de v7 y no una función: el aviso
de **ciclos** y el aviso de tabla **incompleta** (SAP dice N filas y llegaron menos).

Sin botón «Invertir»: en v7 la función existía pero ningún botón la llamaba.

## Production Analyzer — hecho (2026-10-01)

Se reemplazó el analizador anterior de la suite (tabla de calidad propia: Error / Aviso / Nota / Bien, tres
pestañas, «Descargar CSV») por el de v7, con **los mismos algoritmos**. Lo que quedó idéntico, mirado
control por control contra `prodAnalyzer.js`, `snWebView.js`, `mattype-config.js`, `extraFields.js`,
`statsSheet.js`, `runSummary.js` e `index.html` (`tab-pa`) de la rama `master` de v7:

- **El algoritmo** (`core/ibp/production-analyzer.js`, `mattype-config.js`): port literal de
  `paAnalyzeAndExport` y de la matriz de reglas por categoría. Las ocho hojas con sus columnas, notas de
  encabezado, grupos de color y observaciones; estados «⛔ Alerta / ⚠ Advertencia / ✅ OK» (sin «Nota»);
  hoja Resumen con sus bloques de metadatos; hoja Estadísticas. Las pruebas
  (`production-analyzer.test.js`) usan un tenant de juguete cuyas respuestas se **calcularon a mano
  leyendo el código de v7**, no corriendo el nuestro.
- **El Excel** `ProductionHierarchyAnalysis_<fecha>.xlsx` (`src/lib/xlsx-analisis.js`): port de
  `StreamingXlsx` de v7 (el escritor que usaban los dos analizadores; no usaban ExcelJS). Resumen,
  Estadísticas y una hoja por pestaña, con fuente DM Sans, encabezado por color de grupo con su nota,
  fila 1 congelada, color de pestaña, relleno por severidad, números como números.
- **La vista web** (`VistaWebAnalisis.jsx`): cabecera, tarjetas, pestañas con total, chips, buscador,
  columnas redimensionables, popup de celda con «Copiar», paginación de 50, pantalla completa,
  «Cerrar» → barra «Ver resultados», Estadísticas. **Modal «¿Cómo quieres ver el análisis?»**
  (`ModalModoDeSalida.jsx`) y banner «¡Análisis completado!» si fue solo Excel.
- **Pasos ②–⑤** (`AnalizadorProduccion.jsx` + `TablaExcluirTipos`, `MatrizDeCategorias`,
  `CamposAdicionales`): textos, controles, resúmenes y «Volver» que oculta el paso, como v7. Los tipos de
  material se leen de SAP con una consulta ligera al confirmar ① (`tipos-de-material.js`,
  «⏳ Cargando tipos de material desde SAP IBP…»), no de lo ya descargado. El botón ▶ no cambia de texto
  y no hay «Cancelar».
- **La descarga** baja las diez tablas de v7, **incluidas Location Product y Location Source** (antes
  solo bajaba el grupo del árbol y el análisis no tenía los arcos): `ExplorerExtract` admite `tablas`,
  `camposMas`, `requeridas`, `formato` y `sinCancelar`. Textos de v7 (`Descargando X → IDB...`,
  `Indexando Product...`, `Analizando...`, `✓ Completado · N ms`, `[+Nms] PSH: N reg (M SOURCEIDs)`,
  avisos de «0 registros» sin voseo).

### Diferencias que quedan, y por qué

1. **El Resumen del Excel no trae la «API Base URL»** (dice «—»), y la línea del registro dice
   `[GET] <entidad>` en vez de la URL: el navegador nunca conoce la dirección del tenant (vive cifrada en
   el servidor). Regla de seguridad de la plataforma.
2. **La vista web tiene todas las filas en memoria**; v7 mandaba las hojas grandes a IndexedDB. Para las
   ocho hojas del Production Analyzer sobra (decenas de miles de filas). Las de arcos de la red sí van a
   IndexedDB: ver «Network Analyzer — hecho».
3. **La clasificación de tipos se guarda con el formato de la suite** (`mattype_<área>`:
   `{ tipo: { excluido, categorias } }`), no con el `mattype_cfg_<pa>` de v7, para seguir compartida con el
   Network Analyzer mientras este no se migre. Los campos adicionales sí usan las claves de v7
   (`ef_sel_pa_<entidad>_<área>`).
4. **El diálogo de campos adicionales muestra descripción solo de los campos que la suite conoce**
   (`DESCRIPCION_DE_CAMPO`); v7 mostraba la etiqueta que traía SAP de cada campo (`fieldMeta`). Falta
   decidir de dónde sale esa etiqueta aquí (el catálogo de etiquetas de `ibp-master-data.js` es candidato;
   no se comprobó su forma).
5. **No hay panel de corrección de campos** (`validateEntityFields` + `fmShowCorrectionPanel`): si un
   campo no existe en este tenant, la descarga lo omite y lo avisa en el registro, y el análisis sigue
   sin él. Es una brecha previa, no de esta pasada.
6. **Solo español**: v7 tenía `es`/`en`. El idioma queda para el final (decisión previa).
7. **Una rama de v7 es inalcanzable** y se portó igual: «{label} — sin hallazgos en modo permisivo»
   (un producto sin categoría siempre tiene al menos un hallazgo, porque las reglas de «tener receta» y
   «no tener receta» se contradicen). No se corrigió: la regla es paridad.
8. **«Resumen» no es una pestaña de la vista web**, es el renglón de tarjetas: así está en el código de
   v7 (`name !== _PA_SUMMARY_NAME`). Sí es la primera hoja del Excel.
9. ~~Quedan en el esquema de IndexedDB las tablas `pa_*` del analizador anterior, sin uso.~~ Se quitaron al
   migrar la red (esquema versión 4, con migración que las borra).

### Sin confirmar (hay que verlo en el tenant de pruebas)

- Que las diez tablas se resuelvan por sus campos en el tenant, y que `PLEADTIME` y `PRATIO` existan en
  la cabecera (si no, la descarga los omite y avisa).
- El Excel abierto en Excel de verdad (se verificó el XML y que el zip se reabre, no el archivo en Excel).
- El aspecto en un navegador real con decenas de miles de filas (se miró con datos de muestra).

## Network Visualizer — hecho (2026-10-01), falta mirarlo contra un tenant

Recorrido control por control contra `visualizer.js`, el `tab-visualizer` de `index.html` y `es.json` de
v7 (`origin/master`). Lo de abajo está tachado cuando quedó igual; lo que no, dice por qué.

1. ~~Botones **«⊞ Ajustar»** y **«⊟ Compactar»**.~~ «Compactar» reconstruye el grafo (`armarRed` de
   nuevo → otro lienzo), que es lo que hacía `vizCompact`.
2. ~~**Diálogo «Filtros de red»** (botón «▼ Filtros (N)»)~~: dos columnas con buscador con comodines,
   «Seleccionar todo» (con estado intermedio), «Limpiar todo» y «Aplicar»; el botón pasa a ámbar con el
   número. **Una diferencia a propósito**: en v7 cada casilla modificaba los filtros al marcarse y cerrar
   con ✕ o Escape dejaba los cambios puestos sin redibujar (la pantalla decía una cosa y el siguiente
   «Compactar» aplicaba otra). Aquí es un borrador que solo vale con «Aplicar».
3. ~~**Auto-ocultado de clientes por encima de 20**~~, con el aviso `{n} clientes ocultos
   automáticamente. Usa ▼ Filtros para ajustar.`
4. ~~**Pantalla completa** con su propio `<dialog>`~~: título, «⊞ Ajustar», «⊟ Compactar», «✕ Cerrar», su
   leyenda, su detalle de nodo y «Rutas» como franja inferior. El botón sale solo tras cargar una red. Es
   otro grafo (se construye al abrir); la leyenda y el filtro de rutas se comparten con la página, como
   en v7.
5. ~~**Textos, barra de progreso y logs**~~: «Confirmar mapeo y cargar productos» → barra al 5 % con
   «Descargando catálogo de productos…» → «✓ N materiales listos…» al 100 %; «Material: X — haz click
   en…»; «⏳ Cargando...», «Procesando red de X…», `▶ Cargando red para: X`, `✓ Location Source: N
   registros` y los demás; «✓ N nodos · M conexiones». El panel ① se pliega al terminar el catálogo y
   otra vez al cargar la red.
   - Las líneas `[GET]` llevan la entidad, el `$filter` y el `$select`, **no la URL**: el navegador no
     conoce la dirección del tenant (vive cifrada en el servidor). v7 la escribía entera.
   - Las tres primeras tablas (recetas, arcos, clientes) se piden **en paralelo**; v7 las pedía una tras
     otra. El orden de las líneas del log sale distinto, el resultado es el mismo y se ahorran dos
     esperas de ~6 s.
   - Los avisos del plan (una tabla o un campo que este tenant no tiene) se anotan en los logs como
     `warn`. **Sin portar**: el panel de corrección de campos (`validateEntityFields` /
     `fmShowCorrectionPanel` de `fieldmap.js`), que en v7 salía al confirmar y al cargar. No se ha
     comprobado si la suite lo cubre en otro sitio; es común a todas las aplicaciones.
6. ~~**Detalle del nodo**~~: «Seleccionado» con ✕, insignia, código y el globo del nodo; para un
   proveedor, «Insumos abastecidos (N):» con chips. Se quitó «Le llega de / Manda a» y el plazo de
   producción.
7. ~~**Panel Rutas**~~: «▶ Rutas / ▼ Rutas», resumen, «Tipo:» / «Causa:» (Dead-end, Ciclo), buscador,
   tabla `# / Tipo / Ruta / Termina en / Saltos`, tope de 500 filas con su nota, **clic en una fila =
   resalta la ruta** (selecciona nodos y arcos y enfoca; si un nodo estaba apagado en los filtros, lo
   enciende y reconstruye) y «↓ Exportar CSV» con TODAS las rutas, coma, `\n`, sin marca de
   codificación y `Rutas_{producto}.csv`. Las rutas se calculan de las **filas** (`rutasDeLaRed(datos)`),
   no del dibujo, como `vizBuildGraphFromData`.
8. ~~**Leyenda** flotante arriba a la derecha~~ con título «Leyenda» y cuatro casillas con su globo.
   Apagar una clase marca sus nodos `hidden` y encuadra con animación, **sin recalcular** (se comprueba
   con una prueba que cuenta lienzos). Sin quinta etiqueta «Producto».
   - Igual que v7, apagar «Proveedor» y luego «Compactar» NO crea los nodos ni arcos de proveedor (v7
     los salta al armar el grafo); las otras tres clases sí se arman, ocultas.
9. ~~**Buscador de material**~~: solo con texto, código y descripción, sin distinguir mayúsculas, primero
   los que empiezan por el texto, máximo 40.
10. ~~Estado vacío «Busca un material para visualizar su red logística»~~ (se esconde al empezar a
    cargar, y si la carga falla no vuelve: así era en v7).
11. ~~Mapeo ①~~ (hecho aparte). Quitado lo que v7 no tenía: el aviso de nodos sin arco, el nodo
    «Producto» (y su arco «fabricación»), «Leyendo de SAP en vivo…», y el contador «materiales» de la barra.

**Más que se alinearon con v7 al recorrerlo** (no estaban en la lista de arriba):

- El grafo es el de `vizBuildGraph`: sin nodo de producto, así que «N nodos · M conexiones» cuenta lo
  mismo que allí; globos de ayuda con los textos de v7 («Lead time transporte: 2», «Componentes: A
  [LT:5]»…) y con los plazos **crudos**, tal como llegan de SAP (v7 no los formatea).
- La disposición es `vizAssignPositions` entera: los proveedores se ordenan por las plantas a las que
  abastecen, las ubicaciones por las plantas de las que reciben, los clientes por las ubicaciones que los
  sirven —leído de las filas de SAP—, y los clientes quedan una columna después de las ubicaciones.
- Un material **insumo** (sin recetas propias) pregunta a SAP qué plantas hay en los destinos de sus
  arcos (`PSH global por LOCID`, hasta 80), para pintar esas plantas como plantas.
- **Siempre lee de SAP**, como v7: se quitó la lectura de lo descargado (`network-load.js` y su prueba
  se borraron). Es la misma razón por la que los analizadores repiten la descarga.
- Las tarjetas «Product» y «Location» de esta pantalla editan los maestros de la **red**; antes el plan
  seguía leyendo los del árbol y la elección se ignoraba (`planDeLaRed`).

**Lo que sigue sin verse**: solo se ha visto con datos de muestra (31 nodos) en una página temporal; falta
un tenant real. No se han mirado: etiquetas de nodo a zoom normal, una red de cientos de nodos, ni el
rendimiento del diálogo de filtros con miles de ubicaciones o clientes (v7 los pintaba todos).
**No portado**: el selector de idioma (fase i18n al final). `locProd` / `custProd` (Location Product y
Customer Product) no se leen: v7 los pedía y los guardaba en `VIZ_DATA`, pero ninguna pantalla los usaba.

## Network Analyzer — hecho (2026-10-05)

Se reemplazó el analizador anterior de la suite (tabla de calidad propia: Error / Aviso / Nota / Bien, chips
🔴🟡🔵🟢, «Descargar CSV», lógica en `network-analysis.js`) por el de v7, con **los mismos algoritmos**. Se mira
contra `analyzer.js`, `snWebView.js`, `statsSheet.js` (`buildSN`), `runSummary.js`, `mattype-config.js`,
`extraFields.js`, `index.html` (`tab-network`) y `es.json` de `origin/master` de v7.

**Cómo se comprobó que el algoritmo es el mismo.** No solo con fixtures calculadas a mano: se ejecutó el
`analyzeAndStreamExcel` REAL de v7 (cargando `analyzer.js`, `statsSheet.js`, `runSummary.js`,
`mattype-config.js` y `extraFields.js` en un contexto de Node con IndexedDB simulado) sobre las mismas
entradas y se cotejaron, hoja por hoja, encabezados, notas, celdas, colores, hoja Resumen, hoja Estadísticas y
totales. Dos fixtures fijas (`core/ibp/fixtures-red-v7.json`, con la salida que escribió v7) están en las
pruebas; además se corrió el cotejo contra **300 redes generadas al azar** (identificadores numéricos y
alfanuméricos, ciclos, ghost nodes, plazos vacíos / en cero / no numéricos, tipos excluidos, las cuatro
categorías de material, campos adicionales) con **cero diferencias**. El generador y el arnés no se
guardaron en el repo (viven en el espacio de trabajo de la sesión); la prueba fija es la del repo.

Lo que quedó idéntico, mirado control por control:

- **El algoritmo** (`core/ibp/network-analyzer.js`, `network-analyzer-hojas.js`): port literal de las fases 2 a
  8 de `analyzeAndStreamExcel` y de las funciones `sn*` (grafo por producto, rutas con tope de 50.000,
  fantasmas, callejones, plantas aisladas, ciclos, plazos faltantes, resiliencia, **Health Score** y su
  desglose). Las cinco hojas con sus columnas, notas de encabezado, grupos de color y observaciones; estados
  «⛔ Alerta / ⚠ Advertencia / ✅ OK» (sin «Nota»); hoja Resumen con los cinco KPIs de v7; hoja Estadísticas
  (`buildSN`). Los encabezados salen de `es.json`: **«Estado de la Red»** (con R mayúscula),
  `# Plantas`, `# DCs`, `# Clientes`, `# Rutas completas`, `Ruta más larga`, `# Ghost Nodes`,
  `# Dead Ends`, `Health Score`, `Categoría de salud`, **`Detalle cálculo Health Score`** (no «Desglose del
  score»), `Multi-sourced?`, `TLT promedio (días)`, `CLT promedio (días)`, `# Plantas aisladas`…
- **Reglas de v7 que se conservan aunque parezcan rarezas**: un producto sin `MATTYPEID` no se analiza pero
  SÍ cuenta en el total que divide el Health Score promedio; los diccionarios son objetos corrientes, así que
  «Orígenes (códigos)» lista primero los códigos numéricos de menor a mayor (`3, 20, 100, B, A`); la rama
  final de las observaciones OK («Red completa sin anomalias | …») es también la de una materia prima, que no
  tiene la suya; el redondeo de `fmtDuration` (59,6 s sale «60 s»).
- **El Excel** `SupplyNetworkAnalysis_<fecha>.xlsx`: hojas en el orden de v7 (Resumen, Estadísticas, Product,
  Location, Customer, Location Source, Customer Source). **Una hoja con más de 900.000 filas de datos se parte
  en «Hoja», «Hoja (2)»…**, cada parte con su encabezado, nota y color (`analyzeAndStreamExcel` de v7).
- **La vista web** (`VistaWebAnalisis.jsx`, la misma del Production Analyzer): cinco hojas + Estadísticas, las
  cinco tarjetas, modal «¿Cómo quieres ver el análisis?» y banner «¡Análisis completado!». **Las hojas Location
  Source y Customer Source se paginan desde IndexedDB** (`sn_loc_web` / `sn_cust_web`, con índice por
  severidad) sin tener las filas en memoria: la página se pide con `advance` (la 1.800 de 90.000 filas tarda
  ~50 ms), la búsqueda recorre por cursor con los topes de v7 (2.000 coincidencias, 300.000 revisadas) y dice
  cuando se cortó, y si la base falla cae al respaldo en memoria (las primeras 20.000 filas) y lo dice. Los
  avisos del pie son los de v7.
- **El Excel de las hojas grandes no se retiene en memoria**: cada fila de arcos se convierte en XML al llegar
  y, cada 20.000, pasa a un `Blob` (`crearEscritorDeTabla`); las filas de la vista web se guardan en lotes de
  8.000, con la misma contrapresión que v7 (más de 12 lotes sin terminar → vista parcial y aviso).
- **Pasos ②–⑤** (`NetworkAnalyzer.jsx`, el mismo recorrido de `AnalizadorProduccion` con los datos de la red):
  banner, «Interpretación de resultados», ① «MAPEO DE ENTIDADES» (variante `na`, sin tocar), ② Excluir tipos,
  ③ Categorizar, ④ Campos adicionales (las cinco entidades de `EF_ENTITY_META.sn`, con `EF_MAND_VISIBLE.sn` /
  `EF_MAND_HIDDEN.sn`), ⑤ Ejecutar: resumen de una línea con el texto de la red («…análisis estándar para todos
  los tipos»), «▶ Ejecutar análisis» sin cambiar de texto y sin «Cancelar». Los tipos de material se leen de SAP
  al confirmar ① («⏳ Cargando tipos de material desde SAP IBP…»), del maestro elegido en la tarjeta «Product».
- **La descarga** baja las nueve tablas de v7, **en su orden** (Location Source, Customer Source, Product, Header,
  Item, Location, Location Product, Customer, Customer Product) y **pidiendo a SAP exactamente los campos de v7**
  (`solo` en `planificarExtraccion`: el maestro de productos del árbol trae además `UOMID` y `UOMDESCR`, que la
  red no usa y que en un tenant sin ellos habrían dado un aviso falso). Textos de v7: `Descargando X → IDB...`,
  `Indexando X (lookup en memoria)...`, `[GET] <entidad>`, `Location Source: N reg → IDB (M productos)`,
  `Índices listos. N productos en la red. Iniciando análisis...`, `Analizando red (N productos)...`,
  `Analizando d/n productos...`, `Hoja X lista...`, `Análisis completado. N productos analizados · {Excel
  descargado / vista web generada / Excel descargado + vista web} · {duración}.`, `✓ Análisis completado — Excel
  descargado | N productos · {dur}`, y el aviso `⚠️ X (entidad): 0 registros. Verifica…` sin voseo. La barra
  sube por los números de v7 (0, 8, 17, 25, 28, 33, 38, 42, 46 por tabla, 50 al terminar la descarga, 57, 85,
  88, 91, 94, 96, 97, 100).
- **Las ocho entidades de red son imprescindibles** (`required: true` en `validateEntityFields`; el maestro de
  productos no). Sin las tres de arcos/recetas dice «Configura al menos una entidad de red antes de analizar».
- Una tabla que no se bajó en esta corrida se lee VACÍA aunque la base guarde restos del árbol o de otra
  corrida: v7 no los tenía.
- El banner de `modules.js` ya decía lo que `banner.network` de v7 y ahora la pantalla lo entrega.

### Diferencias que quedan, y por qué

1. **El Resumen no trae la «API Base URL»** (dice «—») y la línea del registro dice `[GET] <entidad>` en vez de la
   URL; tampoco hay las líneas `↳ URL: …` por página. El navegador nunca conoce la dirección del tenant (vive
   cifrada en el servidor). Regla de seguridad de la plataforma.
2. **Las hojas Product, Location y Customer de la vista web están en memoria**; v7 las guardaba también en
   IndexedDB (`sn_product_web`, `sn_location_web`, `sn_customer_web`) y dejaba 2.000 filas de respaldo. Son una
   fila por producto / ubicación / cliente y no se midió el peso con un catálogo de cientos de miles de
   productos (en el banco de pruebas: 3.000 productos × 33 columnas sin problema). Si hiciera falta, la
   hoja con `origen` ya lo admite: es guardarlas con `crearFabricaDeHojasGrandes` y agregar su tabla de vista.
3. **El registro se escribe al terminar la descarga**, no tabla por tabla (`ExplorerExtract` avisa por página,
   no por tabla). Las líneas y las horas son las de cada tabla.
4. **La clasificación de tipos se guarda con el formato de la suite** (`mattype_<área>`), compartida con el
   Production Analyzer; los campos adicionales sí usan las claves de v7 (`ef_sel_sn_<entidad>_<área>`).
5. **El diálogo de campos adicionales describe solo los campos que la suite conoce** (igual que en el
   Production Analyzer, punto 4 de arriba).
6. **Sin panel de corrección de campos** (`validateEntityFields` + `fmShowCorrectionPanel`): si un campo no
   existe en este tenant, la descarga lo omite y lo avisa en el registro; v7 paraba con «correcciones pendientes».
   Brecha común a todas las aplicaciones.
7. **Solo español** (fase de idioma al final).
8. En la vista web «Resumen» no es una pestaña sino el renglón de tarjetas, como en v7 y en el Production
   Analyzer.
9. Al fallar el análisis la barra vuelve a 0 en vez de esconderse (v7 la escondía); se ve igual.
10. Las tablas de IndexedDB de los analizadores anteriores (`pa_*`, `pa_*_web`, `sn_product_web`,
    `sn_location_web`, `sn_customer_web`) se **borran** al abrir la base (esquema versión 4). Solo esas, por su
    nombre: una tabla que el código no conoce no se toca.

### Sin confirmar (hay que verlo en el tenant de pruebas)

- Que las nueve tablas se resuelvan por sus campos en el tenant y que `PLEADTIME` / `PRATIO` existan en la
  cabecera (si no, se omiten y se avisa).
- El Excel abierto en Excel de verdad (se verificó que el zip se reabre y que las partes tienen las filas; no se
  abrió en Excel), y el partido a 900.000 filas con una red real (está probado con límite chico).
- El tiempo con un tenant grande: el análisis lee tres veces la base por producto, como v7. Medido en el
  navegador de pruebas con datos sintéticos: 3.000 productos y 90.000 arcos, ~20 s; **6.000 productos y 600.000
  arcos** (una red densa, con 228.000 rutas), ~125 s de análisis con el montón de JavaScript entre 140 y 370 MB,
  y un Excel de 46,8 MB armado en 22 s; la vista web paginó sin problema (la página 1.800 de 90.000 filas, 50 ms).
  100.000 productos serían del orden de varios minutos, igual que en v7.

## Planning Area Documenter — hecho

El documento sale **idéntico byte a byte** al de v7: se comparó el XML de todas las piezas del `.docx`
(documento, estilos, ajustes, relaciones, tipos de contenido) generado por el `paDoc.js` de v7 contra el de
la suite, con los mismos CSV, en cuatro casos (completo con logos y datos en vivo, sin logos, mínimo y sin
área detectada). Incluye las rarezas de v7: el orden de las claves numéricas de un objeto, `getLike` por
«contiene», los títulos 7.n y 10.n, la muestra de 12 atributos, el top 20 de niveles y la definición recortada
a 220. Sin tope de filas.

Pantalla: los cuatro paneles de v7 con sus títulos y textos («📥 Archivos de configuración (CSV)»,
«🎨 Portada del documento», «🔌 Enriquecer con datos en vivo · SAP IBP» y el de generar), la zona «Arrastra los
CSV aquí», la cuadrícula de las 13 secciones («N filas» / «no provisto»), «Planning Area: X» / «Sin PA detectado
aún» y «· Logo cargado (w×h)», Cliente / Autor / Versión del documento, logo PNG/JPG con miniatura y ✕,
interruptor que nace desactivado y deshabilitado, botones «📝 Generar documento Word» (con «⏳ …») y
«🗑️ Limpiar», y el registro con los mismos mensajes. Lo cargado sobrevive a cambiar de aplicación (como en v7,
donde el panel solo se ocultaba) y se vacía al cerrar la sesión.

Datos en vivo: operación nueva `POST /api/ibp/pa-doc-live` (`handlers/ibp/pa-doc-live.js`,
`core/ibp/pa-doc-live.js`), con tres acciones: `entidades`, `volumetria` (concurrencia 6, `$top=1` con
`$inlinecount=allpages`) y `application-jobs` (`BC_EXT_APPJOB_MANAGEMENT`, sin filtrar las plantillas `/IBP/`,
con tipo de paso y marca CI-DS). Exige el módulo Data Tools (`explorer`). Las credenciales no salen del servidor.

Diferencias que se conservan a propósito (todas son guardas de integridad):

- La lista de entidades de dato maestro se lee del documento del servicio (unos kB) y solo cae al `$metadata`
  (4,8 MB) si no trae ninguna; v7 leía siempre el `$metadata`. El resultado es el mismo.
- La volumetría viaja en tandas de 48 tipos, una tras otra, porque una función de Vercel tiene tiempo limitado;
  v7 hacía todo desde el navegador.
- El logo se valida por su contenido: un archivo que no es PNG ni JPEG se rechaza (v7 lo metía como PNG y salía
  roto en Word). El tipo de contenido de las imágenes se normaliza (`image/jpeg`, `image/svg+xml`).
- El XML escapa también los caracteres de control que XML 1.0 no admite (uno solo deja el documento «dañado»),
  y una tabla sin columnas no se dibuja (v7 escribía «Infinity»).
- El nombre del archivo cambia los caracteres no válidos del identificador del área por `_`.
- Se quitó lo que v7 no tenía: tabla Sección/Registros/Archivo/Hace falta, resumen «✓ nombre · N cifras
  clave…», aviso sobre actualizar el índice y el respaldo del área elegida en el selector (la portada dice
  «SAP IBP» si no se detecta área, como v7).

Sin verificar contra un export real: los encabezados de las columnas son los que lee v7; en esta sesión no se
comprobó ningún `Download Configuration File` de un tenant. Texto de v7 que no cuadra con la suite: «Requiere
conexión a SAP IBP (pestaña Conexión).» (aquí la conexión se hace con «Conectar SAP IBP»). Pendiente de la fase
de idioma: el inglés del documento (`T.en` de v7); el diccionario ya se lee por idioma en
`src/lib/pa-doc-textos.js`.

## Infraestructura reutilizable para Network Analyzer

Lo que construyó el Production Analyzer, el Network Analyzer debe **usarlo**, no rehacerlo. Todo es
genérico salvo lo marcado «propio de PA».

**1. El modelo del informe** — `core/ibp/analisis-hojas.js`
- `crearHojaDeTabla({ nombre, color, encabezados, notas, grupos, conEstado })` devuelve una hoja con
  `.agregar(celdas, relleno)` (relleno = `COLORES.C_RED`, `COLORES.C_YEL` o `null`; cuenta total / red /
  yel / ok sola) y `.agregarLibre(celdas, relleno)` (filas bajo la tabla, para los metadatos del Resumen).
- `crearHojaLibre({ nombre, color, capturar })` para la hoja Estadísticas (`capturar` recibe cada fila en
  texto para la vista web).
- `etiquetaDeRelleno`, `porcentajeOk`, `codigos`, `limpiarXml`, `COLORES`, `NA_DASH`.
- La forma del `Informe` (`{ titulo, archivo, generadoEl, hojas, resumen, estadisticas,
  nombreEstadisticas, orden, hojasWeb }`) está documentada al principio del archivo; el molde para
  producirlo es `analizarProduccion` en `core/ibp/production-analyzer.js` (mira `hojaDeAnalisis` y el
  cierre con el Resumen). `bloquesDeResumen(hoja, opts)` (mismo archivo) sirve tal cual para los bloques
  de metadatos del Resumen: cambia `opts.analyzer` y las entidades.
- Propio de PA: `construirEstadisticas` (port de `StatsSheet.buildPA`). El de la red es `buildSN`, que en
  v7 lee IndexedDB; hay que portarlo recibiendo los datos ya leídos.

**2. El Excel** — `src/lib/xlsx-analisis.js`: `armarLibroDeAnalisis(informe, { ceder })` → `ArrayBuffer`,
y `descargarLibro(buffer, informe.archivo)` de `bom-export.js`. No hay que tocarlo. Ojo: el
`analyzeAndStreamExcel` de v7 parte las hojas de más de 900.000 filas; esto **no** lo hace todavía.

**3. La vista web y el modal** — `VistaWebAnalisis.jsx` (`datos`, `descargarExcel`, `excelDescargado`;
`datos` se arma como `datosWeb` en `AnalizadorProduccion.jsx`) y `ModalModoDeSalida.jsx`
(`onElegir('web'|'excel'|'both'|null)`). Cambiar de análisis = montar con otra `key`. **Decisión
resuelta para la red (2026-10-05):** una hoja de `datos.hojas` puede traer `origen` (`pagina` y `buscar`) y
entonces la vista la pide por páginas a la base local; ver `hoja-en-disco.js` y «Network Analyzer — hecho».

**4. Los pasos ②–④** — `TablaExcluirTipos`, `MatrizDeCategorias`, `CamposAdicionales` (props en el
encabezado de cada archivo) dentro de `PasoPlegable`. `core/ibp/mattype-config.js` trae las categorías,
los resúmenes de una línea (`resumenDeExclusionV7`, `resumenDeCategoriasV7`, `resumenDeEjecucionV7`),
`desdeClasificacion` / `actualizarTipos`. La clasificación se guarda con `clasificacion-de-tipos.js`
(compartida con PA). Para los campos adicionales: `campos-adicionales.js` (`leerCamposAdicionales('sn',
…)`; `TABLA_DE_ENTIDAD` es de PA, la red necesita la suya: product → `bom_prd`, location → `bom_loc`,
customer → `sn_cust_master`, locationSource → `sn_loc`, customerSource → `sn_cust`) y las listas de
campos obligatorios/ocultos de `EF_MAND_VISIBLE.sn` / `EF_MAND_HIDDEN.sn` (en `extraFields.js` de v7).

**5. El recorrido y la descarga** — copiar `AnalizadorProduccion.jsx` (guía de pasos, modal, validar →
preguntar → bajar → analizar → entregar, banner, vista). Propio de PA: las tablas, los campos de más, el
`formato` (`registro-pa.js`), `leerDatosDeProduccion` y `analizarProduccion`. Para la red hay que
escribir su `registro-sn.js` (textos de la fase 1 de `analyzer.js`), su lector y su algoritmo.
`ExplorerExtract` ya admite `tablas`, `camposMas`, `requeridas`, `formato`, `sinCancelar` y el mango
`validar() / bajar() / decir() / anotar() / avanzar()`. `planificarExtraccion` admite `tablas` y `mas`.
`leerTiposDeMaterial` (consulta ligera de `PRDID,MATTYPEID`) sirve igual.

**6. Cómo probar** — el patrón de `production-analyzer.test.js` (fixture pequeña con respuestas
calculadas a mano contra v7) y el de `AnalizadorProduccion.test.js` (dobles de descarga, análisis y Excel).

**7. Retirado al migrar la red (2026-10-05)** — `AnalizadorV7.jsx`, `InformeDeCalidad.jsx`, `production-rules.js`,
`production-analysis.js`, `production-analyze.js`, `network-analysis.js`, `network-analyze.js` (con sus pruebas) y
las tablas `pa_*` / `pa_*_web` / `sn_product_web` / `sn_location_web` / `sn_customer_web` de IndexedDB.
`network-load-sap.js` se queda: lo usa el Network Visualizer.

## Decisiones del usuario (2026-10-01)

- Orden de trabajo: el propuesto abajo.
- **Los analizadores se migran con los algoritmos de v7, idénticos, con el mismo funcionamiento exacto**:
  era la idea principal de la migración. Se descarta la tabla de calidad propia.
- **La descarga se repite SIEMPRE**, como v7. Reutilizar lo guardado no captura los cambios hechos en el
  tenant desde la última vez. (Hecho.)

## Hecho de la lista de abajo

- ✅ Mapeo ① compartido (2026-10-01): título «MAPEO DE ENTIDADES», el texto de ayuda de cada aplicación,
  las tarjetas de v7 por aplicación (8 / 10 / 9 / 9) con etiquetas en inglés, buscador con «(ninguna)» y
  «nombre (N campos)», y los campos de la tabla debajo. Cada papel se puede dejar en «(ninguna)».
  Se conserva «Volver a la detección automática» (las correcciones aquí se guardan para el equipo).
- ✅ Descarga siempre en los analizadores (`bajarSiVacio` eliminado).

## Orden propuesto

1. Mapeo ① compartido (PanelMapeo con las tarjetas, etiquetas y buscador de v7): lo usan Production
   Visualizer, Production Analyzer, Network Visualizer y Network Analyzer, así que se arregla una vez.
2. ~~Network Visualizer~~ (hecho, 2026-10-01).
3. Production Analyzer y Network Analyzer: pasos ②–⑤, modal, vista web y Excel (la parte grande).
4. Planning Area Documenter: hecho.

Antes de cada una: recorrer los controles de v7 uno a uno y mirar la pantalla en el tenant de pruebas.
