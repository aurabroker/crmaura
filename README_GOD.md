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
| Excel import | SheetJS (`xlsx`) |

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
      saas-admin/           # SaaS admin (ADMIN GOD only)
```

---

## Model danych (kluczowe tabele)

### `crm_policies`
Polisy ubezpieczeniowe. Pola niestandardowe:
- `typ_umowy`: `jednostkowa` | `generalna`
- `ug_podtyp`: `flota` | `gwarancje` | `cpm` | `car_ear` | `oc_beauty`
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

## APK — Analiza Potrzeb Klienta

System APK działa na dwóch poziomach:
- **React app** (zewnętrzna, `https://apk.aurabroker.pl`) — klient wypełnia formularz przez link z tokenem
- **FRANK67 CRM** — zarządzanie formularzami, generowanie linków, PDF

### Przepływ
1. Doradca tworzy APK w CRM (`/apk` lub zakładka APK w profilu klienta)
2. CRM generuje token (`apk_tokens`) i link `https://apk.aurabroker.pl?token=XXXXX`
3. Klient wypełnia formularz w React app → dane zapisują się w `apk_forms.form_data`
4. Status zmienia się na `submitted`
5. Doradca może wygenerować PDF → uploadowany do `apk-pdfs` bucket, URL zapisany w `apk_forms.pdf_url`

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
