-- Kartoteka pojazdów: pola klasyfikacyjne Hestii (zrzut Cumulus) i polityka
-- identyfikacji pojazdu.
--
-- Hestia używa tego samego układu dla agentów i brokerów, więc pola są
-- wspólne dla całego CRM. Są potrzebne do zaszeregowania pojazdu i wyliczenia
-- składki, dlatego muszą być dostępne w każdym formularzu pojazdu.

alter table crm_vehicles
  add column if not exists rodzaj_kalkulacyjny text,         -- KALKULACYJNY RODZAJ POJAZDU
  add column if not exists rodzaj_rejestrowy text,           -- RODZAJ REJESTROWY (z dowodu)
  add column if not exists typ_pojazdu text,                 -- TYP POJAZDU
  add column if not exists nr_nadwozia text,                 -- NUMER NADWOZIA/RAMY
  add column if not exists nr_silnika text,
  add column if not exists rodzaj_tablic text,               -- RODZAJ TABLIC (stała / tymczasowa …)
  add column if not exists data_pierwszej_rejestracji date,
  add column if not exists liczba_miejsc integer,
  -- POJAZD WYKORZYSTYWANY: 11 flag użytkowania, np. {"leasing": true, "taxi": false}
  add column if not exists uzytkowanie jsonb not null default '{}'::jsonb,
  -- Pojazd specjalny / wolnobieżny niepodlegający rejestracji.
  add column if not exists bez_rejestracji boolean not null default false,
  -- Data zgłoszenia wyrejestrowania do TU.
  add column if not exists wyrejestrowany_at date;

-- Pojazd bez rejestracji identyfikujemy numerem nadwozia/silnika/seryjnym,
-- więc kolumna nie może być już NOT NULL — pilnuje jej warunek poniżej.
alter table crm_vehicles alter column nr_rejestracyjny drop not null;

-- WARUNEK BEZWZGLĘDNY: pojazdu nie da się dodać bez numeru VIN i numeru
-- rejestracyjnego. Wyjątek: pojazd niepodlegający rejestracji (specjalny,
-- wolnobieżny) — wtedy zamiast tablic wystarczy VIN, numer nadwozia/ramy
-- albo numer silnika.
alter table crm_vehicles drop constraint if exists crm_vehicles_identyfikacja_chk;
alter table crm_vehicles add constraint crm_vehicles_identyfikacja_chk check (
  (
    bez_rejestracji = false
    and nullif(btrim(nr_rejestracyjny), '') is not null
    and nullif(btrim(vin), '') is not null
  )
  or
  (
    bez_rejestracji = true
    and (
      nullif(btrim(vin), '') is not null
      or nullif(btrim(nr_nadwozia), '') is not null
      or nullif(btrim(nr_silnika), '') is not null
    )
  )
);

comment on constraint crm_vehicles_identyfikacja_chk on crm_vehicles is
  'Pojazd wymaga VIN i rejestracji; pojazd niepodlegający rejestracji (bez_rejestracji) wymaga VIN albo numeru nadwozia/ramy albo numeru silnika.';

-- Wniosek o pojazd może nieść numer nadwozia / silnika pojazdu specjalnego.
alter table crm_vehicle_requests
  add column if not exists nr_nadwozia text,
  add column if not exists nr_silnika text,
  add column if not exists bez_rejestracji boolean not null default false;
