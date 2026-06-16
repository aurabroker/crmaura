-- Per-client GetResponse linking overrides (Aura Expert only feature).
-- Stores an optional override e-mail used to match the client in GetResponse,
-- and an "ignored" flag to dismiss the CRM <-> GetResponse mismatch warning.
create table if not exists crm_getresponse_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id),
  klient_id uuid not null references crm_clients(id) on delete cascade,
  gr_email text,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (klient_id)
);

alter table crm_getresponse_links enable row level security;

create policy "tenant_isolation_getresponse_links" on crm_getresponse_links
  for all using (tenant_id = get_my_tenant_id());
