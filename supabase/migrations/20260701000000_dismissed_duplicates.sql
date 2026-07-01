-- Persist "not a duplicate" decisions from the Klienci duplicate checker so
-- previously reviewed NIP/PESEL collisions don't resurface on every refresh.
-- dedupe_key encodes both the collision (reason) and the exact set of client
-- ids involved, so if a *new* client later joins that same NIP/PESEL group
-- the key changes and the group is shown again as a new duplicate.
create table if not exists crm_dismissed_duplicates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id),
  dedupe_key text not null,
  dismissed_by uuid references crm_profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

alter table crm_dismissed_duplicates enable row level security;

create policy "tenant_isolation_dismissed_duplicates" on crm_dismissed_duplicates
  for all using (tenant_id = get_my_tenant_id());
