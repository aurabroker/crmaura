create table if not exists crm_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id),
  created_by uuid not null references crm_profiles(id),
  assigned_to uuid references crm_profiles(id),
  klient_id uuid references crm_clients(id),
  polisa_id uuid references crm_policies(id),
  tytul text not null,
  opis text,
  termin date,
  priorytet text not null default 'normalny' check (priorytet in ('niski', 'normalny', 'wysoki', 'pilny')),
  status text not null default 'otwarte' check (status in ('otwarte', 'w_toku', 'zakonczone', 'anulowane')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crm_tasks enable row level security;

create policy "tenant_isolation_tasks" on crm_tasks
  for all using (tenant_id = get_my_tenant_id());
