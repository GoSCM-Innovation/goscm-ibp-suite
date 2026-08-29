# Por dónde seguir

Este archivo es el punto de entrada cuando la instrucción es **«continuemos»**. Se lee primero, se
actualiza al terminar cada sesión, y su orden es el de prioridad acordada.

Última actualización: **2026-08-28**.

## Dónde estamos

- **En línea**: https://goscm-ibp-suite.vercel.app — cada subida a `main` se publica sola.
- **2.564 pruebas**, lint y build limpios, y el build **sin ningún aviso**.
- Los tres proyectos previos están portados en funcionalidad.
- **La interfaz de v7 está restaurada tal cual era**: asistente de conexión de tres pasos, sus seis
  aplicaciones en el menú con sus nombres, el acordeón numerado ① a ⑤ dentro de los analizadores, y el
  grafo interactivo de la red con la misma librería. Ver
  [«La interfaz de v7, restaurada»](PARIDAD-V7.md#la-interfaz-de-v7-restaurada).
- De esa revisión salieron **cinco huecos de funcionalidad** que el inventario de archivos no podía
  ver, los cinco portados: exportar una lista de materiales a un Excel, exportar el árbol que se mira,
  el paso ④ de campos adicionales, el **árbol invertido** (dónde se usa un insumo) y el **panel de
  rutas** (si lo que sale de cada planta llega a alguien).

## Lo siguiente, en orden

### 1. La misma restauración de interfaz para v8 y v9

Es lo acordado con el usuario y es lo que sigue. **La interfaz de los proyectos de origen se respeta
tal cual**: llevan años de uso delante de clientes y está trabajada.

El método que funcionó en v7, y que conviene repetir literalmente:

1. Traer `public/index.html` (o el equivalente) de `origin/master` y **recorrer sus botones uno a uno**,
   comprobando cuál existe aquí. No comparar archivos: comparar CONTROLES.
2. Anotar la forma —qué es un asistente, qué es un acordeón, qué se despliega y cuándo— antes de tocar
   nada, y presentarla al usuario.
3. Portar el CSS del original **copiado, no reinterpretado**, con sus variables de espaciado si hace
   falta. Traducir a mano es donde se cuelan las diferencias de dos píxeles.
4. Los nombres de las aplicaciones se quedan como estaban, aunque sean en inglés.

Lo que hay que mirar primero en cada uno: **cuántas aplicaciones tenía su menú y qué recorrido pedía
cada una.** En v7 eran seis aplicaciones y un asistente de tres pasos; aquí se habían convertido en
siete pestañas y tres desplegables.

### 2. Estrenar las escrituras contra SAP, con el usuario delante

Está todo construido y probado en lectura, y **nada se ha ejecutado**: lanzar un trabajo, cargar una
migración, modificar y borrar dato maestro, copiar cifras clave, lanzar una orquestación y lanzar una
tarea de CI-DS. No se hace en una corrida desatendida. Cada documento de paridad lo lista en su sección
«Sin estrenar».

### 3. Las tareas programadas

La guarda ya está escrita —`handlers/cids/cron-tick.js` valida `CRON_SECRET` y rechaza si es corto—
pero **`vercel.json` no declara ningún `crons`**, así que nada se dispara. Falta una decisión del
usuario: **cada cuánto debe avanzar una orquestación en marcha**. Con eso se escriben las
declaraciones. Necesita además Vercel Pro.

### 4. El idioma (es/en)

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
Para mirar la interfaz de v7 se montó un andamio temporal —un `preview.html` con una sesión falsa— que
se borró al terminar; si hace falta otra vez, se vuelve a montar y se vuelve a borrar. Con él se vio el
menú, el asistente, la cinta, la pantalla de módulo restringido y el acordeón. Lo que sigue sin verse
es todo lo que necesita datos de un tenant: el árbol, el lienzo, las rutas y los informes.

## El patrón que unía los once fallos

Vale tenerlo presente al escribir pantallas nuevas: **un hueco escrito como si fuera un dato.**

Un tope de lista presentado como total («400 materiales» cuando 400 era el tope); el conteo de la
corrida anterior bajo un encabezado que dice «Guardadas»; «todavía no hay clientes» mientras se está
preguntando; dos números en la misma tarjeta que no cuadran; un `403` sin decir qué acuerdo falló; el
árbol de un producto mostrando las recetas de sus componentes.

En todos, la pantalla afirmaba algo que no le constaba. Y ninguno era detectable por las pruebas.
