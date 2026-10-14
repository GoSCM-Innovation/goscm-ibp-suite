-- 007 — A qué SAP IBP carga cada conexión de Cloud Integration.
--
-- Una conexión de tipo `ci` es solo un endpoint de CPI con su usuario: no dice en qué tenant de IBP aterrizan
-- las cargas. Para que CI Tools pueda sugerir áreas, versiones, tablas, campos y cifras clave al armar un body,
-- tiene que saber a qué IBP preguntarle, y ese IBP ya está dado de alta como una conexión más (con sus acuerdos y
-- sus credenciales cifradas, que solo el servidor descifra).
--
-- El vínculo es de la conexión y no de cada integración: un ambiente de CPI (desarrollo, calidad, producción)
-- carga a un solo IBP. Que sea del MISMO cliente y de tipo `ibp` lo comprueba `core/connections`, que puede decir
-- qué está mal; una clave foránea no distingue clientes ni tipos.
--
-- `on delete set null`: borrar la conexión de IBP deja la de CPI sin vínculo (y sin sugerencias), no la borra.

alter table connections add column if not exists ibp_connection_id uuid references connections (id) on delete set null;
