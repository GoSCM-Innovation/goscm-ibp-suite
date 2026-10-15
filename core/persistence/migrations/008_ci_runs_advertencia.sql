-- 008 — Un cuarto resultado para las ejecuciones de CI Tools: «warning» (completada con advertencias).
--
-- Cuando CPI contesta algo distinto de 200 (OK) pero trae el MPL ID de un mensaje, el iFlow SÍ procesó la carga y lo que
-- pasó puede ser que IBP rechazara algún registro: no es necesariamente un error. Hasta ahora esas ejecuciones se anotaban
-- como `error`; ahora se anotan como `warning` y la pantalla las enseña como «Completada con advertencias».
--
-- Solo se amplía la lista de estados permitidos: no se toca ninguna fila existente (las anteriores siguen como están).

alter table ci_runs drop constraint if exists ci_runs_status_check;
alter table ci_runs add constraint ci_runs_status_check
  check (status in ('running', 'success', 'warning', 'error', 'unconfirmed'));
