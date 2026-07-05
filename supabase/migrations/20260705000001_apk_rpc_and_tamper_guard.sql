-- ============================================================
-- S2 (KRYTYCZNE): APK — likwidacja zależności od anon SELECT/UPDATE
-- oraz twarda blokada manipulacji cudzymi formularzami/tokenami.
--
-- Kontekst: apk_forms/apk_tokens mają polityki anon SELECT USING(true) i
-- anon UPDATE WITH CHECK(true). Pozwala to każdemu z publicznym anon-kluczem:
--   1) wylistować WSZYSTKIE APK wszystkich tenantów (PII/RODO),
--   2) nadpisać dowolne pola cudzych formularzy roboczych i tokenów
--      (w tym tenant_id/form_id — przeniesienie/podmiana rekordów).
--
-- Ta migracja robi część BEZPIECZNĄ i NIEŁAMIĄCĄ:
--   A) Funkcje RPC (SECURITY DEFINER) do odczytu/zapisu APK po tokenie —
--      pozwalają frontendom przestać czytać całe tabele anon-kluczem.
--   B) Triggery blokujące sesji ANON zmianę pól identyfikacyjnych
--      (tenant_id/form_id/klient_id/token/...) — domyka wektor manipulacji
--      z pkt 2, NIE psując legalnego zapisu treści formularza (form_data,
--      status, submitted_at) ani oznaczania tokenu jako 'used'.
--
-- Zrzut polityk anon SELECT (pkt 1, enumeracja) NIE jest tu wykonywany —
-- wymaga wcześniejszej migracji zewnętrznego formularza apk.aurabroker.pl
-- (repo aurabroker/APK) na te RPC. Patrz osobny krok lockdown.
-- ============================================================

-- ---------- A) RPC: odczyt APK po tokenie ----------
create or replace function public.get_apk_by_token(p_token text)
returns table (
  token_id uuid,
  token_status text,
  expires_at timestamptz,
  token_advisor_name text,
  form_id uuid,
  form_status text,
  client_name text,
  form_advisor_name text,
  form_data jsonb,
  tenant_id uuid,
  tenant_nazwa text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.status, t.expires_at, t.advisor_name,
         f.id, f.status, f.client_name, f.advisor_name, f.form_data, f.tenant_id,
         (select ct.nazwa from crm_tenants ct where ct.id = f.tenant_id)
  from apk_tokens t
  join apk_forms f on f.id = t.form_id
  where t.token = p_token
$$;
revoke all on function public.get_apk_by_token(text) from public;
grant execute on function public.get_apk_by_token(text) to anon, authenticated;

-- ---------- A) RPC: zapis/wysyłka APK po tokenie ----------
create or replace function public.submit_apk(p_token text, p_form_data jsonb, p_final boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t apk_tokens%rowtype;
  v_f apk_forms%rowtype;
begin
  select * into v_t from apk_tokens where token = p_token;
  if not found then return 'invalid'; end if;
  if v_t.status = 'used' then return 'used'; end if;
  if v_t.expires_at < now() then return 'expired'; end if;

  select * into v_f from apk_forms where id = v_t.form_id;
  if not found then return 'invalid'; end if;
  if v_f.status = 'submitted' then return 'submitted'; end if;

  update apk_forms
     set form_data = p_form_data,
         status = case when p_final then 'submitted' else 'draft' end,
         submitted_at = case when p_final then now() else null end,
         updated_at = now()
   where id = v_f.id;

  if p_final then
    update apk_tokens set status = 'used', used_at = now() where id = v_t.id;
  end if;

  return case when p_final then 'submitted' else 'draft' end;
end;
$$;
revoke all on function public.submit_apk(text, jsonb, boolean) from public;
grant execute on function public.submit_apk(text, jsonb, boolean) to anon, authenticated;

-- ---------- B) Triggery anty-manipulacyjne (tylko sesje anon) ----------
create or replace function public.apk_forms_anon_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  -- Ograniczamy tylko anon (publiczny formularz). authenticated jest zawężony
  -- politykami tenantowymi, service_role to operacje serwerowe.
  if v_role <> 'anon' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.klient_id is distinct from old.klient_id
     or new.ref_number is distinct from old.ref_number
     or new.client_name is distinct from old.client_name
     or new.advisor_name is distinct from old.advisor_name then
    raise exception 'APK: modyfikacja pól identyfikacyjnych formularza niedozwolona';
  end if;
  return new;
end;
$$;

drop trigger if exists apk_forms_anon_guard_trg on public.apk_forms;
create trigger apk_forms_anon_guard_trg
  before update on public.apk_forms
  for each row execute function public.apk_forms_anon_guard();

create or replace function public.apk_tokens_anon_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role <> 'anon' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.token is distinct from old.token
     or new.form_id is distinct from old.form_id
     or new.tenant_id is distinct from old.tenant_id
     or new.advisor_name is distinct from old.advisor_name
     or new.expires_at is distinct from old.expires_at then
    raise exception 'APK: modyfikacja pól identyfikacyjnych tokenu niedozwolona';
  end if;
  return new;
end;
$$;

drop trigger if exists apk_tokens_anon_guard_trg on public.apk_tokens;
create trigger apk_tokens_anon_guard_trg
  before update on public.apk_tokens
  for each row execute function public.apk_tokens_anon_guard();
