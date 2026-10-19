-- Gwarancja z modułu Gwarancje (bond_bonds) jako polisa CRM: składka, rata, prowizja z umowy gwarancyjnej,
-- widoczność na karcie klienta i w rozliczeniach. Powiązanie 1:1 trzymamy po stronie gwarancji.
alter table public.bond_bonds
  add column if not exists crm_policy_id uuid references public.crm_policies(id) on delete set null;

create index if not exists bond_bonds_crm_policy_idx on public.bond_bonds (crm_policy_id) where crm_policy_id is not null;

comment on column public.bond_bonds.crm_policy_id is 'Polisa CRM (crm_policies) założona dla tej gwarancji — $lib/gwarancje.ts';
