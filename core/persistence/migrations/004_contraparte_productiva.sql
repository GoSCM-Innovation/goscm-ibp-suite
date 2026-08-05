-- 004 — La contraparte productiva de una conexión.
--
-- Para qué sirve: cuando alguien mira un tenant de pruebas, la aplicación puede marcar qué tareas
-- existen ADEMÁS en el productivo, o sea qué está ya transportado. v9 lo hacía, pero lo sabía
-- porque el usuario se identificaba a mano contra producción y el navegador se guardaba esa
-- segunda sesión. Aquí las conexiones son filas independientes, así que el enlace se escribe.
--
-- Se escribe y no se deduce a propósito: buscar "la conexión del cliente que esté marcada como
-- productiva" acierta mientras haya una sola, y el día que haya dos elige mal en silencio —
-- aparecerían estrellas en tareas que no están transportadas y nadie se enteraría.
--
-- Nulo es lo normal: una conexión productiva no tiene contraparte, y una de pruebas tampoco está
-- obligada a declararla.
alter table connections
  add column if not exists production_counterpart_id uuid references connections (id) on delete set null;

-- El enlace tiene que quedar dentro del mismo cliente y apuntar a otra conexión, no a sí misma.
-- Que sea del mismo tipo y que la apuntada sea realmente productiva lo valida `core/connections`,
-- que puede dar un mensaje explicando qué pasó; aquí van las dos que la base puede sostener sola.
alter table connections
  drop constraint if exists connections_counterpart_not_self;
alter table connections
  add constraint connections_counterpart_not_self
  check (production_counterpart_id is null or production_counterpart_id <> id);

-- Para resolver el enlace al vuelo sin recorrer la tabla.
create index if not exists connections_counterpart_idx
  on connections (production_counterpart_id)
  where production_counterpart_id is not null;
