# Por dónde seguir

Este archivo es el punto de entrada cuando la instrucción es **«continuemos»**. Se lee primero, se
actualiza al terminar cada sesión, y su orden es el de prioridad acordada.

Última actualización: **2026-08-25**.

## Dónde estamos

- **En línea**: https://goscm-ibp-suite.vercel.app — cada subida a `main` se publica sola.
- **2.436 pruebas**, lint y build limpios, y el build **sin ningún aviso**. Bajaron de 2.476 porque se
  borró `core/odata/` con las suyas: estaba escrito y sin conectar a nada (ver `core/README.md`).
- Los tres proyectos previos están portados: sin huecos de funcionalidad en v7, v8 ni v9.
- Las cuatro áreas —Data Tools, IBP Tools, CI-DS Tools y Administración— están **recorridas pantalla
  por pantalla contra los tenants reales**. De ahí salieron once fallos, todos arreglados.
- **La revisión de alcance y filtros está terminada** en v7, v8 y v9: cada pantalla pide el mismo
  conjunto de datos que su original. Salieron cinco diferencias y las cinco están corregidas — están
  contadas en los tres documentos de paridad, en la sección «Lo que pide cada pantalla».

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

### 3. Una revisión de aspecto, con la pantalla señalada

El usuario pidió que la interfaz sea «bonita e intuitiva». No se hizo, a propósito: es un criterio suyo
y tocar espaciados y colores a ciegas rompe cosas sin poder verificarlo. **Pedirle dos o tres pantallas
concretas** que le resulten feas o confusas, y trabajar sobre esas.

Lo que sí se observó recorriéndolas: son consistentes y explican lo que hacen —cada una tiene su bloque
de «cómo se lee esto», los avisos dicen qué hacer, y la procedencia del dato está siempre visible—. Los
once fallos encontrados fueron de **veracidad**, no de aspecto.

### 4. El idioma (es/en)

Fase propia y deliberadamente la última. Toca cada pantalla. No bloquea nada.

## Decisiones abiertas que necesitan al usuario

| Qué | Por qué no se decide solo |
|---|---|
| Cada cuánto avanza una orquestación | Es su operación, no un detalle técnico |
| Verificar un dominio de correo | Hay que quitar `MAIL_REDIRECT_TO` antes del primer cliente: mientras esté, quien lea ese buzón entra como cualquier usuario |
| Si el árbol de un semiterminado debe ofrecer la planta donde se fabrica **y** se consume | Hoy no la ofrece, y antes tampoco de verdad. Está anotado en la prueba que lo cubre |
| Vercel Pro | Cuesta dinero y hace falta para las tareas programadas |

## Lo que ahora hay que estrenar con más ganas

Tres de las cinco correcciones de alcance solo se pueden comprobar de verdad contra un tenant:

- **La descarga del Explorer** compara ahora lo bajado con lo que SAP dice que hay, y avisa si falta.
  Las tablas grandes —1,4 millones de filas— **nunca se bajaron de verdad**: solo se contaron. Es la
  primera vez que ese aviso puede dispararse.
- **La copia de cifras clave** acota la lectura a las filas con valor. Si SAP rechaza el predicado, la
  pantalla lo dice y lee el nivel entero; hay que ver cuál de los dos caminos toma en el tenant.
- **Bajar solo «Red de suministro»** ahora trae también los dos maestros. Se ve en un momento: la red
  tiene que distinguir proveedores de plantas.

## El patrón que unía los once fallos

Vale tenerlo presente al escribir pantallas nuevas: **un hueco escrito como si fuera un dato.**

Un tope de lista presentado como total («400 materiales» cuando 400 era el tope); el conteo de la
corrida anterior bajo un encabezado que dice «Guardadas»; «todavía no hay clientes» mientras se está
preguntando; dos números en la misma tarjeta que no cuadran; un `403` sin decir qué acuerdo falló; el
árbol de un producto mostrando las recetas de sus componentes.

En todos, la pantalla afirmaba algo que no le constaba. Y ninguno era detectable por las pruebas.
