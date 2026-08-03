# Fase 0 — Levantamiento de módulos unificables

Entregable de la Fase 0 del plan maestro de **V10 / `goscm-ibp-suite`**. Inventario de la lógica que hoy está duplicada entre v7, v8 y v9, y diseño de la **capa transversal compartida** que la reemplaza.

Fecha: 2026-08-03. Fuente: análisis directo del código de los tres proyectos (no de su documentación, que en varios puntos está desactualizada).

---

## 1. Resumen ejecutivo

Los tres proyectos resuelven **el mismo problema tres veces**: hablar con SAP (IBP por OData, CI-DS por SOAP) de forma autenticada, paginada y resiliente. Cada uno lo hizo con su propio proxy, su propia validación, su propio modelo de conexión y su propio manejo de credenciales.

La consolidación no es cosmética: **elimina tres deudas de seguridad reales** (credenciales en texto plano en el navegador, un token de API público de facto, ausencia de aislamiento por cliente) y colapsa unas 10 piezas duplicadas en una sola capa.

Tres hallazgos cambian la planificación:

1. **v7 es mucho más grande de lo que asumía el plan.** No son tres features (BOM / red logística / key figures) sino **ocho módulos**, dos de ellos con ~2.800 líneas de lógica algorítmica real (motores de reglas y scoring). La Fase 4 es la más grande del proyecto, no la más pequeña.
2. **Lo que v7 llama "Key Figures" no es un visor de key figures**, es un generador de documentos Word a partir de los CSV de configuración de un Planning Area. La funcionalidad real de key figures vive en v8.
3. **Ya existe solapamiento resuelto a medias:** dos módulos de v7 (Doc Generator e Integration Explorer) fueron migrados a v9 como módulos legacy en JS vanilla dentro de un iframe — y en v7 quedaron ocultos de la navegación. Hay que decidir explícitamente qué pasa con ellos, o se portarán dos veces.

---

## 2. Qué está duplicado (y en qué se colapsa)

| Lógica | v7 | v8 | v9 | En V10 |
|---|---|---|---|---|
| Proxy SAP OData | `server.js`: 3 endpoints (`/api/proxy`, `-xml`, `-next`) | `api/proxy.js` (el más maduro) | `api/ibp-proxy.js` (consolidó los 3 de v7) | **1 módulo de transporte**, base v8 |
| Validación SSRF | `isPrivateHost` propio | *ninguna* | `_ssrf.js` (el más completo) **+ una segunda regex propia** en `ibp-proxy.js` | **1 validador**, base `_ssrf.js` de v9 + allowlist de host de v7 |
| Autenticación de la API propia | ninguna (solo rate limit) | ninguna | token estático único, embebido en el bundle | **SSO + sesión httpOnly** (se escribe de cero) |
| Acceso a Redis | — | — | **4 copias** de `redisGet`/`redisSet` a mano | **1 cliente** (usando el SDK que v9 ya tiene instalado y no usa) |
| Núcleo SOAP CI-DS | helpers XML en `server.js` | — | `api/soap.js` (completo, bien hecho) | **1 módulo**, base v9 |
| Paginación OData | `fetchAllPages` (sigue `__next`) | 4 paginadores por servicio (con presupuesto de bytes) | `kind:'next'` | **1 paginador** que unifica ambos enfoques |
| Lectura de `$metadata` | DOMParser en el navegador | extracción por regex **en servidor** (resuelve el límite de 4,5 MB de Vercel) | `kind:'xml'` crudo | **1 módulo**, base v8 |
| Modelo de conexión | `goscm.savedConns` | `ibp:connections` + sesión con **password en texto plano** | `ibp_connections` + un `api/connections.js` **muerto e incompatible** | **1 modelo** en Postgres, credenciales cifradas |
| Constantes de estado de jobs/tasks | — | hardcodeadas | duplicadas en **4 sitios** | **1 fuente de verdad** |
| Motor de transacción de escritura SAP | — | 2 implementaciones (master data y planning data) | — | **1 motor** parametrizado por servicio |

---

## 3. Capa transversal propuesta

