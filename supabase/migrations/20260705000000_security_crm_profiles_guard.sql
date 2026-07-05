-- ============================================================
-- S1 (KRYTYCZNE): Blokada pionowej eskalacji uprawnień.
--
-- Problem: crm_profiles ma tylko politykę `tenant_isolation` (FOR ALL,
-- WITH CHECK tenant_id = get_my_tenant_id()), która jest KOLUMNOWO ŚLEPA.
-- Rola `authenticated` ma UPDATE na kolumnie `rola`, więc dowolny zalogowany
-- użytkownik mógł wykonać anon-klientem:
--   sb.from('crm_profiles').update({ rola: 'ADMIN GOD' }).eq('id', <self>)
-- tenant_id się nie zmienia → WITH CHECK przechodzi → staje się ADMIN GOD,
-- co odblokowuje endpointy /api/saas-admin/* (reset hasła dowolnego usera w
-- dowolnym tenancie). Serwerowa ochrona assertAssignableRole była omijana,
-- bo atak szedł wprost do bazy, a nie przez chroniony endpoint.
--
-- Fix: trigger blokujący dla sesji anon/authenticated zmianę własnej roli
-- i przypisania do firmy oraz tworzenie kont z rolą uprzywilejowaną.
-- Operacje serwerowe (service_role, endpointy /api/admin/*) pozostają wolne.
-- ============================================================

create or replace function public.crm_profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  -- Operacje serwerowe (service_role) oraz bezpośrednie migracje (postgres,
  -- brak claimów JWT → traktowane jak service_role) — bez ograniczeń.
  if v_role = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.rola is distinct from old.rola then
      raise exception 'Zmiana roli dozwolona tylko przez administratora (service_role)';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Zmiana przypisania do firmy dozwolona tylko przez administratora (service_role)';
    end if;
  elsif tg_op = 'INSERT' then
    if new.rola in ('ADMIN GOD', 'ADMIN BROKER', 'BOARD') then
      raise exception 'Tworzenie konta z rolą uprzywilejowaną tylko przez administratora (service_role)';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists crm_profiles_guard_trg on public.crm_profiles;
create trigger crm_profiles_guard_trg
  before insert or update on public.crm_profiles
  for each row execute function public.crm_profiles_guard();
