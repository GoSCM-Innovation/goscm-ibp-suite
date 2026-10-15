# CI Tools

El cuarto módulo de la Suite. Reemplaza a Postman en una tarea concreta: cargar datos a SAP IBP llamando
a un iFlow de **SAP Cloud Integration (CPI)**. Cada carga es un `POST` con un body que le dice al iFlow
qué tabla mover, de dónde, adónde y con qué filtro. Antes esos bodies vivían en una colección de Postman;
ahora viven en el servidor, por cliente, se ejecutan desde la Suite y se encadenan en orquestaciones.

- Módulo: id `ci`, nombre visible «CI Tools», icono 🔗. Se contrata aparte, como los otros tres.
- Fusionado a `main` el 2026-10-14 (la rama `feat/ci-tools` se borró). **Decisión del usuario: CI Tools se sigue
  trabajando directo en producción**, sin rama, porque es un módulo aparte que nadie más tiene contratado.
- Plan acordado con el usuario: ver «Decisiones» abajo.

## Qué se puede hacer

| Pantalla | Para qué |
|---|---|
| **Integraciones** | La biblioteca de una conexión: árbol de carpetas (como Postman) u **ordenado por destino** (conmutador «Ordenar por: Carpeta / Destino»), formulario y vista JSON del body, duplicar, renombrar carpetas, **Ejecutar**. |
| **Orquestaciones** | Integraciones en **etapas**: una fila de etapas y, dentro de cada una, pasos en paralelo. Se guarda sola. Mientras corre no se edita. |
| **Historial** | Quién ejecutó qué, cuándo, cuánto tardó y cómo salió, con el MPL ID para buscarlo en el monitor de CPI. |

Cada conexión de tipo **Cloud Integration** es UN ambiente (desarrollo, calidad o producción): su endpoint,
su usuario y su biblioteca. Se dan de alta en Administración → Conexiones, tipo «Cloud Integration», con la
dirección completa del endpoint del iFlow (`https://…it-cpi034-rt.cfapps.us10-002.hana.ondemand.com/http/IBP2`)
y, aparte, el usuario y la contraseña (Basic Auth). La contraseña queda cifrada y no vuelve a salir.

## Sugerencias de IBP (2026-10-14)

Armar un body a mano pide cosas que la Suite ya sabe leer de IBP: el área, la versión, la tabla de dato maestro, sus
campos, las cifras clave y los valores de un filtro. CI Tools las lee del **IBP de destino** de la conexión y las
ofrece como ayuda. Pedido del usuario: «reutiliza las conexiones a IBP para enriquecer y automatizar la creación
del JSON».

**Cómo se enlaza.** Cada conexión de Cloud Integration tiene un **IBP de destino** (Administración → Conexiones →
abrir la conexión de CI → «IBP de destino»): una conexión de IBP del mismo cliente. Es de la conexión y no de cada
integración, porque un ambiente de CPI carga a un solo IBP. Se guarda en `connections.ibp_connection_id`
(migración 007, aplicada el 2026-10-14) y `core/connections` comprueba que sea del mismo cliente y de tipo `ibp`.
Con el vínculo puesto, las credenciales de ese IBP las descifra el servidor y no salen: al navegador solo llega el
catálogo. **«CI STARBRANDS DEV» está vinculada a «STARBRANDS QAS».** Un cliente con solo el módulo `ci` puede leer
el catálogo de SU IBP vinculado y nada más (solo lectura, `requireModule('ci')`).

**Qué ofrece el formulario** (todo sigue siendo editable a mano; sin IBP el formulario es el de siempre):

