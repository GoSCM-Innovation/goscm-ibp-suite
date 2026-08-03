# `core/` — capa transversal compartida

Toda la lógica que habla con SAP, persiste datos o resuelve identidad vive aquí, **una sola vez**. Las funciones de `api/` son handlers delgados que orquestan estos módulos; el frontend en `src/` los consume a través de `api/`.

La razón de existir de esta carpeta está en [`../docs/FASE-0-LEVANTAMIENTO.md`](../docs/FASE-0-LEVANTAMIENTO.md): v7, v8 y v9 resolvían el mismo problema tres veces (tres proxies, tres validaciones, tres modelos de conexión, cuatro copias del acceso a Redis).

## Mapa de módulos

| Módulo | Responsabilidad | Origen |
|---|---|---|
| `transport/` | El **único** punto que hace peticiones a SAP. Basic Auth, timeouts, `redirect: manual`, reutilización de token CSRF entre POSTs de una transacción, guardia anti-truncamiento, extracción de errores OData (JSON y XML), lectura de `$metadata` en servidor | `api/proxy.js` de v8 + `_ssrf.js` de v9 + validadores de v7 |
| `odata/` | Paginador (`$skip`/`$top` con `$orderby` estable y presupuesto de bytes), seguidor de `__next`, constructor de `$filter`, codificación de literales, helpers de OData v4 | v8 + v7 |
| `soap/` | Cliente SOAP de SAP CI-DS: envelope, sesión en header, parseo de faults | `api/soap.js` de v9 |
| `sap-transaction/` | Motor de escritura: `TransactionID` → stage por chunks → commit → polling → mensajes. Parametrizado por servicio (dato maestro / planning data) | unifica las dos implementaciones de v8 |
| `catalog/` | Descubrimiento: Planning Areas, versiones, tipos de dato maestro, catálogo de key figures, etiquetas de campos. Con caché por TTL en backend | v8 |
| `connections/` | Modelo unificado de conexión: acuerdos de comunicación de IBP **cada uno con su propio usuario SAP**, endpoints de CI-DS, base OData. Credenciales cifradas en Postgres, **nunca** enviadas al navegador | unifica los 3 modelos |
| `auth/` | SSO (Microsoft y Google), sesión en cookie httpOnly, aislamiento por cliente, verificación de módulo contratado | **se escribe de cero** |
| `persistence/` | Un solo cliente Postgres y un solo cliente Redis | reemplaza las 4 copias de v9 |
| `jobs/` | Application Jobs: plantillas, programar, cancelar, reiniciar, cabeceras, pasos, logs. Tabla única de códigos de estado | v8 |
| `ai-tools/` | Registro de herramientas del asistente de IA. Cada operación de esta capa se expone con su esquema, el permiso que exige y si es de lectura o escritura | nuevo |

## Estado

| Módulo | Estado |
|---|---|
| `persistence/` | Implementado: cliente Postgres (Neon), cliente Redis (Upstash), guarda de aislamiento por cliente y esquema inicial en `migrations/`. Aplicar con `npm run db:migrate`. **Falta verificarlo contra una base viva** — todavía no hay instancia de Neon |
| El resto | Pendiente. Orden de construcción en `docs/FASE-0-LEVANTAMIENTO.md` §8 |

Para leer o escribir datos de un cliente se usa `queryScoped` / `queryOneScoped`, **nunca** `query` a secas: llevan la guarda que exige el filtro por cliente y fallan cerradas si no pueden demostrarlo. `query` queda para el panel de administración y para las tablas que no son de nadie.

## Reglas

- **Las reglas de SAP van codificadas como guardas, no como comentarios.** Son 17 comportamientos medidos contra tenants reales (ver `docs/FASE-0-LEVANTAMIENTO.md` §5). Ejemplos: nunca `$top=0` en Planning Data; `KF ne 0` es ignorado silenciosamente por SAP; un chunk ya enviado a staging **no se reintenta** (se reintenta la transacción completa).
- **Nada de `core/` importa de `src/`.** La dependencia va en un solo sentido.
- **Los módulos de negocio no hablan con SAP directamente.** Si a un módulo le falta una operación, se agrega aquí — y así queda disponible también para el asistente de IA.
- **Todo módulo de `core/` lleva tests.** Es la única forma de sostener la paridad con v7/v8/v9, que no tienen ninguno.
