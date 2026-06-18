-- ============================================================
-- Utwardzenie bezpieczeństwa: usunięcie groźnych polityk anon
-- bez psucia żywych przepływów (publiczny formularz APK, linki PDF).
-- Audyt: 2026-06-18.
-- ============================================================

-- 1) pakiety: usuń permisywną politykę pozwalającą KAŻDEMU (też anon) zmieniać ceny.
--    Zarządzanie pakietami zostaje przez istniejącą politykę admina (auth).
drop policy if exists "anon update ceny" on public.pakiety;

-- 2) mienie_wnioski: usuń anonimowy odczyt WSZYSTKICH wniosków (wyciek PII / RODO).
--    Insert publiczny (formularz) pozostaje; odczyt mają tylko zalogowani.
drop policy if exists "anon_select_own_mienie" on public.mienie_wnioski;

-- 3) apk_forms: usuń kasowanie DOWOLNEGO formularza przez dowolnego zalogowanego;
--    zastąp kasowaniem ograniczonym do własnego tenanta.
drop policy if exists "apk_forms_delete_auth" on public.apk_forms;
create policy "apk_forms_delete_tenant" on public.apk_forms
  for delete to authenticated
  using (tenant_id = get_my_tenant_id());

-- 4) apk_tokens: usuń w pełni otwarte UPDATE.
--    Anon (formularz) może oznaczyć token jako 'used', ale nie może manipulować
--    tokenem już użytym. Zalogowani: pełny update w obrębie swojego tenanta.
drop policy if exists "apk_tokens_update" on public.apk_tokens;
drop policy if exists "apk_tokens_update_anon" on public.apk_tokens;
create policy "apk_tokens_update_anon" on public.apk_tokens
  for update to anon, authenticated
  using (status <> 'used')
  with check (true);
create policy "apk_tokens_update_tenant" on public.apk_tokens
  for update to authenticated
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

-- 5) apk_audit: tylko zalogowani dopisują do logu (koniec z zatruwaniem przez anon).
drop policy if exists "apk_audit_insert_all" on public.apk_audit;
create policy "apk_audit_insert_auth" on public.apk_audit
  for insert to authenticated
  with check (true);

-- 6) storage: wyłącz anonimowe LISTOWANIE plików w buckecie apk-pdfs.
--    Bezpośredni dostęp po publicznym URL (getPublicUrl) nadal działa.
drop policy if exists "Public read apk-pdfs" on storage.objects;

-- 7) utwardzenie funkcji SECURITY DEFINER: ustaw stały search_path (anty-hijack).
alter function public.is_admin() set search_path = public;
alter function public.is_ud_admin() set search_path = public;
alter function public.is_bond_admin() set search_path = public;
