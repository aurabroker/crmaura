-- SMS-y do klientów przez SMSAPI (np. krótki link do APK i wniosku): token API i pole nadawcy firmy.
-- Jak klucz Resend: zapisuje je tylko serwer (panel SaaS przez /api/saas-admin/tenants, service_role),
-- a przeglądarka ich nie czyta — SELECT roli authenticated obejmuje jawną listę kolumn
-- (20261006000002_crm_tenants_secret_hardening.sql), więc nowe kolumny są dla niej niewidoczne.

alter table public.crm_tenants add column if not exists smsapi_token text;
alter table public.crm_tenants add column if not exists sms_nadawca text;

comment on column public.crm_tenants.smsapi_token is 'Token OAuth SMSAPI (Bearer) firmy; czyta i zapisuje tylko serwer.';
comment on column public.crm_tenants.sms_nadawca is 'Pole nadawcy SMS zarejestrowane w SMSAPI (do 11 znaków); puste = domyślne pole nadawcy konta.';

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
  if new.smsapi_token is distinct from old.smsapi_token
     or new.sms_nadawca is distinct from old.sms_nadawca then
    raise exception 'Ustawienia SMS firmy zmienia wyłącznie administrator systemu (service_role)';
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

revoke all on function public.crm_tenants_guard() from public, anon, authenticated;

-- Weryfikacja (oba false):
--   select has_column_privilege('authenticated', 'public.crm_tenants', 'smsapi_token', 'select'),
--          has_column_privilege('anon',          'public.crm_tenants', 'smsapi_token', 'select');
