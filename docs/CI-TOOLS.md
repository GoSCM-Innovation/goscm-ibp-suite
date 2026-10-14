# CI Tools

El cuarto módulo de la Suite. Reemplaza a Postman en una tarea concreta: cargar datos a SAP IBP llamando
a un iFlow de **SAP Cloud Integration (CPI)**. Cada carga es un `POST` con un body que le dice al iFlow
qué tabla mover, de dónde, adónde y con qué filtro. Antes esos bodies vivían en una colección de Postman;
ahora viven en el servidor, por cliente, se ejecutan desde la Suite y se encadenan en orquestaciones.

- Módulo: id `ci`, nombre visible «CI Tools», icono 🔗. Se contrata aparte, como los otros tres.
- Rama de trabajo: `feat/ci-tools`.
- Plan acordado con el usuario: ver «Decisiones» abajo.

## Qué se puede hacer

| Pantalla | Para qué |
|---|---|
| **Integraciones** | La biblioteca de una conexión: árbol de carpetas (como Postman), formulario y vista JSON del body, duplicar, renombrar carpetas, **Ejecutar**. |
| **Orquestaciones** | Integraciones en **etapas**: una fila de etapas y, dentro de cada una, pasos en paralelo. Se guarda sola. Mientras corre no se edita. |
| **Historial** | Quién ejecutó qué, cuándo, cuánto tardó y cómo salió, con el MPL ID para buscarlo en el monitor de CPI. |

Cada conexión de tipo **Cloud Integration** es UN ambiente (desarrollo, calidad o producción): su endpoint,
su usuario y su biblioteca. Se dan de alta en Administración → Conexiones, tipo «Cloud Integration», con la
dirección completa del endpoint del iFlow (`https://…it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2`)
y, aparte, el usuario y la contraseña (Basic Auth). La contraseña queda cifrada y no vuelve a salir.

## Decisiones del usuario

Tomadas durante el diseño (2026-10-13 y 2026-10-14). Si alguna se quiere revertir, es del usuario:

1. **Autenticación: Basic Auth.** Un usuario y una contraseña por conexión, guardados como los de CI-DS (acuerdo
   fijo `CI`).
2. **Una integración es UN bloque.** El iFlow aceptaría varios bloques en un body y los ejecutaría en fila, pero
   se descartó: la Suite no podría decir cuál falló ni retomar desde ese. Para encadenar cargas se usa una
   orquestación, donde cada paso es una llamada con su propio resultado. Un body con más de un bloque se rechaza
   al guardar, diciendo esto.
3. **Sin importador de Postman.** Se pidió olvidarlo. Pegar el JSON en la vista JSON del editor cubre el caso.
4. **Cualquier usuario del cliente con el módulo contratado puede ejecutar.** No hay roles en CI Tools. Lo que
   sí hay es el historial con quién ejecutó, y una confirmación explícita en producción.
5. **Las fechas se cambian a mano**, hoy en Postman. Aquí son **variables** (`{{FECHA_DESDE}}`) que se piden al
   ejecutar, con los valores de la última vez como propuesta.
6. **Sin ejecución en segundo plano.** Vercel Hobby no lo permite: una orquestación avanza mientras su pantalla
   está abierta. Ver «Límites» y [`SIGUIENTE.md`](SIGUIENTE.md).

## Cómo está hecho

```
core/ci/            body.js  filter.js  mapping.js  campos.js      puras: las comparte la pantalla
                    call.js  integrations.js  history.js           la llamada a CPI, la biblioteca, el historial
                    execute.js  orquestacion.js                    ejecutar una integración / lo que pide una orquestación
core/orchestrations adaptador `ci` (adapters.js) y camino «síncrono» del motor (runner.js)
handlers/ci/        integrations  run  runs  orchestration-info   → api/ci/[...ruta].js (la octava función de Vercel)
src/components/ci/  CiTools  Integraciones  EditorDeIntegracion  FormularioDeBloque  ConstructorDeFiltro
                    TablaDeMapeo  DialogoDeEjecucion  OrquestacionesCi  EditorDeOrquestacion  Historial
src/lib/            ci.js  ci-etapas.js  useFilasLocales.js
core/persistence/migrations/006_ci_tools.sql                      módulo y tipo de conexión nuevos, `ci_integrations`, `ci_runs`
```

