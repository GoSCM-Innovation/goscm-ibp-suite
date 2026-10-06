# Por dónde seguir

Este archivo es el punto de entrada cuando la instrucción es **«continuemos»**. Se lee primero, se
actualiza al terminar cada sesión, y su orden es el de prioridad acordada.

Última actualización: **2026-10-06**.

## Dónde estamos

- **Tira de conexiones con el detalle dentro (2026-10-06, a petición del usuario)**: desaparecen las
  franjas de IBP Tools (`CabeceraDeConexion`) y CI-DS Tools (`CabeceraDeCids`). La pestaña activa se
  ensancha y lleva «↗» (enlace a SAP IBP, solo IBP) y «ⓘ» con el detalle; el tooltip de cada pestaña
  lleva la dirección. Detalle y decisión en `PARIDAD-V8.md` / `PARIDAD-V9.md`. **Pendiente: verlo en
  el sitio** (cuadro de detalle, ancho de la pestaña activa, móvil).
- **Armazón (2026-10-06, a petición del usuario)**: (1) la flecha de Data Tools pliega y despliega sus
  aplicaciones desde cualquier pantalla, antes solo funcionaba estando dentro del módulo (minimizado
  se mantiene: solo las del módulo abierto). (2) **Ya no hay barra superior en pantallas anchas**: logo +
  «Suite» van arriba del menú lateral (minimizado, solo el «GO» del logo recortado) y el contenido sube
  hasta el borde; la cabecera solo existe en móvil. Nombre, etiqueta «Plataforma», tema y «Salir» van a
  continuación de Gestión, antes de «Requisitos técnicos» (pie). **Pendiente: verlo en el sitio**, sobre
  todo el recorte del logo con el menú minimizado.
- **Administración → Conexiones, alta de acuerdos (2026-10-06, a petición del usuario)**: «Acuerdo» pasó de
  cuadro de texto con sugerencias a **desplegable** con el nombre de cada acuerdo, una línea «Activa: …»,
  marca «(ya configurado)» y opción «Otro (escribir el código)…». La tabla de acuerdos guardados muestra
  el nombre bajo el código. Los nombres salen de `ACUERDOS_IBP` en `src/lib/requisitos-tecnicos.js`, la
  misma fuente del panel de Requisitos Técnicos. **Pendiente: verlo en el sitio** (el inicio de sesión es
  por código al correo y no se pudo abrir en local).
- **Production Analyzer cotejado celda a celda contra v7 (2026-10-06)**, mismo tenant y parámetros. Dos
  hallazgos. (1) **Defecto corregido**: la descarga paginaba por los dos primeros campos del `$select`, y
  en Location Source (`LOCID, LOCFR`, sin `PRDID`) miles de filas quedaban empatadas: SAP las desempataba
  distinto en cada página y la base local tenía 27.643 filas con solo 25.440 distintas, con el total
  intacto. Faltaban arcos de abastecimiento y de ahí salían orígenes perdidos, alertas de más y otro
  Resumen. Ahora cada tabla de `EXTRACCIONES` declara su `clave` completa y de ella sale el `$orderby`.
  **Comprobado el mismo día con una corrida nueva de los dos lados**: Location y Resumen coinciden en todas
  las cifras, Product coincide fila a fila (solo cambia el orden de dos columnas) y Prod Source Resource
  coincide como conjunto. Las claves de las otras tablas se declararon por el modelo de IBP, no se midieron. (2) **Diferencia de parámetros, no de código**: ZVER con «Mercadería + Mat. Prima /
  Insumo» en v7 y solo «Insumo» en la Suite da otras reglas (gana la más permisiva). Ese
  ajuste quedó igual en la segunda corrida. **Lo que sigue distinto, sin valores de por medio**: el orden de las
  filas de Prod Source Item y Resource (v7 usa el natural de SAP, que no se puede reproducir con una paginación
  estable; la Suite ordena por clave), «Reemplaza a» en 3 filas por la misma razón, el orden de los campos
  adicionales (en cada app es el de selección) y el «API Base URL» (la Suite muestra «—» a propósito).
  Corregido el encabezado «Alertas»/«Advertencias» del Resumen, que llevaba un espacio de más.

