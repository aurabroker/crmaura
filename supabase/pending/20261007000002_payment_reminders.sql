-- ============================================================
-- Przypomnienia o płatnościach składek (edge function send-payment-reminders).
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA.
--
-- KOLEJNOŚĆ: najpierw wdrożyć kod CRM (pole „Nadawca e-maili” w SAAS Admin), potem ta migracja,
-- potem wdrożenie funkcji send-payment-reminders. Funkcja wysyła tylko dla firm, które mają
-- w SAAS Admin klucz Resend i adres nadawcy — do tego czasu zadanie dzienne nic nie wysyła.
-- ============================================================

-- 1) Rata dostaje przypomnienie raz: znacznik ustawiany przed wysyłką.
alter table public.crm_policy_payments add column if not exists przypomnienie_wyslane_at timestamptz;

-- 2) Nadawca e-maili firmy, np. „Aura Expert <platnosci@auraexpert.pl>”. Kolumna nie ma grantu
--    SELECT dla authenticated (patrz 20261006000002) — czyta ją tylko serwer.
alter table public.crm_tenants add column if not exists email_from text;
alter table public.crm_tenants drop constraint if exists crm_tenants_email_from_chk;
alter table public.crm_tenants add constraint crm_tenants_email_from_chk
  check (email_from is null or (length(email_from) <= 200 and email_from ~ '@' and email_from !~ '[\r\n]'));

-- 3) Adres nadawcy zmienia tylko serwer (jak klucz Resend) — rozszerzenie crm_tenants_guard.
create or replace function public.crm_tenants_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role = 'service_role' then
    return new;
  end if;
  if new.resend_api_key is distinct from old.resend_api_key
     or new.email_from is distinct from old.email_from then
    raise exception 'Ustawienia e-mail firmy zmienia wyłącznie administrator systemu (service_role)';
  end if;
  if new.features is distinct from old.features then
    raise exception 'Moduły firmy zmienia wyłącznie administrator systemu (service_role)';
  end if;
  if new.nazwa is distinct from old.nazwa
     or new.typ is distinct from old.typ
     or new.nip is distinct from old.nip
     or new.bond_module_enabled is distinct from old.bond_module_enabled then
    raise exception 'Dane firmy zmienia wyłącznie administrator systemu (service_role)';
  end if;
  return new;
end; $$;

-- 4) Wywołanie funkcji brzegowej z tokenem z Vault (wzorzec jak ud_wnioski_przypomnienia).
--    p_dry_run = true: funkcja tylko liczy, co by wysłała (wynik w net._http_response).
create or replace function public.crm_send_payment_reminders(p_dry_run boolean default false)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/send-payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_cron_token')
    ),
    body := jsonb_build_object('dry_run', p_dry_run),
    timeout_milliseconds := 60000
  );
$$;
revoke all on function public.crm_send_payment_reminders(boolean) from public, anon, authenticated;

-- 5) Codziennie o 6:05 UTC (8:05 latem, 7:05 zimą czasu polskiego).
select cron.schedule('crm-payment-reminders', '5 6 * * *', 'select public.crm_send_payment_reminders()');

-- Weryfikacja:
--   select jobname, schedule, active from cron.job where jobname = 'crm-payment-reminders';
-- Próba bez wysyłki (po wdrożeniu funkcji i ustawieniu klucza oraz nadawcy w SAAS Admin):
--   select public.crm_send_payment_reminders(true);           -- zwraca id żądania
--   select status_code, content from net._http_response where id = <id>;
--
-- ROLLBACK:
--   select cron.unschedule('crm-payment-reminders');
--   drop function if exists public.crm_send_payment_reminders(boolean);
--   (kolumny i rozszerzenie wyzwalacza mogą zostać — bez zadania nic nie wysyłają)
