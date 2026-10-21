-- Osobny klucz integracji dla asystenta AI (worker konsultacja-agent → /api/integracje/asystent/wniosek).
-- Klucz arkusza zgłoszeń (zakres 'zgloszenia') i klucz asystenta (zakres 'asystent_ai') żyją obok siebie:
-- nowy klucz wyłącza tylko poprzedni klucz tego samego zakresu. Istniejące klucze dostają 'zgloszenia'.
-- crm_przyjmij_zgloszenia zostaje bez zmian: endpoint zgłoszeń odrzuca klucze bez prefiksu crmzg_.
alter table public.crm_klucze_integracji
	add column if not exists zakres text not null default 'zgloszenia'
	check (zakres in ('zgloszenia', 'asystent_ai'));

create index if not exists crm_klucze_integracji_aktywne
	on public.crm_klucze_integracji (tenant_id, zakres) where wylaczony_at is null;

comment on column public.crm_klucze_integracji.zakres is
	'zgloszenia = arkusz zgłoszeń (prefiks crmzg_); asystent_ai = worker konsultacji AI (prefiks crmai_), tylko wysyłka wniosku online.';