Once módulos. Los diez primeros se portan de código existente; el de autenticación se escribe de cero.

### 3.1 `core/transport` — el único punto que habla con SAP
Base: `api/proxy.js` de **v8**, que es el más maduro. Aporta:
- Basic Auth, timeouts explícitos, `redirect: 'manual'` (anti-SSRF).
- **Reutilización del token CSRF** entre los múltiples POST de una misma transacción (v8 ya lo hace; v7 y v9 no).
- **Guardia anti-truncamiento**: compara `Content-Length` contra bytes recibidos y valida el JSON antes de reenviar; devuelve un 502 reintentable en vez de datos corruptos. Nace de un problema real: el relay serverless trunca respuestas grandes bajo carga.
- Extracción de errores OData tanto en JSON como en XML.

Se le suma de **v9** el validador `_ssrf.js` (cubre IPv6, CGNAT, link-local, multicast — el de v7 no) y de **v7** la allowlist de sufijo de host y de servicios permitidos.

### 3.2 `core/odata` — cliente OData
- Paginador con `$skip`/`$top`, `$orderby` estable obligatorio y **presupuesto de bytes por página** (de v8), más el seguidor de `__next`/`@odata.nextLink` (de v7).
- Constructor de `$filter` y codificación de literales OData, incluidas fechas (de v8).
- Helpers de OData v4 (de v8, usados por Metering).
- Helper de conteo con la regla "nunca `$top=0` en Planning Data" incorporada en el código.

### 3.3 `core/soap` — cliente CI-DS
Base: `api/soap.js` de **v9**, sin cambios de fondo. Se descarta el duplicado de v7.

### 3.4 `core/sap-transaction` — motor de escritura
Hoy hay dos implementaciones casi paralelas en v8 (dato maestro y key figures). Se unifican en **un motor** parametrizado por servicio, con el flujo: obtener CSRF → `TransactionID` → `InitiateParallelProcess` (opcional) → stage por chunks → commit → polling hasta procesado → leer mensajes.

Las reglas duras van **en el código, no en comentarios**:
- La versión base omite `PlanningArea` y `VersionID`; una versión real los envía.
- Una transacción no puede mezclar `DeleteEntries: true` y `false`.
- **Nunca reintentar un chunk ya enviado** — el reintento correcto es de la transacción completa (reintentar el chunk duplica claves y SAP rechaza ambas copias en el commit).
- Las key figures calculadas se pueden leer pero no escribir.

### 3.5 `core/catalog` — descubrimiento
Planning Areas, versiones, tipos de dato maestro, catálogo de key figures con sus dimensiones y medidas, etiquetas de campos. Todo con caché por TTL. **Cambio respecto a v8:** la caché pasa de `localStorage` del navegador a backend por cliente/conexión.

### 3.6 `core/connections` — modelo unificado de conexión
La decisión de diseño más importante. Un solo modelo que soporte lo que hoy son tres formas incompatibles:
- Los acuerdos de comunicación de IBP **cada uno con su propio usuario SAP** (de v8: `0326`, `0068`, `0720`, `0924`).
- Los endpoints SOAP de CI-DS (de v9: URL, organización, si es productivo).
- La base OData de IBP (de v7).

**Las credenciales viven cifradas en Postgres y nunca se envían al navegador.** Esto reemplaza los tres esquemas actuales y elimina la deuda más grave (ver §4).

### 3.7 `core/auth` — SSO, sesión, permisos *(se escribe de cero)*
Reemplaza por completo el token estático de v9. Login por SSO, sesión en cookie httpOnly, aislamiento por cliente en toda lectura y escritura, y verificación de módulo contratado en cada endpoint.

### 3.8 `core/persistence` — un solo acceso a datos
Un cliente Postgres y un cliente Redis. Reemplaza las cuatro copias de acceso a Redis de v9.

### 3.9 `core/jobs` — Application Jobs
Listar plantillas, programar (con inyección de `JobUser`), cancelar, reiniciar, cabeceras con filtro de fecha y memoria de rechazo del filtro, pasos, logs y parámetros. Base: v8. Tabla única de códigos de estado.

