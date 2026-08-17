-- ============================================================
-- Introspekcja schematu CRM → dane do docs/db/crm-schema.json
--
-- Uruchamiać na bazie projektu Supabase "aurabroker" (SQL Editor
-- albo psql). Każde zapytanie zwraca jeden fragment schematu
-- w postaci JSON, zawężony do tabel crm_*, bond_* i apk_*.
--
-- Baza hostuje też inne produkty (ud_*, izba_*, pakiety, salons,
-- hub_*, ads_*, life_*) — filtr prefiksów celowo je pomija.
-- ============================================================

-- 1) Tabele i widoki w zakresie: rodzaj, RLS, komentarz, liczba kolumn
SELECT c.relname AS name, c.relkind, c.relrowsecurity AS rls,
       obj_description(c.oid) AS comment,
       (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS cols
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','v','m','p')
  AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
ORDER BY c.relkind, c.relname;

-- 2) Kolumny: [nazwa, typ, czy_nullable, default, komentarz]
SELECT c.relname AS t,
       jsonb_agg(jsonb_build_array(
         a.attname,
         format_type(a.atttypid, a.atttypmod),
         NOT a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid),
         col_description(c.oid, a.attnum)
       ) ORDER BY a.attnum) AS cols
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
GROUP BY c.relname ORDER BY c.relname;

-- 3) Ograniczenia: [nazwa, typ (p/f/u/c), definicja]
SELECT c.relname AS t,
       jsonb_agg(jsonb_build_array(con.conname, con.contype, pg_get_constraintdef(con.oid))
                 ORDER BY con.contype, con.conname) AS cons
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
GROUP BY c.relname ORDER BY c.relname;

-- 4) Indeksy (bez tych, które wynikają z PRIMARY KEY / UNIQUE)
SELECT c.relname AS t, jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY ic.relname) AS idx
FROM pg_index i
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_class ic ON ic.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
  AND NOT i.indisprimary
  AND NOT EXISTS (SELECT 1 FROM pg_constraint pc
                   WHERE pc.conindid = i.indexrelid AND pc.contype = 'u')
GROUP BY c.relname ORDER BY c.relname;

-- 5) Polityki RLS: [nazwa, polecenie, role, USING, WITH CHECK]
SELECT tablename AS t,
       jsonb_agg(jsonb_build_array(policyname, cmd, roles::text, qual, with_check)
                 ORDER BY policyname) AS pol
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename LIKE 'crm\_%' OR tablename LIKE 'bond\_%' OR tablename LIKE 'apk\_%')
GROUP BY tablename ORDER BY tablename;

-- 6) Wyzwalacze (bez wewnętrznych, np. z kluczy obcych)
SELECT c.relname AS t,
       jsonb_agg(jsonb_build_array(tg.tgname, pg_get_triggerdef(tg.oid))
                 ORDER BY tg.tgname) AS trg
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT tg.tgisinternal
  AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
GROUP BY c.relname ORDER BY c.relname;

-- 7) Funkcje pomocnicze RLS i wyzwalaczy
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS ret,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_my_tenant_id','bp_get_role','bp_get_tenant',
                    'recalc_policy_zainkasowane','crm_profiles_guard',
                    'apk_forms_anon_guard','apk_tokens_anon_guard','apk_set_updated_at',
                    'fn_audit_log','fn_bond_calc_skladka')
ORDER BY p.proname;

-- 8) Definicje widoków
SELECT c.relname AS t, pg_get_viewdef(c.oid, true) AS def
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'bond\_%'
ORDER BY c.relname;

-- 9) Liczba wierszy w każdej tabeli (dokładna, przez query_to_xml)
SELECT jsonb_object_agg(t, n) AS counts FROM (
  SELECT c.relname AS t,
         (xpath('/row/c/text()',
            query_to_xml(format('select count(*) as c from public.%I', c.relname),
                         false, true, '')))[1]::text::int AS n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
    AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
) s;

-- 10) Wartości słownikowe kolumn bez CHECK (weryfikacja sekcji "slowniki")
SELECT jsonb_build_object(
  'crm_policies.rodzaj',              (SELECT jsonb_agg(DISTINCT rodzaj) FROM crm_policies),
  'crm_policies.rozliczenie_status',  (SELECT jsonb_agg(DISTINCT rozliczenie_status) FROM crm_policies),
  'crm_policies.gwarancja_typ',       (SELECT jsonb_agg(DISTINCT gwarancja_typ) FROM crm_policies WHERE gwarancja_typ IS NOT NULL),
  'crm_claims.status',                (SELECT jsonb_agg(DISTINCT status) FROM crm_claims),
  'crm_tasks.status',                 (SELECT jsonb_agg(DISTINCT status) FROM crm_tasks),
  'crm_tasks.typy',                   (SELECT jsonb_agg(DISTINCT x) FROM crm_tasks, unnest(typy) x),
  'crm_prospects.status',             (SELECT jsonb_agg(DISTINCT status) FROM crm_prospects),
  'crm_insurers.dzial',               (SELECT jsonb_agg(DISTINCT dzial) FROM crm_insurers),
  'crm_clients.typ',                  (SELECT jsonb_agg(DISTINCT typ) FROM crm_clients),
  'crm_profiles.rola',                (SELECT jsonb_agg(DISTINCT rola) FROM crm_profiles),
  'crm_tenants.typ',                  (SELECT jsonb_agg(DISTINCT typ) FROM crm_tenants),
  'crm_vehicles.rodzaj_pojazdu',      (SELECT jsonb_agg(DISTINCT rodzaj_pojazdu) FROM crm_vehicles),
  'crm_audit_log.action',             (SELECT jsonb_agg(DISTINCT action) FROM crm_audit_log),
  'crm_audit_log.entity_type',        (SELECT jsonb_agg(DISTINCT entity_type) FROM crm_audit_log)
) AS v;

-- 11) Kubełki storage używane przez CRM
SELECT id, public, file_size_limit FROM storage.buckets
WHERE id IN ('apk-pdfs','settlement-files');

-- 12) Kontrola spójności JSON z bazą: sygnatura nazw kolumn per tabela.
--     Ten sam md5 policz z pliku JSON (posortowane nazwy kolumn złączone
--     przecinkiem) — rozjazd oznacza, że plik wymaga aktualizacji.
SELECT jsonb_object_agg(t, h) AS sig FROM (
  SELECT c.relname AS t, md5(string_agg(a.attname, ',' ORDER BY a.attname)) AS h
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (c.relname LIKE 'crm\_%' OR c.relname LIKE 'bond\_%' OR c.relname LIKE 'apk\_%')
  GROUP BY c.relname
) s;
