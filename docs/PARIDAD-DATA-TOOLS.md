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
| Production Analyzer | ❌ Pendiente — ver abajo |
| Network Visualizer | ✅ Igualado a v7 (2026-10-01), con las diferencias dichas abajo. Falta mirarlo en el tenant |
| Network Analyzer | ❌ Pendiente — ver abajo |
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

## Production Analyzer — pendiente (de más a menos visible)

1. **Pantalla de resultados** (grande). v7: vista web `snWebView.js` con cabecera «🌐 Production Analyzer
   — vista web», botones «⬇️ Descargar Excel / ⛶ Pantalla completa / Cerrar» (y «Ver resultados»),
   tarjetas de resumen por hoja, pestañas por hoja con total (Resumen, Product, Location, Resource,
   Resource Location, Prod Source Header, Prod Source Item, Prod Source Resource, Tipos Excluidos,
   📈 Estadísticas), chips «Todos / ⛔ Alertas / ⚠ Advertencias / ✅ OK», buscador «Buscar en {hoja}...»,
   columnas redimensionables, popup de celda con «Copiar», paginación de 50 con «Mostrando a–b de n».
   La suite tiene tres pestañas propias (Por producto / ubicación / recurso), chips 🔴🟡🔵🟢 y «Descargar CSV».
2. **Excel** `ProductionHierarchyAnalysis_<fecha>.xlsx` con una hoja por pestaña. La suite no genera Excel.
3. **Modal «¿Cómo quieres ver el análisis?»** al ejecutar (Ver en la web / Descargar Excel / Ambos /
   Cancelar) y banner «✅ ¡Análisis completado!».
4. **Mapeo ①**: 10 tarjetas de v7 (con Location Product y Location Source; sin «Validez de los
   componentes»), etiquetas en inglés, buscador «Buscar entidad...», «(ninguna)», lista de campos,
   «Continuar →» / «Reconectar». La suite tiene 9 tarjetas con etiquetas en español.
5. **Descarga**: el análisis necesita las tablas de red (`sn_loc`, `sn_loc_prod`) y la suite descarga solo
   el grupo `arbol` (no confirmado: hay que correrlo).
6. **Tipos de material**: v7 los trae con una lectura ligera de SAP al confirmar el mapeo, antes de bajar
   nada; la suite los lee de lo ya descargado y en la primera corrida juzga sin configuración.
7. **② Excluir tipos** (columnas «Tipo / Productos / Incluir en análisis», «N prods», «Incluido/Excluido»),
   **③ Categorizar** (matriz con tooltips «?», nombres de categoría de v7), **④ Campos adicionales**
   (siete botones con modal, buscador, «Campos obligatorios», contador).
8. **⑤ Ejecutar**: textos de progreso de v7 (`Descargando X → IDB...`, `Indexando Product...`,
   `Analizando...`, `✓ Completado · N ms`), log `[+Nms] [GET]…`, el botón no cambia de texto, sin «Cancelar».
9. Panel «Interpretación de resultados» (enlace al glosario) bajo el banner. Falta.
10. v7 **siempre** vuelve a descargar; la suite omite la descarga si hay datos (`bajarSiVacio`).
    Decisión a tomar con el usuario: es una mejora deliberada, pero cambia el comportamiento.

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
