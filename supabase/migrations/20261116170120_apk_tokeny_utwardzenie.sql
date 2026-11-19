-- ============================================================
-- Linki APK z tokenem: utwardzenie funkcji SECURITY DEFINER dostępnych dla anon
-- (przegląd z 12.11.2026).
--
-- 1) get_apk_by_token — jedyne źródło danych strony /form?token=…
--    * token bez daty ważności (expires_at IS NULL) = wygasły; status 'expired' też,
--    * dane osobowe (client_name, imiona doradców) i form_data tylko dla linku
--      aktywnego: token 'pending', data ważności w przyszłości, formularz 'draft',
--    * nie zwraca już identyfikatorów (token_id, form_id, tenant_id) — strona ich nie
--      używa; token_status zwraca stan efektywny ('expired' także po dacie).
--    Wdrożona strona /form (sprzed tej zmiany) czyta tylko pozostałe kolumny,
--    więc działa bez zmian; nowa wersja strony rozpoznaje też status 'expired'.
-- 2) submit_apk — brak daty / status 'expired' = wygasły; formularz musi być 'draft'
--    (zarchiwizowanego nie da się nadpisać linkiem); blokada wiersza tokenu, żeby
--    dwa równoległe „Wyślij” nie zapisały się oba.
-- 3) apk_form_by_token — nic jej nie wywołuje (kod CRM, APK, ud, udapp; logi API
--    z 7 dni; pg_stat_statements od 07.03.2026). Zostaje dla service_role, ale bez
--    EXECUTE dla anon/authenticated, z wąskim wynikiem i tymi samymi warunkami
--    aktywności co get_apk_by_token (zamiast SELECT f.* dla każdego niewygasłego tokenu).
-- 4) apk_tokens: expires_at NOT NULL (było już w produkcji — tu zapisane jawnie),
--    ważność najwyżej 90 dni od utworzenia (CRM daje 30), domyślny token z bazy dla
--    zapisu bez tokenu: 18 bajtów z gen_random_bytes = 24 znaki base64url (144 bity).
--    CRM generuje własny token (newApkToken, od tej zmiany 26 znaków A–Z0–9 ≈ 134 bity).
--    Istniejące tokeny (12 znaków) działają do wygaśnięcia. Wymóg minimalnej długości
--    dla NOWYCH tokenów jest w supabase/migrations/20261119095352_apk_tokeny_min_dlugosc.sql
--    (zastosowana 19.11.2026, po wdrożeniu CRM z 26-znakowym newApkToken).
--
-- Migracja jest idempotentna (drop/create funkcji, „if not exists” przy ograniczeniach).
-- Testy: node scripts/test-apk-tokeny-sql.mjs (lokalnie) i supabase/tests/apk_tokeny.sql
-- (ten sam plik na produkcji — wszystko wycofuje).
-- ============================================================

set local lock_timeout = '5s';

-- ── 4) apk_tokens ────────────────────────────────────────────────────────────
alter table public.apk_tokens alter column expires_at set not null;
alter table public.apk_tokens alter column token
  set default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.apk_tokens'::regclass and conname = 'apk_tokens_expires_at_max_90d') then
    alter table public.apk_tokens
      add constraint apk_tokens_expires_at_max_90d check (expires_at <= created_at + interval '90 days');
  end if;
end $$;

comment on column public.apk_tokens.token is
  'Sekret linku /form?token=…; nowe nadaje baza (24 znaki base64url, 144 bity). Stare 12-znakowe działają do wygaśnięcia.';
comment on column public.apk_tokens.expires_at is
  'Koniec ważności linku (NOT NULL, najwyżej 90 dni od utworzenia). Funkcje tokenowe traktują brak daty jak wygaśnięcie.';