Las orquestaciones reutilizan el **mismo motor** que CI-DS e IBP (`/api/orchestrations`, `/api/orchestration-run`):
no hay un segundo motor. Cada orquestación de CI se guarda como un grafo normal; la pantalla de **etapas** es una
forma de dibujarlo (cada paso de una etapa se conecta con todos los de la siguiente). Si un grafo guardado no tiene
esa forma, la pantalla lo dice en vez de enseñar etapas que no son lo que se ejecuta.

### El body y sus piezas

Un body es `{ "NOMBRE_DEL_BLOQUE": { …campos… } }`. Se guarda como **texto** (no `jsonb`, que reordena las claves) y se
envía como el JSON que la persona escribió.

- **Formulario por tipo de dato.** Se vieron dos familias (`MASTERDATA` y `KEYFIGURES`); cada una enseña sus
  campos. Lo que el formulario no conoce sale en «Otros campos» y se conserva: el iFlow puede aceptar más.
- **Tabla de campos.** `SourceFieldsfromAddon`, `TargetFieldsInSAPIBP` y `FieldMapping` dicen lo mismo tres
  veces. Se edita UNA tabla origen → destino y las tres listas salen de ella. Si un body pegado las trae
  desalineadas, se avisa y se ofrece alinearlas; no se arreglan solas.
- **Filtro.** `FilterForTheDataSource` se edita como filas (`EQ` con fichas, `BT` con desde y hasta). Se vieron solo
  esos dos operadores: **lo que el constructor no entiende se conserva como texto y se envía tal cual**. Leer un
  filtro y volver a escribirlo no cambia lo que se envía. Tampoco se explica cómo se combinan las condiciones
  (nadie lo ha confirmado).
- **Variables.** `{{NOMBRE}}` dentro de un valor. Se sustituyen sobre los valores ya leídos, nunca sobre el texto
  crudo, y un valor no puede llevar comillas ni barras invertidas (el filtro las usa como sintaxis). **Nunca se envía
  un body con un `{{…}}` sin resolver.**

## Garantías que se codificaron

Cada una tiene prueba; la lista es para que nadie las quite sin saber por qué están.

- **Tres resultados, no dos.** `success` (CPI contestó 2xx), `error` (contestó un error, o la llamada no salió) y
  **`unconfirmed`**: se envió y no se sabe cómo terminó (se agotó el tiempo, se cortó la conexión). La carga pudo
  haber entrado. Se pinta con su propio color y **nunca se reintenta sola**, aunque el paso diga «reintentar».
- **Candado por integración** (Redis). Una segunda ejecución de la misma integración no sale mientras la primera
  sigue (doble clic, dos pestañas, una orquestación y una ejecución manual a la vez). Sin Redis no hay candado, y sin
  candado **no se envía**.
- **Se anota antes de enviar.** La ejecución nace `running` en `ci_runs` antes de salir; si no se puede anotar, no se
  envía. Una fila `running` que lleva más de 6 minutos se lee como «sin confirmar».
- **En una orquestación, el estado se guarda ANTES de enviar** (`avanzarNivel` en `runner.js`, camino `ejecutar`).
  El motor guarda al final de cada vuelta, y una vuelta con una carga larga puede durar minutos: sin esto, si la
  función muere a mitad, el paso seguiría «pendiente» y la vuelta siguiente lo enviaría otra vez. El cerrojo de la
  vuelta dura 330 s en lugar de 15.
- **Se valida todo antes del primer paso**: que cada paso apunte a una integración que exista en esa conexión y que
  cada variable traiga un valor. Descubrirlo en el quinto paso, con cuatro cargas ya hechas, es lo que se evita.
- **Producción.** El diálogo de ejecutar dice contra qué conexión y dirección va, si es productiva, y qué comando
  lleva cada integración **tal como está escrito** (`REPLACE`, `INSERT_UPDATE`…; la Suite no interpreta qué hacen).
  En producción hay que marcar que se entiende.
- **Aislamiento.** Todas las consultas llevan el cliente (`ci_integrations` y `ci_runs` están en la guarda de
  `tenant-scope`). El módulo `ci` se exige en el servidor. Quién ejecutó sale de la sesión, no del cuerpo.
