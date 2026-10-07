-- ============================================================
-- beautypolisa: publiczne wpisy do bp_quotes i bp_analytics z ograniczeniami.
-- STATUS: ZASTOSOWANA na produkcji 2026-10-07 (polityki INSERT zweryfikowane w pg_policy).
--
-- Formularze beautypolisa (bp-app.js) zapisują wnioski, kontakty i wizyty kluczem anon,
-- więc wstawianie zostaje otwarte. Polityki „Anyone can insert …” miały jednak WITH CHECK (true):
-- wpis mógł wskazać cudze konto w user_id (a polityka odczytu bp_quotes pokazuje właścicielowi
-- wnioski z jego user_id), nadać sobie dowolny status i mieć pola dowolnej długości.
-- Limity z zapasem względem tego, co zapisuje bp-app.js (lista zabiegów w notes ≈ kilka tys. znaków)
-- i względem dotychczasowych wizyt (najdłuższy referrer: 58 znaków).
-- ============================================================

drop policy if exists "Anyone can insert quote" on public.bp_quotes;
create policy "Anyone can insert quote" on public.bp_quotes
  for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and coalesce(status, 'new') in ('new', 'contact')
    and length(coalesce(email, '')) <= 254
    and length(coalesce(phone, '')) <= 40
    and length(coalesce(salon_name, '')) <= 300
    and length(coalesce(specialization, '')) <= 300
    and length(coalesce(revenue_range, '')) <= 100
    and length(coalesce(notes, '')) <= 10000
    and (sum_insured is null or sum_insured between 0 and 100000000)
    and (annual_premium is null or annual_premium between 0 and 10000000)
    and (employees_count is null or employees_count between 0 and 10000)
  );

drop policy if exists "Anyone can insert visit" on public.bp_analytics;
create policy "Anyone can insert visit" on public.bp_analytics
  for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and length(coalesce(session_id, '')) <= 100
    and length(coalesce(page, '')) <= 300
    and length(coalesce(referrer, '')) <= 2000
    and length(coalesce(utm_source, '')) <= 200
    and length(coalesce(utm_medium, '')) <= 200
    and length(coalesce(utm_campaign, '')) <= 200
    and length(coalesce(device, '')) <= 50
    and (screen_w is null or screen_w between 0 and 100000)
  );

-- Weryfikacja:
--   select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
--   where polrelid in ('public.bp_quotes'::regclass, 'public.bp_analytics'::regclass) and polcmd = 'a';
-- Po zastosowaniu: wysłać testowy wniosek i kontakt na beautypolisa (bez logowania) i sprawdzić,
-- że pojawiły się w panelu admina; wizyty dalej się zapisują (licznik w zakładce Analityka).
--
-- ROLLBACK:
--   drop policy if exists "Anyone can insert quote" on public.bp_quotes;
--   create policy "Anyone can insert quote" on public.bp_quotes for insert with check (true);
--   drop policy if exists "Anyone can insert visit" on public.bp_analytics;
--   create policy "Anyone can insert visit" on public.bp_analytics for insert with check (true);
