-- STATUS: ZASTOSOWANA na produkcji 21.10.2026 (execute_sql).
-- Klient z branży beauty oznaczony ręcznie w CRM. Dotąd „beauty” rozpoznawał się tylko po imporcie z BEAUTY (beauty_id),
-- certyfikacie z programu OC beauty albo leadzie z formularza BEAUTY — klient dodany ręcznie nie dostawał linków
-- do APK i wniosku o pierwszą polisę OC. Pole ustawia formularz „Nowy klient” i edycja klienta.
alter table public.crm_clients add column if not exists segment_beauty boolean not null default false;
comment on column public.crm_clients.segment_beauty is 'Klient z branży beauty oznaczony ręcznie w CRM (program OC Beauty Razem): dostaje linki do APK i wniosku o pierwszą polisę OC, na liście trafia do grupy Beauty. Import z BEAUTY rozpoznaje się po beauty_id.';