-- ── 1) get_apk_by_token ──────────────────────────────────────────────────────
drop function if exists public.get_apk_by_token(text);
create function public.get_apk_by_token(p_token text)
returns table (
  token_status       text,
  expires_at         timestamptz,
  token_advisor_name text,
  form_status        text,
  client_name        text,
  form_advisor_name  text,
  form_data          jsonb,
  tenant_nazwa       text
)
language sql stable security definer set search_path = ''
as $$
  select case
           when t.status = 'used' then 'used'
           when t.status = 'expired' or t.expires_at is null or t.expires_at <= now() then 'expired'
           else t.status
         end,
         t.expires_at,
         case when a.aktywny then t.advisor_name end,
         f.status,
         case when a.aktywny then f.client_name end,
         case when a.aktywny then f.advisor_name end,
         case when a.aktywny then f.form_data end,
         -- Nazwa firmy brokerskiej zostaje także po wygaśnięciu: to administrator danych
         -- z klauzuli na stronie i adresat prośby o nowy link.
         (select ct.nazwa from public.crm_tenants ct where ct.id = f.tenant_id)
  from public.apk_tokens t
  join public.apk_forms f on f.id = t.form_id
  cross join lateral (
    select t.status = 'pending'
       and t.expires_at is not null
       and t.expires_at > now()
       and f.status = 'draft' as aktywny
  ) a
  where t.token = p_token
$$;

comment on function public.get_apk_by_token(text) is
  'Strona /form: stan linku APK; dane klienta i formularza tylko dla aktywnego linku (pending, niewygasły, formularz draft).';

revoke all on function public.get_apk_by_token(text) from public;
grant execute on function public.get_apk_by_token(text) to anon, authenticated, service_role;

-- ── 2) submit_apk ────────────────────────────────────────────────────────────
create or replace function public.submit_apk(p_token text, p_form_data jsonb, p_final boolean)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_t public.apk_tokens%rowtype;
  v_f public.apk_forms%rowtype;
  v_final boolean := coalesce(p_final, false);
begin
  if p_token is null
     or jsonb_typeof(p_form_data) is distinct from 'object'
     or octet_length(p_form_data::text) > 100000 then
    return 'invalid';
  end if;

  select * into v_t from public.apk_tokens where token = p_token for update;
  if not found then return 'invalid'; end if;
  if v_t.status = 'used' then return 'used'; end if;
  if v_t.status <> 'pending' or v_t.expires_at is null or v_t.expires_at <= now() then
    return 'expired';
  end if;

  select * into v_f from public.apk_forms where id = v_t.form_id for update;
  if not found then return 'invalid'; end if;
  if v_f.status = 'submitted' then return 'submitted'; end if;
  if v_f.status <> 'draft' then return 'invalid'; end if;

  update public.apk_forms
     set form_data    = p_form_data,
         status       = case when v_final then 'submitted' else 'draft' end,
         submitted_at = case when v_final then now() else null end,
         updated_at   = now()
   where id = v_f.id;

  if v_final then
    update public.apk_tokens set status = 'used', used_at = now() where id = v_t.id;
  end if;

  return case when v_final then 'submitted' else 'draft' end;
end;
$$;

comment on function public.submit_apk(text, jsonb, boolean) is
  'Strona /form: zapis szkicu lub wysyłka APK po tokenie. Wynik: draft | submitted | used | expired | invalid.';

revoke all on function public.submit_apk(text, jsonb, boolean) from public;
grant execute on function public.submit_apk(text, jsonb, boolean) to anon, authenticated, service_role;

-- ── 3) apk_form_by_token (tylko service_role) ────────────────────────────────
drop function if exists public.apk_form_by_token(text);
create function public.apk_form_by_token(p_token text)
returns table (
  form_status  text,
  client_name  text,
  advisor_name text,
  form_data    jsonb,
  expires_at   timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select f.status, f.client_name, coalesce(t.advisor_name, f.advisor_name), f.form_data, t.expires_at
  from public.apk_tokens t
  join public.apk_forms f on f.id = t.form_id
  where t.token = p_token
    and t.status = 'pending'
    and t.expires_at is not null
    and t.expires_at > now()
    and f.status = 'draft'
$$;

comment on function public.apk_form_by_token(text) is
  'Nieużywana poprzedniczka get_apk_by_token; bez EXECUTE dla anon/authenticated. Do usunięcia, gdy nic jej nie przywróci.';

revoke all on function public.apk_form_by_token(text) from public, anon, authenticated;
grant execute on function public.apk_form_by_token(text) to service_role;
