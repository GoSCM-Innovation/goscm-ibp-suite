# `core/` — capa transversal compartida

Toda la lógica que habla con SAP, persiste datos o resuelve identidad vive aquí, **una sola vez**. Las funciones de `api/` son handlers delgados que orquestan estos módulos; el frontend en `src/` los consume a través de `api/`.

La razón de existir de esta carpeta está en [`../docs/FASE-0-LEVANTAMIENTO.md`](../docs/FASE-0-LEVANTAMIENTO.md): v7, v8 y v9 resolvían el mismo problema tres veces (tres proxies, tres validaciones, tres modelos de conexión, cuatro copias del acceso a Redis).

## Mapa de módulos

| Módulo | Responsabilidad | Origen |
|---|---|---|
| `transport/` | El **único** punto que hace peticiones a SAP. Basic Auth, timeouts, `redirect: manual`, reutilización de token CSRF entre POSTs de una transacción, guardia anti-truncamiento, extracción de errores OData (JSON y XML), lectura de `$metadata` en servidor | `api/proxy.js` de v8 + `_ssrf.js` de v9 + validadores de v7 |
| `odata/` | Paginador (`$skip`/`$top` con `$orderby` estable y presupuesto de bytes), seguidor de `__next`, constructor de `$filter`, codificación de literales, helpers de OData v4 | v8 + v7 |
| `soap/` | Cliente SOAP de SAP CI-DS: envelope, sesión en header, parseo de faults | `api/soap.js` de v9 |
| `orchestrations/` | Orquestaciones de CI-DS: el grafo de tareas con dependencias, grupos, estrategias de error y reintentos. La definición en Postgres por cliente; el estado de una ejecución, en Redis | v9, sacándolo de una única clave global de Redis |
| `cids/` | CI-DS de cara a los módulos: sesión guardada en el servidor, lista cerrada de operaciones, tabla única de estados de tarea, y el fin y la duración de las ejecuciones por tandas | v9 |
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
| `persistence/` | Implementado y verificado contra Neon y Upstash reales: un cliente Postgres, un cliente Redis, guarda de aislamiento por cliente y migraciones (`npm run db:migrate`) |
| `auth/` | Implementado y verificado de punta a punta: ingreso por **código de un solo uso al correo**, sesión de una jornada en cookie httpOnly, y guardas de sesión, administrador y módulo contratado. Microsoft y Google quedan para una iteración posterior — la estructura ya los contempla (`allowed_providers`) |
| `transport/` | Implementado con tests: el único punto que llama a SAP. Portero anti-SSRF (validador de v9 + allowlist de host y de servicios de v7), Basic Auth, sin seguir redirecciones, reutilización del token de escritura, guardia anti-truncamiento y lectura de `$metadata` en servidor. **Sin verificar contra un tenant real todavía** |
| `odata/` | Implementado con tests: construcción de filtros y consultas, paginación (por enlace de continuación y por posición), conteo, presupuesto de bytes por página y reintento de lecturas. Las reglas de SAP van como candados. **Sin verificar contra un tenant real todavía** |
| `soap/` | Implementado con tests: cliente de CI-DS portado de `api/soap.js` de v9 sin cambiar comportamiento. Añade lo que allí faltaba: la dirección pasa por el portero anti-SSRF y hay tiempo máximo. **Sin verificar contra un tenant real todavía** |
| `orchestrations/` | Modelo, guardado y motor implementados con tests: una fila por orquestación en Postgres con la guarda de cliente, el grafo validado como candado —conexiones a nodos inexistentes y ciclos se rechazan al guardar, porque el motor los descartaba en silencio—, y la ejecución por vueltas con cerrojo, reintentos, grupos, salteo por dependencia y retomar desde donde falló. Las reglas van aparte de la plomería y por eso se prueban sin SAP. Faltan la programación por cron y la interfaz. **Sin verificar contra un tenant real todavía** |
| `cids/` | Implementado con tests: la sesión con CI-DS vive en el servidor (el navegador nunca la ve, al contrario que en v9), las operaciones que se pueden pedir son una lista cerrada, los estados de tarea están una sola vez, y el fin y la duración de las ejecuciones se juntan por tandas del lado del servidor. **Sin verificar contra un tenant real todavía** |
| `connections/` | Implementado y verificado contra la base real: modelo unificado de conexión, cada acuerdo de comunicación con su propio usuario de SAP, y las contraseñas cifradas con AES-256-GCM y atadas a su fila |
| `accounts/` | Implementado y verificado de punta a punta: clientes, usuarios y suscripción por módulo, con dos niveles de administración |
| El resto | Pendiente. Orden de construcción en `docs/FASE-0-LEVANTAMIENTO.md` §8 |

Las reglas de SAP que van **codificadas como candados** en `transport/` y `odata/`, no como comentarios: `$top=0` prohibido en datos de planificación (tumba el servicio), `$select` obligatorio en datos de planificación (sin él SAP agrega a otro nivel), `ne 0` y `ne ''` rechazados (SAP los ignora en silencio), lectura en paralelo denegada sin `$orderby` estable (habría solapes y huecos), y un servicio de OData fuera de la lista no se llama.

El primer administrador se crea con `npm run db:seed` porque la base arranca vacía y el panel exige ser administrador para entrar. Es el único punto del sistema donde nace un usuario sin que otro lo autorice.

Hay **dos niveles de administración**: el de la plataforma (GoSCM) da de alta clientes y activa o vence módulos —es decidir qué se cobra—, y el de un cliente gestiona solo su gente y sus conexiones a SAP. Nadie puede quitarse a sí mismo el rol de plataforma, ni dejar la plataforma sin ninguno.

Mientras no haya proveedor de correo, el código se imprime en la consola del servidor; en producción eso revienta a propósito en vez de dejar códigos en los registros.

Para leer o escribir datos de un cliente se usa `queryScoped` / `queryOneScoped`, **nunca** `query` a secas: llevan la guarda que exige el filtro por cliente y fallan cerradas si no pueden demostrarlo. `query` queda para el panel de administración y para las tablas que no son de nadie.

## Reglas

- **Las reglas de SAP van codificadas como guardas, no como comentarios.** Son 17 comportamientos medidos contra tenants reales (ver `docs/FASE-0-LEVANTAMIENTO.md` §5). Ejemplos: nunca `$top=0` en Planning Data; `KF ne 0` es ignorado silenciosamente por SAP; un chunk ya enviado a staging **no se reintenta** (se reintenta la transacción completa).
- **Nada de `core/` importa de `src/`.** La dependencia va en un solo sentido.
- **Los módulos de negocio no hablan con SAP directamente.** Si a un módulo le falta una operación, se agrega aquí — y así queda disponible también para el asistente de IA.
- **Todo módulo de `core/` lleva tests.** Es la única forma de sostener la paridad con v7/v8/v9, que no tienen ninguno.
