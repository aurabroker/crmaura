-- Atrapa środowiska Supabase dla testów linków APK (supabase/tests/apk_tokeny.sql)
-- na zwykłym Postgresie 16. Uruchamia ją scripts/test-apk-tokeny-sql.mjs.
--
-- NIE jest to zrzut produkcji. Tabele apk_tokens, apk_forms i crm_tenants mają
-- kolumny, ograniczenia, wyzwalacze, polityki RLS i uprawnienia ról takie jak
-- w produkcji 13.11.2026 (odczytane z katalogu bazy, bez danych). Funkcje tokenowe
-- są w wersji SPRZED migracji 20261113…_apk_tokeny_utwardzenie — dzięki temu ten
-- sam zestaw testów puszczony przed migracją pokazuje błędy, a po niej przechodzi.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema extensions;
create extension pgcrypto with schema extensions;

-- Supabase: nowe funkcje w public dostają EXECUTE dla ról API automatycznie.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.crm_tenants (
  id    uuid primary key default gen_random_uuid(),
  nazwa text not null
);
alter table public.crm_tenants enable row level security;

create function public.get_my_tenant_id() returns uuid language sql stable security definer
  set search_path = public as
  $$ select nullif(current_setting('testy.tenant', true), '')::uuid $$;

create policy tenant_isolation on public.crm_tenants for all to authenticated
  using (id = get_my_tenant_id()) with check (id = get_my_tenant_id());

create table public.apk_forms (
  id                     uuid primary key default gen_random_uuid(),
  ref_number             text not null unique,
  client_name            text not null,
  advisor_name           text,
  form_date              date not null default current_date,
  mode                   text not null default 'client' check (mode = any (array['client', 'advisor'])),
  status                 text not null default 'draft' check (status = any (array['draft', 'submitted', 'archived'])),
  form_data              jsonb not null default '{}'::jsonb,
  submitted_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  tenant_id              uuid,
  klient_id              uuid,
  pdf_url                text,
  client_declined        boolean not null default false,
  client_declined_reason text
);

create table public.apk_tokens (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  form_id      uuid references public.apk_forms(id) on delete set null,
  advisor_name text,
  status       text not null default 'pending' check (status = any (array['pending', 'used', 'expired'])),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '30 days'),
  used_at      timestamptz,
  tenant_id    uuid
);

alter table public.apk_forms enable row level security;
alter table public.apk_tokens enable row level security;

create policy apk_forms_delete_tenant on public.apk_forms for delete to authenticated using (tenant_id = get_my_tenant_id());
create policy apk_tenant_insert on public.apk_forms for insert with check (tenant_id = get_my_tenant_id());
create policy apk_tenant_select on public.apk_forms for select to authenticated using (tenant_id = get_my_tenant_id());
create policy apk_tenant_update on public.apk_forms for update using (tenant_id = get_my_tenant_id());
create policy apk_tokens_insert on public.apk_tokens for insert with check (tenant_id = get_my_tenant_id());
create policy apk_tokens_select on public.apk_tokens for select to authenticated using (tenant_id = get_my_tenant_id());
create policy apk_tokens_update_tenant on public.apk_tokens for update to authenticated
  using (tenant_id = get_my_tenant_id()) with check (tenant_id = get_my_tenant_id());

create function public.apk_forms_anon_guard() returns trigger language plpgsql set search_path = public as $$
declare v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role <> 'anon' then return new; end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.klient_id is distinct from old.klient_id
     or new.ref_number is distinct from old.ref_number
     or new.client_name is distinct from old.client_name
     or new.advisor_name is distinct from old.advisor_name then
    raise exception 'APK: modyfikacja pol identyfikacyjnych formularza niedozwolona';
  end if;
  return new;
end; $$;
create trigger apk_forms_anon_guard_trg before update on public.apk_forms
  for each row execute function public.apk_forms_anon_guard();

create function public.apk_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
create trigger apk_forms_updated_at before update on public.apk_forms
  for each row execute function public.apk_set_updated_at();

create function public.apk_tokens_anon_guard() returns trigger language plpgsql set search_path = public as $$
declare v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role');
begin
  if v_role <> 'anon' then return new; end if;
  if new.id is distinct from old.id
     or new.token is distinct from old.token
     or new.form_id is distinct from old.form_id
     or new.tenant_id is distinct from old.tenant_id
     or new.advisor_name is distinct from old.advisor_name
     or new.expires_at is distinct from old.expires_at then
    raise exception 'APK: modyfikacja pol identyfikacyjnych tokenu niedozwolona';
  end if;
  return new;
end; $$;
create trigger apk_tokens_anon_guard_trg before update on public.apk_tokens
  for each row execute function public.apk_tokens_anon_guard();

-- ── Funkcje tokenowe w wersji sprzed utwardzenia (kopia z produkcji) ──────────

create function public.apk_form_by_token(p_token text) returns setof public.apk_forms
  language sql stable security definer set search_path = public as $$
  select f.*
  from public.apk_forms f
  join public.apk_tokens t on t.form_id = f.id
  where t.token = p_token
    and (t.expires_at is null or t.expires_at > now());
$$;

create function public.get_apk_by_token(p_token text)
returns table (token_id uuid, token_status text, expires_at timestamptz, token_advisor_name text,
               form_id uuid, form_status text, client_name text, form_advisor_name text,
               form_data jsonb, tenant_id uuid, tenant_nazwa text)
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

create function public.submit_apk(p_token text, p_form_data jsonb, p_final boolean)
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
