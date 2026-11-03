-- Zgłaszanie wyrejestrowania pojazdu do towarzystwa.
--
-- Adresaci są ustawiani per towarzystwo (dwa adresy), kopia idzie na adres
-- wskazany przez brokera/agenta. Każde zgłoszenie jest zapisywane przy kliencie
-- wraz z załącznikami (dowód sprzedaży, faktura, decyzja o złomowaniu).

alter table crm_insurers
  add column if not exists email_wyrej_1 text,
  add column if not exists email_wyrej_2 text;

comment on column crm_insurers.email_wyrej_1 is 'Adres w TU do zgłoszeń wyrejestrowania pojazdu (główny).';
comment on column crm_insurers.email_wyrej_2 is 'Adres w TU do zgłoszeń wyrejestrowania pojazdu (drugi).';

alter table crm_profiles
  add column if not exists email_cc_zgloszenia text;

comment on column crm_profiles.email_cc_zgloszenia is 'Adres CC brokera/agenta dla zgłoszeń wysyłanych do TU.';

create table if not exists crm_vehicle_deregistrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id) on delete cascade,
  klient_id uuid not null references crm_clients(id) on delete cascade,
  pojazd_id uuid references crm_vehicles(id) on delete set null,
  polisa_id uuid references crm_policies(id) on delete set null,
  tu_id uuid references crm_insurers(id) on delete set null,

  powod text not null check (powod in ('sprzedaz', 'zlomowanie', 'kradziez', 'inne')),
  data_zdarzenia date,
  tresc text,

  -- Migawka pojazdu w chwili zgłoszenia — kartoteka może się później zmienić.
  pojazd_opis text,

  adresaci text[] not null,
  cc text[] not null default '{}',
  nadawca text,
  temat text,
  -- [{nazwa, sciezka, rozmiar, typ}] — pliki w buckecie "wyrejestrowania"
  zalaczniki jsonb not null default '[]'::jsonb,

  status text not null default 'wyslane' check (status in ('wyslane', 'blad')),
  resend_id text,
  blad text,

  wyslal_id uuid references crm_profiles(id) on delete set null,
  wyslal_nazwa text,
  created_at timestamptz not null default now()
);

alter table crm_vehicle_deregistrations enable row level security;

drop policy if exists crm_vehicle_deregistrations_tenant on crm_vehicle_deregistrations;
create policy crm_vehicle_deregistrations_tenant on crm_vehicle_deregistrations
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

create index if not exists idx_crm_vehicle_deregistrations_klient
  on crm_vehicle_deregistrations(tenant_id, klient_id, created_at desc);

comment on table crm_vehicle_deregistrations is
  'Zgłoszenia wyrejestrowania pojazdu wysłane do TU — kto, kiedy, do kogo, z jakimi załącznikami.';

-- Prywatny bucket na dowody wyrejestrowania; ścieżka zaczyna się od tenant_id.
insert into storage.buckets (id, name, public)
values ('wyrejestrowania', 'wyrejestrowania', false)
on conflict (id) do nothing;

drop policy if exists wyrejestrowania_tenant_select on storage.objects;
create policy wyrejestrowania_tenant_select on storage.objects
  for select to authenticated
  using (bucket_id = 'wyrejestrowania' and (storage.foldername(name))[1] = get_my_tenant_id()::text);

drop policy if exists wyrejestrowania_tenant_insert on storage.objects;
create policy wyrejestrowania_tenant_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wyrejestrowania' and (storage.foldername(name))[1] = get_my_tenant_id()::text);
