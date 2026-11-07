-- Krótki link do wniosku (APK i wniosek o odnowienie albo o pierwszą polisę) do wysłania SMS-em:
-- <portal>/w/<kod_krotki> przekierowuje na pełny link z podpisem (/odnowienie/<id>.<podpis>).
-- Kod losowy, 10 znaków (renewals.ts: krotkiLinkDla), nadawany przy pierwszej prośbie o krótki link.

alter table public.crm_renewals add column if not exists kod_krotki text;
create unique index if not exists crm_renewals_kod_krotki_key on public.crm_renewals (kod_krotki) where kod_krotki is not null;

comment on column public.crm_renewals.kod_krotki is 'Kod krótkiego linku do wniosku (/w/<kod>), np. do SMS-a; losowy, unikalny.';
