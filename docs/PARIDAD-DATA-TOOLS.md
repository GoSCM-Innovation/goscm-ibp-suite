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
| Network Visualizer | ❌ Pendiente — ver abajo |
| Network Analyzer | ❌ Pendiente — ver abajo |
| Planning Area Documenter | ❌ Pendiente — ver abajo |

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
   ocho hojas del Production Analyzer sobra (decenas de miles de filas); para las de arcos de la red
   puede no sobrar (ver abajo).
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
9. Quedan en el esquema de IndexedDB las tablas `pa_*` del analizador anterior, sin uso. No se
   tocaron para no subir la versión del esquema; se quitan cuando se migre la red.

### Sin confirmar (hay que verlo en el tenant de pruebas)

- Que las diez tablas se resuelvan por sus campos en el tenant, y que `PLEADTIME` y `PRATIO` existan en
  la cabecera (si no, la descarga los omite y avisa).
- El Excel abierto en Excel de verdad (se verificó el XML y que el zip se reabre, no el archivo en Excel).
- El aspecto en un navegador real con decenas de miles de filas (se miró con datos de muestra).

## Network Visualizer — pendiente

1. Botones **«⊞ Ajustar»** y **«⊟ Compactar»** (faltan).
2. **Diálogo «Filtros de red»** (botón «▼ Filtros (N)»): columnas Ubicaciones y Clientes con buscador con
   comodines, «Seleccionar todo», «Limpiar todo», «Aplicar».
3. **Auto-ocultado de clientes por encima de 20**, con el aviso «{n} clientes ocultos automáticamente…».
4. **Pantalla completa** con su propio diálogo (título = PRDID, Ajustar, Compactar, Cerrar, leyenda,
   detalle de nodo y Rutas como overlay).
5. **Textos y barra de progreso**: «Confirmar mapeo y cargar productos», «Descargando catálogo de productos…»,
   «✓ N materiales listos — selecciona uno y haz click en "Cargar red logística"», «⏳ Cargando…»,
   «Procesando red de {prdid}…», «✓ N nodos · M conexiones», «Ver logs técnicos» con `✓ Location Source: N registros`.
6. **Detalle del nodo**: cabecera «Seleccionado» con ✕ y, para proveedores, «Insumos abastecidos (N)».
   La suite lo reemplazó por «Le llega de / Manda a».
7. **Panel Rutas**: botón «▶ Rutas / ▼ Rutas», etiquetas «Tipo:» y «Causa:», «Dead-end» (no «Sin salida»),
   columnas `# / Tipo / Ruta / Termina en / Saltos`, **resaltado de la ruta en el grafo al hacer clic**,
   «↓ Exportar CSV» con todas las rutas y las columnas de v7.
8. **Leyenda** como cuadro flotante arriba a la derecha con título «Leyenda»; ocultar un tipo no recalcula la
   disposición (hoy sí).
9. **Buscador de material**: solo con texto, por código y descripción, hasta 40, ordenado por relevancia.
10. Estado vacío «Busca un material para visualizar su red logística».
11. Mapeo ①: 9 tarjetas con etiquetas en inglés y buscador, título sin numeral.

## Network Analyzer — pendiente

Comparte con Production Analyzer: modal de modo de salida, mapeo/tipos/categorías/campos adicionales,
textos de progreso, banner final, panel «Interpretación de resultados».

Específico: **Excel `SupplyNetworkAnalysis_<fecha>.xlsx`** (hojas Resumen, Product, Location, Customer,
Location Source, Customer Source, Estadísticas); **vista web** con cinco hojas + Estadísticas; columnas de
v7 (`# Plantas`, `# DCs`, `# Clientes`, `# Rutas completas`, `Ruta más larga`, `# Ghost Nodes`,
`# Dead Ends`, **`Health Score`**, `Categoría de salud`, `Desglose del score`, `Multi-sourced?`, lead
times); etiquetas «⛔ Alerta / ⚠ Advertencia / ✅ OK» (la suite añade «Nota», que v7 no tiene).

⚠ **Decisión de producto previa**: la suite reemplazó el Excel de seis hojas por una tabla de calidad con
otras columnas y otra lógica en `core/ibp/network-analysis.js`. Igualar v7 implica portar la lógica de
v7 (Health Score incluido) y decidir qué pasa con la actual. El banner de `modules.js` ya promete un
Excel que la pantalla no entrega.

## Planning Area Documenter — pendiente

1. **Volumetría y Application Jobs en vivo** (SAP_COM_0720 y SAP_COM_0326): columna «Registros (en vivo)»,
   plantillas con pasos, tipo de paso y marca CI-DS. Faltan endpoints en el backend.
2. **El cuerpo del documento**: v7 tiene 10 secciones numeradas con prosa y subsecciones, más Anexos A y B;
   la suite emite una tabla genérica por CSV, sin numeración ni prosa, cortada a 400 filas.
3. **Columnas de los CSV** (posible error): v7 lee `ID`, `Name`, `Base Planning Level`, `Attribute ID`,
   `Operator Profile / Operator Type`; la suite busca `Key Figure`, `Attribute`, `Operator`…
   Hay que contrastar con un export real de SAP. Las pruebas actuales usan encabezados inventados.
4. **Logo de GoSCM** en la portada: `public/logo-goscm.png` existe y nunca se pasa al documento.
5. Campos **Autor** y **Versión del documento** (faltan); portada con tabla Campo/Valor y descripción.
6. Botón **«🗑️ Limpiar»** y quitar el logo (✕); miniatura del logo solo PNG/JPG.
7. Interruptor de datos en vivo: nace desactivado y deshabilitado sin conexión (la suite nace activado).
8. Área de **log** paso a paso y estado de las 13 secciones; textos «Detectado: …», «ZIP → …».
9. Nombre de archivo `Documentacion_PA_<PA>_<AAAA-MM-DD>.docx`.
10. Voseo en la suite: «Soltá el ZIP…» → v7: «Arrastra los CSV aquí». Corregir ya.
11. Textos de las zonas de carga y de los paneles (los de v7).

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
pendiente para la red:** la vista tiene las filas en memoria; las hojas Location Source / Customer Source
de v7 pueden tener cientos de miles de filas y v7 las paginaba desde IndexedDB. O se capa y se avisa, o
se hace una variante paginada.

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

**7. Qué se puede retirar cuando la red se migre** — `AnalizadorV7.jsx`, `InformeDeCalidad.jsx`,
`production-rules.js`, `production-analysis.js` (solo conserva `texto`), `production-analyze.js` (solo
conserva `tiposDeMaterial`), `network-analysis.js`, `network-analyze.js`, `network-load-sap.js` y las
tablas `pa_*` / `sn_*_web` de IndexedDB.

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
2. Network Visualizer (puntos 1, 5, 6, 8, 9, 10; luego Rutas, Filtros, pantalla completa).
3. Production Analyzer y Network Analyzer: pasos ②–⑤, modal, vista web y Excel (la parte grande).
4. Planning Area Documenter: lo pequeño primero (voseo, logo, Autor/Versión, Limpiar), luego el documento.

Antes de cada una: recorrer los controles de v7 uno a uno y mirar la pantalla en el tenant de pruebas.
