-- ============================================================
-- Zadanie dzienne odnowień: adres *.pages.dev zamiast portal.beautypolisa.eu.
-- STATUS: ZASTOSOWANA na produkcji 2026-10-08 (ręczne uruchomienie: HTTP 200, wynik zadania bez błędów).
--
-- Domena portalu ma ochronę Cloudflare przed botami: żądanie z bazy (pg_net) dostaje 403 „Just a moment…”
-- i zadanie /api/cron/renewals nigdy się nie wykonuje (wygaszanie linków, automat 45 dni, przypomnienia).
-- Ta sama aplikacja pod crmaura.pages.dev odpowiada normalnie; endpoint chroni nagłówek x-cron-token,
-- a linki w e-mailach i tak prowadzą na portal (trasa cron podmienia adres *.pages.dev na portal).
-- ============================================================

create or replace function public.crm_run_renewals()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://crmaura.pages.dev/api/cron/renewals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;
revoke all on function public.crm_run_renewals() from public, anon, authenticated;

-- Weryfikacja (po zastosowaniu, ręcznie): wywołanie i odpowiedź zadania — oczekiwany status 200 z JSON-em wyniku.
--   select public.crm_run_renewals();                                   -- zwraca id żądania
--   select status_code, content from net._http_response order by id desc limit 1;
