-- 006 — CI Tools: el cuarto módulo. Integraciones de SAP Cloud Integration (CPI) que cargan datos a IBP.
--
-- Qué se agrega:
--
--   1. El módulo `ci` entre los que se pueden contratar, y el tipo de conexión `ci` (un endpoint HTTPS de
--      un iFlow de Cloud Integration, con Basic Auth).
--   2. `ci_integrations`: las integraciones guardadas de un cliente. Una integración es el body que hoy
--      se pega en Postman: un bloque (`PRODUCT`, `KEYFIGURE`…) con lo que el iFlow necesita para cargar
--      una tabla a IBP.
--   3. `ci_runs`: el historial. Quién ejecutó qué, contra qué conexión, cuándo, cuánto tardó y cómo salió.
--
-- Los dos CHECK se recrean con el nombre que Postgres les puso en 001 (`<tabla>_<columna>_check`).

alter table module_subscriptions drop constraint if exists module_subscriptions_module_check;
alter table module_subscriptions add constraint module_subscriptions_module_check
  check (module in ('explorer', 'jobs', 'cids', 'ci'));

alter table connections drop constraint if exists connections_kind_check;
alter table connections add constraint connections_kind_check
  check (kind in ('ibp', 'cids', 'ci'));

-- El body va como TEXTO y no como jsonb, a propósito: jsonb reordena las claves, y lo que se envía al
-- iFlow tiene que ser lo que la persona escribió, en el orden en que lo escribió. Se valida que sea JSON
-- al guardar (lo hace `core/ci`, que puede explicar qué está mal; un CHECK solo diría que no).
--
-- Una integración pertenece a UNA conexión: apunta al tenant de CPI contra el que se probó, y cada
-- ambiente (desarrollo, calidad, producción) tiene su conexión y su biblioteca.
--
-- `folder` es la carpeta de Postman: texto libre, vacío si no hay. Las carpetas no son una tabla porque
-- no tienen nada propio que guardar, y renombrar una es un solo UPDATE.
create table if not exists ci_integrations (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  connection_id uuid not null references connections (id) on delete cascade,
  folder        text not null default '',
  name          text not null,
  body          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users (id) on delete set null,

  constraint ci_integrations_name_not_blank check (length(btrim(name)) > 0)
);

-- Dos integraciones con el mismo nombre en la misma carpeta de la misma conexión no se distinguen en
-- ninguna lista ni en ninguna orquestación.
create unique index if not exists ci_integrations_nombre_idx
  on ci_integrations (client_id, connection_id, folder, name);

create index if not exists ci_integrations_conexion_idx
  on ci_integrations (client_id, connection_id);

-- El historial. El nombre de la integración se copia a cada fila: si la integración se borra o se
-- renombra, el historial sigue diciendo qué se ejecutó ese día. Quién ejecutó también se copia (el
-- correo) por lo mismo.
--
-- `status`:
--   running      se envió y todavía no hay respuesta
--   success      CPI contestó 2xx
--   error        CPI contestó con error, o la llamada ni siquiera salió
--   unconfirmed  se envió y NO se sabe cómo terminó (se cortó la conexión o se agotó el tiempo). La carga
--                pudo haber entrado: no se da por buena ni por mala, y nunca se reintenta sola.
create table if not exists ci_runs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients (id) on delete cascade,
  connection_id    uuid not null references connections (id) on delete cascade,
  integration_id   uuid references ci_integrations (id) on delete set null,
  integration_name text not null,
  folder           text not null default '',
  orchestration_id uuid references orchestrations (id) on delete set null,
  origin           text not null check (origin in ('manual', 'orchestration')),
  user_id          uuid references users (id) on delete set null,
  user_email       text,
  status           text not null check (status in ('running', 'success', 'error', 'unconfirmed')),
  http_status      integer,
  duration_ms      integer,
  mpl_id           text,
  message          text,
  variables        jsonb not null default '{}'::jsonb,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index if not exists ci_runs_conexion_idx
  on ci_runs (client_id, connection_id, started_at desc);

create index if not exists ci_runs_integracion_idx
  on ci_runs (client_id, integration_id, started_at desc);
