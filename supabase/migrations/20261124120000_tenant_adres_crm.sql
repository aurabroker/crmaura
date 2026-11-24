-- Adres CRM firmy do linków dla klientów (formularz APK, wniosek o pierwszą polisę i odnowienie, krótki link do SMS-a)
-- i linków w codziennym podsumowaniu, np. Aura Consulting: https://crm2.auraconsulting.pl. Linki prowadzą na domenę
-- firmy niezależnie od adresu, pod którym pracownik się zalogował ($lib/adresCrm). Puste = jak dotąd.
-- Zapisuje tylko serwer (panel SaaS, service_role); odczyt dla zalogowanych — aplikacja buduje link do formularza APK.

alter table public.crm_tenants add column if not exists adres_crm text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tenants_adres_crm_format' and conrelid = 'public.crm_tenants'::regclass) then
    alter table public.crm_tenants add constraint crm_tenants_adres_crm_format
      check (adres_crm is null or adres_crm ~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$');
  end if;
end $$;

comment on column public.crm_tenants.adres_crm is 'Adres CRM firmy (https://domena, bez ukośnika) do linków wysyłanych klientom i w podsumowaniach; puste = adres żądania (portal dla *.pages.dev).';

grant select (adres_crm) on public.crm_tenants to authenticated;

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
     or new.email_nazwa_nadawcy is distinct from old.email_nazwa_nadawcy
     or new.email_podpis is distinct from old.email_podpis
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
     or new.adres_crm is distinct from old.adres_crm
     or new.bond_module_enabled is distinct from old.bond_module_enabled then
    raise exception 'Dane firmy zmienia wyłącznie administrator systemu (service_role)';
  end if;
  return new;
end; $$;

revoke all on function public.crm_tenants_guard() from public, anon, authenticated;
