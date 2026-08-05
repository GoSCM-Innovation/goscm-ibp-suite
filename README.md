# Suite IBP — GoSCM (`goscm-ibp-suite`)

Plataforma web unificada para operar **SAP IBP** y **SAP CI-DS**, comercializada por suscripción. Reúne en una sola aplicación —un login, un panel— tres módulos que antes eran tres aplicaciones separadas:

| Módulo | Qué hace |
|---|---|
| **Explorer** | Jerarquía de producción (BOM), red logística, analizadores de red de suministro y de jerarquía de producción, documentador de Planning Area |
| **Jobs / Migración** | Application Jobs (monitor, ejecución, cancelación, reinicio) y migración de dato maestro, transaccional y key figures |
| **Integración CI-DS** | Monitoreo y orquestación de tareas de SAP CI-DS, explorador de integraciones y generador de documentación de dataflows |

Cada cliente contrata los módulos que necesita; los no contratados aparecen bloqueados. Incluye un panel de administración y un asistente de IA que consulta y ejecuta acciones sobre la propia aplicación.

## Estado

**Fase 1 completa — los cimientos funcionan de punta a punta.** Se puede entrar con un código
enviado al correo, moverse por la aplicación y administrar clientes, personas, suscripciones y
conexiones a SAP desde el navegador. Los tres módulos existen en el menú como sitios
reservados: sus pantallas llegan en las fases siguientes.

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
