-- ============================================================
-- Podpis klienta (palcem / rysikiem / myszą) pod APK i pod wnioskiem o odnowienie oraz zgody marketingowe.
--
-- crm_renewal_podpisy  jeden podpis na zakres ('apk' — analiza potrzeb albo odmowa, razem ze zgodami;
--                      'wniosek' — wniosek z ankietą i załącznikami). Poprawiona APK = nowy podpis nadpisuje.
--                      skrot_tresci: SHA-256 kanonicznej treści w chwili podpisu (serwer liczy ją tą samą
--                      funkcją z wiersza crm_renewals, więc zgodność da się sprawdzić w każdej chwili);
--                      skrot_podpisu: SHA-256 bajtów PNG; punkty: przebieg ruchu [[x, y, t, nacisk], …].
--                      Przebieg ruchu to ślad dowodowy — czytają go tylko pracownicy firmy, nigdy klient.
-- crm_zgody            rejestr zgód marketingowych z dokładnym brzmieniem (kanał e-mail / SMS i telefon),
--                      źródłem i śladem (IP, przeglądarka). Nowa zgoda = nowy wiersz; stan bieżący na kliencie.
-- crm_renewals.zgody   migawka zgód przy wniosku (odpowiedzi, wersja, teksty) — część podpisanej treści APK.
-- crm_clients.zgoda_*  stan bieżący do list i wysyłek (null = nigdy nie pytano).
-- Pisze wyłącznie serwer (service_role); pracownicy tylko czytają w obrębie swojej firmy.
-- ============================================================

alter table public.crm_renewals
  add column if not exists zgody jsonb,
  add column if not exists podpis_apk_at timestamptz,
  add column if not exists podpis_wniosku_at timestamptz;

create table if not exists public.crm_renewal_podpisy (
  id            uuid primary key default gen_random_uuid(),
  renewal_id    uuid not null references public.crm_renewals(id) on delete cascade,
  tenant_id     uuid not null references public.crm_tenants(id),
  zakres        text not null check (zakres in ('apk', 'wniosek')),
  png           text not null check (length(png) <= 400000),
  punkty        jsonb not null,
  proporcje     numeric not null check (proporcje > 0.5 and proporcje < 10),
  podpisano_at  timestamptz not null default now(),
  ip            text,
  user_agent    text,
  skrot_tresci  text not null check (skrot_tresci ~ '^[0-9a-f]{64}$'),
  skrot_podpisu text not null check (skrot_podpisu ~ '^[0-9a-f]{64}$'),
  wersja        text not null default 'v1',
  created_at    timestamptz not null default now(),
  unique (renewal_id, zakres)
);

alter table public.crm_renewal_podpisy enable row level security;
revoke all on public.crm_renewal_podpisy from anon, authenticated;
grant select on public.crm_renewal_podpisy to authenticated;
drop policy if exists crm_renewal_podpisy_tenant_select on public.crm_renewal_podpisy;
create policy crm_renewal_podpisy_tenant_select on public.crm_renewal_podpisy
  for select to authenticated using (tenant_id = public.get_my_tenant_id());

create table if not exists public.crm_zgody (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.crm_tenants(id),
  klient_id   uuid not null references public.crm_clients(id) on delete cascade,
  kanal       text not null check (kanal in ('email', 'sms')),
  zgoda       boolean not null,
  tresc       text not null,
  wersja      text not null,
  zrodlo      text not null default 'odnowienie',
  renewal_id  uuid references public.crm_renewals(id) on delete set null,
  podpisany   boolean not null default false,
  ip          text,
  user_agent  text,
  at          timestamptz not null default now()
);
create index if not exists crm_zgody_klient_idx on public.crm_zgody (klient_id, at desc);

alter table public.crm_zgody enable row level security;
revoke all on public.crm_zgody from anon, authenticated;
grant select on public.crm_zgody to authenticated;
drop policy if exists crm_zgody_tenant_select on public.crm_zgody;
create policy crm_zgody_tenant_select on public.crm_zgody
  for select to authenticated using (tenant_id = public.get_my_tenant_id());

alter table public.crm_clients
  add column if not exists zgoda_email boolean,
  add column if not exists zgoda_email_at timestamptz,
  add column if not exists zgoda_sms boolean,
  add column if not exists zgoda_sms_at timestamptz;

-- Weryfikacja:
--   select has_table_privilege('anon', 'public.crm_renewal_podpisy', 'select'),          -- false
--          has_table_privilege('authenticated', 'public.crm_renewal_podpisy', 'insert'), -- false
--          has_table_privilege('authenticated', 'public.crm_zgody', 'select');           -- true
--
-- ROLLBACK:
--   drop table if exists public.crm_zgody, public.crm_renewal_podpisy;
--   alter table public.crm_renewals drop column if exists zgody, drop column if exists podpis_apk_at, drop column if exists podpis_wniosku_at;
--   alter table public.crm_clients drop column if exists zgoda_email, drop column if exists zgoda_email_at, drop column if exists zgoda_sms, drop column if exists zgoda_sms_at;
