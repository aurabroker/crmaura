-- ============================================================
-- apk-pdfs: bucket prywatny.
-- STATUS: PRZYGOTOWANA, NIE ZASTOSOWANA.
--
-- KOLEJNOŚĆ: najpierw wdrożyć kod, w którym CRM otwiera zapisane PDF-y APK podpisanym linkiem
-- (src/lib/utils/storageLink.ts) i zapisuje w apk_forms.pdf_url ścieżkę pliku. Starsze wiersze
-- z pełnym adresem publicznym kod obsługuje (odczytuje z nich ścieżkę).
-- Odczyt plików przez zalogowanych zostaje ograniczony do własnej firmy polityką
-- apk_pdfs_tenant_select (migracja 20261006000000).
-- ============================================================

update storage.buckets set public = false where id = 'apk-pdfs';

-- Weryfikacja (powinno zwrócić public = false):
--   select id, public from storage.buckets where id = 'apk-pdfs';
--
-- ROLLBACK:
--   update storage.buckets set public = true where id = 'apk-pdfs';
