-- ============================================================
-- E-maile wysłane klientowi z CRM (przypomnienia o płatnościach, później odnowienia).
-- Pokazywane na karcie klienta (zakładka „E-maile”). Zapisuje wyłącznie serwer (service_role):
-- funkcja send-payment-reminders po udanej wysyłce. Pracownicy firmy tylko czytają.
-- STATUS: ZASTOSOWANA na produkcji 2026-10-08 (5 wpisów z 08.10, RLS: pracownicy firmy tylko odczyt).
-- ============================================================

create table if not exists public.crm_client_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id),
  klient_id uuid not null references public.crm_clients(id) on delete cascade,
  polisa_ids uuid[] not null default '{}',
  rodzaj text not null check (rodzaj in ('przypomnienie_platnosci', 'odnowienie', 'inne')),
  adres text not null check (length(adres) <= 320),
  temat text not null check (length(temat) <= 500),
  tresc text check (length(tresc) <= 20000),
  dostawca_id text,
  wyslano_at timestamptz not null default now()
);

create index if not exists crm_client_emails_klient_idx on public.crm_client_emails (klient_id, wyslano_at desc);
create index if not exists crm_client_emails_tenant_idx on public.crm_client_emails (tenant_id, wyslano_at desc);

alter table public.crm_client_emails enable row level security;
revoke all on public.crm_client_emails from anon, authenticated;
grant select on public.crm_client_emails to authenticated;

drop policy if exists crm_client_emails_tenant_select on public.crm_client_emails;
create policy crm_client_emails_tenant_select on public.crm_client_emails
  for select to authenticated using (tenant_id = get_my_tenant_id());

-- Przypomnienia wysłane 2026-10-08 przed powstaniem tabeli (treść jak w ówczesnej wersji funkcji).
insert into public.crm_client_emails (tenant_id, klient_id, polisa_ids, rodzaj, adres, temat, tresc, wyslano_at)
select po.tenant_id, po.klient_id, array[po.id], 'przypomnienie_platnosci', coalesce(c.email, ''),
       'Przypomnienie: termin płatności składki — polisa ' || po.nr_polisy,
       'Przypomnienie o racie ' || coalesce(p.nr_raty::text, '—') || ': ' ||
         replace(to_char(p.kwota, 'FM999999990.00'), '.', ',') || ' zł, termin ' || to_char(p.data_platnosci, 'DD.MM.YYYY') ||
         ' (wysłane automatycznie, zapis uzupełniony po wdrożeniu historii e-maili).',
       p.przypomnienie_wyslane_at
from public.crm_policy_payments p
join public.crm_policies po on po.id = p.polisa_id
join public.crm_clients c on c.id = po.klient_id
where p.przypomnienie_wyslane_at is not null
  and p.przypomnienie_wyslane_at < '2026-10-09'
  and not exists (select 1 from public.crm_client_emails e where e.klient_id = po.klient_id and po.id = any(e.polisa_ids) and e.rodzaj = 'przypomnienie_platnosci');
