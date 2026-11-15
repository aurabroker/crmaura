-- Testy linków APK: get_apk_by_token, submit_apk, apk_form_by_token i tabela apk_tokens.
--
-- Jeden blok DO, który na końcu ZAWSZE rzuca wyjątek "TESTY_WYNIK …" — dzięki temu
-- cała transakcja (dane testowe, zmiany ról) się wycofuje, a ten sam plik można puścić:
--   * lokalnie: scripts/test-apk-tokeny-sql.mjs (atrapa supabase/tests/apk_tokeny_stub.sql),
--   * na produkcji: jako jedno zapytanie (np. MCP execute_sql). Nic nie zostaje w bazie,
--     a test czyta wyłącznie wiersze, które sam wstawił (prefiks tokenu "zz-test-").
--
-- Ustawienie testy.lokalnie = on (robi to skrypt lokalny) włącza przypadki, których na
-- produkcji nie da się odtworzyć bez DDL na żywej tabeli: token z expires_at = NULL
-- (kolumna ma NOT NULL, więc test zdejmuje je w tej samej, wycofywanej transakcji)
-- i nazwa firmy (wymaga wiersza w crm_tenants).
--
-- Wynik: wiadomość wyjątku "TESTY_WYNIK pass=N fail=M [| FAIL: …]". Każdy przypadek
-- wypisuje też NOTICE "PASS …" / "FAIL …".

do $testy$
declare
  lokalnie boolean := coalesce(current_setting('testy.lokalnie', true), '') = 'on';
  v_tenant uuid;
  r record;
  n int;
  s text;
  t_ok text;   t_used text; t_exp text; t_flag text; t_sub text; t_arch text; t_null text; t_short text;
  f_ok uuid;   f_used uuid; f_exp uuid; f_flag uuid; f_sub uuid; f_arch uuid; f_null uuid; f_short uuid;
  wynik text;
  stan text;