- **Salida a CPI.** La dirección pasa por el portero SSRF con un patrón propio (`DEFAULT_CI_HOST_PATTERN`): exige el
  segmento `it-cpi<número>` y es más estrecho que el de CI-DS, porque cualquier cliente de BTP publica aplicaciones en
  `*.cfapps.<región>.hana.ondemand.com`. Sin seguir redirecciones. No se registran el body ni las credenciales.

## Para ponerlo en marcha

1. **Aplicar la migración**: `npm run db:migrate`. La 006 está escrita y **no se ha aplicado a ninguna base**. Se
   comprobó contra la base real que los nombres de las dos restricciones que recrea (`connections_kind_check` y
   `module_subscriptions_module_check`) son los que asume.
2. **Activar el módulo `ci`** al cliente (Administración → Clientes, quien administra la plataforma).
3. **Dar de alta una conexión «Cloud Integration»** por ambiente, con el endpoint completo y el usuario y la
   contraseña. Si el host de algún tenant no encaja con el patrón, no hace falta tocar código: se abre con la
   variable de entorno `ALLOWED_CI_HOST_REGEX`.
4. **Vercel**: `vercel.json` ya declara 300 s para `api/ci/[...ruta].js` y `api/orchestration-run.js` (IBP ya usa 300 s
   en este plan). Una llamada a CPI puede tardar más que el límite de 10 s que Vercel aplica si no se declara nada.

## Límites

- **Una orquestación avanza mientras su pantalla esté abierta** (como las de CI-DS hoy). Si se cierra, queda donde
  estaba y se retoma con «Retomar»: lo que ya salió bien no se repite. Una carga que estuviera esperando a CPI queda
  «sin confirmar» y «Retomar» avisa antes de enviarla otra vez.
- **Cortar durante una llamada** espera a que esa llamada termine (la vuelta tiene el cerrojo): la Suite dice
  «prueba de nuevo en unos segundos». Cortar tampoco deshace lo ya cargado ni detiene a CPI; detiene lo que falta.
- **Programación (horarios): no está.** Sin un reloj que la dispare, una pantalla de horarios sería un hueco que
  parece una función. El modelo de datos no lo impide: se puede agregar cuando haya reloj (Vercel Pro, o uno externo
  que llame al endpoint `handlers/cids/cron-tick.js` ya protegido con `CRON_SECRET`; habría que ampliarlo para CI).
- **Detalle del error por MPL ID desde CPI: no está.** Hoy la Suite muestra el MPL ID y lo copia. Traer el detalle
  exige otro acceso (la API de monitoreo de Cloud Integration, con otro usuario) que está por verificar.

## Sin estrenar

**Nada de CI Tools se ha ejecutado contra un tenant de CPI.** Todo está probado por piezas (varios cientos de pruebas nuevas) y
la interfaz se vio con datos de muestra, no contra el servidor. Lo que hay que comprobar con el usuario delante,
en desarrollo y de a una integración:

1. **La llamada real**: que Basic Auth con el usuario de la conexión entre, y qué responde CPI cuando sale bien
   (el cuerpo no se conoce: solo se vio el 500 con el MPL ID) y cuánto tarda.
2. **El patrón de host.** Se midió con un solo tenant (`it-cpi034-rt.cfapps.us10-002`).
3. **Los 300 s** de la función en el plan Hobby (IBP ya los declara, pero no se ha medido una llamada de ese tamaño).
4. **Una pestaña cerrada a mitad de una vuelta**: se asume que la función sigue hasta terminar o que el paso queda
   «sin confirmar»; no se ha visto cuál de las dos pasa en Vercel.
5. **Un endpoint único por cliente**: se asumió que todos los bodies de una conexión van al mismo endpoint.
6. **El filtro**: la semántica de varias condiciones (si el mismo campo repetido es «o» y campos distintos «y») y si el
   iFlow admite más operadores que `EQ` y `BT`.
7. **`BatchCommand`**: la Suite solo lo muestra. Qué hace `REPLACE` exactamente en el iFlow lo sabe quien lo escribió.
8. **Orquestaciones de punta a punta**: etapas en paralelo, un fallo a mitad, «Retomar», y el caso «sin confirmar».
