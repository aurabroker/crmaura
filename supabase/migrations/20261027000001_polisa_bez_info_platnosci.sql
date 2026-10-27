-- Polisa: „Nie wysyłaj klientowi informacji o płatnościach”.
--
-- Leadenhall: w CRM składka (i raty) bez opłat dystrybucyjnych, a klient płaci całość (brutto) — kwota
-- w przypomnieniu o racie albo w e-mailu z polisą byłaby błędna. Flaga wyłącza dla polisy:
--   • automatyczne przypomnienia o ratach (edge function send-payment-reminders),
--   • składkę i termin płatności w e-mailu „Wyślij polisę klientowi” (wbudowana treść bez tych wierszy).
-- Raty, rozliczenia, statystyki i podsumowania dla pracowników liczą się bez zmian.
--
-- Nowe polisy Leadenhall dostają flagę w formularzu i przy imporcie PDF (domyślnie zaznaczona, do zmiany).
-- Tu: kolumna i oznaczenie istniejących polis Leadenhall (każda firma; TU po nazwie).
--
-- STATUS: nałożona 2026-10-27 przez execute_sql, wpisana do supabase_migrations.schema_migrations.

alter table public.crm_policies add column if not exists bez_info_platnosci boolean not null default false;

comment on column public.crm_policies.bez_info_platnosci is
  'Nie wysyłaj klientowi informacji o płatnościach (przypomnienia o ratach, składka i termin w e-mailu z polisą) — np. Leadenhall: w CRM składka bez opłat dystrybucyjnych, klient płaci brutto.';

update public.crm_policies p
   set bez_info_platnosci = true
  from public.crm_insurers i
 where i.id = p.tu_id
   and i.nazwa ilike '%leadenhall%'
   and not p.bez_info_platnosci;
