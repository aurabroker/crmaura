-- ============================================================
-- Status dostarczenia e-maili do klientów (webhook Resend → /api/webhooks/resend/<tenant_id>).
-- STATUS: ZASTOSOWANA na produkcji 2026-10-10 (krokami przez execute_sql; sekret niewidoczny dla authenticated — sprawdzone).
--
-- 1) crm_tenants.resend_webhook_secret — sekret podpisu webhooka (whsec_…) z panelu Resend firmy.
--    Bez grantu SELECT dla authenticated (patrz 20261006000002): czyta i zapisuje tylko serwer.
-- 2) crm_client_emails: stan dostawy ostatniego zdarzenia, czas pierwszego otwarcia i opis błędu.
--    Tabela ma dla authenticated tylko SELECT — status zapisuje wyłącznie serwer (service_role).
-- ============================================================

alter table public.crm_tenants add column if not exists resend_webhook_secret text;
alter table public.crm_tenants drop constraint if exists crm_tenants_resend_webhook_secret_chk;
alter table public.crm_tenants add constraint crm_tenants_resend_webhook_secret_chk
  check (resend_webhook_secret is null or resend_webhook_secret ~ '^whsec_[A-Za-z0-9+/=]{16,200}$');

-- Sekret zmienia tylko serwer (jak klucz Resend i adres nadawcy) — rozszerzenie crm_tenants_guard.
create or replace function public.crm_tenants_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role = 'service_role' then
    return new;
  end if;
  if new.resend_api_key is distinct from old.resend_api_key
     or new.email_from is distinct from old.email_from
     or new.resend_webhook_secret is distinct from old.resend_webhook_secret then
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

alter table public.crm_client_emails add column if not exists dostawa text;
alter table public.crm_client_emails drop constraint if exists crm_client_emails_dostawa_chk;
alter table public.crm_client_emails add constraint crm_client_emails_dostawa_chk
  check (dostawa is null or dostawa in ('wyslany', 'opozniony', 'dostarczony', 'otwarty', 'klikniety', 'odbity', 'spam', 'blad'));
alter table public.crm_client_emails add column if not exists dostawa_at timestamptz;
alter table public.crm_client_emails add column if not exists otwarto_at timestamptz;
alter table public.crm_client_emails add column if not exists dostawa_blad text;

-- Webhook szuka wiersza po identyfikatorze wiadomości w Resend.
create index if not exists crm_client_emails_dostawca_idx
  on public.crm_client_emails (tenant_id, dostawca_id) where dostawca_id is not null;

-- Weryfikacja (oczekiwane: false):
--   select has_column_privilege('authenticated', 'public.crm_tenants', 'resend_webhook_secret', 'select');
-- ROLLBACK:
--   alter table public.crm_client_emails drop column dostawa, drop column dostawa_at, drop column otwarto_at, drop column dostawa_blad;
--   drop index if exists crm_client_emails_dostawca_idx;
--   alter table public.crm_tenants drop column resend_webhook_secret;  -- i poprzednia wersja crm_tenants_guard z 20261007000002
