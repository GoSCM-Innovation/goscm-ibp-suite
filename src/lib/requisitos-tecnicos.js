// Qué hay que tener configurado para que cada módulo pueda leer algo.
//
// Los TRES proyectos tenían su propio panel de requisitos y decían cosas distintas, porque hablan con
// sistemas distintos: v7 con los acuerdos de comunicación de IBP para sus analizadores, v8 con los
// cuatro `SAP_COM_xxxx` de sus pestañas, y v9 con el tenant de CI-DS y su usuario de WebService.
// Aquí solo estaba el de v7.
//
// El texto es el de cada original, copiado. Es documentación ganada contra tenants reales: la mitad
// de los tropiezos de un arranque no son de la herramienta, son de un acuerdo que no está creado.
//
// v8: `header.req0title`…`header.req4detail` de su `es.json`.
// v9: `REQUIREMENTS` de su `components/Header.jsx`.

/** Los de v8, que gobiernan las pestañas de IBP Tools. */
export const REQUISITOS_IBP = Object.freeze([
  {
    titulo: 'Configuración base — aplica a todos los acuerdos',
    detalle: 'En SAP IBP → Settings → Communication Management: crear un Communication User, un '
      + 'Communication System (representa este sistema externo) y un Communication Arrangement con el '
      + 'escenario correspondiente. La URL del endpoint se obtiene de cada Communication Arrangement '
      + 'una vez creado.',
  },
  {
    titulo: 'SAP_COM_0326 — Administración de Application Jobs',
    detalle: 'Escenario «Programador externo - Integración de administración de jobs de aplicación». '
      + 'Otorga acceso completo al servicio BC_EXT_APPJOB_MANAGEMENT: programar jobs para cualquier '
      + 'usuario de negocio, cancelar, reiniciar y supervisar jobs creados por cualquier usuario. '
      + 'Activa: Resumen · Job Templates · Job Monitor · Orquestador.',
  },
  {
    titulo: 'SAP_COM_0068 — Supervisión de integración',
    detalle: 'Escenario «Planificación: Supervisión de integración». Expone consumo de recursos '
      + '(/IBP/RES_CONS_STATS_API_SRV) con CPU y memoria del tenant en % con timestamps UTC a nivel de '
      + 'minuto, y supervisión de tareas de sistema (/IBP/TASKMON_EXT_SRV) con datos de los últimos 90 '
      + 'días. Activa: Resource Stats.',
  },
  {
    titulo: 'SAP_COM_0924 — Integración de datos de telemetría',
    detalle: 'Escenario «Planning – Telemetry Data Integration». Expone la Telemetry Read API con '
      + 'datos de los últimos 90 días: uso del Excel Add-In (logons, planning views, key figures), '
      + 'Dashboards, Analytics Stories, Alert Monitor y apps Fiori por usuario y Planning Area. '
      + 'Procesa datos personales. Activa: Telemetría.',
  },
  {
    titulo: 'SAP_COM_0720 — Integración de datos maestros y transaccionales',
    detalle: 'Expone MASTER_DATA_API_SRV y PLANNING_DATA_API_SRV. Un área debe habilitarse por '
      + 'separado EN CADA SERVICIO del escenario: tenerla en uno no la habilita en los demás, y ese es '
      + 'el fallo que más veces se confunde con un problema de permisos. Activa: Migración · Ver Dato '
      + 'Maestro · Ver Dato Transaccional.',
  },
  {
    titulo: 'Autenticación — todos los acuerdos',
    detalle: 'HTTP Basic Authentication con el usuario y contraseña del Communication User de cada '
      + 'acuerdo. Aquí las credenciales las da de alta quien administra la cuenta y quedan cifradas en '
      + 'el servidor: no llegan nunca al navegador.',
  },
])

/** Los de v9, que gobiernan CI-DS Tools. */
export const REQUISITOS_CIDS = Object.freeze([
  {
    titulo: '1. Tenant SAP CI-DS',
    detalle: 'Acceso a un tenant de SAP Cloud Integration for Data Services (CI-DS), sobre plataforma '
      + 'Kyma o Neo (legacy). Es el sistema cuyas tasks y proyectos gestiona esta aplicación.',
  },
  {
    titulo: '2. Usuario tipo WebService',
    detalle: 'El admin debe crearlo en Administrator → Users con permiso de WebServices. Un usuario '
      + 'normal de UI no sirve. Su usuario y contraseña se usan al iniciar sesión.',
  },
  {
    titulo: '3. Organización (orgName)',
    detalle: 'Nombre técnico de la organización CI-DS, sensible a mayúsculas y minúsculas. Aparece en '
      + 'la consola CI-DS, arriba a la derecha bajo tu usuario.',
  },
  {
    titulo: '4. URL del servicio SOAP',
    detalle: 'Endpoint del WebService de CI-DS. Kyma: https://<host>/webservices · Neo: '
      + 'https://<host>/DSoD/webservices. Se obtiene del dominio del portal CI-DS reemplazando la ruta '
      + 'por /webservices.',
  },
  {
    titulo: '5. Autenticación por sesión',
    detalle: 'La aplicación hace logon con usuario y contraseña y obtiene un SessionId temporal que usa '
      + 'en cada operación; al cerrar la conexión hace logout. No usa Basic Auth ni OAuth, y la '
      + 'contraseña no se almacena.',
  },
  {
    titulo: '6. Repositorios Producción y Sandbox',
    detalle: 'Cada alta crea automáticamente dos destinos sobre el mismo tenant: uno contra el '
      + 'repositorio Productivo y otro contra el Sandbox.',
  },
  {
    titulo: '7. Conectividad de red',
    detalle: 'El endpoint SOAP debe ser alcanzable desde el backend de GoSCM, que actúa como pasarela '
      + 'segura (token Bearer + protección anti-SSRF, sin seguir redirecciones).',
  },
])
