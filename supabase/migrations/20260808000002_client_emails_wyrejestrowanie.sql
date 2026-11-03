-- Zgłoszenie wyrejestrowania pojazdu idzie do TU, ale trafia też do historii e-maili klienta
-- (crm_client_emails), żeby webhook Resend śledził dostawę i żeby zakładka „E-maile” pokazywała,
-- kto i kiedy je wysłał. Słownik rodzajów dostaje wartość 'wyrejestrowanie'.

alter table crm_client_emails drop constraint if exists crm_client_emails_rodzaj_check;
alter table crm_client_emails add constraint crm_client_emails_rodzaj_check
  check (rodzaj in ('przypomnienie_platnosci', 'odnowienie', 'recznie', 'polisa', 'inne', 'wyrejestrowanie'));
