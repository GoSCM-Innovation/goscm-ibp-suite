-- 001 — Esquema inicial: clientes, usuarios, suscripción por módulo y conexiones a SAP.
--
-- Convención que sostiene el aislamiento por cliente: TODA tabla con datos de un cliente
-- lleva la columna `client_id`, incluso cuando podría deducirse siguiendo una relación
-- (ver `connection_agreements`). La uniformidad es deliberada — es lo que permite que la
-- guarda de `core/persistence/tenant-scope.js` exija el filtro sin excepciones.
--
-- Las sesiones NO viven aquí: son estado efímero y van en Redis.

create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- La identidad es el correo verificado por el proveedor de SSO. El proveedor es solo la
-- puerta: el mismo correo entrando por Microsoft o por Google es el mismo usuario. De ahí
-- el índice único global sobre el correo en minúsculas.
create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients (id) on delete cascade,
  email             text not null,
  name              text,
  is_admin          boolean not null default false,
  allowed_providers text[] not null default array['microsoft', 'google']::text[],
  status            text not null default 'active' check (status in ('active', 'disabled')),
  created_at        timestamptz not null default now(),
  last_login_at     timestamptz,
  constraint users_allowed_providers_valid check (
    cardinality(allowed_providers) > 0
    and allowed_providers <@ array['microsoft', 'google']::text[]
  )
);

create unique index if not exists users_email_unique on users (lower(email));
create index if not exists users_client_idx on users (client_id);

-- Una fila por cliente y módulo contratado. Es lo que consulta la guarda de "módulo
-- contratado" en el backend: ocultar un botón en la interfaz no es una restricción.
create table if not exists module_subscriptions (
  client_id   uuid not null references clients (id) on delete cascade,
  module      text not null check (module in ('explorer', 'jobs', 'cids')),
  status      text not null default 'active' check (status in ('active', 'expired')),
  valid_from  date,
  valid_until date,
  created_at  timestamptz not null default now(),
  primary key (client_id, module)
);

-- Una conexión es un destino: un tenant de IBP (base OData) o un endpoint de CI-DS.
-- `organization` e `is_production` solo aplican a CI-DS.
create table if not exists connections (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  kind          text not null check (kind in ('ibp', 'cids')),
  name          text not null,
  base_url      text not null,
  organization  text,
  is_production boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (client_id, name)
);

create index if not exists connections_client_idx on connections (client_id);

-- Cada acuerdo de comunicación tiene SU PROPIO usuario SAP (0326 con un usuario, 0720 con
-- otro). Los conocidos hoy son SAP_COM_0326, 0068, 0720 y 0924, pero la columna no lleva
-- CHECK a propósito: dar de alta un acuerdo nuevo no debe exigir una migración.
--
-- La contraseña se guarda cifrada con AES-256-GCM y NUNCA se envía al navegador. El cifrado
-- lo hace core/connections; aquí solo viven las tres partes del texto cifrado.
create table if not exists connection_agreements (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients (id) on delete cascade,
  connection_id     uuid not null references connections (id) on delete cascade,
  agreement         text not null,
  sap_user          text not null,
  secret_ciphertext text not null,
  secret_iv         text not null,
  secret_tag        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (connection_id, agreement)
);

create index if not exists connection_agreements_client_idx on connection_agreements (client_id);