| Dónde | Qué hace |
|---|---|
| Franja sobre el editor | Dice contra qué IBP se sugiere, con «↺ Actualizar»; sin vínculo, o con IBP caído, lo dice y no estorba. |
| Planning Area y Versión | Se eligen de las de IBP (la base se ve «Versión base (vacío)» y vale vacío, que es lo que lleva el body). «A mano» pasa a texto; un valor que el body ya tenía y IBP no conoce se conserva tal cual con un aviso. |
| Tipo de maestro (dato maestro) | Es la tabla de IBP: se elige de las **que se pueden cargar** en esa versión del área, sin el prefijo (`PRODUCT`), y elegirla rellena también `MasterDataPrefix` **y ajusta el mapeo** a los campos de esa tabla: las filas cuyo destino existe en la nueva se quedan, las demás se quitan, y si no queda ninguna se llena con los campos de la tabla (todos menos los de sistema). Si las tres listas del mapeo no coinciden, o los campos no se pueden leer, solo cambian el tipo y el prefijo. Un solo control: no hay un selector aparte de «tabla». Escribirlo a mano («A mano») no toca ni el prefijo ni el mapeo. |
| Campos y mapeo | Dato maestro: «Elegir campos de IBP» (marca todos menos los de sistema si la tabla está vacía; al aplicar conserva el origen de lo que ya estaba y lo propio del origen). Cifras clave: «Armar desde IBP» (cifra + dimensiones; genera dimensiones, `KEYFIGUREDATE:KEYFIGUREDATE` y `KFVALUE:<cifra>`). Una columna «En IBP» da la etiqueta de cada destino y marca lo que no existe. |
| Filtro | «Valores de IBP» en cada fila `campo = valores` cuyo campo es de IBP; no se ofrecen los valores con comillas simples o comas (cortarían el filtro). |
| Nivel del perfil de tiempo | Sugiere los valores que ya usan otras integraciones de la conexión: **no se sabe a qué `PERIODIDn` corresponde cada código**, así que no se calcula. |
| Revisión contra IBP | Avisos (área, versión, tabla o campo que no existen, campos de sistema). **No bloquean guardar ni ejecutar**; el diálogo de ejecución los repite. Las variables `{{…}}` no se comparan. |

**Reglas que se codificaron**

- Solo lectura y por el mismo camino que IBP Tools (`core/ibp`): no hay una segunda implementación.
- Lo leído se guarda 30 minutos en Redis **por cliente y por IBP** (`tenantKey(cliente, 'ci-ibp', …)`); si Redis falla se
  lee igual. **Los valores de un campo no se guardan**: son datos del cliente. En el navegador, nada se guarda: vive en
  memoria mientras la pantalla está abierta.
- Los campos de una tabla y las cifras de un área se leen **solo si IBP tiene esa tabla o esa área**. Si no, escribir el
  tipo de maestro a medias (`S`, `SB`, `SBP`…) bajaría el `$metadata` de dato maestro (varios megas) en cada tecla.
- Los nombres que se pegan en una dirección (tabla, área, campo) pasan por `esNombreSeguro` antes de llegar a IBP.
- Cada servicio se habilita por separado en el acuerdo: si uno no contesta, se arma lo posible con el otro y el motivo
  sale en los avisos de la franja.

**Comprobado contra STARBRANDS QAS (2026-10-14, solo lectura)**: 2 áreas (`STARBRANDS`, prefijo `SB`, 5 versiones, 46
tablas cargables; `UNIPA`, prefijo `UPA`); `SBPRODUCT` con 67 campos (65 con etiqueta, 4 de sistema); el área
`STARBRANDS` con 228 dimensiones, 611 cifras y 6 niveles de periodo; `MATTYPEID` con 9 valores en 0,7 s. Dos cosas que
solo se vieron con el tenant real: un campo que la tabla no tiene contesta **404** («Resource not found for the
segment»), no 400, y los valores «por área» (para filtros de cifras) tardaron unos 19 s en el área grande.

**Sin hacer**: sugerir el nivel de tiempo desde IBP (falta saber la correspondencia con `PERIODIDn`), y revisar el body
de una integración **dentro de una orquestación** (el aviso aparece al editarla y al ejecutarla suelta).

## Pantalla compacta (2026-10-15)

Pedido del usuario: aprovechar el espacio. Lo que se hizo, por si alguien lo quiere deshacer:

