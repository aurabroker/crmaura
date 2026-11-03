-- Odnowienia OC beauty: dwa ostrzeżenia dla klienta, który nie złożył wniosku o odnowienie.
--   mail_ostatni_dzien_at — e-mail w ostatnim dniu ochrony (czerwony, z linkiem do wniosku, ważnym do północy),
--   mail_wygasla_at       — e-mail dzień po końcu ochrony („Ochrona ubezpieczeniowa wygasła”, kontakt z biurem).
-- Zadanie dzienne (/api/cron/renewals) zajmuje pole przed wysyłką, więc każdy e-mail idzie najwyżej raz.

alter table public.crm_renewals add column if not exists mail_ostatni_dzien_at timestamptz;
alter table public.crm_renewals add column if not exists mail_wygasla_at timestamptz;

comment on column public.crm_renewals.mail_ostatni_dzien_at is 'Kiedy wysłano klientowi e-mail „ochrona kończy się dziś” (ostatni dzień certyfikatu, wniosek niezłożony).';
comment on column public.crm_renewals.mail_wygasla_at is 'Kiedy wysłano klientowi e-mail „ochrona ubezpieczeniowa wygasła” (dzień po końcu certyfikatu bez odnowienia).';
