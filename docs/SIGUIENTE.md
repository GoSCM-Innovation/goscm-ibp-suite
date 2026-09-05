# Por dónde seguir

Este archivo es el punto de entrada cuando la instrucción es **«continuemos»**. Se lee primero, se
actualiza al terminar cada sesión, y su orden es el de prioridad acordada.

Última actualización: **2026-09-05**.

## Dónde estamos

- **En línea**: https://goscm-ibp-suite.vercel.app
- **El despliegue automático NO está funcionando.** Comprobado el 2026-08-29: el último despliegue que
  disparó un `git push` era de ocho días antes, con varios push por medio.

  **Media causa encontrada el 2026-09-05.** El remoto de git de esta carpeta seguía apuntando al
  sitio viejo (`gahumadatoledo-cmyk/goscm-ibp-suite`) y GitHub contestaba a cada push con «This
  repository moved»: el push llegaba por redirección, pero **una redirección no dispara los webhooks**,
  así que Vercel no se enteraba de nada. El remoto ya está corregido a
  `GoSCM-Innovation/goscm-ibp-suite`.

  **Lo que falta comprobar en el próximo push:** si con eso el despliegue automático vuelve solo. Si
  no vuelve, entonces sí hay que reenlazar la conexión de Git del proyecto en Vercel al repositorio
  nuevo. Mientras siga así, cualquiera que mire la web verá una versión vieja sin que nada avise.

  Y en cualquier caso, **desplegar a mano** desde la carpeta del proyecto sigue funcionando:

  ```bash
  vercel --prod --yes
  ```

  Tarda medio minuto y deja el alias puesto en el dominio de siempre.
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
