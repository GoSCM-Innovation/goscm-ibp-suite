-- 002 — El correo pasa a ser una puerta de entrada más.
--
-- La identidad de la aplicación siempre fue el correo verificado; hasta ahora las únicas
-- formas de verificarlo eran Microsoft y Google. Se añade `email`: un código de un solo uso
-- enviado al buzón demuestra exactamente lo mismo que demuestra un proveedor de SSO.
--
-- Es además la puerta por la que se arranca. Microsoft y Google quedan para una iteración
-- posterior (decisión del usuario, 2026-08-03): no aportan seguridad sobre esto, aportan
-- comodidad y una casilla en los cuestionarios de compra de las empresas grandes.

alter table users drop constraint users_allowed_providers_valid;

alter table users alter column allowed_providers set default array['email']::text[];

alter table users add constraint users_allowed_providers_valid check (
  cardinality(allowed_providers) > 0
  and allowed_providers <@ array['email', 'microsoft', 'google']::text[]
);