- **CI-DS Tools entero igualado a v9 (2026-10-05)**: Integration Explorer, Mapping Dataflow Generator,
  Resumen Global, Resumen, Projects & Tasks, Task Monitor, Orquestaciones y el marco (cabecera, pestañas,
  Requisitos Técnicos, logs técnicos). Ver las secciones con esos nombres en `PARIDAD-V9.md`, cada una con
  la tabla de lo que sigue siendo distinto y por qué. **Pendiente: verlo en el sitio con un tenant real**
  (nada se comprobó contra SAP; el lienzo de Orquestaciones no se miró en el navegador) y generar un Excel
  real de los dos lados para cotejarlo celda a celda. Sin decisión del usuario: reordenar conexiones
  arrastrando (v9 sí, aquí no) y borrar las reglas de CSS sin uso de las Orquestaciones viejas.
- **Revisión de paridad del 2026-10-05** (v7 `e628db5`, v8 `ed718ed`, v9 `b078052`, ya sincronizados): v7 y
  v8 sin pendientes. **v9 tenía tres huecos** (detalle en `PARIDAD-V9.md`): los `<messageLine>` de los logs de tarea
  (**hecho**), los scripts pre/post-load del Integration Explorer (**hecho**), y el SSRF
  con IPv4 embebida en IPv6 hexadecimal. El tercero, comprobado a mano, **no es explotable aquí** (los hosts
  numéricos se rechazan antes): queda como defensa en profundidad, no como urgencia.
- **Cambios de interfaz pedidos por el usuario el 2026-10-05** (pendientes de verlos en el sitio):
  1. **Las pestañas de conexión muestran TODAS las conexiones**, sin «+» ni ✕ (IBP Tools y CI-DS Tools), y
     la cabecera del tenant pone el nombre y «Abrir en SAP IBP ↗» en una sola fila.
  2. **Data Tools lleva la misma tira de tenants.** Sigue habiendo un solo destino activo (como v7): la
     pestaña es un atajo al asistente. Si ya se eligió área y versión en ese tenant en la sesión, vuelve
     a ellas; si no, abre el asistente directo en el área (`verAsistente(true, { conexionId })`). Cambiar
     de pestaña empieza de cero las aplicaciones, como «Cambiar tenant». **Decisión tomada: opción A**; la
     B (cada tenant conserva sus aplicaciones vivas en segundo plano) queda por si hace falta.
  3. **El menú de Data Tools se pliega como árbol** (flecha ▾/▸, recordada en `menu_plegados`).
  4. **Planning Area Documenter, oculto de momento** (`oculta` en `lib/modules.js`).
- **Decisión del usuario, 2026-10-01: Data Tools tiene que ser IDÉNTICO a v7.** La auditoría completa
  está en [`docs/PARIDAD-DATA-TOOLS.md`](PARIDAD-DATA-TOOLS.md). **Hecho el 2026-10-05**: las seis
  aplicaciones de Data Tools están igualadas a v7 en código —Glosario, Production Visualizer, Production
  Analyzer, Network Visualizer, **Network Analyzer** (algoritmo cotejado contra la salida real de v7, vista
  web con las hojas de arcos paginadas desde IndexedDB y Excel partido a 900.000 filas) y Planning Area
  Documenter—. **Lo que falta es mirarlas contra un tenant real** (cada sección de ese documento tiene su
  «Sin confirmar») y abrir el Excel de los dos analizadores en Excel de verdad.
- **Tres correcciones más del 2026-10-01 al conectar un tenant** (pendientes de verlas en el sitio):
  1. El asistente **se cierra** al terminar el paso ③, como `closeConnectDialog` de v7. Ya no hay cuadro
     «Conexión activa» con «Cerrar» (ese panel solo sale al abrir el diálogo estando ya conectado).
  2. **Al conectar se borra lo guardado en el navegador de OTRO tenant/área/versión**
     (`reiniciarSiOtroOrigen`, el `resetAllModules()` de v7). Antes el árbol («Árbol 1») aparecía de
     inmediato con productos de otro sistema, porque la comprobación de origen solo corría al descargar.
     **Corregido el 2026-10-05:** ya NO se conserva ni siquiera lo del mismo destino —el usuario vio el
     buscador del Production Visualizer al reconectar, antes de descargar—: conectar borra todo, como v7.
     Navegar entre aplicaciones no borra nada; solo conectar o cambiar de tenant (`reiniciarAlConectar`).
  3. **El mapeo ya no parpadea.** El destino se recalculaba como objeto nuevo en cada dibujo y la
     relectura de sesión (al volver a la pestaña) hacía que el mapeo se vaciara y pidiera todo a SAP otra
     vez. Ahora `DataTools` lo memoriza por tenant/área/versión.
