-- ============================================================
-- Pliki not prowizyjnych i zestawień TU w Cloudflare R2 (zamiast bucketu settlement-files w Supabase).
-- STATUS: ZASTOSOWANA na produkcji 2026-10-10; wyzwalacz sprawdzony — zmiana plik_* z roli authenticated jest odrzucana.
-- Klucz obiektu: noty/<tenant_id>/<nota_id>/<uuid>.<rozszerzenie>. Stare pliki (file_url) zostają
-- w Supabase Storage i nadal się otwierają.
-- Kolumny plik_* zapisuje tylko serwer (/api/noty/<id>/plik, service_role) — przeglądarka może dalej
-- dodawać i poprawiać noty (polityka tenant_isolation), ale nie przepnie noty na cudzy plik.
-- ============================================================

alter table public.crm_noty add column if not exists plik_klucz text;
alter table public.crm_noty add column if not exists plik_nazwa text;
alter table public.crm_noty add column if not exists plik_rozmiar bigint;
alter table public.crm_noty add column if not exists plik_typ text;
alter table public.crm_noty drop constraint if exists crm_noty_plik_klucz_chk;
alter table public.crm_noty add constraint crm_noty_plik_klucz_chk
  check (plik_klucz is null or plik_klucz ~ ('^noty/' || tenant_id::text || '/'));

create or replace function public.crm_noty_plik_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.plik_klucz is not null or new.plik_nazwa is not null or new.plik_rozmiar is not null or new.plik_typ is not null then
      raise exception 'Plik noty zapisuje wyłącznie serwer';
    end if;
  elsif new.plik_klucz is distinct from old.plik_klucz
     or new.plik_nazwa is distinct from old.plik_nazwa
     or new.plik_rozmiar is distinct from old.plik_rozmiar
     or new.plik_typ is distinct from old.plik_typ then
    raise exception 'Plik noty zapisuje wyłącznie serwer';
  end if;
  return new;
end; $$;

revoke all on function public.crm_noty_plik_guard() from public, anon, authenticated;

drop trigger if exists crm_noty_plik_guard_trg on public.crm_noty;
create trigger crm_noty_plik_guard_trg
  before insert or update on public.crm_noty
  for each row execute function public.crm_noty_plik_guard();

-- ROLLBACK:
--   drop trigger if exists crm_noty_plik_guard_trg on public.crm_noty;
--   drop function if exists public.crm_noty_plik_guard();
--   alter table public.crm_noty drop constraint if exists crm_noty_plik_klucz_chk,
--     drop column plik_klucz, drop column plik_nazwa, drop column plik_rozmiar, drop column plik_typ;
