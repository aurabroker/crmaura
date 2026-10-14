-- ============================================================
-- Scalanie zdublowanych klientów: public.crm_scal_klientow(...)
--
-- Duplikaty powstają głównie z importu BEAUTY (ta sama firma z literówką w NIP, dwa wpisy w formularzu).
-- Dotąd pracownik scalał je z przeglądarki tabela po tabeli, a RLS nie pozwalał przepiąć wniosków
-- o odnowienie ani historii e-maili — scalenie blokowało się, gdy duplikat cokolwiek miał.
--
-- Teraz robi to jedna funkcja w bazie (wywołuje ją serwer kluczem service_role, w jednej transakcji):
--  1. sprawdza, że rekord docelowy i duplikaty należą do tej samej firmy,
--  2. przepina WSZYSTKIE powiązania na rekord docelowy: polisy (także jako ubezpieczony), wnioski
--     o odnowienie, historię e-maili, maile kampanii, zgłoszenia, zgody, szkody, pojazdy i wnioski
--     o pojazd, kontakty, zadania, APK, gwarancje (bond_tenants), powiązanie GetResponse (jedno na klienta),
--  3. łączy leady (jeden lead na klienta): aktywności i zgłoszenia leada duplikatu idą do leada docelowego,
--     etap zostaje dalszy, zainteresowania i liczba zgłoszeń się sumują,
--  4. uzupełnia puste pola rekordu docelowego z duplikatów (adres, e-mail, telefon, opiekun, RODO…);
--     NIP/REGON/PESEL: zostaje ten, który ma poprawną długość,
--  5. zapamiętuje identyfikatory BEAUTY duplikatów (crm_clients.beauty_ids_scalone) — synchronizacja
--     traktuje je jak ten rekord i nie odtwarza usuniętego duplikatu,
--  6. usuwa duplikaty i zapisuje w dzienniku (crm_audit_log, clients_merged) ich pełne migawki.
-- ============================================================

alter table public.crm_clients add column if not exists beauty_ids_scalone integer[] not null default '{}';
comment on column public.crm_clients.beauty_ids_scalone is 'Identyfikatory BEAUTY duplikatów scalonych z tym klientem — synchronizacja traktuje je jak ten rekord.';

