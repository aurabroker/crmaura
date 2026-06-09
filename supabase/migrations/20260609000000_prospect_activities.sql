create table if not exists crm_prospect_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references crm_tenants(id) on delete cascade,
  prospect_id uuid not null references crm_prospects(id) on delete cascade,
  author_id uuid references crm_profiles(id) on delete set null,
  typ text not null check (typ in ('notatka', 'komentarz', 'wiadomosc')),
  tresc text not null,
  created_at timestamptz not null default now()
);

alter table crm_prospect_activities enable row level security;

create policy "tenant isolation" on crm_prospect_activities
  using (tenant_id = (select tenant_id from crm_profiles where id = auth.uid()));