- **Menos aire arriba y a los lados** solo en CI Tools (`.content:has(.ci-tools)`): 8 px arriba y 14 px a los lados, en lugar de los 22 px de las demás pantallas.
- **Las pestañas «Integraciones / Orquestaciones / Historial» van en la misma fila que las de conexión**, a su derecha (`ConnectionTabs`, prop `derecha`).
- **El árbol mide 360 px, se queda a la vista mientras el formulario se desplaza y se ajusta**: un divisor en su borde se arrastra, se mueve con las flechas (16 px; 48 con Mayús), Inicio y doble clic lo devuelven. Entre 220 y 560 px, solo en memoria. El nombre completo sale al pasar el cursor por una fila.
- **En la lista manda el nombre**: ocupa todo el ancho de la fila. Por carpeta, la fila es solo el nombre (el comando está al pasar el cursor y en el editor); por destino, el nombre en su línea y debajo, pequeño, la carpeta y el comando.
- **Editor**: nombre, carpeta y botones en una fila; duplicar y eliminar son solo icono. «Cambios sin guardar» va en la fila de las pestañas y la acción principal pasa a ser Guardar mientras hay cambios, y Ejecutar cuando no.
- **Formulario**: el nombre técnico del campo va en su etiqueta y la explicación, al pasar el cursor, en lugar de una línea de ayuda bajo cada campo.
- **Estado de IBP**: en una línea a la derecha de las pestañas «Formulario / JSON»; el motivo de un fallo y los avisos, debajo.
- **Menú lateral** (toda la Suite): 216 px en lugar de 252, siempre a la vista aunque la página se desplace (su pie con la sesión no queda al final), filas más bajas, y tema, «Salir» y requisitos técnicos en una fila de tres iconos junto a quién tiene la sesión, abajo. El botón « sigue minimizándolo.

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
                    ibp-nombres.js                                 puras: prefijo y tipo de tabla, versión base, campos de sistema
                    call.js  integrations.js  history.js           la llamada a CPI, la biblioteca, el historial
                    execute.js  orquestacion.js                    ejecutar una integración / lo que pide una orquestación
                    ibp-catalogo.js  ibp-campos.js                 lo que se lee del IBP de destino (solo lectura) y sus campos
core/orchestrations adaptador `ci` (adapters.js) y camino «síncrono» del motor (runner.js)
handlers/ci/        integrations  run  runs  orchestration-info  ibp   → api/ci/[...ruta].js (la octava función de Vercel)
src/components/ci/  CiTools  Integraciones  EditorDeIntegracion  FormularioDeBloque  ConstructorDeFiltro
                    TablaDeMapeo  DialogoDeEjecucion  OrquestacionesCi  EditorDeOrquestacion  Historial
                    BarraIbp  CampoConLista  ConstructorDeCifra  RevisionIbp  useCatalogoIbp  useIbpDelBody
