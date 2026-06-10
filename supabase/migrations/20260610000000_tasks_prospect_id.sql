alter table crm_tasks add column if not exists prospect_id uuid references crm_prospects(id);
