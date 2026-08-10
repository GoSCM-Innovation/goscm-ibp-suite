-- 005 — Cómo se llama, en CADA tenant, lo que el explorador necesita.
--
-- El explorador pide "el maestro de productos" y "la descripción del producto". Ninguna de las dos
-- se llama igual en dos tenants: son `GIDPRODUCT` en uno y `AS1PRODUCT` en otro, y hay campos que en
-- uno existen y en otro no. La detección automática acierta casi siempre; lo que no resuelve se
-- pregunta una vez y se guarda aquí.
--
-- En v7 esto vivía en `localStorage` con la clave `fieldmap_<area>`. Dos problemas, y el segundo es
-- el que decide que vaya a Postgres:
--
--   1. La clave era solo el ÁREA. Dos tenants con un área del mismo nombre compartían el mapeo, y el
--      de uno se aplicaba silenciosamente a los datos del otro.
--   2. Vivía en el navegador. La corrección que hace una persona no la ve nadie más, así que el
--      siguiente que abre la pantalla vuelve a resolver lo mismo — y puede resolverlo distinto. Un
--      análisis de calidad de datos que da dos resultados según quién lo corra no sirve para llevarlo
--      a una reunión.
--
-- Aquí el mapeo es del CLIENTE y está atado al destino exacto: conexión, área y versión.

create table if not exists explorer_maps (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  connection_id uuid not null references connections (id) on delete cascade,
  planning_area text not null,
  -- La versión base es la cadena vacía y no NULL, para que la clave única la trate como un valor más:
  -- con NULL, Postgres considera distintas dos filas que son la misma y se duplicarían.
  version_id    text not null default '',

  -- Qué entidad cumple cada papel: { papel: nombreDeEntidad }. Lo que la detección automática
  -- resolvió mal o no resolvió, corregido a mano.
  roles         jsonb not null default '{}'::jsonb,

  -- Qué campo real corresponde a cada canónico: { entidad: { canonico: real | null } }. `null` es una
  -- RESPUESTA —alguien confirmó que el campo no existe— y por eso no se vuelve a preguntar; que la
  -- clave no esté es que nadie lo revisó todavía. Va como JSON y no en tablas porque se lee y se
  -- escribe completo, y nunca se consulta "en qué tenants existe tal campo".
  fields        jsonb not null default '{}'::jsonb,

  updated_at    timestamptz not null default now(),
  updated_by    uuid references users (id) on delete set null,

  constraint explorer_maps_area_not_blank check (length(btrim(planning_area)) > 0)
);

-- Un solo mapeo por destino. Es lo que impide que dos personas guarden correcciones distintas para
-- lo mismo y que el análisis dependa de quién lo corrió.
create unique index if not exists explorer_maps_destino_idx
  on explorer_maps (client_id, connection_id, planning_area, version_id);