create or replace function public.crm_scal_klientow(
  p_tenant uuid,
  p_docelowy uuid,
  p_duplikaty uuid[],
  p_user_id uuid default null,
  p_user_email text default null,
  p_user_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dupy uuid[];
  v_cel public.crm_clients%rowtype;
  v_d public.crm_clients%rowtype;
  v_lead_cel uuid;
  v_lead record;
  v_migawki jsonb := '[]'::jsonb;
  v_ile jsonb := '{}'::jsonb;
  v_n int;
  -- Pola rekordu docelowego uzupełniane z duplikatów (w kolejności utworzenia).
  v_nazwa_skr text; v_ulica text; v_nip text; v_regon text; v_pesel text; v_krs text; v_email text; v_tel text;
  v_opiekun uuid; v_gwar boolean; v_rodo boolean; v_rodo_data date; v_rodo_kanal text;
  v_ze boolean; v_ze_at timestamptz; v_zs boolean; v_zs_at timestamptz;
  v_auth uuid; v_beauty_id integer; v_beauty_scalone integer[] := '{}';
  v_ranga constant text[] := array['nowy', 'przegrany', 'w_kontakcie', 'oferta_wyslana', 'wygrany'];
begin
  select array_agg(distinct d) into v_dupy from unnest(p_duplikaty) d where d is not null and d <> p_docelowy;
  if p_tenant is null or p_docelowy is null or coalesce(array_length(v_dupy, 1), 0) = 0 then
    raise exception 'BRAK_DANYCH' using hint = 'Wskaż klienta docelowego i co najmniej jeden duplikat.';
  end if;
  if array_length(v_dupy, 1) > 20 then
    raise exception 'ZA_DUZO' using hint = 'Za jednym razem można scalić najwyżej 20 duplikatów.';
  end if;

  select * into v_cel from public.crm_clients where id = p_docelowy and tenant_id = p_tenant for update;
  if not found then
    raise exception 'KLIENT_NIEZNANY' using hint = 'Klient docelowy nie istnieje w tej firmie.';
  end if;
  perform 1 from public.crm_clients where id = any(v_dupy) and tenant_id = p_tenant for update;
  select count(*) into v_n from public.crm_clients where id = any(v_dupy) and tenant_id = p_tenant;
  if v_n <> array_length(v_dupy, 1) then
    raise exception 'DUPLIKAT_NIEZNANY' using hint = 'Któryś z duplikatów nie istnieje w tej firmie.';
  end if;

  -- 1. Migawki duplikatów i wartości do uzupełnienia rekordu docelowego.
  v_nazwa_skr := nullif(v_cel.nazwa_skrocona, ''); v_ulica := nullif(v_cel.ulica, ''); v_nip := nullif(v_cel.nip, '');
  v_regon := nullif(v_cel.regon, ''); v_pesel := nullif(v_cel.pesel, ''); v_krs := nullif(v_cel.krs, '');
  v_email := nullif(v_cel.email, ''); v_tel := nullif(v_cel.telefon, ''); v_opiekun := v_cel.opiekun_id;
  v_gwar := coalesce(v_cel.gwarancje, false); v_rodo := coalesce(v_cel.rodo_zgoda, false); v_rodo_data := v_cel.rodo_data; v_rodo_kanal := v_cel.rodo_kanal;
  v_ze := v_cel.zgoda_email; v_ze_at := v_cel.zgoda_email_at; v_zs := v_cel.zgoda_sms; v_zs_at := v_cel.zgoda_sms_at;
  v_auth := v_cel.auth_user_id; v_beauty_id := v_cel.beauty_id;

  for v_d in select * from public.crm_clients where id = any(v_dupy) order by created_at, id loop
    v_migawki := v_migawki || to_jsonb(v_d);
    v_nazwa_skr := coalesce(v_nazwa_skr, nullif(v_d.nazwa_skrocona, ''));
    v_ulica := coalesce(v_ulica, nullif(v_d.ulica, ''));
    v_krs := coalesce(v_krs, nullif(v_d.krs, ''));
    v_email := coalesce(v_email, nullif(v_d.email, ''));
    v_tel := coalesce(v_tel, nullif(v_d.telefon, ''));
    v_opiekun := coalesce(v_opiekun, v_d.opiekun_id);
    v_gwar := v_gwar or coalesce(v_d.gwarancje, false);
    -- Identyfikatory: zostaje poprawna długość (NIP 10, REGON 9/14, PESEL 11 cyfr), inaczej pierwszy niepusty.
    if length(regexp_replace(coalesce(v_nip, ''), '\D', '', 'g')) <> 10 and length(regexp_replace(coalesce(v_d.nip, ''), '\D', '', 'g')) = 10 then v_nip := v_d.nip;
    elsif v_nip is null then v_nip := nullif(v_d.nip, ''); end if;
    if length(regexp_replace(coalesce(v_regon, ''), '\D', '', 'g')) not in (9, 14) and length(regexp_replace(coalesce(v_d.regon, ''), '\D', '', 'g')) in (9, 14) then v_regon := v_d.regon;
    elsif v_regon is null then v_regon := nullif(v_d.regon, ''); end if;
    if length(regexp_replace(coalesce(v_pesel, ''), '\D', '', 'g')) <> 11 and length(regexp_replace(coalesce(v_d.pesel, ''), '\D', '', 'g')) = 11 then v_pesel := v_d.pesel;
    elsif v_pesel is null then v_pesel := nullif(v_d.pesel, ''); end if;
    -- RODO tylko w górę; zgody marketingowe: najnowsza odpowiedź.
    if coalesce(v_d.rodo_zgoda, false) and not v_rodo then v_rodo := true; v_rodo_data := v_d.rodo_data; v_rodo_kanal := v_d.rodo_kanal; end if;
    if v_d.zgoda_email_at is not null and (v_ze_at is null or v_d.zgoda_email_at > v_ze_at) then v_ze := v_d.zgoda_email; v_ze_at := v_d.zgoda_email_at; end if;
    if v_d.zgoda_sms_at is not null and (v_zs_at is null or v_d.zgoda_sms_at > v_zs_at) then v_zs := v_d.zgoda_sms; v_zs_at := v_d.zgoda_sms_at; end if;
    v_auth := coalesce(v_auth, v_d.auth_user_id);
    if v_d.beauty_id is not null then v_beauty_scalone := v_beauty_scalone || v_d.beauty_id; end if;
    v_beauty_scalone := v_beauty_scalone || coalesce(v_d.beauty_ids_scalone, '{}');
  end loop;

  -- 2. Leady: jeden na klienta. Lead duplikatu przechodzi na cel, gdy cel leada nie ma; inaczej jest w niego wtapiany.
  select id into v_lead_cel from public.crm_prospects where klient_id = p_docelowy;
  for v_lead in select * from public.crm_prospects where klient_id = any(v_dupy) order by created_at, id loop
    if v_lead_cel is null then
      update public.crm_prospects set klient_id = p_docelowy where id = v_lead.id;
      v_lead_cel := v_lead.id;
    else
      update public.crm_prospect_activities set prospect_id = v_lead_cel where prospect_id = v_lead.id;
      update public.crm_zgloszenia set prospect_id = v_lead_cel where prospect_id = v_lead.id;
      update public.crm_prospects c set
        status = case when array_position(v_ranga, v_lead.status) > array_position(v_ranga, c.status) then v_lead.status else c.status end,
        liczba_zgloszen = coalesce(c.liczba_zgloszen, 0) + coalesce(v_lead.liczba_zgloszen, 0),
        data_zgloszenia = least(c.data_zgloszenia, v_lead.data_zgloszenia),
        ostatnie_zgloszenie_at = greatest(c.ostatnie_zgloszenie_at, v_lead.ostatnie_zgloszenie_at),
        zainteresowania = (select coalesce(array_agg(distinct z), '{}'::text[]) from unnest(coalesce(c.zainteresowania, '{}'::text[]) || coalesce(v_lead.zainteresowania, '{}'::text[])) z),
        przychod = coalesce(nullif(c.przychod, ''), v_lead.przychod),
        zrodlo = coalesce(nullif(c.zrodlo, ''), v_lead.zrodlo),
        broker_id = coalesce(c.broker_id, v_lead.broker_id),
        notatki = nullif(concat_ws(E'\n', nullif(c.notatki, ''), nullif(v_lead.notatki, '')), '')
      where c.id = v_lead_cel;
      insert into public.crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
      values (p_tenant, v_lead_cel, 'notatka', 'Scalono z leadem duplikatu klienta „' || coalesce(v_lead.nazwa, '') || '” (' || v_lead.id || ').');
      delete from public.crm_prospects where id = v_lead.id;
    end if;
  end loop;

  -- 3. Powiązania → rekord docelowy (liczby do dziennika).
  update public.crm_policies set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('polisy', v_n);
  update public.crm_policies set ubezpieczony_id = p_docelowy where ubezpieczony_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('polisy_ubezpieczony', v_n);
  update public.crm_renewals set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('wnioski', v_n);
  update public.crm_client_emails set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('maile', v_n);
  update public.crm_kampanie_maile set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('maile_kampanii', v_n);
  update public.crm_zgloszenia set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('zgloszenia', v_n);
  update public.crm_zgody set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('zgody', v_n);
  update public.crm_claims set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('szkody', v_n);
  update public.crm_vehicles set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('pojazdy', v_n);
  update public.crm_vehicle_requests set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('wnioski_pojazdow', v_n);
  update public.crm_client_contacts set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('kontakty', v_n);
  update public.crm_tasks set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('zadania', v_n);
  update public.crm_task_history set klient_id = p_docelowy where klient_id = any(v_dupy);
  update public.apk_forms set klient_id = p_docelowy where klient_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('apk', v_n);
  update public.bond_tenants set crm_client_id = p_docelowy where crm_client_id = any(v_dupy);
  get diagnostics v_n = row_count; v_ile := v_ile || jsonb_build_object('gwarancje', v_n);
  -- GetResponse: jedno powiązanie na klienta — zostaje to z rekordu docelowego albo najstarsze z duplikatów.
  if not exists (select 1 from public.crm_getresponse_links where klient_id = p_docelowy) then
    update public.crm_getresponse_links set klient_id = p_docelowy
    where id = (select id from public.crm_getresponse_links where klient_id = any(v_dupy) order by created_at limit 1);
  end if;
  delete from public.crm_getresponse_links where klient_id = any(v_dupy);

  -- 4. Usunięcie duplikatów (powiązania są już przepięte; po nich zwalniają się unikalne beauty_id i auth_user_id).
  delete from public.crm_clients where id = any(v_dupy);

  -- 5. Rekord docelowy: uzupełnione pola, identyfikator BEAUTY (własny albo pierwszego duplikatu), pozostałe jako scalone.
  if v_beauty_id is null and coalesce(array_length(v_beauty_scalone, 1), 0) > 0 then v_beauty_id := v_beauty_scalone[1]; end if;
  v_beauty_scalone := array(select distinct b from unnest(coalesce(v_cel.beauty_ids_scalone, '{}') || v_beauty_scalone) b where b is distinct from v_beauty_id order by b);
  update public.crm_clients set
    nazwa_skrocona = v_nazwa_skr, ulica = v_ulica, nip = v_nip, regon = v_regon, pesel = v_pesel, krs = v_krs, email = v_email, telefon = v_tel,
    opiekun_id = v_opiekun, gwarancje = v_gwar, rodo_zgoda = v_rodo, rodo_data = v_rodo_data, rodo_kanal = v_rodo_kanal,
    zgoda_email = v_ze, zgoda_email_at = v_ze_at, zgoda_sms = v_zs, zgoda_sms_at = v_zs_at,
    auth_user_id = v_auth, beauty_id = v_beauty_id, beauty_ids_scalone = v_beauty_scalone
  where id = p_docelowy;

  -- 6. Dziennik: kto, co zachował, co usunął (pełne migawki — do ręcznego odtworzenia w razie pomyłki).
  insert into public.crm_audit_log (tenant_id, user_id, user_email, user_name, action, entity_type, entity_id, entity_label, details)
  values (p_tenant, p_user_id, p_user_email, p_user_name, 'clients_merged', 'client', p_docelowy::text, v_cel.nazwa,
          jsonb_build_object('merged_ids', to_jsonb(v_dupy), 'przeniesiono', v_ile, 'usunieci', v_migawki,
                             'beauty_id', v_beauty_id, 'beauty_ids_scalone', to_jsonb(v_beauty_scalone), 'lead', v_lead_cel));

  return jsonb_build_object('docelowy', p_docelowy, 'usunieto', array_length(v_dupy, 1), 'przeniesiono', v_ile,
                            'beauty_id', v_beauty_id, 'beauty_ids_scalone', to_jsonb(v_beauty_scalone), 'lead', v_lead_cel);
end;
$$;

revoke all on function public.crm_scal_klientow(uuid, uuid, uuid[], uuid, text, text) from public, anon, authenticated;

-- Weryfikacja:
--   select has_function_privilege('authenticated', 'public.crm_scal_klientow(uuid, uuid, uuid[], uuid, text, text)', 'execute'); -- false
-- ROLLBACK:
--   drop function if exists public.crm_scal_klientow(uuid, uuid, uuid[], uuid, text, text);
--   alter table public.crm_clients drop column if exists beauty_ids_scalone;