### 3.10 `core/ui` — utilidades compartidas de frontend
Conversión de timestamps SAP, exportación a CSV y PDF, tema, i18n, `useIsMobile`, y una pieza que vale la pena rescatar: **`useVisibleInterval`**, un polling que se pausa cuando la pestaña está oculta y refresca al volver. Más la capa de IndexedDB de v7 (los datasets grandes nunca viven completos en memoria) que el módulo Explorer necesita.

### 3.11 `core/ai-tools` — registro de herramientas del asistente
Cada operación de la capa transversal se registra como herramienta del asistente de IA, con su esquema de entrada, el permiso que requiere, y si es de lectura o escritura (las de escritura piden confirmación al usuario).

**Consecuencia de diseño:** el asistente de IA no es un módulo aparte — es una vista más sobre esta misma capa. Si una operación no está en la capa transversal, el asistente no puede hacerla; y todo lo que se agregue a la capa queda disponible para el chat automáticamente.

---

## 4. Deudas que V10 **no** debe heredar

| # | Deuda | Dónde está hoy | Qué se hace en V10 |
|---|---|---|---|
| 1 | **Token de API público de facto** — está embebido en el bundle del navegador; cualquiera puede leerlo y llamar a la API sin restricción | v9 (documentado como limitación conocida) | Sesión real por SSO en cookie httpOnly |
| 2 | **Contraseñas de SAP en texto plano en el navegador** | v8 (`localStorage`) | Cifradas en el backend, nunca enviadas al cliente |
| 3 | **Sin aislamiento por cliente** — un solo secreto global, quien lo tiene ve todo | v9 | Aislamiento por cliente en toda consulta |
| 4 | **Sin CORS real** — funciona porque frontend y proxy comparten origen | v7 | Política CORS explícita |
| 5 | Comparación de secreto del cron no resistente a timing | v9 | Comparación segura |
| 6 | **Cero tests** en los tres proyectos | v7, v8, v9 | Como mínimo, tests de la capa transversal: parsers, motor de transacción, construcción del árbol BOM |
| 7 | Código muerto con esquema incompatible (`api/connections.js`) | v9 | Se descarta, no se porta |
| 8 | Rate limit en memoria del proceso (inservible en serverless con varias instancias) | v7 | Rate limit con almacén compartido |

---

## 5. Base de conocimiento SAP a preservar

v8 acumuló **17 reglas confirmadas contra tenants reales**. No son opiniones: son comportamientos medidos de SAP IBP que costaron depuración. Las más importantes:

- `$top=0` para contar **revienta** en Planning Data (usar `$top` pequeño + `$inlinecount`); en Master Data sí es seguro.
- **`$select` define el nivel de agregación** en Planning Data: pedir menos atributos hace que SAP sume silenciosamente a un nivel más alto. El número es correcto, pero menos granular.
- Las key figures de cantidad o valor **exigen** `UOMTOID`/`CURRTOID` en el filtro, y SAP solo informa **un** atributo faltante por respuesta — hay que reintentar iterativamente.
- **`KF ne 0` se ignora silenciosamente**: SAP devuelve todo. Hay que usar `gt 0`/`lt 0` y descartar ceros también en el cliente. Y cualquier predicado sobre un atributo descarta además las filas donde ese atributo está vacío.
- Un área debe habilitarse **por separado en cada servicio**: puede existir en Master Data y dar 404 en Planning Data.
- El cuello de botella **no es `$skip` profundo**, es un costo fijo de ~6 s por petición. Conviene pocas páginas grandes y concurrencia moderada, no muchas peticiones chicas.
- `$orderby` estable es obligatorio al paginar, o hay solapes y huecos con lecturas concurrentes.
- Master Data deduplica del lado del servidor cuando se proyecta un solo campo; Planning Data rechaza ese mismo patrón.

Estas reglas deben quedar **codificadas como guardas** en `core/odata` y `core/sap-transaction`, no como documentación que alguien pueda pasar por alto.

---

## 6. Inventario real de v7 (lo que hay que reescribir)

El plan asumía tres features. El código tiene ocho módulos:

