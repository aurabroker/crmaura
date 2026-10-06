-- ============================================================
-- crm_clients.auth_user_id: zmienia wyłącznie serwer.
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA — czeka na potwierdzenie.
--
-- Powód: polityka tenant_isolation (ALL) pozwala każdemu użytkownikowi najemcy,
-- także BROKER, zapisać w tej kolumnie dowolny UUID konta Auth. Endpoint
-- /api/portal/access, działając kluczem service_role, zmienia potem hasło albo
-- usuwa wskazane konto — a Auth jest wspólny dla wielu aplikacji.
--
-- Do potwierdzenia przed zastosowaniem: żaden kod przeglądarkowy w src/ nie
-- zapisuje auth_user_id wprost (zapis idzie tylko przez /api/portal/access,
-- który ma service_role i przechodzi przez ten wyzwalacz bez zmian).
-- ============================================================

create or replace function public.crm_clients_auth_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.auth_user_id is not null then
      raise exception 'Powiązanie klienta z kontem logowania ustawia wyłącznie serwer (service_role)';
    end if;
  elsif new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'Powiązanie klienta z kontem logowania zmienia wyłącznie serwer (service_role)';
  end if;
  return new;
end; $$;

revoke all on function public.crm_clients_auth_guard() from public, anon, authenticated;

drop trigger if exists crm_clients_auth_guard_trg on public.crm_clients;
create trigger crm_clients_auth_guard_trg
  before insert or update on public.crm_clients
  for each row execute function public.crm_clients_auth_guard();

-- ROLLBACK: drop trigger crm_clients_auth_guard_trg on public.crm_clients;
