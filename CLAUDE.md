# Reglas del proyecto `goscm-ibp-suite` (GoSCM Suite)

## Regla fundamental
**No inventar información nunca.** Si se necesita un dato específico (endpoints SAP IBP, escenarios de comunicación, roles, configuraciones) y no está en el código, en `docs/` o en lo que el usuario ha proporcionado, **preguntar antes de escribir cualquier cosa**.

## Si la instrucción es «continuemos»
Leer primero [`docs/SIGUIENTE.md`](docs/SIGUIENTE.md): tiene el estado, lo siguiente en orden de
prioridad acordado, y las decisiones abiertas que necesitan al usuario. Se actualiza al terminar cada
sesión.

## Contexto
Plataforma web unificada para SAP IBP y SAP CI-DS, comercializada por suscripción. Sustituye a tres proyectos previos (`ibp-bom-v7`, `ibp-bom-v8`, `ibp-bom-v9`) que están en carpetas hermanas y **siguen operativos durante la transición** — se leen como referencia para portar código y para verificar paridad, nunca se modifican.

Lectura obligatoria antes de tocar `core/`: [`docs/FASE-0-LEVANTAMIENTO.md`](docs/FASE-0-LEVANTAMIENTO.md) — inventario de la duplicación que esta arquitectura elimina y las 17 reglas de SAP confirmadas contra tenants reales.

## Arquitectura

```
core/      Capa transversal. Toda la lógica que habla con SAP, persiste o resuelve identidad.
handlers/  Un archivo por operación HTTP — handlers delgados sobre core/.
api/       Funciones serverless de Vercel: un MOSTRADOR por área que reparte a handlers/.
src/       Frontend React.
docs/      Arquitectura y decisiones.
```

- La dependencia va en un solo sentido: `src/` → `api/` → `handlers/` → `core/`. **Nada en `core/` importa de `src/`.**

### Por qué `api/` y `handlers/` están separados

Vercel cuenta **una función por archivo de `api/`**, y su plan gratuito permite 12. Este backend tiene
29 operaciones, así que un archivo por operación no se puede desplegar. En `api/` hay un mostrador por
área (`api/ibp/[...ruta].js` y sus hermanos) que reparte con la tabla de `handlers/<área>/index.js`;
las tres operaciones de la raíz siguen siendo archivos sueltos. Son **7 funciones**.

Las direcciones no cambiaron: `/api/ibp/master-data` sigue siendo `/api/ibp/master-data`.

Dos reglas que esto impone:

- **Un handler nuevo va también en la tabla de su área**, o es inalcanzable sin que nada avise. Hay una
  prueba (`handlers/repartir.test.js`) que compara cada tabla con los archivos de su carpeta.
- **El servidor de desarrollo lee LA MISMA tabla** (`vite.config.js`). Resolver distinto en desarrollo
  y en producción es cómo se llega a «en mi máquina funciona» con el frontend igual y el backend no.
- **Los módulos de negocio no hablan con SAP directamente.** Si a un módulo le falta una operación, se agrega a `core/` — así queda disponible también para el asistente de IA.
- El mapa de módulos de la capa transversal está en [`core/README.md`](core/README.md).

## Reglas de SAP
Las 17 reglas confirmadas (documentadas en `docs/FASE-0-LEVANTAMIENTO.md` §5) van **codificadas como guardas en `core/`, no como comentarios**. Las que más muerden:

- **Nunca `$top=0`** para contar en `PLANNING_DATA_API_SRV` (revienta con `TSV_TNEW_PAGE_ALLOC_FAILED`); usar `$top` pequeño + `$inlinecount`. En `MASTER_DATA_API_SRV` sí es seguro.
- **`$select` define el nivel de agregación** en Planning Data: pedir menos atributos hace que SAP sume silenciosamente a un nivel más alto.
- **`KF ne 0` es ignorado silenciosamente** por SAP (devuelve todo). Usar `gt 0`/`lt 0` y descartar ceros también en el cliente.
- Cualquier predicado sobre un atributo **descarta las filas donde ese atributo está vacío**. Para "excluir X" hay que seleccionar explícitamente los demás valores.
- **Un chunk ya enviado a staging NO se reintenta** — el reintento correcto es de la transacción completa. Reintentar el chunk duplica claves y SAP rechaza ambas copias en el commit.
- Una transacción no puede mezclar `DeleteEntries: true` y `false`.
- La versión base omite `PlanningArea` y `VersionID` al mintar el `TransactionID`; una versión real los envía.
- El cuello de botella **no es `$skip` profundo**: es un costo fijo de ~6 s por petición. Pocas páginas grandes, concurrencia moderada.
- `$orderby` estable es obligatorio al paginar, o hay solapes y huecos con lecturas concurrentes.
- Un área debe habilitarse **por separado en cada servicio** de `SAP_COM_0720`.