begin
  -- Wyniki zbieramy w ustawieniach sesji (set_config), a nie w tabeli: asercje padają
  -- także wtedy, gdy bieżącą rolą jest anon, która do tabeli tymczasowej nie ma prawa.
  perform set_config('testy.pass', '0', true);
  perform set_config('testy.fail', '0', true);
  perform set_config('testy.lista', '', true);
  create function pg_temp.sprawdz(warunek boolean, nazwa text) returns void language plpgsql as $f$
  begin
    if coalesce(warunek, false) then
      perform set_config('testy.pass', (current_setting('testy.pass')::int + 1)::text, true);
      raise notice 'PASS %', nazwa;
    else
      perform set_config('testy.fail', (current_setting('testy.fail')::int + 1)::text, true);
      perform set_config('testy.lista', current_setting('testy.lista') || '; ' || nazwa, true);
      raise notice 'FAIL %', nazwa;
    end if;
  end $f$;
  grant execute on function pg_temp.sprawdz(boolean, text) to public;

  -- ── Dane testowe ───────────────────────────────────────────────────────────
  if lokalnie then
    insert into public.crm_tenants (nazwa) values ('Firma Testowa') returning id into v_tenant;
  end if;

  t_ok    := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  t_used  := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  t_exp   := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  t_flag  := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  t_sub   := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  t_arch  := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  t_null  := 'zz-test-' || encode(extensions.gen_random_bytes(12), 'hex');
  -- Stary format (12 znaków A–Z0–9): istniejące linki działają do wygaśnięcia.
  t_short := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 12));

  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_ok, 'Klient Testowy', 'Doradca F', 'draft', '{"a": 1}', v_tenant) returning id into f_ok;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_used, 'Klient Testowy', 'Doradca F', 'submitted', '{"a": 1}', v_tenant) returning id into f_used;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_exp, 'Klient Testowy', 'Doradca F', 'draft', '{"a": 1}', v_tenant) returning id into f_exp;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_flag, 'Klient Testowy', 'Doradca F', 'draft', '{"a": 1}', v_tenant) returning id into f_flag;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_sub, 'Klient Testowy', 'Doradca F', 'submitted', '{"a": 1}', v_tenant) returning id into f_sub;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_arch, 'Klient Testowy', 'Doradca F', 'archived', '{"a": 1}', v_tenant) returning id into f_arch;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_null, 'Klient Testowy', 'Doradca F', 'draft', '{"a": 1}', v_tenant) returning id into f_null;
  insert into public.apk_forms (ref_number, client_name, advisor_name, status, form_data, tenant_id)
  values ('ZZ-TEST-' || t_short, 'Klient Testowy', 'Doradca F', 'draft', '{"a": 1}', v_tenant) returning id into f_short;

  insert into public.apk_tokens (token, form_id, advisor_name, status, expires_at, tenant_id) values
    (t_ok,    f_ok,    'Doradca T', 'pending', now() + interval '7 days', v_tenant),
    (t_used,  f_used,  'Doradca T', 'used',    now() + interval '7 days', v_tenant),
    (t_exp,   f_exp,   'Doradca T', 'pending', now() - interval '1 minute', v_tenant),
    (t_flag,  f_flag,  'Doradca T', 'expired', now() + interval '7 days', v_tenant),
    (t_sub,   f_sub,   'Doradca T', 'pending', now() + interval '7 days', v_tenant),
    (t_arch,  f_arch,  'Doradca T', 'pending', now() + interval '7 days', v_tenant),
    (t_short || '-tymczasowo-dlugi', f_short, 'Doradca T', 'pending', now() + interval '7 days', v_tenant);
  -- Krótki token wstawiamy przez UPDATE: wymóg długości z supabase/pending dotyczy tylko INSERT.
  update public.apk_tokens set token = t_short where token = t_short || '-tymczasowo-dlugi';

  -- ── apk_tokens: ograniczenia ───────────────────────────────────────────────
  begin
    insert into public.apk_tokens (token, form_id, status, expires_at)
    values ('zz-test-' || encode(extensions.gen_random_bytes(12), 'hex'), f_null, 'pending', null);
    perform pg_temp.sprawdz(false, 'apk_tokens: expires_at = NULL jest odrzucane');
  exception when not_null_violation then
    perform pg_temp.sprawdz(true, 'apk_tokens: expires_at = NULL jest odrzucane');
  end;

  if lokalnie then
    -- Token bez daty ważności: w produkcji niemożliwy (NOT NULL), tu odtwarzamy go
    -- w wycofywanej transakcji, żeby sprawdzić, że same funkcje traktują brak daty
    -- jak wygaśnięcie (gdyby ktoś kiedyś zdjął NOT NULL).
    alter table public.apk_tokens alter column expires_at drop not null;
    insert into public.apk_tokens (token, form_id, advisor_name, status, expires_at, tenant_id)
    values (t_null, f_null, 'Doradca T', 'pending', null, v_tenant);
  end if;

  begin
    insert into public.apk_tokens (token, form_id, status, expires_at)
    values ('zz-test-' || encode(extensions.gen_random_bytes(12), 'hex'), f_ok, 'pending', now() + interval '91 days');
    perform pg_temp.sprawdz(false, 'apk_tokens: ważność dłuższa niż 90 dni jest odrzucana');
  exception when check_violation then
    perform pg_temp.sprawdz(true, 'apk_tokens: ważność dłuższa niż 90 dni jest odrzucana');
  end;

  begin
    insert into public.apk_tokens (form_id, status) values (f_ok, 'pending') returning token into s;
    perform pg_temp.sprawdz(length(s) >= 22 and s ~ '^[A-Za-z0-9_-]+$',
      'apk_tokens: token nadany przez bazę ma >= 22 znaki base64url (jest: ' || length(s) || ')');
    delete from public.apk_tokens where token = s;
  exception when not_null_violation then
    perform pg_temp.sprawdz(false, 'apk_tokens: token nadany przez bazę ma >= 22 znaki base64url (brak domyślnej wartości)');
  end;

  -- Wymóg długości nowych tokenów (supabase/pending/20261113000002_apk_tokeny_min_dlugosc.sql):
  -- sprawdzany tylko, gdy wyzwalacz już jest w bazie.
  if exists (select 1 from pg_trigger where tgrelid = 'public.apk_tokens'::regclass
             and tgname = 'apk_tokens_min_dlugosc_trg') then
    begin
      insert into public.apk_tokens (token, form_id, status, expires_at)
      values (upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 12)), f_ok, 'pending', now() + interval '7 days');
      perform pg_temp.sprawdz(false, 'apk_tokens: nowy 12-znakowy token jest odrzucany');
    exception when check_violation then
      perform pg_temp.sprawdz(true, 'apk_tokens: nowy 12-znakowy token jest odrzucany');
    end;
    update public.apk_tokens set used_at = used_at where token = t_short;
    get diagnostics n = row_count;
    perform pg_temp.sprawdz(n = 1, 'apk_tokens: istniejący krótki token da się nadal aktualizować');
  end if;

  -- ── Uprawnienia ról API ────────────────────────────────────────────────────
  perform pg_temp.sprawdz(has_function_privilege('anon', 'public.get_apk_by_token(text)', 'execute'),
    'anon może wywołać get_apk_by_token (strona /form)');
  perform pg_temp.sprawdz(has_function_privilege('anon', 'public.submit_apk(text, jsonb, boolean)', 'execute'),
    'anon może wywołać submit_apk (strona /form)');
  perform pg_temp.sprawdz(to_regprocedure('public.apk_form_by_token(text)') is not null
      and not has_function_privilege('anon', 'public.apk_form_by_token(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.apk_form_by_token(text)', 'execute'),
    'apk_form_by_token: brak EXECUTE dla anon i authenticated');
  perform pg_temp.sprawdz(pg_get_function_result('public.get_apk_by_token(text)'::regprocedure) !~ '(token_id|form_id|tenant_id)',
    'get_apk_by_token nie zwraca identyfikatorów (token_id, form_id, tenant_id)');
  perform pg_temp.sprawdz(pg_get_function_result('public.apk_form_by_token(text)'::regprocedure) !~ '(pdf_url|klient_id|tenant_id|SETOF)',
    'apk_form_by_token nie zwraca całego wiersza apk_forms');

  -- ── get_apk_by_token jako anon ─────────────────────────────────────────────
  set local role anon;
  set local request.jwt.claims = '{"role": "anon"}';

  select * into r from public.get_apk_by_token(t_ok);
  perform pg_temp.sprawdz(r.token_status = 'pending' and r.client_name = 'Klient Testowy'
      and r.form_data ->> 'a' = '1' and r.token_advisor_name = 'Doradca T',
    'get_apk_by_token: poprawny token zwraca klienta i formularz');

  select * into r from public.get_apk_by_token(t_short);
  perform pg_temp.sprawdz(r.client_name = 'Klient Testowy' and r.form_data is not null,
    'get_apk_by_token: stary 12-znakowy token działa do wygaśnięcia');

  select * into r from public.get_apk_by_token(t_used);
  perform pg_temp.sprawdz(r.token_status = 'used' and r.client_name is null and r.form_data is null
      and r.token_advisor_name is null and r.form_advisor_name is null,
    'get_apk_by_token: użyty token — bez client_name, doradcy i form_data');

  select * into r from public.get_apk_by_token(t_exp);
  perform pg_temp.sprawdz(r.token_status = 'expired' and r.client_name is null and r.form_data is null
      and r.token_advisor_name is null,
    'get_apk_by_token: wygasły token — status expired, bez client_name i form_data');

  select * into r from public.get_apk_by_token(t_flag);
  perform pg_temp.sprawdz(r.token_status = 'expired' and r.client_name is null and r.form_data is null,
    'get_apk_by_token: token ze statusem expired (data w przyszłości) — bez danych');

  select * into r from public.get_apk_by_token(t_sub);
  perform pg_temp.sprawdz(r.form_status = 'submitted' and r.client_name is null and r.form_data is null,
    'get_apk_by_token: wysłany formularz — bez client_name i form_data');

  select * into r from public.get_apk_by_token(t_arch);
  perform pg_temp.sprawdz(r.client_name is null and r.form_data is null,
    'get_apk_by_token: zarchiwizowany formularz — bez client_name i form_data');

  select count(*) into n from public.get_apk_by_token('zz-test-nie-istnieje');
  perform pg_temp.sprawdz(n = 0, 'get_apk_by_token: nieznany token — brak wiersza');

  if lokalnie then
    select * into r from public.get_apk_by_token(t_null);
    perform pg_temp.sprawdz(r.token_status = 'expired' and r.client_name is null and r.form_data is null,
      'get_apk_by_token: token bez daty ważności traktowany jak wygasły');
    select * into r from public.get_apk_by_token(t_exp);
    perform pg_temp.sprawdz(r.tenant_nazwa = 'Firma Testowa',
      'get_apk_by_token: wygasły token nadal pokazuje nazwę firmy (do kogo się zwrócić)');
  end if;

  -- ── submit_apk jako anon ───────────────────────────────────────────────────
  perform pg_temp.sprawdz(public.submit_apk(t_exp, '{"b": 2}', false) = 'expired', 'submit_apk: wygasły token — expired');
  perform pg_temp.sprawdz(public.submit_apk(t_flag, '{"b": 2}', true) = 'expired', 'submit_apk: token ze statusem expired — expired');
  perform pg_temp.sprawdz(public.submit_apk(t_used, '{"b": 2}', true) = 'used', 'submit_apk: użyty token — used');
  perform pg_temp.sprawdz(public.submit_apk(t_sub, '{"b": 2}', true) = 'submitted', 'submit_apk: wysłany formularz — submitted, bez zapisu');
  perform pg_temp.sprawdz(public.submit_apk(t_arch, '{"b": 2}', true) = 'invalid', 'submit_apk: zarchiwizowany formularz — invalid');
  perform pg_temp.sprawdz(public.submit_apk('zz-test-nie-istnieje', '{"b": 2}', true) = 'invalid', 'submit_apk: nieznany token — invalid');
  perform pg_temp.sprawdz(public.submit_apk(t_ok, jsonb_build_object('x', repeat('a', 100001)), false) = 'invalid',
    'submit_apk: dane ponad 100 kB — invalid');
  perform pg_temp.sprawdz(public.submit_apk(t_ok, '[1, 2]', false) = 'invalid', 'submit_apk: dane nie-obiekt — invalid');
  if lokalnie then
    perform pg_temp.sprawdz(public.submit_apk(t_null, '{"b": 2}', true) = 'expired',
      'submit_apk: token bez daty ważności — expired');
  end if;

  perform pg_temp.sprawdz(public.submit_apk(t_ok, '{"b": 2}', false) = 'draft', 'submit_apk: poprawny token, szkic — draft');
  select * into r from public.get_apk_by_token(t_ok);
  perform pg_temp.sprawdz(r.token_status = 'pending' and r.form_data ->> 'b' = '2',
    'submit_apk: szkic zapisany, token nadal aktywny');

  perform pg_temp.sprawdz(public.submit_apk(t_ok, '{"b": 3}', true) = 'submitted', 'submit_apk: poprawny token, wysyłka — submitted');
  perform pg_temp.sprawdz(public.submit_apk(t_ok, '{"b": 4}', true) = 'used', 'submit_apk: drugi raz ten sam token — used');
  select * into r from public.get_apk_by_token(t_ok);
  perform pg_temp.sprawdz(r.token_status = 'used' and r.client_name is null and r.form_data is null,
    'get_apk_by_token: po wysyłce link nie pokazuje już danych');

  -- ── Bezpośredni dostęp anon do tabel ───────────────────────────────────────
  select count(*) into n from public.apk_forms;
  perform pg_temp.sprawdz(n = 0, 'anon: SELECT na apk_forms nie zwraca wierszy');
  select count(*) into n from public.apk_tokens;
  perform pg_temp.sprawdz(n = 0, 'anon: SELECT na apk_tokens nie zwraca wierszy');
  update public.apk_forms set form_data = '{"atak": 1}' where id = f_exp;
  get diagnostics n = row_count;
  perform pg_temp.sprawdz(n = 0, 'anon: UPDATE na apk_forms nie zmienia wierszy');
  begin
    select count(*) into n from public.crm_tenants;
    perform pg_temp.sprawdz(n = 0, 'anon: crm_tenants bez wierszy');
  exception when insufficient_privilege then
    perform pg_temp.sprawdz(true, 'anon: crm_tenants bez wierszy (brak uprawnień)');
  end;
  begin
    select count(*) into n from public.apk_form_by_token(t_short);
    perform pg_temp.sprawdz(false, 'anon: wywołanie apk_form_by_token odrzucone');
  exception when insufficient_privilege or undefined_function then
    perform pg_temp.sprawdz(true, 'anon: wywołanie apk_form_by_token odrzucone');
  end;

  reset role;

  -- ── apk_form_by_token (tylko service_role) ────────────────────────────────
  if to_regprocedure('public.apk_form_by_token(text)') is not null then
    select count(*) into n from public.apk_form_by_token(t_short);
    perform pg_temp.sprawdz(n = 1, 'apk_form_by_token: aktywny token — jeden wiersz');
    select count(*) into n from public.apk_form_by_token(t_used);
    perform pg_temp.sprawdz(n = 0, 'apk_form_by_token: użyty token — brak wiersza');
    select count(*) into n from public.apk_form_by_token(t_exp);
    perform pg_temp.sprawdz(n = 0, 'apk_form_by_token: wygasły token — brak wiersza');
    select count(*) into n from public.apk_form_by_token(t_sub);
    perform pg_temp.sprawdz(n = 0, 'apk_form_by_token: wysłany formularz — brak wiersza');
    if lokalnie then
      select count(*) into n from public.apk_form_by_token(t_null);
      perform pg_temp.sprawdz(n = 0, 'apk_form_by_token: token bez daty — brak wiersza');
    end if;
  end if;

  -- ── Podsumowanie i wycofanie wszystkiego ───────────────────────────────────
  wynik := format('TESTY_WYNIK pass=%s fail=%s%s', current_setting('testy.pass'), current_setting('testy.fail'),
                  case when current_setting('testy.lista') <> ''
                       then ' | FAIL: ' || substr(current_setting('testy.lista'), 3) else '' end);
  raise exception '%', wynik;
end
$testy$;
