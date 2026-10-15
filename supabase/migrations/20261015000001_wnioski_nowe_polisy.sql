-- ============================================================
-- Wnioski o pierwszą polisę (klient bez certyfikatu): ta sama tabela i ten sam link co odnowienia.
--
-- Dotąd link do APK i wniosku dało się wysłać tylko z karty certyfikatu (crm_renewals.polisa_id NOT NULL).
-- Klient, który dopiero zgłasza się po pierwszą polisę, dostaje teraz taki sam link z karty klienta albo leada:
-- APK ze zgodami i podpisem, wniosek o zawarcie ubezpieczenia (firma, początek ochrony, suma, ochrona prawna,
-- zabiegi wymagające ankiety), podpis, PDF-y i zadanie dla doradcy.
--  - rodzaj: 'odnowienie' (polisa_id wymagane) albo 'nowa' (polisa_id puste),
--  - decyzja 'nowa' = klient wnioskuje o ubezpieczenie; 'nie' = rezygnuje,
--  - jeden aktywny wniosek o pierwszą polisę na klienta (jak jeden aktywny wniosek na certyfikat).
-- ============================================================

alter table public.crm_renewals alter column polisa_id drop not null;

alter table public.crm_renewals add column if not exists rodzaj text not null default 'odnowienie';
alter table public.crm_renewals drop constraint if exists crm_renewals_rodzaj_check;
alter table public.crm_renewals add constraint crm_renewals_rodzaj_check
  check (rodzaj in ('odnowienie', 'nowa') and (rodzaj = 'nowa' or polisa_id is not null));
comment on column public.crm_renewals.rodzaj is 'odnowienie = certyfikat z programu (polisa_id); nowa = pierwsza polisa klienta bez certyfikatu (polisa_id puste).';

alter table public.crm_renewals drop constraint if exists crm_renewals_decyzja_check;
alter table public.crm_renewals add constraint crm_renewals_decyzja_check
  check (decyzja in ('bez_zmian', 'zmiany', 'nie', 'nowa'));

-- Jeden aktywny wniosek o pierwszą polisę na klienta.
create unique index if not exists crm_renewals_one_active_nowa
  on public.crm_renewals (klient_id) where polisa_id is null and status not in ('wygasl', 'anulowany');

-- Weryfikacja:
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.crm_renewals'::regclass and conname like 'crm_renewals_%_check';
--   select indexname from pg_indexes where tablename = 'crm_renewals';
-- ROLLBACK (tylko gdy nie ma wniosków z rodzaj = 'nowa'):
--   drop index if exists public.crm_renewals_one_active_nowa;
--   alter table public.crm_renewals drop constraint if exists crm_renewals_decyzja_check;
--   alter table public.crm_renewals add constraint crm_renewals_decyzja_check check (decyzja in ('bez_zmian', 'zmiany', 'nie'));
--   alter table public.crm_renewals drop constraint if exists crm_renewals_rodzaj_check;
--   alter table public.crm_renewals drop column if exists rodzaj;
--   alter table public.crm_renewals alter column polisa_id set not null;
