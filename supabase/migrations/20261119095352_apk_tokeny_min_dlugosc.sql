-- ============================================================
-- APK: nowe tokeny linków muszą mieć co najmniej 22 znaki (>= 128 bitów).
-- STATUS: ZASTOSOWANA na produkcji 19.11.2026 (MCP apply_migration, wersja 20261119095352;
-- treść funkcji md5 9c948fa64a301bff31a261f10d4f880d = ten plik). supabase/tests/apk_tokeny.sql
-- na produkcji: 40/40 (z dwoma przypadkami wyzwalacza), dane testowe wycofane.
--
-- KOLEJNOŚĆ (dotrzymana): najpierw CRM v1.98.1 (#105, wdrożony 18.11.2026 19:24 UTC),
-- w którym newApkToken (src/lib/utils/apkLink.ts) generuje 26 znaków; oba miejsca
-- tworzące link (apk/+page.svelte, clients/[id]/+page.svelte) go używają, żadna funkcja
-- w bazie nie wstawia do apk_tokens. Zastosowana wcześniej — CRM z 12-znakowym tokenem
-- nie utworzyłby nowego linku APK (błąd przy zapisie). Przed zastosowaniem:
-- select max(created_at) from apk_tokens where length(token) < 22; → 2026-10-09,
-- zero krótkich tokenów po wdrożeniu CRM.
--
-- Dlaczego wyzwalacz, a nie CHECK … NOT VALID: ograniczenie NOT VALID i tak sprawdza
-- każdy UPDATE, a submit_apk przy wysyłce aktualizuje wiersz tokenu (status 'used').
-- Klient ze starym 12-znakowym linkiem nie mógłby wtedy wysłać formularza.
-- Wyzwalacz pilnuje tylko INSERT; stare tokeny działają do wygaśnięcia (najpóźniej
-- 90 dni — ograniczenie apk_tokens_expires_at_max_90d). Potem można go zamienić na
-- zwykły CHECK (length(token) >= 22).
-- ============================================================

create or replace function public.apk_tokens_min_dlugosc()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token is null or length(new.token) < 22 then
    raise exception 'APK: token linku musi mieć co najmniej 22 znaki (zostaw pole puste, baza nada token)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.apk_tokens_min_dlugosc() from public, anon, authenticated;

drop trigger if exists apk_tokens_min_dlugosc_trg on public.apk_tokens;
create trigger apk_tokens_min_dlugosc_trg
  before insert on public.apk_tokens
  for each row execute function public.apk_tokens_min_dlugosc();

-- Weryfikacja (oczekiwane: błąd check_violation dla krótkiego tokenu, sukces bez tokenu):
--   begin;
--   insert into public.apk_tokens (token, status) values ('KROTKI123456', 'pending');  -- błąd
--   rollback;
--
-- ROLLBACK:
--   drop trigger if exists apk_tokens_min_dlugosc_trg on public.apk_tokens;
--   drop function if exists public.apk_tokens_min_dlugosc();
