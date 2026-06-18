-- ============================================================================
-- AURA SECURITY AUDIT — read-only audyt bezpieczeństwa Supabase / Postgres
-- ----------------------------------------------------------------------------
-- Uruchom w Supabase SQL Editor, przez `tools/security-audit/run.mjs`, lub MCP.
-- Niczego NIE zmienia. Zwraca priorytetowany raport z gotową remediacją.
--
-- Kolumny wyniku: severity | check_id | object | detail | remediation
--
-- Allowlista (CTE poniżej) wycisza zaakceptowane, świadome wyjątki
-- (np. publiczny odczyt cenników/katalogów do porównywarek).
-- ============================================================================

with allowlist(tablename, check_id) as (
  values
    -- === Zamierzone publiczne katalogi / cenniki (read-only dane referencyjne) ===
    ('pakiety',           'RLS_ANON_ALWAYS_TRUE'),
    ('oferty',            'RLS_ANON_ALWAYS_TRUE'),
    ('life_offers',       'RLS_ANON_ALWAYS_TRUE'),
    ('dostawcy',          'RLS_ANON_ALWAYS_TRUE'),
    ('placowki_medyczne', 'RLS_ANON_ALWAYS_TRUE'),
    ('relacje_sieci',     'RLS_ANON_ALWAYS_TRUE'),
    -- === Funkcje definer celowo wołane przez anon (RLS/triggery/liczniki) ===
    ('get_my_tenant_id',       'DEFINER_ANON_EXECUTABLE'),
    ('rls_auto_enable',        'DEFINER_ANON_EXECUTABLE'),
    ('is_authenticated',       'DEFINER_ANON_EXECUTABLE'),
    ('increment_article_views','DEFINER_ANON_EXECUTABLE'),
    ('increment_salon_views',  'DEFINER_ANON_EXECUTABLE')
),
findings as (
  -- 1) RLS otwarte dla anon/public (always-true) — wrogie inserty / odczyt PII
  select case when p.cmd in ('INSERT','UPDATE','DELETE','ALL') then 'CRITICAL' else 'HIGH' end as severity,
         'RLS_ANON_ALWAYS_TRUE' as check_id,
         p.tablename || '.' || p.policyname as object,
         p.cmd || ' dla ' || p.roles::text || ' bez warunku' as detail,
         'drop policy "' || p.policyname || '" on public.' || p.tablename || ';' as remediation
  from pg_policies p
  where p.schemaname = 'public'
    and (p.roles && '{anon}' or p.roles && '{public}')
    and (p.qual = 'true' or p.with_check = 'true')

  union all
  -- 2) Tabela w schemacie public bez włączonego RLS
  select 'HIGH', 'TABLE_NO_RLS', c.relname,
         'Tabela bez włączonego RLS',
         'alter table public.' || c.relname || ' enable row level security;'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all
  -- 3) RLS włączone, brak polityki (deny-all przez PostgREST — do przeglądu)
  select 'LOW', 'RLS_NO_POLICY', c.relname,
         'RLS włączone bez żadnej polityki (brak dostępu przez PostgREST)',
         '-- dodaj politykę lub potwierdź, że tabela ma być niedostępna z API'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)

  union all
  -- 4) Funkcje SECURITY DEFINER bez ustawionego search_path (ryzyko hijacku)
  select 'MEDIUM', 'DEFINER_NO_SEARCH_PATH', p.proname,
         'SECURITY DEFINER bez ustawionego search_path',
         'alter function public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') set search_path = public;'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')

  union all
  -- 5) Funkcje SECURITY DEFINER wykonywalne przez rolę anon (eskalacja)
  select 'MEDIUM', 'DEFINER_ANON_EXECUTABLE', p.proname,
         'SECURITY DEFINER wykonywalna przez rolę anon',
         'revoke execute on function public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') from anon;'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')

  union all
  -- 6) Publiczne buckety storage (sprawdź polityki listowania / dane wrażliwe)
  select 'MEDIUM', 'PUBLIC_BUCKET', b.name,
         'Bucket publiczny — sprawdź polityki listowania na storage.objects',
         '-- rozważ public=false + signed URL, lub usuń szerokie polityki SELECT (anon listing)'
  from storage.buckets b where b.public
)
select f.severity, f.check_id, f.object, f.detail, f.remediation
from findings f
left join allowlist a
  on a.tablename = split_part(f.object, '.', 1) and a.check_id = f.check_id
where a.tablename is null
order by case f.severity
           when 'CRITICAL' then 1 when 'HIGH' then 2
           when 'MEDIUM' then 3 when 'LOW' then 4 else 5 end,
         f.check_id, f.object;
