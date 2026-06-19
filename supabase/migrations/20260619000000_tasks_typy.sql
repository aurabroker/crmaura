-- Typy zadania (checkboxy: spotkanie / e-mail / telefon / oferta) — używane w ścieżce Prospects.
alter table crm_tasks
  add column if not exists typy text[] default '{}';
