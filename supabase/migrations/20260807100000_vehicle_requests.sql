-- Wnioski o dodanie pojazdu z importu polisy.
-- Polisa potrafi nie zawierać numeru rejestracyjnego (bywa sam VIN), a
-- crm_vehicles wymaga rejestracji. Zamiast zapisywać niekompletny pojazd,
-- broker składa wniosek, a administrator go uzupełnia i akceptuje albo odrzuca.

create table if not exists crm_vehicle_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id) on delete cascade,
  klient_id uuid not null references crm_clients(id) on delete cascade,
  polisa_id uuid references crm_policies(id) on delete set null,

  -- Dane odczytane z polisy. Rejestracja bywa pusta — to powód istnienia wniosku.
  nr_rejestracyjny text,
  vin text,
  marka_model text,
  rok_produkcji integer,
  rodzaj_pojazdu text,
  pojemnosc_silnika integer,
  moc integer,
  ladownosc integer,

  zrodlo text,
  status text not null default 'oczekuje'
    check (status in ('oczekuje', 'zaakceptowany', 'odrzucony')),
  powod text,

  pojazd_id uuid references crm_vehicles(id) on delete set null,
  created_by uuid references crm_profiles(id) on delete set null,
  created_at timestamptz default now(),
  rozpatrzony_przez uuid references crm_profiles(id) on delete set null,
  rozpatrzony_at timestamptz
);

alter table crm_vehicle_requests enable row level security;

drop policy if exists crm_vehicle_requests_tenant on crm_vehicle_requests;
create policy crm_vehicle_requests_tenant on crm_vehicle_requests
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

create index if not exists idx_crm_vehicle_requests_tenant_status
  on crm_vehicle_requests(tenant_id, status);

comment on table crm_vehicle_requests is
  'Wnioski brokerów o dodanie pojazdu na podstawie polisy, gdy danych z dokumentu nie da się zapisać wprost. Rozpatruje administrator.';
