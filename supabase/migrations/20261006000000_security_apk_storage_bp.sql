-- ============================================================
-- Uszczelnienie bazy — audyt 2026-10-06.
-- Zakres: tabele apk_*, kubełki storage apk-pdfs i settlement-files,
-- tabela bp_profiles (self-service is_admin).
--
-- Baza i Supabase Auth są współdzielone z innymi aplikacjami, więc zawężamy
-- wyłącznie polityki, których CRM nie używa (zweryfikowane w kodzie src/):
--  * CRM zapisuje i czyta apk_forms / apk_tokens tylko w obrębie swojego
--    najemcy (polityki apk_tenant_*, apk_tokens_*_tenant — zostają),
--  * CRM nigdy nie czyta apk_audit, tylko do niego dopisuje,
--  * oba kubełki są zapisywane pod ścieżką <tenant_id>/… (4 z 4 plików).
-- Publiczny dostęp po tokenie idzie wyłącznie przez funkcje SECURITY DEFINER.
-- ============================================================

-- ---------- 1) APK: koniec z szerokim dostępem ----------

-- Odczyt całej tabeli przez dowolne konto zalogowane (także z innych aplikacji).
drop policy if exists "apk_forms_select_auth"  on public.apk_forms;
-- Wstawianie formularza do dowolnego najemcy przez anon/authenticated.
drop policy if exists "apk_forms_insert_anon"  on public.apk_forms;
-- Nadpisywanie dowolnego formularza w statusie draft.
drop policy if exists "apk_forms_update_anon"  on public.apk_forms;
-- Wystawianie tokenu do cudzego formularza.
drop policy if exists "apk_tokens_insert_auth" on public.apk_tokens;
-- Zmiana statusu tokenu przez anon (submit_apk robi to sam jako definer).
drop policy if exists "apk_tokens_update_anon" on public.apk_tokens;

-- Odczyt tenantowy: bez wyjątku „tenant_id IS NULL” i bez roli public.
drop policy if exists "apk_tenant_select" on public.apk_forms;
create policy "apk_tenant_select" on public.apk_forms
  for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

drop policy if exists "apk_tokens_select" on public.apk_tokens;
create policy "apk_tokens_select" on public.apk_tokens
  for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

-- apk_audit: zamiast „czyta i pisze każdy zalogowany” — tylko w obrębie najemcy formularza.
drop policy if exists "apk_audit_select_auth" on public.apk_audit;
drop policy if exists "apk_audit_insert_auth" on public.apk_audit;

create policy "apk_audit_select_tenant" on public.apk_audit
  for select to authenticated
  using (exists (
    select 1 from public.apk_forms f
    where f.id = apk_audit.form_id and f.tenant_id = public.get_my_tenant_id()
  ));

create policy "apk_audit_insert_tenant" on public.apk_audit
  for insert to authenticated
  with check (exists (
    select 1 from public.apk_forms f
    where f.id = apk_audit.form_id and f.tenant_id = public.get_my_tenant_id()
  ));

-- ---------- 2) RPC: dane formularza tylko dla ważnego tokenu ----------

