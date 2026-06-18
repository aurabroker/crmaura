# 🔐 SECURITY HANDOFF — domknięcie audytu (punkty 1–3)

> Dokument przeznaczony do **nowej sesji Claude Code** uruchomionej z dostępem do
> repozytoriów `aurabroker/APK` i `aurabroker/udapp` (oraz najlepiej `aurabroker/crmaura`).
> Świeża sesja nie pamięta poprzedniej rozmowy — **cała wiedza o zadaniu jest tutaj.**

- **Data audytu:** 2026-06-18
- **Projekt Supabase:** `aurabroker` — `project_id = kukvgsjrmrqtzhkszzum` (region eu-west-1)
- **Baza jest WSPÓŁDZIELONA** przez wiele aplikacji (CRM, APK, udochodu, beauty, bonds…).
  Zmiany RLS dotykają wszystkich — testuj, zanim usuniesz polityki anon.

---

## ✅ Co już zrobiono (w repo `crmaura`, branch `claude/wonderful-carson-ural1y`)

Commit `security: utwardzenie SaaS …`. Migracja: `supabase/migrations/20260618000000_security_hardening_anon_policies.sql` (zastosowana na produkcji).

- Blokada eskalacji uprawnień do `ADMIN GOD` (`assertAssignableRole` w `src/lib/server/auth.ts`, użyte w `api/admin/update-role` i `api/admin/invite`).
- Turnstile w `/api/register` (serwer + widget).
- README: usunięta mina `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- RLS: usunięta anon zmiana cen (`pakiety`), anon odczyt PII (`mienie_wnioski`), zawężone `apk_forms`/`apk_tokens` (delete/update do tenanta; anon nie rusza użytego tokenu), `apk_audit` insert tylko zalogowani, wyłączone anon listowanie bucketu `apk-pdfs`, `search_path` na funkcjach SECURITY DEFINER.

---

## 🎯 TODO w nowej sesji — punkty 1–3 (NIE zrobione, wymagają repo APK/udapp)

### Problem, który domykamy
Tabele `apk_forms` i `apk_tokens` mają nadal polityki **anon SELECT `USING(true)`** oraz **anon UPDATE**, bo żywy publiczny formularz APK (React app `apk.aurabroker.pl` = repo `aurabroker/APK`, oraz trasa `/form` w `crmaura`) czyta/zapisuje te tabele **bezpośrednio anon-kluczem po tokenie**. To pozwala każdemu z anon-kluczem **wylistować WSZYSTKIE APK wszystkich tenantów** (wyciek PII / RODO).
Analogicznie `ud_clients` ma anon INSERT (formularz „utrata dochodu", repo `aurabroker/udapp` / `aurabroker/ud`).

Nie można po prostu usunąć tych polityk — najpierw frontend musi przejść na funkcje RPC (SECURITY DEFINER), które działają „po tokenie" zamiast czytać całą tabelę.

### KROK 1 — utwórz funkcje RPC w Supabase (addytywne, nic nie psują)

Zastosuj migracją (`apply_migration`, `project_id=kukvgsjrmrqtzhkszzum`):

```sql
-- Odczyt APK po tokenie (zamiast anon SELECT na apk_tokens + apk_forms).
create or replace function public.get_apk_by_token(p_token text)
returns table (
  token_id uuid, token_status text, expires_at timestamptz, token_advisor_name text,
  form_id uuid, form_status text, client_name text, form_advisor_name text,
  form_data jsonb, tenant_id uuid, tenant_nazwa text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.status, t.expires_at, t.advisor_name,
         f.id, f.status, f.client_name, f.advisor_name, f.form_data, f.tenant_id,
         (select ct.nazwa from crm_tenants ct where ct.id = f.tenant_id)
  from apk_tokens t join apk_forms f on f.id = t.form_id
  where t.token = p_token
$$;
revoke all on function public.get_apk_by_token(text) from public;
grant execute on function public.get_apk_by_token(text) to anon, authenticated;

-- Zapis/wysyłka APK po tokenie (zamiast anon UPDATE na apk_forms + apk_tokens).
create or replace function public.submit_apk(p_token text, p_form_data jsonb, p_final boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_t apk_tokens%rowtype; v_f apk_forms%rowtype;
begin
  select * into v_t from apk_tokens where token = p_token;
  if not found then return 'invalid'; end if;
  if v_t.status = 'used' then return 'used'; end if;
  if v_t.expires_at < now() then return 'expired'; end if;
  select * into v_f from apk_forms where id = v_t.form_id;
  if not found then return 'invalid'; end if;
  if v_f.status = 'submitted' then return 'submitted'; end if;
  update apk_forms set form_data = p_form_data,
         status = case when p_final then 'submitted' else 'draft' end,
         submitted_at = case when p_final then now() else null end
   where id = v_f.id;
  if p_final then
    update apk_tokens set status = 'used', used_at = now() where id = v_t.id;
  end if;
  return case when p_final then 'submitted' else 'draft' end;
end; $$;
revoke all on function public.submit_apk(text, jsonb, boolean) from public;
grant execute on function public.submit_apk(text, jsonb, boolean) to anon, authenticated;
```

### KROK 2 — przepnij frontend na RPC

**`aurabroker/APK`** (React) oraz **`crmaura` trasa `src/routes/form/+page.svelte`**:
- Zamiast `supabase.from('apk_tokens').select(...).eq('token', token)` + `from('apk_forms').select(...)`
  → `supabase.rpc('get_apk_by_token', { p_token: token })` (zwraca jeden wiersz).
- Zamiast `from('apk_forms').update(...)` + `from('apk_tokens').update({status:'used'})`
  → `supabase.rpc('submit_apk', { p_token: token, p_form_data: formData, p_final: !asDraft })`.

Wzorzec referencyjny: obecna logika w `crmaura/src/routes/form/+page.svelte` (onMount + submit).

### KROK 3 — udochodu (`ud_clients`)
- Potwierdź, że publiczny formularz w `aurabroker/udapp` (i/lub `ud`) wysyła dane przez **edge function `form-submit`** (która waliduje Turnstile + PESEL i pisze service_rolem), a NIE robi bezpośredniego `insert` anon-kluczem.
- Jeśli tak → anon insert na `ud_clients` jest zbędny i można go usunąć (lockdown poniżej).
- Jeśli nie → najpierw przepnij formularz na `form-submit`.

### KROK 4 — LOCKDOWN (uruchom DOPIERO po wdrożeniu KROKU 2 i 3 na produkcję)

```sql
-- APK: koniec z anon enumeracją i anon zapisem (frontend używa już RPC).
drop policy if exists "apk_forms_select_anon_by_ref" on public.apk_forms;
drop policy if exists "apk_forms_update_anon"        on public.apk_forms;
drop policy if exists "apk_tokens_select_anon"       on public.apk_tokens;
drop policy if exists "apk_tokens_update_anon"       on public.apk_tokens;

-- udochodu: insert tylko przez edge function (service_role); koniec z anon insert.
drop policy if exists "ud_clients_anon_insert" on public.ud_clients;
```

### KROK 5 — weryfikacja
- `get_apk_by_token` zwraca dane dla ważnego tokenu; pusty wynik dla losowego.
- Anon enumeracja zablokowana — to powinno zwrócić błąd/0 wierszy:
  `curl 'https://kukvgsjrmrqtzhkszzum.supabase.co/rest/v1/apk_forms?select=*' -H "apikey: <ANON_KEY>"`
- Publiczny formularz APK (otwórz realny link `?token=…`) zapisuje szkic i wysyła.
- Formularz „utrata dochodu" nadal zapisuje leady.
- `mcp__Supabase__get_advisors(type=security)` — `rls_policy_always_true` zredukowane.

---

## 📋 Pozostałe rekomendacje (Tier 2, niżej priorytet)
- `apk-pdfs`: rozważ bucket **prywatny + signed URL** (zmiana `crmaura/src/lib/utils/apkPdf.ts` `getPublicUrl`→`createSignedUrl` + miejsca czytające `pdf_url`).
- Pozostałe tabele leadowe z anon insert (`udochodu_contacts`, `kancelaria_leads`, `bp_quotes`) → edge function + drop anon insert (repo: `kancelaria`, `beautypolisa`).
- `ud_clients`/`mienie_wnioski`: zawęź `auth_select USING(true)` do roli admina modułu (cross-modułowy odczyt PII).
- Supabase Auth: włącz „Leaked password protection" (HIBP); MFA dla ról admin.
- Higiena: pozostałe `function_search_path_mutable`, przegląd `security_definer_view`, przenieś rozszerzenie `unaccent` poza `public`.
- Wygeneruj typy bazy (`supabase gen types`) → naprawia 464 błędy `never` w `crmaura` i poprawia stabilność.
