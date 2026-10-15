-- Zadanie utworzone po złożeniu wniosku online (odnowienie / pierwsza polisa) pamięta swój wniosek:
-- pulpit pokazuje alert „klient czeka na ofertę/polisę” i prowadzi z zadania do wniosku (i odwrotnie).
-- Zamknięcie takiego zadania (zakończone / anulowane) zdejmuje wniosek z alertu, gdy polisa nie powstała w CRM.
alter table public.crm_tasks
  add column if not exists renewal_id uuid references public.crm_renewals(id) on delete set null;

create index if not exists crm_tasks_renewal_id_idx on public.crm_tasks (renewal_id) where renewal_id is not null;
