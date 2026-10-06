-- ============================================================
-- crm_tenants: dane firmy, moduły i klucz Resend zmienia tylko serwer.
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA.
--
-- KOLEJNOŚĆ: najpierw wdrożyć kod, w którym panel SaaS czyta i zapisuje firmy przez
-- /api/saas-admin/tenants (service_role). Ta migracja odbiera przeglądarce odczyt
-- resend_api_key oraz zapis chronionych pól — stary panel SaaS przestałby działać.
--
-- Powód: polityka tenant_isolation (ALL) pozwala każdemu użytkownikowi firmy, także BROKER,
--  * odczytać jawny klucz Resend swojej firmy,
--  * samodzielnie włączać sobie moduły (features) i zmieniać typ firmy,
--  * zmienić nazwę firmy — a nazwa służy jako atrybut autoryzacji: funkcja
--    getresponse-client-activities wpuszcza każdą firmę, której nazwa zawiera „aura”.
-- Sprawdzone w pg_stat_statements: jedynym zapisem do crm_tenants z roli authenticated jest
-- panel SaaS (features); nikt poza nim nie czyta resend_api_key ani nie robi select * na tej tabeli.
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
  if new.nazwa is distinct from old.nazwa
     or new.typ is distinct from old.typ
     or new.nip is distinct from old.nip
     or new.bond_module_enabled is distinct from old.bond_module_enabled then
    raise exception 'Dane firmy zmienia wyłącznie administrator systemu (service_role)';
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

-- 3) Rola anon nie ma tu żadnej polityki RLS, a mimo to miała pełne uprawnienia tabeli
--    (w tym do kolumny z kluczem). Jedyna ścieżka anon dotykająca tej tabeli to funkcja
--    get_apk_by_token (SECURITY DEFINER, wykonuje się z uprawnieniami właściciela).
revoke all on public.crm_tenants from anon;

-- 4) Firmy tworzy i usuwa wyłącznie serwer (rejestracja i panel SaaS używają service_role).
--    Rola authenticated zachowuje tylko UPDATE, chroniony wyzwalaczem z punktu 1.
revoke insert, delete, truncate, references, trigger on public.crm_tenants from authenticated;

-- Weryfikacja po zastosowaniu (wszystkie wyniki powinny być false):
--   select has_column_privilege('authenticated', 'public.crm_tenants', 'resend_api_key', 'select'),
--          has_column_privilege('anon',          'public.crm_tenants', 'resend_api_key', 'select'),
--          has_table_privilege('authenticated',  'public.crm_tenants', 'delete');
--
-- ROLLBACK:
--   drop trigger if exists crm_tenants_guard_trg on public.crm_tenants;
--   grant select, insert, delete, truncate, references, trigger on public.crm_tenants to authenticated;
--   grant all on public.crm_tenants to anon;