| Módulo | Tamaño | Qué hace |
|---|---|---|
| **BOM Hierarchy** | ~1.600 líneas | Árbol de jerarquía de producción, carga perezosa por nivel desde IndexedDB, detección de ciclos por camino de ancestros, co-productos, sustitutos, exportación a Excel con agrupación colapsable, y exportación por lotes de varios materiales |
| **Supply Network Analyzer** | ~2.770 líneas | Grafo de red de suministro con detección de nodos fantasma, callejones sin salida, plantas aisladas, ciclos, enumeración de rutas, análisis de resiliencia por cliente y un **health score 0-100 con reglas distintas por categoría de material** |
| **Production Hierarchy Analyzer** | ~2.790 líneas | Motor de reglas de calidad de datos: 12 chequeos cuya severidad depende de las categorías asignadas a cada tipo de material |
| **Visualizer (red logística)** | ~1.450 líneas | Red logística de un producto puntual, con layout manual por centro de gravedad para minimizar cruces, enumeración de rutas planta→cliente y detección de plantas huérfanas |
| **PA Documenter** (lo que el proyecto llama "Key Figures") | ~1.050 líneas | Genera un **documento Word** de 10 secciones desde los CSV de configuración de un Planning Area, con enriquecimiento opcional en vivo (volumetría real y Application Jobs) |
| **Glosario** | ~1.400 líneas | Ayuda bilingüe que explica cada columna, color y regla de los análisis |
| **Doc Generator** | ~2.530 líneas | Genera Excel documentando dataflows de CI-DS. **Oculto de la navegación.** Ya migrado a v9 como módulo legacy |
| **Integration Explorer** | ~1.720 líneas | Explora integraciones de CI-DS, con conexión SOAP en vivo. **Oculto de la navegación.** Ya migrado a v9 como módulo legacy |

Más piezas de soporte: configuración de tipos de material, campos adicionales por entidad, hoja de estadísticas, visor web alterno con paginación desde IndexedDB, y una capa de corrección de campos que resuelve diferencias de esquema entre tenants.

**Trampas encontradas en v7:**
- El `README.md` describe la v6 y está obsoleto; el `CLAUDE.md` no documenta tres módulos que sí existen.
- La detección de ciclos del árbol BOM **está incompleta**: la estructura que la almacena se inicializa y nunca se llena, así que el aviso al usuario nunca aparece — aunque el README la anuncia como feature. En el Visualizer y el SN Analyzer sí funciona.
- La función de invertir el árbol BOM está implementada pero no tiene botón en la interfaz.

---

## 7. Decisiones pendientes

1. **Módulos legacy de v9** (Integration Explorer y Mapping Dataflow Generator, ~5.700 líneas de JS vanilla en iframe): ¿se reescriben a React, se mantienen como iframe, o quedan fuera de V10 por ahora? La decisión previa fue "sin iframes", pero se tomó pensando en v7, no en estos.
2. **Alcance real de v7:** ¿se portan los ocho módulos o se prioriza? Los dos analizadores son ~5.600 líneas de lógica de análisis que no depende de SAP más allá de la lectura de datos.
3. **Detección de ciclos del BOM:** al reescribir, ¿se implementa de verdad (es lo que la interfaz promete) o se retira?

---

## 8. Orden de construcción sugerido para la Fase 1

1. Repositorio, estructura del monorepo, tooling.
2. `core/persistence` + esquema de Postgres (clientes, usuarios, permisos, suscripción, conexiones, credenciales cifradas).
3. `core/auth` (SSO + sesión + guardas de permiso). **Antes de cualquier módulo**, porque todo lo demás cuelga de aquí.
4. `core/transport` + `core/odata` + `core/soap` (portados, con las guardas de las reglas SAP).
5. `core/connections` + panel admin mínimo: alta de cliente, alta de usuario, permisos por módulo, conexiones con sus acuerdos y usuarios.
6. Shell de la aplicación: barra, menú de módulos, estados de "no contratado".

Con eso cerrado, la Fase 2 (primer módulo real) ya monta sobre una base que no habrá que rehacer.
