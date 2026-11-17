-- Nazwa nadawcy i podpis w e-mailach do klientów (mail z polisą, e-mail z karty klienta), np. Aura Expert:
-- „Beauty❤️Polisa / Płatności” i „Zespół Beauty❤️Polisa” zamiast imienia i nazwiska osoby, która wysyła.
-- Jak adres nadawcy (email_from): zapisuje je tylko serwer (panel SaaS przez /api/saas-admin/tenants, service_role).
-- Puste = jak dotąd: nazwa firmy (mail z polisą) albo „osoba | firma” (e-mail z karty klienta) i imię i nazwisko w podpisie.

alter table public.crm_tenants add column if not exists email_nazwa_nadawcy text;
alter table public.crm_tenants add column if not exists email_podpis text;

comment on column public.crm_tenants.email_nazwa_nadawcy is 'Nazwa nadawcy w e-mailach do klientów (adres z email_from albo z szablonu Resend); puste = nazwa firmy / osoba wysyłająca.';
comment on column public.crm_tenants.email_podpis is 'Podpis w e-mailach z polisą zamiast imienia i nazwiska osoby wysyłającej (np. „Zespół Beauty❤️Polisa”); puste = osoba wysyłająca.';

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
     or new.bond_module_enabled is distinct from old.bond_module_enabled then
    raise exception 'Dane firmy zmienia wyłącznie administrator systemu (service_role)';
  end if;
  return new;
end; $$;

revoke all on function public.crm_tenants_guard() from public, anon, authenticated;
