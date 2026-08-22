# GoSCM Suite (`goscm-ibp-suite`)

Plataforma web unificada para operar **SAP IBP** y **SAP CI-DS**, comercializada por suscripción. Reúne en una sola aplicación —un login, un panel— tres módulos que antes eran tres aplicaciones separadas:

| Módulo | Qué hace |
|---|---|
| **Explorer** | Jerarquía de producción (BOM), red logística, analizadores de red de suministro y de jerarquía de producción, documentador de Planning Area |
| **Jobs / Migración** | Application Jobs (monitor, ejecución, cancelación, reinicio) y migración de dato maestro, transaccional y key figures |
| **Integración CI-DS** | Monitoreo y orquestación de tareas de SAP CI-DS, explorador de integraciones y generador de documentación de dataflows |

Cada cliente contrata los módulos que necesita; los no contratados aparecen bloqueados. Incluye un panel de administración y un asistente de IA que consulta y ejecuta acciones sobre la propia aplicación.

## Estado

**Los tres proyectos previos están portados.** No queda ningún hueco de funcionalidad abierto en
ninguno de los tres, y cada uno tiene su inventario recorrido contra el repositorio de origen:
[`PARIDAD-V7.md`](docs/PARIDAD-V7.md), [`PARIDAD-V8.md`](docs/PARIDAD-V8.md) y
[`PARIDAD-V9.md`](docs/PARIDAD-V9.md). Ahí está también lo que **no** se portó, con el motivo escrito
en cada caso: no todo lo que hacían las apps viejas valía la pena traer.

Los cimientos funcionan de punta a punta: se entra con un código enviado al correo, y clientes,
personas, suscripciones y conexiones a SAP se administran desde el navegador.

Lo que falta para poner esto delante de un cliente, y no es código de módulos:

- **Verificar un dominio de correo y quitar el desvío temporal.** El envío funciona
  (`core/auth/email.js`, por Resend) pero hoy usa el remitente de pruebas, que **solo entrega al
  dueño de la cuenta**. Mientras dure, `MAIL_REDIRECT_TO` desvía todos los códigos a ese único buzón:
  cada persona entra con su propia dirección e identidad, y solo la entrega se desvía. El asunto dice
  para quién es cada código.

  **Mientras el desvío esté puesto, quien pueda leer ese buzón puede entrar como cualquier usuario.**
  Es aceptable entre quienes construyen la plataforma; hay que quitarlo antes de que entre un cliente.
  Se revierte borrando la variable: no hay nada más que deshacer.

  Sin ninguna variable de correo, en desarrollo el código se imprime en la consola y en producción el
  ingreso falla **a propósito**: un código de acceso en los registros del servidor es una puerta
  abierta para cualquiera que los pueda leer.
- **Vercel Pro y los `crons`** de `vercel.json`, para lo que corre solo.
- **El idioma (es/en)** es una fase propia y deliberadamente la última: hasta que todo esté portado,
  traducir es traducir dos veces.
- **Todo lo que ESCRIBE en SAP está construido y probado en lectura, pero sin estrenar.** Lanzar un
  trabajo, cargar una migración, modificar o borrar dato maestro, copiar cifras clave, lanzar una
  orquestación o una tarea de CI-DS: se estrenan con el usuario delante, no en una corrida
  desatendida. Cada documento de paridad lo lista en su sección «Sin estrenar».

El plan completo y el inventario del que nace esta arquitectura están en
[`docs/FASE-0-LEVANTAMIENTO.md`](docs/FASE-0-LEVANTAMIENTO.md); el estado de cada módulo de la
capa transversal, en [`core/README.md`](core/README.md).

Puesta en marcha desde cero:

```bash
npm install
cp .env.example .env       # rellenar credenciales
npm run db:migrate         # crea el esquema
npm run db:seed -- --cliente "Mi empresa" --slug miempresa --correo yo@miempresa.com
npm run dev
```

Sustituye a tres proyectos previos (`ibp-bom-v7`, `ibp-bom-v8`, `ibp-bom-v9`), que siguen operativos durante la transición para poder verificar paridad de funcionalidad y rendimiento módulo por módulo.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + Vite 8 (JavaScript/JSX, sin TypeScript) |
| Backend | Funciones serverless de Vercel (`api/`) |
| Lógica compartida | [`core/`](core/README.md) — capa transversal |
| Base de datos | Postgres (Neon vía Vercel) |
| Estado efímero y cron | Redis (Upstash) |
| Identidad | SSO con Microsoft (Entra ID) y Google |
| Asistente de IA | Claude (API de Anthropic) |
| Integraciones | SAP IBP (OData), SAP CI-DS (SOAP) |

## Estructura

```
core/     Capa transversal: SAP, persistencia, identidad. Una sola implementación.
api/      Funciones serverless — handlers delgados sobre core/.
src/      Frontend React: shell, módulos, componentes.
docs/     Documentación de arquitectura y decisiones.
```

La dependencia va en un solo sentido: `src/` → `api/` → `core/`. Nada en `core/` importa de `src/`.

## Arranque

```bash
npm install
cp .env.example .env    # rellenar credenciales
npm run dev             # frontend + /api en http://localhost:5173
```

`npm run dev` monta los handlers de `api/*.js` en el dev server de Vite mediante un plugin de desarrollo, así que frontend y API se sirven en un único puerto.

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo (frontend + `/api`) |
| `npm run build` | Build de producción a `dist/` |
| `npm run preview` | Sirve el build localmente |
| `npm run lint` | ESLint sobre todo el repo |
| `npm test` | Tests (Vitest) |
| `npm run db:migrate` | Aplica las migraciones pendientes a Postgres |
| `npm run db:seed` | Crea el primer cliente y su administrador de plataforma |
| `npm run gen:secret` | Genera un secreto aleatorio de 32 bytes |

## Requisitos

- Node.js `>=20.19.0` (ver [`.nvmrc`](.nvmrc))
- Una instancia de Postgres y otra de Redis
- Credenciales de SSO y de SAP para uso real
