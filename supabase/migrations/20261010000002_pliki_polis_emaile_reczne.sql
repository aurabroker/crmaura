-- ============================================================
-- 1) Pliki polis (PDF) — treść w Cloudflare R2 (binding POLISY_PDF w Cloudflare Pages), tu tylko opis.
--    Zapisuje i usuwa wyłącznie serwer (service_role) po sprawdzeniu firmy użytkownika;
--    pracownicy firmy czytają listę. Klucz obiektu: <tenant_id>/<polisa_id>/<uuid>.pdf
-- 2) Historia e-maili: rodzaj „recznie” (wysłane z Panelu 360°), autor i nazwy załączników.
-- STATUS: ZASTOSOWANA na produkcji (sprawdzone 2026-10-10: tabela z RLS i polityką odczytu, kolumny e-maili, nowy check rodzaju).
-- ============================================================

create table if not exists public.crm_policy_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id),
  polisa_id uuid not null references public.crm_policies(id) on delete cascade,
  rodzaj text not null default 'polisa' check (rodzaj in ('polisa', 'aneks', 'owu', 'inne')),
  nazwa text not null check (length(nazwa) between 1 and 255),
  klucz text not null unique check (length(klucz) <= 400),
  rozmiar bigint not null check (rozmiar > 0),
  typ text not null default 'application/pdf',
  zrodlo text not null default 'recznie' check (zrodlo in ('import_pdf', 'recznie')),
  dodal uuid references public.crm_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_policy_files_polisa_idx on public.crm_policy_files (polisa_id, created_at desc);
create index if not exists crm_policy_files_tenant_idx on public.crm_policy_files (tenant_id);

alter table public.crm_policy_files enable row level security;
revoke all on public.crm_policy_files from anon, authenticated;
grant select on public.crm_policy_files to authenticated;

drop policy if exists crm_policy_files_tenant_select on public.crm_policy_files;
create policy crm_policy_files_tenant_select on public.crm_policy_files
  for select to authenticated using (tenant_id = (select get_my_tenant_id()));

alter table public.crm_client_emails drop constraint if exists crm_client_emails_rodzaj_check;
alter table public.crm_client_emails add constraint crm_client_emails_rodzaj_check
  check (rodzaj in ('przypomnienie_platnosci', 'odnowienie', 'recznie', 'inne'));
alter table public.crm_client_emails add column if not exists autor_id uuid references public.crm_profiles(id) on delete set null;
alter table public.crm_client_emails add column if not exists zalaczniki text[] not null default '{}';