## Seguridad (no repetir los errores de v7/v8/v9)
- **Ningún secreto en el bundle del frontend.** v9 embebía un token de API en el cliente; era público de facto. La autenticación es por sesión en cookie httpOnly.
- **Las credenciales de SAP nunca llegan al navegador.** Viven cifradas en Postgres; solo el backend las descifra. v8 las guardaba en texto plano en `localStorage`.
- **Aislamiento por cliente en toda lectura y escritura.** Ninguna consulta sin filtro de cliente.
- **Verificación de módulo contratado en el backend**, no solo en la interfaz. Ocultar un botón no es una restricción.
- Toda URL saliente pasa por la validación SSRF de `core/transport` (incluye allowlist de sufijo de host y de servicios permitidos) y usa `redirect: 'manual'`.
- Comparaciones de secretos siempre resistentes a timing.

## Convenciones
- Español para texto de interfaz, documentación y comentarios. Código y nombres de símbolos en inglés.
- **El texto PORTADO manda sobre la preferencia de idioma.** Un nombre de pantalla, un botón o una
  columna que ya existía en v7, v8 o v9 se copia tal cual, aunque esté en inglés («Job Templates»,
  «Task Monitor», «↺ Refresh», «Warnings»). No se traduce. La regla de arriba vale para el texto que
  se escribe NUEVO. Decidido por el usuario el 2026-08-28: los tres proyectos llevan años de uso
  delante de clientes y renombrar un control que la gente ya conoce no traduce nada, cambia el
  producto. Ver [Respetar la interfaz de origen](#respetar-la-interfaz-de-origen).
- **Español neutro latinoamericano, nunca rioplatense.** Formas de tú («elige», «pulsa», «vuelve»),
  no de vos («elegí», «pulsá», «volvé»). Tampoco «acá» por «aquí», «chico» por «pequeño», «de a una»
  por «una por una», ni «recién» con el sentido de «solo entonces». Vale para la interfaz, los
  comentarios, los documentos **y las respuestas al usuario**.
- **Sin iframes para los módulos.** Todo se reescribe a React; es una decisión de producto, no una preferencia.
- **Todo módulo de `core/` lleva tests** (Vitest). Es la única forma de sostener la paridad con proyectos que no tienen ninguno.
- **Paridad antes de dar un módulo por terminado**: checklist de funcionalidad y verificación lado a lado contra la app vieja correspondiente. Los de v7, v8 y v9 están en [`docs/PARIDAD-V7.md`](docs/PARIDAD-V7.md), [`docs/PARIDAD-V8.md`](docs/PARIDAD-V8.md) y [`docs/PARIDAD-V9.md`](docs/PARIDAD-V9.md) — **antes de contestar «¿ya está v7/v8/v9?», recorrer su árbol en `origin/master` y actualizar el checklist**, no contestar de memoria. En v9 hay que recorrer también `api/` y `public/legacy/`: dos módulos enteros vivían ahí. El clon de v7 está anidado (`ibp-bom-v7/ibp-bom-v7`) y su remoto es `GoSCM-Innovation/ibp-bom-v7`.
- Preservar la arquitectura de IndexedDB de v7 al reescribir Explorer: los datasets grandes **nunca** viven completos en memoria, se leen por cursor. Meterlos en estado de React degrada el rendimiento.
- Commits sin `Co-Authored-By`.
- Sesiones cortas y enfocadas por feature.

## Respetar la interfaz de origen

**La interfaz de v7, v8 y v9 se porta tal cual era.** No se rediseña, no se renombran sus pantallas y
no se traducen sus controles. Llevan años de uso delante de clientes y está trabajada; portar la
funcionalidad y rehacer la forma convierte una migración en un producto nuevo que nadie pidió.

Cómo se comprueba, que es lo que de verdad importa: **recorrer los controles del original uno a uno**
—sus botones, sus desplegables, sus pestañas, sus paneles plegables— y ver cuál existe aquí. Comparar
ARCHIVOS no sirve: los huecos encontrados así vivían todos dentro de archivos ya dados por portados.

Solo se acepta desviarse cuando lo obliga una regla de seguridad de esta plataforma —por ejemplo, el
paso ① del asistente de v7 pedía credenciales de SAP y aquí elige entre conexiones dadas de alta,
porque las credenciales viven cifradas—. Cuando pasa, se escribe por qué al lado del código.

## Comandos
- Desarrollo: `npm run dev` (frontend + `/api` en un solo puerto).
- Verificar: `npm run lint` y `npm test` y `npm run build`.
