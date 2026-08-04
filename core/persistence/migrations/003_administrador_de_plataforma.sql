-- 003 — Dos niveles de administración.
--
-- `is_admin` ya existía y significa "administra su propio cliente": su gente y sus conexiones
-- a SAP. Lo que faltaba era el nivel de encima.
--
-- `is_platform_admin` es GoSCM: da de alta clientes, activa y vence módulos —porque eso es
-- cobrar— y puede nombrar a otros de su mismo nivel. Sin esta separación, el administrador de
-- un cliente podría crearse clientes nuevos y regalarse módulos que no contrató.
--
-- El primero se crea con `npm run db:seed`, ejecutado contra la base. No hay forma de
-- fabricarlo desde la aplicación, que es justo lo que se quiere.

alter table users add column if not exists is_platform_admin boolean not null default false;

-- Para encontrar rápido a los administradores de plataforma al comprobar que no queda ninguno.
create index if not exists users_platform_admin_idx on users (is_platform_admin) where is_platform_admin;
