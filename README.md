# AuraCRM — System CRM dla Brokerów Ubezpieczeniowych

> **Multi-tenant SaaS CRM** dedykowany kancelariom i firmom brokerskim.  
> Zarządzanie polisami, klientami, szkodami, płatnościami składek i zespołem — w jednym miejscu.

---

## Spis treści

1. [Opis produktu](#opis-produktu)
2. [Stack technologiczny](#stack-technologiczny)
3. [Architektura](#architektura)
4. [Baza danych](#baza-danych)
5. [Bezpieczeństwo i multi-tenancy](#bezpieczenstwo-i-multi-tenancy)
6. [Moduły systemu](#moduly-systemu)
7. [Role użytkowników](#role-uzytkownikow)
8. [Deployment](#deployment)
9. [Zmienne środowiskowe](#zmienne-srodowiskowe)
10. [Lokalne uruchomienie](#lokalne-uruchomienie)
11. [Struktura projektu](#struktura-projektu)
12. [Roadmap SaaS](#roadmap-saas)

---

## Opis produktu

AuraCRM to nowoczesny system CRM zaprojektowany z myślą o **kancelariach brokerskich i agentach ubezpieczeniowych**. System obsługuje pełen cykl życia polisy ubezpieczeniowej — od pozyskania klienta, przez wystawienie polisy i aneksów, kontrolę płatności składek, aż po obsługę szkód i raportowanie do KNF.

### Główne cechy

- **Multi-tenant** — każda firma brokerska ma własną, izolowaną przestrzeń danych
- **Role-based access control** — pięć poziomów uprawnień od brokera po administratora
- **Panel 360° klienta** — pełna historia klienta: polisy, pojazdy, szkody, saldo
- **Umowy Generalne** — obsługa flot, gwarancji, CPM i CAR-EAR z hierarchią aneksów
- **Kalendarz płatności** — kontrola rat składek z oznaczaniem opłaconych i zaległych
- **Personalizowany pulpit** — drag & drop widżety, wskaźnik skuteczności odnowień
- **Rejestr szkód** — pełna obsługa zgłoszeń z filtrowaniem po statusie
- **Raport KNF** — gotowy wydruk PDF zgodny z wymogami regulatora

---

## Stack technologiczny

| Warstwa | Technologia | Wersja |
|---------|-------------|--------|
| Framework | SvelteKit 5 (runes mode) | ^2.57.0 |
| UI Language | Svelte 5 | ^5.55.2 |
| Styling | Tailwind CSS v4 | ^4.3.0 |
| Backend / Auth / DB | Supabase | ^2.107.0 |
| Hosting | Cloudflare Pages | — |
| Adapter | @sveltejs/adapter-cloudflare | ^7.2.8 |
| Ikony | lucide-svelte | ^1.0.1 |
| Drag & Drop | svelte-dnd-action | ^0.9.69 |
| Build tool | Vite 8 | ^8.0.7 |
| Język | TypeScript | ^6.0.2 |

### Dlaczego ten stack?

- **SvelteKit 5 + runes** — reaktywność bez boilerplate, mały bundle, szybkie renderowanie
- **Tailwind CSS v4** — nowa architektura CSS-first, brak konfiguracji JS, szybszy build
- **Supabase** — PostgreSQL z wbudowaną autoryzacją, RLS na poziomie bazy, realtime, storage
- **Cloudflare Pages** — globalny CDN, edge functions, darmowy tier wystarczający na start
- **SSR wyłączony** — aplikacja działa jako SPA (CSR), brak problemów z hydracją przy Supabase Auth

---

## Architektura

```
┌─────────────────────────────────────────────────┐
│                  Cloudflare Pages                │
│  ┌─────────────────────────────────────────┐    │
│  │           SvelteKit 5 (CSR/SPA)         │    │
│  │                                         │    │
│  │  src/routes/                            │    │
│  │  ├── login/          <- publiczna       │    │
│  │  ├── (app)/          <- chroniona       │    │
│  │  │   ├── dashboard/                     │    │
│  │  │   ├── clients/[id]/  <- Panel 360°   │    │
│  │  │   ├── policies/                      │    │
│  │  │   ├── claims/                        │    │
│  │  │   ├── payments/                      │    │
│  │  │   ├── finance/                       │    │
│  │  │   ├── admin/                         │    │
│  │  │   └── knf-report/                    │    │
│  │  └── api/                               │    │
│  │      └── admin/      <- server endpoints│    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────┘
                          │ HTTPS / Supabase JS SDK
┌─────────────────────────▼───────────────────────┐
│                    Supabase                      │
│  ┌──────────────┐  ┌──────────────┐             │
│  │  PostgreSQL  │  │  Supabase    │             │
│  │  + RLS       │  │  Auth        │             │
│  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────┘
```

### Przepływ autoryzacji

1. Użytkownik loguje się przez `supabase.auth.signInWithPassword()`
2. JWT token jest przechowywany w `localStorage` (persisted session)
3. Layout guard (`(app)/+layout.svelte`) sprawdza sesję przy każdej nawigacji
4. Brak sesji → redirect na `/login`
5. Brak roli admina na chronionych stronach (admin, finance) → redirect na `/dashboard`
6. Wszystkie zapytania do bazy niosą JWT → RLS weryfikuje `tenant_id` automatycznie

---

## Baza danych

### Tabele

| Tabela | Opis |
|--------|------|
| `crm_tenants` | Firmy brokerskie (jeden rekord = jedna firma) |
| `crm_profiles` | Użytkownicy systemu z rolą i przynależnością do tenanta |
| `crm_clients` | Klienci (osoby fizyczne i prawne) |
| `crm_insurers` | Towarzystwa ubezpieczeniowe |
| `crm_policies` | Polisy ubezpieczeniowe (jednostkowe i Umowy Generalne) |
| `crm_policy_annexes` | Aneksy do polis (korekta, zmiana, rozszerzenie, wypowiedzenie) |
| `crm_policy_payments` | Raty składek z terminami i statusami płatności |
| `crm_claims` | Szkody / roszczenia |
| `crm_vehicles` | Pojazdy przypisane do klientów |
| `crm_apk_log` | Rejestr APK (analiza potrzeb klienta) |
| `crm_dashboard_prefs` | Preferencje pulpitu per użytkownik |

### Typy polis (`typ_umowy`)

| Wartość | Opis |
|---------|------|
| `jednostkowa` | Standardowa polisa dla klienta indywidualnego |
| `generalna` | Umowa Generalna — nadrzędna umowa ramowa |

### Podtypy Umowy Generalnej (`ug_podtyp`)

| Wartość | Opis |
|---------|------|
| `flota` | Ubezpieczenie floty pojazdów |
| `gwarancje` | Ubezpieczenia gwarancji kontraktowych |
| `cpm` | Contractor's Plant & Machinery — maszyny budowlane |
| `car_ear` | Contractor's All Risk / Erection All Risk — ryzyka budowy i montażu |

### Hierarchia polis

```
Umowa Generalna (typ_umowy = 'generalna')
└── Polisa certyfikatowa / jednostkowa (parent_id = id UG)
    └── Aneks (crm_policy_annexes)
        ├── korekta       -- nadpisuje dane polisy nadrzędnej
        ├── zmiana        -- zmiana warunków
        ├── rozszerzenie  -- rozszerzenie zakresu
        └── wypowiedzenie -- zakończenie umowy
```

### Statusy płatności (`crm_policy_payments.status`)

| Status | Opis |
|--------|------|
| `Oczekująca` | Termin jeszcze nie minął |
| `Opłacona` | Potwierdzona wpłata |
| `Zaległa` | Termin minął, brak wpłaty |

---

## Bezpieczenstwo i multi-tenancy

### Izolacja danych

Każda tabela zawierająca dane biznesowe posiada kolumnę `tenant_id` (UUID). Dostęp do danych jest ograniczony przez **Row Level Security (RLS)** na poziomie PostgreSQL.

### Funkcja pomocnicza SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM crm_profiles WHERE id = auth.uid()
$$;
```

Funkcja działa z podwyższonymi uprawnieniami, dzięki czemu użytkownik nie może jej ominąć. Jest wykorzystywana we wszystkich politykach RLS.

### Przykładowa polityka RLS

```sql
-- Użytkownik widzi tylko klientów swojego tenanta
CREATE POLICY "tenant_isolation" ON crm_clients
  FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());
```

### Operacje administracyjne (service_role)

Tworzenie kont użytkowników i zmiana ról wymagają klucza `service_role` (omija RLS). Klucz jest używany wyłącznie po stronie serwera w endpointach SvelteKit (`src/routes/api/admin/`), nigdy nie trafia do przeglądarki.

```
POST /api/admin/invite      <- tworzy konto + generuje tymczasowe hasło
POST /api/admin/update-role <- zmienia rolę / dane użytkownika
```

---

## Moduly systemu

### Pulpit (`/dashboard`)

- **Widżety drag & drop** — kolejność zapisywana w `crm_dashboard_prefs`
- **Dostępne widżety:**
  - Odnowienia — lista polis kończących się w ciągu 30 dni
  - Szkody aktywne — liczba otwartych szkód
  - Klienci — łączna liczba klientów
  - Wskaźnik odnowień — % polis wznowionych vs wygasłych w bieżącym roku
  - Zaległe płatności — lista przeterminowanych rat
- **Tryb konfiguracji** — toggle "Dostosuj pulpit" pokazuje checkboxy do włączania/wyłączania widżetów

### Klienci (`/clients`)

- Lista z wyszukiwaniem po nazwie i emailu
- Dodawanie / edycja klientów (osoby fizyczne i prawne)
- Klik w klienta → Panel 360°

### Panel 360° klienta (`/clients/[id]`)

Zakładki:
- **Polisy** — wszystkie polisy klienta z statusem i kwotą
- **Pojazdy** — flota z rejestracją, VIN, marką, modelem
- **Szkody** — historia zgłoszeń z inline edycją statusu
- **Saldo** — zestawienie składek i płatności

### Polisy (`/policies`)

- Widok listy z filtrem: Wszystkie / Jednostkowe / Generalne
- **Umowy Generalne** — rozwijane drzewo z podrzędnymi polisami
- Aneksy jako podwiersze z oznaczeniem delta (różnica składki)
- Dodawanie / edycja polisy przez modal z pełnym formularzem (`PolicyForm.svelte`)
- Typy aneksów: korekta (nadpisuje dane polisy), zmiana, rozszerzenie, wypowiedzenie
- Pola polis: nr polisy, TU, klient, produkt, daty, składka przypisana / zaliczkowa, ilość rat, broker opiekun

### Szkody (`/claims`)

- Rejestr wszystkich szkód w portfelu
- Filtry statusów: Zgłoszona / W toku / Wypłacona / Zakończona / Odmowa
- Wyszukiwarka po kliencie i numerze szkody
- Modal dodawania/edycji: klient, polisa, nr szkody w TU, data, opis, wartość roszczenia
- Badge counter w topbarze (aktywne szkody = Zgłoszona + W toku)

### Płatności (`/payments`)

- **Kalendarz rat** — grupowanie po dniach miesiąca
- Filtry: miesiąc, status (Oczekujące / Opłacone / Zaległe)
- Wyszukiwarka po kliencie i numerze polisy
- KPI summary: łącznie / opłacone / do zapłaty
- Akcje inline: **Opłacona** (zielony button) / **Zaległa** (czerwony border)
- Modal dodawania raty z auto-wypełnieniem kwoty z polisy (składka / ilość rat)

### Finanse (`/finance`)

- Tabela prowizji — dostępna dla ról z uprawnieniami finansowymi (ADMINISTRACJA, BOARD, ADMIN)
- Role-gated — pozostałe role widzą komunikat braku dostępu

### Administracja (`/admin`)

Dostępna tylko dla ról: `ADMIN GOD`, `ADMIN BROKER`, `BOARD`

**Sekcja TU (Towarzystwa Ubezpieczeniowe):**
- Dodawanie i edycja TU: nazwa, dział (Majątkowy/Życiowy), adres, NIP, KRS

**Sekcja Zespół:**
- Lista wszystkich użytkowników z rolami (kolorowe Badge)
- Edycja użytkownika: imię i nazwisko, rola, stanowisko
- **Dodaj użytkownika** → tworzy konto z losowym tymczasowym hasłem (12 znaków)
- Hasło wyświetlane adminowi — przekazuje je użytkownikowi, który zmienia je po zalogowaniu

### Raport KNF (`/knf-report`)

- Filtr dat (od/do)
- Tabela danych zgodna z wymogami regulatora
- Przycisk **Drukuj PDF** (browser print)

---

## Role uzytkownikow

| Rola | Opis | Uprawnienia |
|------|------|-------------|
| `BROKER` | Standardowy broker | Klienci, polisy, szkody, płatności |
| `ADMINISTRACJA` | Pracownik administracyjny | Jak BROKER + dostęp do finansów |
| `BOARD` | Zarząd | Jak ADMINISTRACJA + panel admin |
| `ADMIN BROKER` | Administrator firmy brokerskiej | Pełny dostęp + zarządzanie użytkownikami |
| `ADMIN GOD` | Administrator systemu (właściciel SaaS) | Pełny dostęp do wszystkiego |

### Hierarchia dostępu

```
ADMIN GOD
    └── ADMIN BROKER
            └── BOARD
                    └── ADMINISTRACJA
                                └── BROKER
```

Funkcje pomocnicze w `app.svelte.ts`:
- `isAdmin(profile)` — zwraca `true` dla: ADMIN GOD, ADMIN BROKER, BOARD
- `isFinance(profile)` — zwraca `true` dla: powyższe + ADMINISTRACJA

---

## Deployment

### Cloudflare Pages (produkcja)

Projekt deployowany automatycznie przy push na branch `main` przez integrację GitHub → Cloudflare Pages.

**Konfiguracja buildu w Cloudflare:**
- Build command: `npm run build`
- Build output directory: `.svelte-kit/cloudflare`
- Node.js version: 18+

**Wymagane zmienne środowiskowe (Cloudflare Pages → Settings → Environment variables):**

```
VITE_SUPABASE_URL              = https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY         = eyJ...
VITE_SUPABASE_SERVICE_ROLE_KEY = eyJ...  <- wymagany dla /api/admin/*
```

### Adapter

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-cloudflare';
```

---

## Zmienne srodowiskowe

| Zmienna | Wymagana | Opis |
|---------|----------|------|
| `VITE_SUPABASE_URL` | TAK | URL projektu Supabase |
| `VITE_SUPABASE_ANON_KEY` | TAK | Klucz publiczny (anon) Supabase |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | TAK* | Klucz service_role — wymagany dla endpointów admin |

*Bez `SERVICE_ROLE_KEY` panel admin działa, ale tworzenie kont i zmiana ról nie będzie działać.

---

## Lokalne uruchomienie

### Wymagania

- Node.js 18+
- Konto Supabase z skonfigurowanym projektem

### Instalacja

```bash
git clone https://github.com/aurabroker/crmaura.git
cd crmaura
npm install
```

### Konfiguracja

Utwórz plik `.env.local` w katalogu głównym projektu:

```env
VITE_SUPABASE_URL=https://twoj-projekt.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Uruchomienie

```bash
npm run dev        # dev server na http://localhost:5173
npm run build      # produkcyjny build
npm run preview    # podgląd builda lokalnie
npm run check      # TypeScript + Svelte type checking
```

---

## Struktura projektu

```
crmaura/
├── src/
│   ├── app.css                          # Tailwind v4 import + CSS custom properties
│   ├── app.html                         # HTML shell
│   ├── lib/
│   │   ├── supabase.ts                  # Klient Supabase + eksport SB_URL
│   │   ├── utils.ts                     # fmtPln, dateDiffDays, todayStr, policyStatus
│   │   ├── stores/
│   │   │   └── app.svelte.ts            # Globalny stan aplikacji ($state runes)
│   │   ├── types/
│   │   │   └── database.ts              # Interfejsy TypeScript dla tabel Supabase
│   │   └── components/
│   │       ├── Badge.svelte             # Kolorowy badge statusu
│   │       ├── Modal.svelte             # Modalne okno ze Snippet API (footer slot)
│   │       ├── KpiCard.svelte           # Karta KPI na pulpicie
│   │       └── PolicyForm.svelte        # Reużywalny formularz polisy (add/edit)
│   └── routes/
│       ├── +layout.ts                   # ssr=false, prerender=false
│       ├── login/
│       │   └── +page.svelte             # Strona logowania
│       ├── (app)/                       # Chroniona część aplikacji
│       │   ├── +layout.svelte           # Auth guard + ładowanie danych + topbar + sidebar
│       │   ├── dashboard/+page.svelte   # Pulpit z drag & drop widżetami
│       │   ├── clients/
│       │   │   ├── +page.svelte         # Lista klientów
│       │   │   └── [id]/+page.svelte    # Panel 360° klienta
│       │   ├── policies/+page.svelte    # Polisy + UG + aneksy
│       │   ├── claims/+page.svelte      # Rejestr szkód
│       │   ├── payments/+page.svelte    # Kalendarz płatności składek
│       │   ├── finance/+page.svelte     # Prowizje (role-gated)
│       │   ├── admin/+page.svelte       # TU + zarządzanie użytkownikami
│       │   └── knf-report/+page.svelte  # Raport KNF + druk PDF
│       └── api/
│           └── admin/
│               ├── invite/+server.ts    # POST: utwórz konto z temp hasłem
│               └── update-role/+server.ts # POST: zmień rolę użytkownika
├── svelte.config.js                     # adapter-cloudflare
├── vite.config.ts                       # @tailwindcss/vite plugin
├── tsconfig.json
└── package.json
```

---

## Roadmap SaaS

### Etap 1 — Rejestracja samoobsługowa

- [ ] Publiczna strona marketingowa / landing page
- [ ] Formularz rejestracji firmy brokerskiej (nazwa, NIP, email admina)
- [ ] Automatyczne tworzenie `tenant` + pierwszego konta `ADMIN BROKER`
- [ ] Strona `/register` i `/onboarding`

### Etap 2 — Płatności i subskrypcje

- [ ] Integracja Stripe Billing
- [ ] Plany subskrypcyjne (np. Starter / Pro / Enterprise — per liczba użytkowników)
- [ ] Webhook Stripe → aktywacja/blokada tenanta
- [ ] Strona zarządzania subskrypcją dla admina firmy
- [ ] Trial period (np. 14 dni bez karty)

### Etap 3 — Panel SAAS-ADMIN

- [ ] Widok wszystkich tenantów z metrykami
- [ ] Blokowanie / odblokowanie dostępu
- [ ] Impersonacja (zalogowanie się jako tenant do debugowania)
- [ ] Statystyki użycia (liczba polis, klientów, aktywnych userów)
- [ ] Zarządzanie planami i fakturami

### Etap 4 — Funkcje enterprise

- [ ] Własna domena dla tenanta (np. `crm.firmaxyz.pl`)
- [ ] White-label (logo i kolory firmy)
- [ ] Eksport danych (CSV, Excel, PDF)
- [ ] API REST dla integracji z zewnętrznymi systemami
- [ ] Powiadomienia email (przypomnienia o odnowieniach, zaległych płatnościach)
- [ ] Integracja z UFG (Ubezpieczeniowy Fundusz Gwarancyjny)

### Etap 5 — Ustawienia konta użytkownika

- [ ] Strona `/settings` — zmiana hasła, email, awatar
- [ ] Powiadomienia push / email per użytkownik
- [ ] Ustawienia językowe i strefy czasowej

---

## Kontakt

**Właściciel produktu:** Aura Broker  
**Email:** biuro@utratadochodu.com  
**Deployment:** https://crmaura.pages.dev

---

*Dokumentacja aktualna na dzień 2026-06-03*
