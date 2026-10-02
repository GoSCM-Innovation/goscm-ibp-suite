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
