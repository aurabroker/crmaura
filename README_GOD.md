# FRANK67 CRM — README GOD

> Wewnętrzna dokumentacja systemu. Zawiera pełną architekturę, konwencje, decyzje projektowe i instrukcje dla developerów.

---

## Stack

| Warstwa | Technologia |
|---|---|
| Frontend | SvelteKit 5 + Svelte 5 Runes (`$state`, `$derived`, `$effect`) |
| Styling | Tailwind CSS v4 |
| Backend / DB | Supabase (PostgreSQL 17, RLS, Edge Functions) |
| Auth | Supabase Auth |
| Storage | Supabase Storage (bucket: `apk-pdfs`) |
| Deploy | Cloudflare (adapter-cloudflare) |
| PDF | jsPDF + jspdf-autotable |
| Excel import | SheetJS (`xlsx`) — ładowany dynamicznie (`await import('xlsx')`) |
| Email | Resend API — per tenant, klucz w `crm_tenants.resend_api_key` |

### Wersja

Numer wersji CRM jest w `package.json` (`version`) i widać go przy nagłówku „Pulpit …” (po najechaniu:
data builda i commit). **Każde wdrożenie na main podnosi wersję**; środkowa liczba = numer PR
(np. PR #31 → `1.31.0`, kolejna poprawka w tym samym PR → `1.31.1`). Plik `package-lock.json` ma ten sam numer.

---

## Struktura projektu

```
src/
  lib/
    components/
      PolicyForm.svelte     # Formularz polisy (nowa + edycja)
      Modal.svelte
      Badge.svelte
    stores/
      app.svelte.ts         # Globalny stan aplikacji ($state)
    types/
      database.ts           # TypeScript interfejsy dla wszystkich tabel
    utils/
      index.ts              # fmtPln, todayStr, policyStatus
      apkPdf.ts             # Generowanie i upload PDF z APK
    supabase.ts             # Klient Supabase
  routes/
    (app)/
      +layout.svelte        # Auth guard, ładowanie danych, nawigacja
      dashboard/            # Pulpit z widgetami
      clients/              # Lista klientów + profil klienta (zakładki)
      policies/             # Lista polis (drzewo UG / widok płaski)
        new/                # Nowa polisa
        [id]/               # Szczegóły polisy
        [id]/edit/          # Edycja polisy
      payments/             # Płatności + import rozliczenia ERGO (XLSX)
      apk/                  # Formularze APK (lista + tworzenie)
      commission/           # Prowizje brokerów
      finance/              # Rozliczenia finansowe
      renewals/             # Odnowienia polis
      prospects/            # Prospekty / leady
      claims/               # Szkody
      vehicles/             # Pojazdy
      knf-report/           # Raporty KNF
      settings/             # Ustawienia
      admin/                # Administracja (ADMIN BROKER)
      saas-admin/           # SaaS admin (ADMIN GOD only) — tenanci, funkcje, Resend keys
```

---

## Model danych (kluczowe tabele)

### `crm_policies`
Polisy ubezpieczeniowe. Pola niestandardowe:
- `typ_umowy`: `jednostkowa` | `generalna`
- `ug_podtyp`: `flota` | `gwarancje` | `cpm` | `car_ear` | `oc_beauty` | `beauty_tax`
- `rodzaj`: `majątkowa` | `życie` | `grupowe_medyczne` | `grupowe_życie` | `utrata_dochodu` | `komunikacja` | `flota` | `finansowa` | `OC` | `techniczna` | `karno_skarbowa` | `polisa_obca` | `umowa_generalna_*`
- `parent_id` → FK do `crm_policies.id` (polisa podpięta pod UG)
- `daty_rat`: string CSV dat płatności rat, np. `"2025-01-25, 2025-02-25"`
- `kwoty_rat`: string CSV kwot rat, np. `"500.00, 500.00"`
- `przedmiot`: tekst lub JSON (`{"__ud":true,"ctn":...,"ctc":...,"si":...}`) dla Utraty Dochodu
- `skladka_zainkasowana`, `prowizja_zainkasowana` — **automatycznie przeliczane przez DB trigger** `trg_recalc_zainkasowane` na podstawie opłaconych rat w `crm_policy_payments`

### `crm_policy_payments`
Raty płatności polis.
- `status`: `Oczekująca` | `Opłacona` | `Zaległa` | `Częściowo opłacona`
- `nota_id` → FK do `crm_noty` (powiązanie z rozliczeniem ERGO)
- `prowizja_z_noty` — prowizja wynikająca z noty TU
- Zmiana `status` lub `kwota` → trigger automatycznie aktualizuje `crm_policies`

### `crm_tenants`
Konfiguracja tenantów SaaS.
- `features`: JSONB — opcjonalne funkcje per tenant (`gwarancje`, `kalendarz`)
- `resend_api_key`: klucz API Resend do wysyłki przypomnień e-mail

### `crm_rodo_texts`
Treści zgód RODO per tenant. Pola: `key`, `label`, `tresc`, `required`, `aktywna`.

### `crm_noty`
Zestawienia prowizyjne importowane z XLSX (np. ERGO).

### `apk_forms`
Formularze APK (Analiza Potrzeb Klienta) powiązane z klientami CRM.
- `tenant_id`, `klient_id` — powiązanie z CRM
- `pdf_url` — URL do wygenerowanego PDF w Supabase Storage
- `form_data` — JSON z odpowiedziami klienta (wypełniany w React app)

### `apk_tokens`
Jednorazowe tokeny dostępu do formularzy APK (ważne 30 dni).

### `apk_audit`
Log zdarzeń APK (created, submitted, itp.).

---

## Multi-tenancy

Każda tabela ma kolumnę `tenant_id`. RLS (Row Level Security) filtruje dane przez funkcję `get_my_tenant_id()`. Użytkownik widzi tylko dane swojego tenanta.

`crm_profiles` ładowane w layout z filtrem `.eq('tenant_id', profile.tenant_id)` — brak wycieku cross-tenant.

### Funkcje opcjonalne per tenant
Pole `features` (JSONB) w `crm_tenants`. Włączane przez ADMIN GOD w `/saas-admin`:
- `gwarancje` — moduł gwarancji ubezpieczeniowych
- `kalendarz` — kalendarz i zadania

### Role użytkowników
| Rola | Uprawnienia |
|---|---|
| `ADMIN GOD` | Pełny dostęp + SaaS admin panel |
| `ADMIN BROKER` | Administracja swojego tenanta |
| `BOARD` | Widok zarządczy |
| `ADMINISTRACJA` | Obsługa operacyjna |
| `BROKER` | Obsługa polis, szkód, klientów |

Funkcje pomocnicze: `isAdmin()`, `isBroker()`, `isFinance()` w `app.svelte.ts`.

---

## Globalny stan — `appState`

Jeden reaktywny obiekt `$state` ładowany przy logowaniu w `+layout.svelte`:

```ts
appState.clients        // crm_clients
appState.policies       // crm_policies (z join crm_clients, crm_insurers)
appState.payments       // crm_policy_payments
appState.annexes        // crm_policy_annexes
appState.claims         // crm_claims
appState.vehicles       // crm_vehicles
appState.insurers       // crm_insurers
appState.brokers        // crm_profiles
appState.apkForms       // apk_forms (z join crm_clients)
appState.profile        // zalogowany użytkownik
appState.tenantTyp      // 'broker' | 'agent' | ...
appState.tenantNazwa    // nazwa firmy tenanta
```

---

## PolicyForm — kluczowe zachowania

1. **Kolejność sekcji**: UG/Rodzaj → Klient/TU → Nr/Przedmiot → Daty → **Dane Finansowe** → Raty

2. **Auto-fill TU z UG**: Wybór UG (`parent_id`) natychmiast ustawia `fpTu` i blokuje pole TU do edycji. Zmiana TU możliwa tylko w panelu samej UG.

3. **Auto-fill prowizji z UG**: `onchange` na selekcie UG ustawia `fpProwPct` z `ug_default_prowizja_pct`. Prowizja PLN przeliczana automatycznie.

4. **Auto-fill kwot rat**: Zmiana składki lub liczby rat → wszystkie kwoty rat przeliczane równo (`składka / n`). Zmiana tylko `data_od` → wypełniane tylko puste sloty dat.

5. **Wykrywanie zmiany liczby rat**: `_prevN` (zwykła zmienna, nie `$state`) śledzi poprzednią wartość. Zmiana n → przelicz wszystkie daty od nowa. Tylko `data_od` zmieniona → wypełnij puste.

6. **Utrata dochodu**: `rodzaj = utrata_dochodu` → pole Przedmiot zastępowane 3 polami kwot (CTN, CTC, SI). Dane serializowane do JSON w kolumnie `przedmiot`. TU ograniczone do CEU i Leadenhall.

7. **Edycja polisy**: Płatności `Opłacona` / `Częściowo opłacona` **nie są usuwane** przy regeneracji rat. Usuwane i regenerowane tylko `Oczekujące` i `Zaległe`.

---

## Import ERGO (XLSX)

Strona `/payments` obsługuje import rozliczenia prowizyjnego z TU ERGO:

1. Wgraj plik `.xlsx` → parser czyta nagłówki, numer noty, dane polis
2. Mapowanie: `nr_polisy` → `crm_policies`
3. Porównanie prowizji: różnica < 0.05 zł → `Opłacona`, inaczej → `Częściowo opłacona`
4. Polisy nieznalezione → wyświetlane jako `not_found`
5. Już rozliczone → pomijane (`already_settled`)
6. Zapis: INSERT do `crm_noty` + UPDATE `crm_policy_payments` (status, kwota, prowizja_z_noty, nota_id, data_oplacenia)
7. **Cofnięcie**: przycisk "↩ Cofnij" resetuje ratę do `Oczekująca` (trigger DB automatycznie aktualizuje polisę)

---

## Email — przypomnienia o płatnościach

Supabase Edge Function `send-payment-reminders` wysyła przypomnienia przez Resend API.

- Uruchamia ją pg_cron codziennie o 6:05 UTC (8:05 latem, 7:05 zimą) przez funkcję SQL
  `public.crm_send_payment_reminders()` z nagłówkiem `x-cron-token` (sekret `edge_cron_token` w Vault,
  sprawdzany przez `edge_cron_token_matches`). Bez poprawnego tokenu funkcja nic nie czyta.
- Wysyła tylko firma, która ma w SAAS Admin **klucz Resend** i **adres nadawcy** (`crm_tenants.email_from`,
  domena zweryfikowana w Resend tej firmy).
- Bierze raty `status = 'Oczekująca'` z terminem od dziś do +7 dni (czas polski), z nieusuniętych polis,
  bez `przypomnienie_wyslane_at`. Jedna wiadomość na adres klienta, z listą jego rat.
- Każda rata dostaje przypomnienie raz: znacznik `przypomnienie_wyslane_at` ustawiany przed wysyłką,
  zdejmowany, gdy Resend odmówi. Zaległych rat automat nie przypomina.
- Próba bez wysyłki: `select public.crm_send_payment_reminders(true);`, wynik w `net._http_response`.
- Migracja: `supabase/migrations/20261007000002_payment_reminders.sql`.

---

## APK — Analiza Potrzeb Klienta

Cały system APK mieszka w CRM (domena `portal.beautypolisa.eu`):
- **Publiczny formularz** — trasa `/form?token=…` (`src/routes/form/+page.svelte`); czyta i zapisuje
  wyłącznie przez funkcje bazy `get_apk_by_token` i `submit_apk`, tabele `apk_*` nie są publicznie dostępne
- **CRM** — zarządzanie formularzami, generowanie linków, PDF

Adres linków jest w jednym miejscu: `src/lib/utils/apkLink.ts` (`APK_FORM_URL`, nadpisywany zmienną
`VITE_APK_FORM_URL`). Dawna aplikacja `apk.aurabroker.pl` nie istnieje.

### Przepływ
1. Doradca tworzy APK w CRM (`/apk` lub zakładka APK w profilu klienta)
2. CRM generuje token (`apk_tokens`) i link `https://portal.beautypolisa.eu/form?token=XXXXX`
3. Klient wypełnia formularz → dane zapisują się w `apk_forms.form_data` (funkcja `submit_apk`)
4. Status zmienia się na `submitted`
5. Doradca może wygenerować PDF → uploadowany do `apk-pdfs` bucket, URL zapisany w `apk_forms.pdf_url`

---

## Odnowienia polis OC beauty

Program ERGO Hestia WA50/003353/24/A (certyfikaty = polisy z `parent_id` wskazującym umowę generalną
z `ug_podtyp = 'oc_beauty'`). Klient dostaje link do wniosku, wypełnia APK (albo świadomie jej odmawia),
wybiera: odnowienie bez zmian / ze zmianami / rezygnacja; przy zabiegach z listy wyłączeń — ankieta ERGO Hestii
z załącznikami (dyplom, certyfikat szkolenia z ostatnich 12 miesięcy, wzory zgód).

- **Link**: `/odnowienie/<id>.<podpis HMAC>` — podpis liczy serwer (`src/lib/server/renewals.ts`), w bazie go nie ma.
  Ważny do końca ochrony (min. 14 dni). Anulowanie/zastąpienie wniosku unieważnia link.
- **Strona klienta**: `src/routes/odnowienie/[klucz]` ↔ `src/routes/api/odnowienie/[klucz]` (kontrakt: `src/lib/renewals/api.ts`).
  Klient nie ma konta ani dostępu do bazy; pliki wgrywa przez jednorazowe podpisane adresy do bucketu `renewal-files`.
- **Reguły programu** (taryfa, listy zabiegów, pytania APK, walidacja, wycena): `src/lib/renewals/program.ts` — wspólne
  dla strony i serwera. Wyższa suma: składka z tabeli programu wg rodzaju gabinetu (z APK) i liczby osób (+25% przy 6–8,
  powyżej 8 — wycena indywidualna); ochrona prawna +92 zł.
- **Po złożeniu**: PDF (`renewalDocs.ts`, czcionka Roboto) w `renewal-files/<tenant>/<id>/wniosek-odnowienia.pdf`, e-mail do
  klienta i do biura (`RENEWAL_OFFICE_EMAIL`, domyślnie odnowienia@auraexpert.pl) z PDF i załącznikami, zadanie w CRM dla
  opiekuna klienta. Dziennik: `crm_renewal_events` (otwarcie, APK/odmowa z IP i przeglądarką, złożenie, wysyłki, błędy).
- **CRM**: karta polisy → „Odnów polisę” → wysyłka e-mailem albo link; panel statusu wniosku; kolumna na liście wznowień.
- **Automat**: pg_cron `crm-renewals` (codziennie 6:20 UTC) → `https://crmaura.pages.dev/api/cron/renewals` z `x-cron-token`
  (nie przez portal.beautypolisa.eu — ochrona Cloudflare przed botami zwraca bazie 403; linki w e-mailach i tak na portal): wygaszanie,
  zaproszenia 45 dni przed końcem (moduł `odnowienia_auto` w SAAS Admin), jedno przypomnienie po 7 dniach.
- **Wysyłka**: klucz Resend firmy (SAAS Admin), nadawca `RENEWAL_EMAIL_FROM` (domyślnie BeautyPolisa <odnowienia@beautypolisa.eu>).
- **Tryb testowy**: moduł `odnowienia_test` (SAAS Admin) — każdy e-mail odnowień (zaproszenie, przypomnienie,
  potwierdzenie, kopia do biura) idzie na `RENEWAL_TEST_EMAIL` (domyślnie zarzad@auraexpert.pl) z „[TEST]” w temacie;
  zadanie w CRM też ma „[TEST]”. Wniosek utworzony w trybie testowym ma adres testowy zamiast adresu klienta (zdarzenie
  `tryb_testowy`), więc nie napisze do klienta także po wyłączeniu trybu. W trybie testowym automat 45 dni nie zakłada
  nowych wniosków (ponawia tylko niewysłane — na adres testowy). Karta CRM otwarta przy włączonym trybie wysyła
  `oczekiwany_test: true`; gdy tryb wyłączono w międzyczasie, serwer odpowiada 409 („odśwież stronę”).
  Po testach: wyłączyć moduł i usunąć wnioski testowe (`email` = adres testowy) — inaczej automat pominie te certyfikaty.
- Migracje: `supabase/migrations/20261007000003_renewals.sql`, `20261008000002_renewals_cron_url.sql` (obie zastosowane 2026-10-08).

---

## DB Trigger — automatyczne przeliczanie składek

```sql
-- trg_recalc_zainkasowane
-- Odpala po INSERT/UPDATE/DELETE na crm_policy_payments
-- Przelicza dla danej polisy:
--   skladka_zainkasowana = SUM(kwota) WHERE status IN ('Opłacona', 'Częściowo opłacona')
--   prowizja_zainkasowana = SUM(prowizja_z_noty ?? kwota * prowizja_pct%) WHERE paid
```

Nie trzeba ręcznie aktualizować `crm_policies` po zmianie statusu raty — trigger robi to automatycznie.

---

## Konwencje kodu

- **Svelte 5 runes wszędzie** — `$state`, `$derived`, `$effect`. Nie używać `writable`, `readable`.
- **`untrack()`** — gdy efekt czyta I pisze do tego samego `$state`, użyj `untrack(() => value)` przy odczycie żeby uniknąć nieskończonej pętli.
- **Dropdowny** — wzorzec `onfocusout` + `e.currentTarget.contains(e.relatedTarget)` + `tabindex="0"` na przyciskach. NIE używać `onblur` + timeout (race condition).
- **Brak komentarzy** w kodzie poza nieoczywistymi przypadkami.
- **Modalne edycje** — każda edycja ma osobną stronę (`/edit`) a nie modal na stronie szczegółów.

---

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

Zmienne środowiskowe (`.env`):
```
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_ANON_KEY=...
```

## Build

```bash
npm run build       # Cloudflare adapter
npm run preview     # Podgląd produkcyjny lokalnie
```