- **Dos correcciones del 2026-10-01, pendientes de verlas en el sitio desplegado.**
  1. **El Glosario Analyzers ahora es el de v7**, no una versión derivada del código que se había
     inventado y no se parecía al original. Dos pestañas, índice lateral, leyenda y secciones por hoja,
     y «↓ Exportar PDF». Ver `docs/PARIDAD-V7.md`. **Falta comprobar el PDF descargado de verdad** y el
     seguimiento del índice al desplazarse: en el panel de vista previa no disparan los eventos de scroll.
  2. **«Desconectado / Conectar SAP IBP» salió del menú lateral.** Cada aplicación de Data Tools (menos
     el Glosario) lleva una barra de tenant con «Cambiar tenant». Lo último elegido lo heredan las demás.
     Si se quiere un desplegable directo de tenants en vez del asistente de tres pasos, es el siguiente paso.
- **En línea**: https://goscm-ibp-suite.vercel.app
- **El despliegue automático vuelve a funcionar.** Arreglado el 2026-09-05, y la causa era una sola
  cosa: **el remoto de git de esta carpeta seguía apuntando al sitio viejo**
  (`gahumadatoledo-cmyk/goscm-ibp-suite`). El repositorio se había movido a `GoSCM-Innovation`, y
  GitHub contestaba a cada push con «This repository moved». El push LLEGABA —por redirección— y por
  eso nada parecía roto, pero **una redirección no dispara los webhooks**, así que Vercel no se
  enteraba. De ahí los huecos de ocho y de once días entre despliegues.

  ```bash
  git remote set-url origin https://github.com/GoSCM-Innovation/goscm-ibp-suite.git
  ```

  Comprobado: el push siguiente disparó un despliegue solo, quedó `Ready` en 15 s, y el bundle que
  sirve `goscm-ibp-suite.vercel.app` es el mismo que el del build local. **Ya no hace falta desplegar
  a mano.**

  Lo que hay que mirar si vuelve a pasar: que `git remote -v` apunte a `GoSCM-Innovation`, y que un
  push no conteste «This repository moved». Si alguien clonó de la URL vieja, tiene el mismo problema
  sin que nada avise. Desplegar a mano sigue siendo el respaldo:

  ```bash
  vercel --prod --yes
  ```
