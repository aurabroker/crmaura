# Aura Security Audit

Read-only audyt bezpieczeństwa współdzielonej bazy **Supabase/Postgres**. Wykrywa
dokładnie te klasy problemów, które znaleziono w audycie z 2026-06-18 — i pilnuje,
żeby nie wróciły (regresje wychwytuje CI).

> **Read-only.** Narzędzie niczego nie zmienia w bazie. Zwraca raport z gotowymi
> poleceniami naprawczymi, które uruchamiasz świadomie i osobno.

## Co sprawdza

| check_id | severity | opis |
|---|---|---|
| `RLS_ANON_ALWAYS_TRUE` | CRITICAL / HIGH | polityki RLS otwarte dla `anon`/`public` (always-true) — wrogie inserty/odczyt |
| `TABLE_NO_RLS` | HIGH | tabela w `public` bez włączonego RLS |
| `RLS_NO_POLICY` | LOW | RLS włączone, ale brak polityki (deny-all — do przeglądu) |
| `DEFINER_NO_SEARCH_PATH` | MEDIUM | funkcja `SECURITY DEFINER` bez `search_path` |
| `DEFINER_ANON_EXECUTABLE` | MEDIUM | funkcja `SECURITY DEFINER` wykonywalna przez `anon` |
| `PUBLIC_BUCKET` | MEDIUM | publiczny bucket storage (sprawdź listowanie) |

## Trzy sposoby uruchomienia

**1. Szybko, dziś — SQL Editor / MCP.** Wklej `audit.sql` do Supabase SQL Editor
i uruchom. Dostajesz tabelę: `severity | check_id | object | detail | remediation`.

**2. CLI (nadaje się do CI):**
```bash
cd tools/security-audit
npm install
SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
  node run.mjs                 # raport czytelny
node run.mjs --json            # JSON (do dalszego przetwarzania / dashboardu)
node run.mjs --fail-on=high    # exit 1 przy CRITICAL+HIGH (domyślnie: critical)
```
Connection string: **Supabase → Project Settings → Database → Connection string (URI)**.
Trzymaj jako sekret serwerowy — **nigdy** z prefiksem `VITE_`.

**3. GitHub Action** (`.github/workflows/security-audit.yml`): nocny cron + na każdym
PR do `main`. Wymaga sekretu repo/org `SUPABASE_DB_URL`. PR psuje się tylko przy
nowym `CRITICAL`.

## Allowlista (świadome wyjątki)

Część publicznych odczytów jest zamierzona (cenniki, katalog placówek do
porównywarek). Dopisz je w CTE `allowlist` w `audit.sql`, np.:
```sql
('pakiety','RLS_ANON_ALWAYS_TRUE'),
```
Wyciszone wpisy nie pojawią się w raporcie ani nie zepsują CI.

## Mapowanie właściciela (`owners.json`)

Baza jest współdzielona przez ~30 aplikacji. `owners.json` mapuje prefiks tabeli na
repo, więc raport CLI pokazuje `(repo: APK)` / `(repo: udapp)` — od razu wiadomo,
która sesja/zespół ma naprawić dany wpis. Uzupełniaj wg potrzeb.

## Roadmap (kolejne fazy)

- **F2:** baseline + `diff` względem poprzedniego skanu (raport pokazuje tylko *nowe*
  naruszenia), alert e-mail/Slack na regresji.
- **F2:** reguły konfiguracji przez Management API (leaked-password protection, MFA,
  czas życia JWT, otwarte signupy).
- **F3:** reguły statyczne kodu/repo (`VITE_…SERVICE_ROLE`, edge functions
  `verify_jwt:false`, endpointy nadające role bez allowlisty).
- **F3:** dashboard w panelu SAAS Admin (`/saas-admin/security`, tylko `ADMIN GOD`),
  sygnalizacja świetlna per-moduł, skan na żądanie.
