-- Indeksy przyspieszające moduł Prospects.
-- Do tej pory crm_prospects / crm_prospect_activities / crm_tasks miały tylko
-- klucz główny, więc lista prospektów (filtr po tenant + sort po created_at) oraz
-- karta prospekta (aktywności i zadania filtrowane po prospect_id) skanowały
-- całe tabele. Przy ~5 tys. prospektów to zauważalnie spowalniało ładowanie.

-- Lista prospektów: filtr RLS po tenant_id + ORDER BY created_at DESC, id DESC.
create index if not exists crm_prospects_tenant_created_idx
  on crm_prospects (tenant_id, created_at desc, id desc);

-- Karta prospekta: aktywności (notatki/komentarze/wiadomości) po prospect_id.
create index if not exists crm_prospect_activities_prospect_idx
  on crm_prospect_activities (prospect_id);

-- Karta prospekta: zadania powiązane z prospektem.
create index if not exists crm_tasks_prospect_idx
  on crm_tasks (prospect_id);
