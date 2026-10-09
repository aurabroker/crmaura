# Schemat bazy danych — dokumentacja

| Plik | Zawartość |
|------|-----------|
| `crm-schema.json` | Pełna konstrukcja tabel SQL obsługujących CRM w formacie JSON |
| `crm-audit.json` | Audyt SQL bazy (bezpieczeństwo, integralność, jakość danych, wydajność) z dowodami i gotowymi poprawkami |
| `introspect.sql` | Zapytania introspekcyjne, którymi plik JSON został wygenerowany |

## Co jest w `crm-audit.json`

Stan na 2026-10-06. Każde ustalenie w `ustalenia` ma: `id`, `waga`
(krytyczna → informacyjna), `kategoria`, `obiekty`, `dowod` (zapytanie i jego
wynik — wyłącznie liczniki, bez danych osobowych), `skutek` i `naprawa` (opis,
ewentualny `warunek` do sprawdzenia przed wdrożeniem oraz `sql`). Sekcja
`kolejnosc_napraw` układa poprawki w kroki z uzasadnieniem kolejności.

Dowody pochodzą z introspekcji, Supabase Database Advisors oraz symulacji ról
(anon, konto spoza CRM, ADMIN GOD) w transakcjach wycofywanych. Wszystkie
fragmenty SQL przeszły parser PostgreSQL 17, a nazwy usuwanych polityk
sprawdzono z bazą. **Żadna poprawka nie została zastosowana** — to decyzja do
podjęcia, część z nich ma warunki zależne od aplikacji APK.

## Co jest w `crm-schema.json`

49 tabel i 1 widok z prefiksami `crm_`, `bond_` i `apk_` (523 kolumny) — komplet
relacji, na których opiera się aplikacja SvelteKit. Dla każdej tabeli:

- **`kolumny`** — typ, `NOT NULL`, `DEFAULT`, opis biznesowy
- **`klucze_obce`**, **`unikalne`**, **`check`**, **`indeksy`**
- **`polityki_rls`** — pełne wyrażenia `USING` i `WITH CHECK`
- **`wyzwalacze`** — co robią i którą funkcję wołają
- **`wierszy`** — liczba rekordów w momencie generowania (kontekst skali)
- **`uzywana_w_aplikacji`** — czy kod w `src/` faktycznie z niej korzysta

Sekcje zbiorcze: `moduly` (podział funkcjonalny), `slowniki` (wszystkie zbiory
wartości wraz ze wskazaniem, czy wymusza je `CHECK`, czy tylko kod), `funkcje`
(pomocnicze funkcje RLS i wyzwalaczy), `relacje` (89 krawędzi FK jako płaska
lista — gotowe pod generator ERD), `storage` oraz `niespojnosci`.

## Skąd pochodzą dane

Z **introspekcji produkcyjnej bazy** projektu Supabase `aurabroker`, nie z
katalogu `supabase/migrations/`. Migracje w repo pokrywają wyłącznie zmiany od
2026-06-05 (26 plików), podczas gdy `supabase_migrations.schema_migrations`
w bazie zawiera 130 wersji — większość tabel powstała wcześniej w panelu
Supabase. Odtworzenie schematu z samych plików w repo nie jest możliwe.

## Odświeżenie po zmianie schematu

1. Uruchom zapytania z `introspect.sql` na bazie (SQL Editor albo `psql`).
2. Nanieś różnice w `crm-schema.json` i zaktualizuj `meta.wygenerowano`.
3. Sprawdź zgodność zapytaniem 12 z `introspect.sql` — zwraca md5 posortowanych
   nazw kolumn każdej tabeli. Ten sam skrót policzony z pliku JSON musi się
   zgadzać:

   ```bash
   node -e "
   const c=require('crypto'),j=require('./docs/db/crm-schema.json');
   for(const [t,d] of Object.entries(j.tabele))
     console.log(t, c.createHash('md5')
       .update(d.kolumny.map(k=>k.nazwa).sort().join(',')).digest('hex'));
   "
   ```

## Uwaga

Sekcja `niespojnosci` wskazuje rozjazdy między bazą, migracjami i kodem —
m.in. politykę RLS `apk_forms_select_auth` z warunkiem `USING true`, która
otwiera formularze APK wszystkich najemców każdemu zalogowanemu użytkownikowi.
