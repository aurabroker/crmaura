-- ============================================================
-- Codzienne podsumowanie na e-mail pracownika (Ustawienia → Powiadomienia).
-- Jedna subskrypcja na pracownika: godzina (czas Warszawy), wybrane sekcje, „pomiń, gdy nic nowego”.
-- Czyta i zapisuje wyłącznie serwer (API /api/podsumowanie po zalogowaniu; automat kluczem service_role),
-- adres odbiorcy to zawsze e-mail z profilu pracownika. Automat co godzinę (7 min po pełnej) wysyła
-- podsumowania tym, których godzina właśnie wybiła i którzy dziś jeszcze go nie dostali.
-- ============================================================

create table if not exists public.crm_podsumowania (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id),
  profile_id uuid not null unique references public.crm_profiles(id) on delete cascade,
  godzina smallint not null default 7 check (godzina between 0 and 23),
  sekcje jsonb not null default '{}'::jsonb,
  aktywne boolean not null default true,
  pomin_puste boolean not null default false,
  ostatnio_wyslano_at timestamptz,
  ostatni_blad text check (length(ostatni_blad) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_podsumowania_godzina_idx on public.crm_podsumowania (godzina) where aktywne;

alter table public.crm_podsumowania enable row level security;
revoke all on public.crm_podsumowania from anon, authenticated;

-- Automat: co godzinę, 7 minut po pełnej (serwer sam dobiera, komu wysłać według godziny warszawskiej).
create or replace function public.crm_run_podsumowania()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://crmaura.pages.dev/api/cron/podsumowanie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_cron_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$;
revoke all on function public.crm_run_podsumowania() from public, anon, authenticated;

select cron.schedule('crm-podsumowania', '7 * * * *', 'select public.crm_run_podsumowania()');
