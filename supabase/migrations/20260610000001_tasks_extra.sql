alter table crm_tasks
  add column if not exists extra_assignees uuid[] default '{}',
  add column if not exists czas_trwania_dni int,
  add column if not exists postep_pct int default 0 check (postep_pct >= 0 and postep_pct <= 100),
  add column if not exists zakonczone_at timestamptz;

create table if not exists crm_task_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id),
  task_id uuid not null references crm_tasks(id) on delete cascade,
  tytul_zadania text,
  zmiana text not null,
  stary_status text,
  nowy_status text,
  autor_id uuid references crm_profiles(id),
  klient_id uuid references crm_clients(id),
  prospect_id uuid references crm_prospects(id),
  created_at timestamptz not null default now()
);
alter table crm_task_history enable row level security;
create policy "tenant_isolation_task_history" on crm_task_history
  for all using (tenant_id = get_my_tenant_id());
