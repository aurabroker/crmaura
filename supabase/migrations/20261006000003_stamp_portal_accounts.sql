-- ============================================================
-- Znacznik konta portalu klienta (app_metadata.portal_klient_id).
-- STATUS: ZASTOSOWANA na produkcji 2026-10-06 (1 konto oznaczone, weryfikacja ok = true). Idempotentna.
--
-- /api/portal/access rozpoznaje konto portalu po znaczniku w app_metadata, który zapisuje tylko
-- serwer. Konta założone przed wprowadzeniem znacznika są oznaczane przy pierwszym użyciu endpointu,
-- ale do tego czasu właściciel takiego konta mógłby zmienić swój user_metadata i uniemożliwić
-- doradcy reset hasła lub odebranie dostępu. Ta migracja oznacza istniejące konta od razu.
-- Oznaczane są wyłącznie konta, które spełniają dotychczasowy warunek (rola=KLIENT i klient_id
-- zgodny z klientem, do którego konto jest przypięte) i nie są kontami pracowników.
-- Zastosować po wdrożeniu kodu.
-- ============================================================

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('portal_klient_id', c.id::text)
from public.crm_clients c
where c.auth_user_id = u.id
  and u.raw_user_meta_data ->> 'rola' = 'KLIENT'
  and u.raw_user_meta_data ->> 'klient_id' = c.id::text
  and not exists (select 1 from public.crm_profiles p where p.id = u.id)
  and coalesce(u.raw_app_meta_data ->> 'portal_klient_id', '') <> c.id::text;

-- Weryfikacja (powinno zwrócić wiersze z ok = true dla wszystkich kont portalu):
--   select c.id, (u.raw_app_meta_data ->> 'portal_klient_id') = c.id::text as ok
--   from public.crm_clients c join auth.users u on u.id = c.auth_user_id;