src/lib/            ci.js  ci-ibp.js  ci-etapas.js  useFilasLocales.js
core/persistence/migrations/006_ci_tools.sql                      módulo y tipo de conexión nuevos, `ci_integrations`, `ci_runs`
core/persistence/migrations/007_ci_ibp_destino.sql                `connections.ibp_connection_id`: el IBP de destino de una conexión de CI
```

Las orquestaciones reutilizan el **mismo motor** que CI-DS e IBP (`/api/orchestrations`, `/api/orchestration-run`):
no hay un segundo motor. Cada orquestación de CI se guarda como un grafo normal; la pantalla de **etapas** es una
forma de dibujarlo (cada paso de una etapa se conecta con todos los de la siguiente). Si un grafo guardado no tiene
esa forma, la pantalla lo dice en vez de enseñar etapas que no son lo que se ejecuta.

### El body y sus piezas

Un body es `{ "NOMBRE_DEL_BLOQUE": { …campos… } }`. Se guarda como **texto** (no `jsonb`, que reordena las claves) y se
envía como el JSON que la persona escribió.

- **Formulario por tipo de dato.** Se vieron dos familias (`MASTERDATA` y `KEYFIGURES`); cada una enseña sus
  campos. «Tipo de dato» es un desplegable y **cambiarlo cambia el formulario**: se quitan los campos que solo valen
  para el otro tipo (`MasterDataPrefix` y `MasterDataType` en cifras; `TargetTimeProfileLevelinSAPIBP` y `FileName` en
  maestro) y aparecen vacíos los del nuevo, justo después de `TypeOfData`. Si lo que se quita tiene valor, se pregunta
  antes; nada se guarda hasta «Guardar». **No cambia el comando por su cuenta.**
- **Comando.** Desplegable con `INSERT_UPDATE` y `REPLACE`, los dos que se vieron en los bodies reales (más «A mano»
  para otro). **No se sabe qué otros acepta el iFlow**: no se inventaron. Los desplegables muestran todas las opciones
  a la vez; un cuadro de texto con las sugerencias del navegador (`<datalist>`) filtra por lo que ya está escrito y
  esconde las demás, y así dejó de poderse llegar a «KEYFIGURES».
- **Destino de una integración.** A qué carga: la tabla de dato maestro (prefijo + tipo, `SBPRODUCT`) o la cifra clave a la
  que apunta `KFVALUE` en el mapeo (`ZFACTURAS`). Se calcula al leer el body (`destinoDeBloque`), no se guarda. La vista
  «Destino» agrupa en tablas de dato maestro, cifras clave y «Sin destino» (bodies a medias), cada destino en un nodo que
  se abre; el buscador también busca por destino. La vista elegida vive solo en memoria.
- **Otros campos.** Lo que el body trae y el formulario no conoce (por ejemplo, al pegar un JSON con un campo más)
  aparece solo en «Otros campos», se conserva y se envía tal cual: el iFlow puede aceptar más. Sin campos extra la
  sección no se muestra; queda un enlace para agregar uno a mano.
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

1. **Aplicar la migración**: `npm run db:migrate`. **Aplicada el 2026-10-14** a la base que usa la Suite (tenía las
   001 a 005). Se comprobó antes que los nombres de las dos restricciones que recrea (`connections_kind_check` y
   `module_subscriptions_module_check`) eran los que asume, y después que quedaron con `ci`.
2. **Activar el módulo `ci`** al cliente (Administración → Clientes, quien administra la plataforma). **Hecho para
   GoSCM el 2026-10-14.**
3. **Dar de alta una conexión «Cloud Integration»** por ambiente, con el endpoint completo y el usuario y la
   contraseña. **Creada «CI STARBRANDS DEV» el 2026-10-14, SIN credenciales**: la contraseña de Basic Auth la escribe
   una persona en Administración → Conexiones (no pasa por código). Si el host de algún tenant no encaja con el
   patrón, no hace falta tocar código: se abre con la variable de entorno `ALLOWED_CI_HOST_REGEX`.
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

**Primera carga real (2026-10-14).** El usuario ejecutó desde la Suite la integración `UOMTO` de «CI STARBRANDS DEV»
(dato maestro, `INSERT_UPDATE`, 2 campos) y **funcionó**: Basic Auth con sus credenciales, HTTP 200, **20 s**, resultado
«Completada» en el historial. Lo que CPI contestó es un XML que repite los parámetros enviados
(`<ROOT><IBPRead BatchCommand=… BatchName=… DataSource=…>`) y **no trae MPL ID**: así se ve un 200. Ese 200 dice que
CPI aceptó la llamada; qué entró en IBP se mira en IBP o en el monitor de CPI (la Suite todavía no lo consulta).

### Lo que ya se comprobó contra el sistema real (2026-10-14)

Con un cliente y una sesión TEMPORALES (borrados al terminar) sobre el servidor de desarrollo, la base y Redis
reales, y la dirección real del CPI de desarrollo con credenciales de mentira:

- La migración 006, el SQL de la biblioteca, el historial y las orquestaciones (45 comprobaciones de API).
- **La llamada llega a CPI y contesta** (401 con credenciales falsas, en unos 2 s); se clasifica como error, no como
  «sin confirmar», y el mensaje manda a mirar el usuario y la contraseña de la conexión.
- **El patrón de host acepta el host real** (`…it-cpi034-rt.cfapps.us10-002…`), incluida su resolución por DNS.
- **El candado**: dos ejecuciones simultáneas de la misma integración, sale una.
- **El módulo se exige en el servidor** (vencerlo da 403 al instante) y **un segundo cliente no ve ni toca nada del
  primero** (404 al leer, cambiar o borrar; no ve su conexión ni su historial).
- La pantalla real: crear, guardar y ejecutar una integración, y armar y lanzar una orquestación de dos etapas
  (fallo del primer paso, segundo omitido, «Retomar» disponible), el historial y la conexión en Administración.

### Lo que sigue sin estrenar

1. ~~**La carga real**~~ Hecha el 2026-10-14 con `UOMTO` (ver arriba): entra, contesta 200 con un XML y tardó 20 s. Falta
   probar una carga de **cifras clave** y una grande (más campos, más filas).
2. **Los 300 s** de la función en el plan Hobby (IBP ya los declara, pero no se ha medido una llamada de ese tamaño).
4. **Una pestaña cerrada a mitad de una vuelta**: se asume que la función sigue hasta terminar o que el paso queda
   «sin confirmar»; no se ha visto cuál de las dos pasa en Vercel.
5. **Un endpoint único por cliente**: se asumió que todos los bodies de una conexión van al mismo endpoint.
6. **El filtro**: la semántica de varias condiciones (si el mismo campo repetido es «o» y campos distintos «y») y si el
   iFlow admite más operadores que `EQ` y `BT`.
7. **`BatchCommand`**: la Suite solo lo muestra. Qué hace `REPLACE` exactamente en el iFlow lo sabe quien lo escribió.
8. **Orquestaciones con cargas que salen bien**, y el caso «sin confirmar» (se probó en el motor con pruebas, no con
   una llamada que de verdad se corte).
