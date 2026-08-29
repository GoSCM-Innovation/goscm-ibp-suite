# Por dónde seguir

Este archivo es el punto de entrada cuando la instrucción es **«continuemos»**. Se lee primero, se
actualiza al terminar cada sesión, y su orden es el de prioridad acordada.

Última actualización: **2026-08-29**.

## Dónde estamos

- **En línea**: https://goscm-ibp-suite.vercel.app — cada subida a `main` se publica sola.
- **2.603 pruebas**, lint y build limpios, y el build **sin ningún aviso**.
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
- Comparar CONTROLES —y no archivos— destapó **dieciséis huecos de funcionalidad**, todos dentro de
  archivos que el inventario daba por portados. Quince cerrados; queda uno, el ancho de columna a mano
  del visor de v8.

## Lo siguiente, en orden

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
Para mirar la interfaz se montó las dos veces un andamio temporal —un `preview.html` con una sesión
falsa— que se borró al terminar. **Si hace falta otra vez, se vuelve a montar y se vuelve a borrar**:
es la única forma de ver una pantalla sin poder entrar.

Con él se vieron el menú, el asistente de v7, el acordeón, la tira de pestañas de conexiones, la
cabecera de la conexión, las pestañas de los visores, las secciones plegables, la cabecera de tabla
con orden y filtro, y el menú minimizado.

Lo que sigue sin verse es todo lo que necesita datos de un tenant: el árbol, el lienzo de la red, las
rutas, los informes y las tablas con filas de verdad.

## El patrón que unía los once fallos

Vale tenerlo presente al escribir pantallas nuevas: **un hueco escrito como si fuera un dato.**

Un tope de lista presentado como total («400 materiales» cuando 400 era el tope); el conteo de la
corrida anterior bajo un encabezado que dice «Guardadas»; «todavía no hay clientes» mientras se está
preguntando; dos números en la misma tarjeta que no cuadran; un `403` sin decir qué acuerdo falló; el
árbol de un producto mostrando las recetas de sus componentes.

En todos, la pantalla afirmaba algo que no le constaba. Y ninguno era detectable por las pruebas.
