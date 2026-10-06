-- ============================================================
-- crm_tenants: klucz Resend i moduły (features) tylko dla serwera.
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA.
--
-- KOLEJNOŚĆ: najpierw wdrożyć kod, w którym panel SaaS czyta i zapisuje firmy przez
-- /api/saas-admin/tenants (service_role). Ta migracja odbiera przeglądarce odczyt
-- resend_api_key oraz zapis features/resend_api_key — stary panel przestałby działać.
--
-- Powód: polityka tenant_isolation (ALL) pozwala każdemu użytkownikowi firmy, także BROKER,
-- odczytać jawny klucz Resend swojej firmy i samodzielnie włączać sobie moduły.
-- Sprawdzone w pg_stat_statements: poza panelem SaaS żadne zapytanie roli authenticated nie
-- czyta tej kolumny ani nie robi select * na tej tabeli (wszystkie wybierają jawne kolumny).
-- ============================================================

-- 1) Zapis chronionych pól tylko przez service_role (wzorzec jak w crm_profiles_guard).
create or replace function public.crm_tenants_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role = 'service_role' then
    return new;
  end if;
  if new.resend_api_key is distinct from old.resend_api_key then
    raise exception 'Klucz Resend zmienia wyłącznie administrator systemu (service_role)';
  end if;
  if new.features is distinct from old.features then
    raise exception 'Moduły firmy zmienia wyłącznie administrator systemu (service_role)';
  end if;
  return new;
end; $$;

revoke all on function public.crm_tenants_guard() from public, anon, authenticated;

drop trigger if exists crm_tenants_guard_trg on public.crm_tenants;
create trigger crm_tenants_guard_trg
  before update on public.crm_tenants
  for each row execute function public.crm_tenants_guard();

-- 2) Odczyt klucza Resend tylko dla service_role: zawężamy SELECT roli authenticated do
--    jawnej listy kolumn. Zapytania wybierające wyłącznie te kolumny działają bez zmian
--    (w tym osadzone crm_tenants(nazwa)); select * lub kolumna resend_api_key zwróci błąd uprawnień.
--    Uwaga: nowa kolumna w tej tabeli wymaga osobnego grant select (...) dla authenticated.
revoke select on public.crm_tenants from authenticated;
grant select (id, nazwa, created_at, typ, bond_module_enabled, nip, features)
  on public.crm_tenants to authenticated;

-- Weryfikacja po zastosowaniu (oba wyniki powinny być false):
--   select has_column_privilege('authenticated', 'public.crm_tenants', 'resend_api_key', 'select');
--   select has_column_privilege('anon',          'public.crm_tenants', 'resend_api_key', 'select') and false;
--
-- ROLLBACK:
--   drop trigger if exists crm_tenants_guard_trg on public.crm_tenants;
--   grant select on public.crm_tenants to authenticated;