- **2.671 pruebas**, lint y build limpios, y el build **sin ningún aviso**.
- Los tres proyectos previos están portados en funcionalidad.
- **La interfaz de los TRES está restaurada tal cual era.** Es una decisión del usuario y ahora es
  regla del proyecto: ver [«Respetar la interfaz de origen»](../CLAUDE.md#respetar-la-interfaz-de-origen).
  - v7: asistente de tres pasos, sus seis aplicaciones con sus nombres, el acordeón ① a ⑤ y el grafo
    interactivo. [Detalle](PARIDAD-V7.md#la-interfaz-de-v7-restaurada).
  - v8: sus nueve pestañas con sus nombres y su orden, la condición por acuerdo, la cabecera de la
    conexión, y los cinco controles del visor —pestañas, secciones plegables, preselecciones de
    columnas, ordenar y filtrar por columna—. [Detalle](PARIDAD-V8.md#la-interfaz-de-v8-restaurada).
  - v9: sus nombres, su orden y la tira de pestañas de conexiones abiertas.
    [Detalle](PARIDAD-V9.md#la-interfaz-de-v9-restaurada).
- Comparar CONTROLES —y no archivos— destapó **diecisiete huecos de funcionalidad**, todos dentro de
  archivos que el inventario daba por portados. **Los diecisiete están cerrados.**
- **Corrida contra un tenant real, la primera (2026-09-05).** El usuario corrió Production Visualizer
  contra `GCINDURAMA · IBP CONSENSO QA` y salieron tres cosas que ninguna prueba podía ver. Las tres
  están cerradas:
  - **El árbol no veía lo bajado.** La descarga guardó las 98.956 filas y el árbol seguía diciendo «no
    hay recetas descargadas»: se montaba antes de bajar, leía la base vacía y nadie le avisaba nunca.
    [Detalle](PARIDAD-V7.md#el-árbol-no-veía-lo-que-se-acababa-de-bajar).
  - **La descarga no era la de v7.** Había un panel aparte con una tabla de cuatro columnas; v7 tenía
    barra de progreso, línea de estado con color y «Ver logs técnicos», y todo dentro del paso ①. Lo
    que la tabla decía —y v7 no— se mudó al registro.
    [Detalle](PARIDAD-V7.md#la-descarga-que-se-había-reinventado).
  - **No había dónde cambiar de conexión** en IBP Tools ni en CI-DS Tools. La tira dibujaba solo las
    pestañas ya abiertas; en v9 se abría una desde el menú lateral, que aquí lista módulos.
    [Detalle](PARIDAD-V9.md#el--no-había-forma-de-cambiar-de-conexión).

  **La lección, que es lo reutilizable:** las tres estaban a un clic de distancia de cualquiera que
  abriera la aplicación, y ninguna se veía leyendo el código. Correr una pantalla de punta a punta
  contra un tenant destapa en diez minutos más que un recorrido de archivos.

## IBP Tools, portado otra vez — 2026-09-30 / 10-01

El usuario comparó «Ver Dato Maestro» lado a lado con v8 y la de aquí era peor y hacía otra cosa (no
tenía la versión base). Al recorrer TODAS las pestañas control por control resultó que casi todo IBP
Tools eran rediseños. Se portaron otra vez, una por una, desde el código de v8: el marco (cabecera,
barra de pestañas, «📊 Resumen» junto a las conexiones), Ver Dato Maestro, Ver Dato Transaccional,
Resumen y Resumen global, Job Templates y Job Monitor, Resource Stats, Telemetría, Orquestador y
los dos modos de Migración. El detalle y los fallos de datos que salieron están en
[PARIDAD-V8.md](PARIDAD-V8.md#2026-09-30-la-tabla-de-abajo-decía-portado-y-no-lo-era).

**Mirado con datos de muestra, no contra un tenant.** Lo primero es abrir cada pestaña contra un
tenant real (mejor el de acuerdos separados) y compararla con v8 en la misma conexión. Lo que más
puede sorprender, por haberse escrito de nuevo del lado del servidor: Telemetría (ordena por la
clave que declara cada conjunto en su `$metadata`), el panel de pasos de Job Monitor (lecturas
nuevas), y los tramos de las dos migraciones (ahora la función de `/api/ibp` tiene 300 s).

Para que la cabecera diga lo mismo que v8, las conexiones se llaman sin el ambiente («CLARO CO»): el
«(Producción)» o «(Calidad)» lo agrega la aplicación.

## Lo siguiente, en orden

### 0. Los tres fallos de «Llamadas técnicas» de la corrida del 2026-09-05

En la captura del usuario, la barra de abajo decía **90 llamadas, 3 con fallo**, y la descarga terminó
bien igual. No se sabe qué eran: la barra global agrupa por ruta y no dice de qué paso salió cada una.

**Ahora se puede averiguar sin adivinar:** el registro de la descarga escribe una línea por tabla, con
el nombre real de la entidad y lo que devolvió. Volver a correr Production Visualizer contra el mismo
tenant y abrir «Ver logs técnicos». Si los tres son de tablas accesorias es lo normal —hay papeles que
ese tenant no cubre—; si son de una esencial, hay algo más.

### 1. Estrenar las escrituras contra SAP, con el usuario delante

Está todo construido y probado en lectura, y **nada se ha ejecutado**: lanzar un trabajo, cargar una
migración, modificar y borrar dato maestro, copiar cifras clave, lanzar una orquestación y lanzar una
tarea de CI-DS. No se hace en una corrida desatendida. Cada documento de paridad lo lista en su sección
«Sin estrenar».

### 2. Las tareas programadas

La guarda ya está escrita —`handlers/cids/cron-tick.js` valida `CRON_SECRET` y rechaza si es corto—
pero **`vercel.json` no declara ningún `crons`**, así que nada se dispara. Falta una decisión del
usuario: **cada cuánto debe avanzar una orquestación en marcha**. Con eso se escriben las
declaraciones. Necesita además Vercel Pro.

### 3. El idioma (es/en)

Fase propia y deliberadamente la última. Toca cada pantalla. No bloquea nada.

## Decisiones abiertas que necesitan al usuario

| Qué | Por qué no se decide solo |
|---|---|
| Cada cuánto avanza una orquestación | Es su operación, no un detalle técnico |
| Verificar un dominio de correo | Hay que quitar `MAIL_REDIRECT_TO` antes del primer cliente: mientras esté, quien lea ese buzón entra como cualquier usuario |
| Si el árbol de un semiterminado debe ofrecer la planta donde se fabrica **y** se consume | Hoy no la ofrece, y antes tampoco de verdad. Está anotado en la prueba que lo cubre |
| Vercel Pro | Cuesta dinero y hace falta para las tareas programadas |

## Lo que hay que estrenar con más ganas

- **El grafo de la red.** Vuelve a ser el lienzo interactivo de v7 y no se ha visto contra un tenant.
  Lo que hay que mirar: que las columnas se lean de izquierda a derecha —proveedores, plantas,
  ubicaciones, producto, clientes— y que los arcos no se crucen más de la cuenta. El orden dentro de
  cada columna lo decide `posicionesEnLienzo`, con sus pruebas.
- **El panel de rutas.** Es nuevo aquí y su hallazgo principal —la **planta huérfana**— no se puede
  fabricar en una prueba: hace falta una red real para saber si aparece y si tiene sentido.
- **La exportación por lotes del árbol.** Pegar treinta materiales y ver cuánto tarda.
- **La descarga del Explorer** compara ahora lo bajado con lo que SAP dice que hay, y avisa si falta.
  Las tablas grandes —1,4 millones de filas— **nunca se bajaron de verdad**: solo se contaron.
- **La copia de cifras clave** acota la lectura a las filas con valor. Si SAP rechaza el predicado, la
  pantalla lo dice y lee el nivel entero; hay que ver cuál de los dos caminos toma en el tenant.

## Lo que no se pudo comprobar con los ojos

**No se puede entrar a la aplicación en desarrollo**: el ingreso pide el código que llega al correo.
Para mirar la interfaz se montó las tres veces un andamio temporal —un `preview.html` con una página
que dibuja las piezas con datos de muestra— que se borró al terminar. **Si hace falta otra vez, se
vuelve a montar y se vuelve a borrar**: es la única forma de ver una pantalla sin poder entrar.

Con él se vieron el menú, el asistente de v7, el acordeón, la tira de pestañas de conexiones, la
cabecera de la conexión, las pestañas de los visores, las secciones plegables, la cabecera de tabla
con orden y filtro, el menú minimizado, y —el 2026-09-05— la descarga con la forma de v7 y el «+» de
la tira con su desplegable.

Dos cosas que valen para la próxima vez:

- **Mirar sirve para lo que las pruebas no pueden ver.** El desplegable del «+» pasaba sus quince
  pruebas y **no se veía**: la tira tiene `overflow-x: auto` y lo recortaba. Se descubrió preguntándole
  al navegador con `elementFromPoint` si el menú estaba de verdad ahí donde decía estar. Ese truco
  —comprobar que un elemento es alcanzable, no solo que existe en el DOM— vale para cualquier panel
  flotante.
- **Para que una pieza se pueda dibujar sola hay que poder sacarla.** La parte visual de la descarga
  se separó en `ProgresoDeDescarga`, exportada desde `ExplorerExtract.jsx`, justamente para poder
  pintarla con datos falsos sin un tenant delante. Conviene hacer lo mismo con lo que venga.

Lo que sigue sin verse es todo lo que necesita datos de un tenant: el árbol, el lienzo de la red, las
rutas, los informes y las tablas con filas de verdad.

Y una cosa más, que es de ratón y no de datos: **el ancho de columna a mano**. El cálculo está probado
—qué se compara, qué holgura se suma, entre qué topes queda— pero arrastrar el borde y hacer doble
clic en él no se probó con la mano. Son diez segundos en la primera tabla que se abra.

## El patrón que unía los once fallos

Vale tenerlo presente al escribir pantallas nuevas: **un hueco escrito como si fuera un dato.**

Un tope de lista presentado como total («400 materiales» cuando 400 era el tope); el conteo de la
corrida anterior bajo un encabezado que dice «Guardadas»; «todavía no hay clientes» mientras se está
preguntando; dos números en la misma tarjeta que no cuadran; un `403` sin decir qué acuerdo falló; el
árbol de un producto mostrando las recetas de sus componentes.

En todos, la pantalla afirmaba algo que no le constaba. Y ninguno era detectable por las pruebas.

El del 2026-09-05 es el doceavo y el más puro de todos: **«No hay recetas descargadas»** dicho justo
debajo de un «✓ Se guardaron 98.956 filas». La pantalla no sabía si había recetas — sabía que no las
había cuando preguntó, cinco minutos antes, y nadie le dijo que volviera a mirar.

## Y un segundo patrón, de esa misma corrida

**Una función que existe y ningún control llama.** Salió dos veces el mismo día:

- `ExplorerExtract` tenía un `onTerminada` que ninguna pantalla pasaba. Por eso el árbol no se
  enteraba de nada.
- `IbpTools` tenía un `elegir(id)` que abre una pestaña, y no había ningún botón que lo llamara con
  una conexión sin abrir. Por eso no se podía cambiar de tenant.

Las dos veces el código estaba escrito, probado por debajo y **desconectado**, y las dos veces eso se
lee como una funcionalidad que falta. Ni el lint ni las pruebas lo pueden ver: una función exportada
que nadie usa es legítima. Lo que sí lo ve es abrir la pantalla e intentar hacer la cosa. Cuando se
escriba un `onAlgo` o un `elegirAlgo` nuevo, conviene comprobar en el acto quién lo dispara.
