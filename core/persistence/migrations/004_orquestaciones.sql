-- 004 — Orquestaciones de CI-DS: encadenar tareas con dependencias, reintentos y grupos.
--
-- En v9 TODAS las orquestaciones de TODOS los clientes vivían en una sola clave de Redis
-- (`cids:orchestrations`) como un único arreglo JSON. Eso traía tres problemas, y el segundo es el
-- que decide que esto vaya en Postgres:
--
--   1. Era una clave global, sin aislamiento por cliente.
--   2. Cada cambio leía el arreglo entero, lo modificaba y lo volvía a escribir. Dos personas
--      guardando a la vez y una pierde su trabajo sin que nadie se entere.
--   3. Redis es estado efímero. Una orquestación es dato durable: si Redis se vacía, no está.
--
-- Aquí la definición es durable y va a Postgres con la guarda de cliente; en Redis queda solo el
-- estado de una ejecución en curso, que sí es efímero y se puede perder sin consecuencias.

-- Una orquestación corre contra un DESTINO, no contra una conexión: `connection_id` dice a qué
-- tenant y `production` a cuál de sus dos repositorios. En v9 el repositorio se deducía de una marca
-- de la conexión, pero en CI-DS una conexión es pruebas Y producción a la vez, así que hay que
-- decirlo. No es un detalle: lanzar una carga en pruebas y en producción no es lo mismo.
create table if not exists orchestrations (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  connection_id uuid not null references connections (id) on delete cascade,
  production    boolean not null default false,
  name          text not null,

  -- El grafo va como JSON y no en tablas de nodos y aristas a propósito: se lee y se escribe siempre
  -- completo —el lienzo guarda todo el dibujo de una vez— y nunca se consulta "todos los nodos que
  -- usan tal tarea". Normalizarlo sería trabajo sin beneficio. Su forma la valida `core/orchestrations`,
  -- que puede explicar qué está mal; un CHECK solo podría decir que no.
  nodes         jsonb not null default '[]'::jsonb,
  edges         jsonb not null default '[]'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint orchestrations_name_not_blank check (length(btrim(name)) > 0)
);

-- Se lista por destino: "las orquestaciones de este repositorio de este tenant".
create index if not exists orchestrations_destino_idx
  on orchestrations (client_id, connection_id, production);

-- Sin índice único por nombre a propósito: v9 no lo tenía y duplicar una orquestación le agrega
-- "(copia)" al nombre, así que duplicar dos veces choparía contra la restricción y fallaría.
