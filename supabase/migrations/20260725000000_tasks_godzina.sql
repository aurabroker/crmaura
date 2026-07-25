-- Opcjonalna godzina zadania.
-- Gdy ustawiona, zadanie pojawia się w siatce godzin (widoki Tydzień/Dzień w kalendarzu).
-- NULL = zadanie całodniowe (dotychczasowe zachowanie, pełna wsteczna kompatybilność).
alter table crm_tasks
  add column if not exists godzina time;