-- Poprzednio zwracała form_data także po wygaśnięciu i po złożeniu formularza.
-- Sygnatura bez zmian: front dalej dostaje status/expires_at i sam pokazuje komunikat.
create or replace function public.get_apk_by_token(p_token text)
returns table (
  token_id uuid, token_status text, expires_at timestamptz, token_advisor_name text,
  form_id uuid, form_status text, client_name text, form_advisor_name text,
  form_data jsonb, tenant_id uuid, tenant_nazwa text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.status, t.expires_at, t.advisor_name,
         f.id, f.status, f.client_name, f.advisor_name,
         case when t.status <> 'used'
                and (t.expires_at is null or t.expires_at > now())
                and f.status <> 'submitted'
              then f.form_data else null end,
         f.tenant_id,
         (select ct.nazwa from crm_tenants ct where ct.id = f.tenant_id)
  from apk_tokens t
  join apk_forms f on f.id = t.form_id
  where t.token = p_token
$$;

-- Zapis po tokenie: dodany limit rozmiaru i kształtu danych (reszta bez zmian).
create or replace function public.submit_apk(p_token text, p_form_data jsonb, p_final boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_t apk_tokens%rowtype; v_f apk_forms%rowtype;
begin
  if jsonb_typeof(p_form_data) is distinct from 'object'
     or octet_length(p_form_data::text) > 100000 then
    return 'invalid';
  end if;
  select * into v_t from apk_tokens where token = p_token;
  if not found then return 'invalid'; end if;
  if v_t.status = 'used' then return 'used'; end if;
  if v_t.expires_at < now() then return 'expired'; end if;
  select * into v_f from apk_forms where id = v_t.form_id;
  if not found then return 'invalid'; end if;
  if v_f.status = 'submitted' then return 'submitted'; end if;
  update apk_forms set form_data = p_form_data,
         status = case when p_final then 'submitted' else 'draft' end,
         submitted_at = case when p_final then now() else null end,
         updated_at = now()
   where id = v_f.id;
  if p_final then
    update apk_tokens set status = 'used', used_at = now() where id = v_t.id;
  end if;
  return case when p_final then 'submitted' else 'draft' end;
end; $$;

-- ---------- 3) Storage: izolacja najemców ----------

drop policy if exists "Authenticated update apk-pdfs" on storage.objects;
drop policy if exists "Authenticated upload apk-pdfs" on storage.objects;
drop policy if exists "apk_pdfs_insert"               on storage.objects;
drop policy if exists "apk_pdfs_select"               on storage.objects;
drop policy if exists "settlement_read"               on storage.objects;
drop policy if exists "settlement_upload"             on storage.objects;

create policy "apk_pdfs_tenant_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'apk-pdfs'
         and (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

create policy "apk_pdfs_tenant_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'apk-pdfs'
              and (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

-- saveApkPdf wgrywa z upsert:true, więc potrzebny jest też UPDATE.
create policy "apk_pdfs_tenant_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'apk-pdfs'
         and (storage.foldername(name))[1] = public.get_my_tenant_id()::text)
  with check (bucket_id = 'apk-pdfs'
              and (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

create policy "settlement_tenant_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'settlement-files'
         and (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

create policy "settlement_tenant_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'settlement-files'
              and (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

-- ---------- 4) bp_profiles: koniec z samodzielnym nadawaniem is_admin ----------

-- Polityka „Owner can CRUD own profile” (ALL) pozwalała każdemu zarejestrowanemu
-- użytkownikowi beautypolisa.eu ustawić sobie is_admin = true, a ta flaga otwiera
-- odczyt i zmianę bp_quotes / bp_analytics. Wzorzec jak w crm_profiles_guard:
-- zmiany flagi tylko z poziomu service_role / SQL (brak claimów JWT = pełne uprawnienia).
create or replace function public.bp_profiles_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) then
      raise exception 'Flagę is_admin nadaje wyłącznie administrator systemu (service_role)';
    end if;
  elsif new.is_admin is distinct from old.is_admin then
    raise exception 'Flagę is_admin zmienia wyłącznie administrator systemu (service_role)';
  end if;
  return new;
end; $$;

revoke all on function public.bp_profiles_guard() from public, anon, authenticated;

drop trigger if exists bp_profiles_guard_trg on public.bp_profiles;
create trigger bp_profiles_guard_trg
  before insert or update on public.bp_profiles
  for each row execute function public.bp_profiles_guard();

-- ============================================================
-- ROLLBACK (gdyby coś w innej aplikacji korzystało z usuniętych polityk):
--   create policy "apk_forms_select_auth" on public.apk_forms for select to authenticated using (true);
--   create policy "apk_forms_insert_anon" on public.apk_forms for insert to anon, authenticated with check (true);
--   create policy "apk_forms_update_anon" on public.apk_forms for update to anon, authenticated
--     using (status = 'draft') with check (status = 'draft');
--   create policy "apk_tokens_insert_auth" on public.apk_tokens for insert to authenticated with check (true);
--   create policy "apk_tokens_update_anon" on public.apk_tokens for update to anon, authenticated
--     using (status <> 'used') with check (status <> 'used');
--   create policy "apk_audit_select_auth" on public.apk_audit for select to authenticated using (true);
--   create policy "apk_audit_insert_auth" on public.apk_audit for insert to authenticated with check (true);
--   (storage: odtworzyć polityki apk_pdfs_* / settlement_* z warunkiem samego bucket_id)
--   drop trigger bp_profiles_guard_trg on public.bp_profiles;
-- ============================================================
