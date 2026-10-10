-- Konto wirtualne „Centrala”: profil bez możliwości logowania (konto auth zablokowane, losowe hasło),
-- domyślny opiekun polis firmy. Konta założono 10.10.2026 dla Aura Expert i Aura Consulting
-- (auth.users + crm_profiles), a wszystkie istniejące polisy dostały je jako opiekuna (crm_policy_brokers,
-- rola „opiekun” — poza podziałem prowizji).

alter table public.crm_profiles add column if not exists wirtualny boolean not null default false;
comment on column public.crm_profiles.wirtualny is 'Konto bez logowania (np. „Centrala”) — tylko do przypisań, nie do pracy w CRM.';
update public.crm_profiles set wirtualny = true where email like 'centrala@%.invalid';

-- Każda nowa polisa dostaje opiekuna „Centrala” swojej firmy (jeśli firma ma takie konto).
-- Doradca może potem dodać właściwego opiekuna i usunąć Centralę na karcie polisy.
create or replace function public.crm_policy_domyslny_opiekun()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into crm_policy_brokers (tenant_id, polisa_id, broker_id, rola, udzial_pct)
  select new.tenant_id, new.id, pr.id, 'opiekun', 100
    from crm_profiles pr
   where pr.tenant_id = new.tenant_id and pr.wirtualny and pr.imie_nazwisko = 'Centrala'
     and not exists (select 1 from crm_policy_brokers b where b.polisa_id = new.id and b.rola = 'opiekun')
   order by pr.created_at
   limit 1;
  return new;
end;
$$;

revoke all on function public.crm_policy_domyslny_opiekun() from public, anon, authenticated;

drop trigger if exists crm_policies_default_opiekun on public.crm_policies;
create trigger crm_policies_default_opiekun
  after insert on public.crm_policies
  for each row execute function public.crm_policy_domyslny_opiekun();
