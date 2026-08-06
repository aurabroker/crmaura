-- Parametry odczytane z pliku polisy, które nie mają własnych kolumn
-- w crm_policies: pozycje ryzyk z sumami, klauzule, franszyzy, miejsca
-- ubezpieczenia, konto do wpłat, dane agenta, numer OWU.
-- Kolumna jest opcjonalna — polisy wprowadzane ręcznie zostawiają ją pustą.

alter table crm_policies add column if not exists dane_importu jsonb;

comment on column crm_policies.dane_importu is
  'Dane odczytane z pliku polisy przez moduł importu (ryzyka, klauzule, OWU, konto). Wypełniane wyłącznie przy imporcie z PDF.';
