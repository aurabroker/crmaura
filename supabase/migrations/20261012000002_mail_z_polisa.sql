-- ============================================================
-- Wysyłka polisy klientowi z CRM (szablon Resend + PDF polisy w załączniku; pozostałe dokumenty
-- programu są w treści maila jako linki do pliki.auraexpert.pl).
-- Historia e-maili: rodzaj „polisa” (polisa wysłana klientowi).
-- ============================================================

alter table public.crm_client_emails drop constraint if exists crm_client_emails_rodzaj_check;
alter table public.crm_client_emails add constraint crm_client_emails_rodzaj_check
  check (rodzaj in ('przypomnienie_platnosci', 'odnowienie', 'recznie', 'polisa', 'inne'));

-- Szukanie wcześniejszych wysyłek danej polisy (ostrzeżenie przed ponowną wysyłką).
create index if not exists crm_client_emails_polisy_idx on public.crm_client_emails using gin (polisa_ids);
