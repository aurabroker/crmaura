-- ============================================================
-- Odnowienia polis OC beauty: link dla klienta, APK, wniosek, decyzja.
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA.
--
-- Klient nie ma dostępu do tych tabel z przeglądarki: strona /odnowienie/<token> rozmawia
-- z serwerem CRM (/api/odnowienie/...), który działa kluczem service_role i sprawdza token.
-- Pracownicy widzą odnowienia swojej firmy (SELECT); zapis wyłącznie przez serwer.
-- Link to /odnowienie/<id>-<podpis HMAC>; podpis liczy tylko serwer, w bazie nie ma nic, co go odtwarza.
-- ============================================================

-- 1) Suma gwarancyjna polisy (dotąd brak takiego pola; wniosek pokazuje ją, gdy jest wpisana).
alter table public.crm_policies add column if not exists suma_gwarancyjna numeric;

-- 2) Odnowienia
create table if not exists public.crm_renewals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id),
  polisa_id uuid not null references public.crm_policies(id) on delete cascade,
  klient_id uuid not null references public.crm_clients(id),
  status text not null default 'utworzony'
    check (status in ('utworzony', 'wyslany', 'otwarty', 'apk', 'zlozony', 'wygasl', 'anulowany')),
  decyzja text check (decyzja in ('bez_zmian', 'zmiany', 'nie')),
  email text,
  -- Stan polisy w chwili utworzenia linku — to widzi klient i to trafia do PDF.
  nr_polisy text,
  tu_nazwa text,
  program text,
  klient_nazwa text,
  suma numeric,
  skladka numeric,
  okres_od date,
  okres_do date,
  -- Odpowiedzi klienta
  apk jsonb,
  apk_odmowa boolean not null default false,
  wniosek jsonb,
  ankieta jsonb,
  zalaczniki jsonb not null default '[]'::jsonb,
  skladka_nowa numeric,
  pdf_path text,
  -- Przebieg
  wyslano_at timestamptz,
  otwarto_at timestamptz,
  apk_at timestamptz,
  zlozono_at timestamptz,
  przypomniano_at timestamptz,
  wazny_do timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Jedno aktywne odnowienie na polisę.
create unique index if not exists crm_renewals_one_active
  on public.crm_renewals (polisa_id) where status not in ('wygasl', 'anulowany');
create index if not exists crm_renewals_tenant_status on public.crm_renewals (tenant_id, status);

-- 3) Dziennik zdarzeń (otwarcie, APK lub odmowa APK, decyzja) z czasem, IP i przeglądarką.
create table if not exists public.crm_renewal_events (
  id bigint generated always as identity primary key,
  renewal_id uuid not null references public.crm_renewals(id) on delete cascade,
  tenant_id uuid not null,
  zdarzenie text not null,
  at timestamptz not null default now(),
  ip text,
  user_agent text,
  szczegoly jsonb
);
create index if not exists crm_renewal_events_renewal on public.crm_renewal_events (renewal_id, at);

-- 4) Dostęp: pracownicy czytają odnowienia swojej firmy; nikt poza serwerem nie pisze.
alter table public.crm_renewals enable row level security;
alter table public.crm_renewal_events enable row level security;

drop policy if exists crm_renewals_tenant_select on public.crm_renewals;
create policy crm_renewals_tenant_select on public.crm_renewals
  for select to authenticated using (tenant_id = public.get_my_tenant_id());
drop policy if exists crm_renewal_events_tenant_select on public.crm_renewal_events;
create policy crm_renewal_events_tenant_select on public.crm_renewal_events
  for select to authenticated using (tenant_id = public.get_my_tenant_id());

revoke all on public.crm_renewals, public.crm_renewal_events from anon;
revoke all on public.crm_renewals, public.crm_renewal_events from authenticated;
grant select on public.crm_renewals, public.crm_renewal_events to authenticated;

-- 5) Pliki od klienta (dyplomy, certyfikaty, wzory zgód) i PDF wniosku: bucket prywatny.
--    Klient wgrywa przez jednorazowy podpisany adres od serwera; pracownicy czytają pliki swojej firmy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renewal-files', 'renewal-files', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

drop policy if exists renewal_files_tenant_select on storage.objects;
create policy renewal_files_tenant_select on storage.objects
  for select to authenticated
  using (bucket_id = 'renewal-files' and (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

-- 6) Zadanie dzienne: wysyłka zaproszeń 45 dni przed końcem (dla firm z włączoną automatyczną
--    wysyłką), jedno przypomnienie po 7 dniach, wygaszanie nieużytych linków.
create or replace function public.crm_run_renewals()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://portal.beautypolisa.eu/api/cron/renewals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;
revoke all on function public.crm_run_renewals() from public, anon, authenticated;

select cron.schedule('crm-renewals', '20 6 * * *', 'select public.crm_run_renewals()');

-- 7) Sumy gwarancyjne certyfikatów programu z polis w BEAUTY (projekt dhuvykwecsxgchzxufxw,
--    public.crm_policies.suma_ubezpieczenia), dopasowane po numerze certyfikatu; tylko puste pola.
update public.crm_policies p
set suma_gwarancyjna = v.suma
from (values
  ('472000146072',100000),('472000146216',100000),('472000146771',100000),('472000146861',100000),
  ('472000146732',100000),('472000148733',200000),('436000436385',200000),('472000157991',200000),
  ('472000146502',200000),('472000146768',100000),('472000146603',200000),('436000413518',100000),
  ('436000415672',300000),('472000147130',100000),('472000147165',100000),('472000147233',100000),
  ('472000147332',200000),('472000147736',200000),('472000147873',200000),('472000147990',200000),
  ('436000425008',200000),('472000148058',200000),('472000148153',100000),('436000416447',300000),
  ('472000148620',200000),('472000158384',300000),('436000437663',100000),('436000417036',100000),
  ('436000440287',200000)
) as v(nr, suma)
where regexp_replace(coalesce(p.nr_polisy, ''), '\D', '', 'g') = v.nr
  and p.suma_gwarancyjna is null
  and p.deleted_at is null;

-- Weryfikacja:
--   select has_table_privilege('anon', 'public.crm_renewals', 'select'),            -- false
--          has_table_privilege('authenticated', 'public.crm_renewals', 'insert'),   -- false
--          (select public from storage.buckets where id = 'renewal-files');          -- false
--   select jobname, schedule, active from cron.job where jobname = 'crm-renewals';
--
-- ROLLBACK:
--   select cron.unschedule('crm-renewals');
--   drop function if exists public.crm_run_renewals();
--   drop table if exists public.crm_renewal_events, public.crm_renewals;
--   (bucket renewal-files usuwać dopiero po przejrzeniu plików)
