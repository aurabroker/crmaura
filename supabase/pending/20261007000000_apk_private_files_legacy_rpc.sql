-- ============================================================
-- APK: prywatny bucket z PDF-ami i wyłączenie starej funkcji odczytu po tokenie.
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA.
--
-- KOLEJNOŚĆ: najpierw wdrożyć kod, w którym CRM otwiera zapisane PDF-y APK podpisanym linkiem
-- (src/lib/utils/storageLink.ts) i zapisuje w apk_forms.pdf_url ścieżkę pliku. Starsze wiersze
-- z pełnym adresem publicznym kod obsługuje (odczytuje z nich ścieżkę).
-- ============================================================

-- 1) Bucket prywatny: pliki tylko przez podpisany link; odczyt przez zalogowanych ogranicza
--    polityka apk_pdfs_tenant_select (migracja 20261006000000) do własnej firmy.
update storage.buckets set public = false where id = 'apk-pdfs';

-- 2) apk_form_by_token to poprzedniczka get_apk_by_token. Formularz /form używa wyłącznie
--    get_apk_by_token i submit_apk; w pg_stat_statements brak wywołań tej funkcji przez
--    anon/authenticated. Funkcja zostaje (do ewentualnego przywrócenia), bez prawa wywołania z API.
revoke execute on function public.apk_form_by_token(text) from public, anon, authenticated;

-- Weryfikacja (oczekiwane: public = false; oba has_function_privilege = false):
--   select id, public from storage.buckets where id = 'apk-pdfs';
--   select has_function_privilege('anon', 'public.apk_form_by_token(text)', 'execute'),
--          has_function_privilege('authenticated', 'public.apk_form_by_token(text)', 'execute');
--
-- ROLLBACK:
--   update storage.buckets set public = true where id = 'apk-pdfs';
--   grant execute on function public.apk_form_by_token(text) to anon, authenticated;
