-- ============================================================
-- STATUS: ZASTOSOWANA na produkcji 11.10.2026 (execute_sql, krokami).
-- Zbiorowe uzupełnianie danych klientów z rejestru REGON (GUS) — /api/gus/uzupelnij.
-- Klient z NIP, któremu brakuje adresu albo REGON, jest sprawdzany w GUS raz; wynik i surowe dane
-- zostają przy kliencie. Uzupełniane są tylko puste pola (adres, REGON) — dane poprawione w CRM zostają.
--
-- gus_wynik: uzupelniono | bez_zmian | nie_znaleziono | zakonczona (firma wykreślona) | zly_nip
-- ============================================================

alter table public.crm_clients add column if not exists gus_sprawdzono_at timestamptz;
alter table public.crm_clients add column if not exists gus_wynik text;
alter table public.crm_clients add column if not exists gus_dane jsonb;
alter table public.crm_clients drop constraint if exists crm_clients_gus_wynik_chk;
alter table public.crm_clients add constraint crm_clients_gus_wynik_chk
  check (gus_wynik is null or gus_wynik in ('uzupelniono', 'bez_zmian', 'nie_znaleziono', 'zakonczona', 'zly_nip'));

-- Kolejka do sprawdzenia: klienci firmy z NIP, jeszcze niesprawdzeni.
create index if not exists crm_clients_gus_kolejka_idx
  on public.crm_clients (tenant_id) where gus_sprawdzono_at is null and nip is not null;

-- ROLLBACK:
--   drop index if exists crm_clients_gus_kolejka_idx;
--   alter table public.crm_clients drop constraint if exists crm_clients_gus_wynik_chk,
--     drop column gus_sprawdzono_at, drop column gus_wynik, drop column gus_dane;
