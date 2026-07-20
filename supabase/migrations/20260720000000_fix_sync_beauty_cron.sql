-- Naprawa crona synchronizacji BEAUTY -> Aura Expert (sync-beauty-companies-daily).
--
-- Problem: poprzednia komenda budowala naglowek Authorization przez sklejanie stringow:
--   headers := '{"...Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb
-- Przez precedencje operatorow rzutowanie ::jsonb wiazalo sie tylko z koncowym literalem '"}',
-- wiec baza probowala sparsowac '"}' jako JSON i job padal codziennie z bledem:
--   ERROR: invalid input syntax for type json (Token '"}' is invalid)
-- Dodatkowo GUC app.service_role_key jest NULL, wiec naglowek i tak bylby niepoprawny.
-- Efekt: od ~2026-06-19 synchronizacja nie startowala (funkcja nigdy nie byla wywolywana).
--
-- Rozwiazanie: budujemy naglowki przez jsonb_build_object (zawsze poprawny JSON),
-- bez zaleznosci od GUC. Funkcja ma verify_jwt=false, wiec naglowek Authorization
-- nie jest wymagany (uzywa wlasnych kluczy service_role z env).

SELECT cron.schedule(
  'sync-beauty-companies-daily',
  '0 7 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/sync-beauty-companies',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);
