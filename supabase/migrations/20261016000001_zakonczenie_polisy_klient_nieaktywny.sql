-- Zakończenie polisy decyzją (wypowiedzenie od dnia albo brak odnowienia na koniec okresu) i klient nieaktywny
-- (zakończenie działalności). Dotąd polisa po końcu ochrony „wisiała” bez decyzji — status liczył się tylko z dat.
--
-- crm_policies.zakonczona_od — dzień, od którego polisa nie chroni (od dnia: podana data; koniec okresu: data_do).
-- Sama obecność daty oznacza decyzję „nie odnawiamy”: polisa znika z odnowień, automat nie wysyła wniosku.
alter table public.crm_policies
  add column if not exists zakonczona_od date,
  add column if not exists zakonczenie_tryb text check (zakonczenie_tryb is null or zakonczenie_tryb in ('od_dnia', 'koniec_okresu')),
  add column if not exists zakonczenie_powod text,
  add column if not exists zakonczenie_notatka text,
  add column if not exists zakonczono_at timestamptz,
  add column if not exists zakonczono_przez uuid references public.crm_profiles(id);

create index if not exists crm_policies_zakonczona_od_idx on public.crm_policies (tenant_id, zakonczona_od) where zakonczona_od is not null;

-- crm_clients.aktywny = false: klient zakończył działalność (albo zrezygnował) — lista klientów chowa go domyślnie,
-- odnowienia i automat go pomijają; polisy można zakończyć razem z oznaczeniem.
alter table public.crm_clients
  add column if not exists aktywny boolean not null default true,
  add column if not exists nieaktywny_od date,
  add column if not exists nieaktywny_powod text,
  add column if not exists nieaktywny_notatka text,
  add column if not exists nieaktywny_at timestamptz,
  add column if not exists nieaktywny_przez uuid references public.crm_profiles(id);

create index if not exists crm_clients_nieaktywni_idx on public.crm_clients (tenant_id) where aktywny = false;
