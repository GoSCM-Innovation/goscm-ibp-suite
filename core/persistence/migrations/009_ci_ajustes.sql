-- 009 — Ajustes de una orquestación de CI Tools, y su rastro en el historial.
--
-- Una orquestación puede cambiar, para su carga, lo que dicen las integraciones que ejecuta (versión, comando, origen, destino,
-- fechas y valores del filtro) sin tocar la integración original: la integración se queda como está y los ajustes se aplican al
-- body SOLO al enviarlo. Ver `core/ci/ajustes.js`.
--
--   - `orchestrations.adjustments`: los ajustes del LOTE (los de todos los pasos). Los de cada PASO viajan en el grafo, dentro del
--     `data` de su nodo, como el resto de lo que configura un paso.
--   - `ci_runs.adjustments`: qué se cambió en ESA llamada (una lista de `{ clave, etiqueta, de, a, fuente }`), para que el
--     historial diga que se ejecutó con ajustes y cuáles. Vacía en las ejecuciones de siempre.
--
-- Solo se agregan columnas con valor por omisión: no se toca ninguna fila existente.

alter table orchestrations add column if not exists adjustments jsonb not null default '{}'::jsonb;
alter table ci_runs add column if not exists adjustments jsonb not null default '[]'::jsonb;
