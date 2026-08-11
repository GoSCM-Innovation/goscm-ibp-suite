# Reglas del proyecto `goscm-ibp-suite` (GoSCM Suite)

## Regla fundamental
**No inventar información nunca.** Si se necesita un dato específico (endpoints SAP IBP, escenarios de comunicación, roles, configuraciones) y no está en el código, en `docs/` o en lo que el usuario ha proporcionado, **preguntar antes de escribir cualquier cosa**.

## Contexto
Plataforma web unificada para SAP IBP y SAP CI-DS, comercializada por suscripción. Sustituye a tres proyectos previos (`ibp-bom-v7`, `ibp-bom-v8`, `ibp-bom-v9`) que están en carpetas hermanas y **siguen operativos durante la transición** — se leen como referencia para portar código y para verificar paridad, nunca se modifican.

Lectura obligatoria antes de tocar `core/`: [`docs/FASE-0-LEVANTAMIENTO.md`](docs/FASE-0-LEVANTAMIENTO.md) — inventario de la duplicación que esta arquitectura elimina y las 17 reglas de SAP confirmadas contra tenants reales.

## Arquitectura

```
core/     Capa transversal. Toda la lógica que habla con SAP, persiste o resuelve identidad.
api/      Funciones serverless de Vercel — handlers delgados sobre core/.
src/      Frontend React.
docs/     Arquitectura y decisiones.
```

- La dependencia va en un solo sentido: `src/` → `api/` → `core/`. **Nada en `core/` importa de `src/`.**
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
- **Sin iframes para los módulos.** Todo se reescribe a React; es una decisión de producto, no una preferencia.
- **Todo módulo de `core/` lleva tests** (Vitest). Es la única forma de sostener la paridad con proyectos que no tienen ninguno.
- **Paridad antes de dar un módulo por terminado**: checklist de funcionalidad y verificación lado a lado contra la app vieja correspondiente. El de v8 está en [`docs/PARIDAD-V8.md`](docs/PARIDAD-V8.md) — **antes de contestar «¿ya está v8?», recorrer el árbol de `src/` de v8 en `origin/master` y actualizarlo**, no contestar de memoria.
- Preservar la arquitectura de IndexedDB de v7 al reescribir Explorer: los datasets grandes **nunca** viven completos en memoria, se leen por cursor. Meterlos en estado de React degrada el rendimiento.
- Commits sin `Co-Authored-By`.
- Sesiones cortas y enfocadas por feature.

## Comandos
- Desarrollo: `npm run dev` (frontend + `/api` en un solo puerto).
- Verificar: `npm run lint` y `npm test` y `npm run build`.
