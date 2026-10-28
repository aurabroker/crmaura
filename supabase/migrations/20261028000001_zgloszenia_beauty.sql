-- Zgłoszenia z formularza BeautyPolisa (arkusz Google → Apps Script → /api/leady/zgloszenia) od razu oznaczają
-- klienta jako branżę beauty (crm_clients.segment_beauty).
--
-- Dotąd klient z formularza dostawał znacznik beauty dopiero z porannej synchronizacji z HUB (beauty_id = numer
-- firmy w HUB, dopasowanie po NIP). Do tego czasu karta nie proponowała „APK i wniosku o pierwszą polisę OC beauty”
-- i klient nie trafiał do filtra Beauty (przypadek 28.10: Unique Cosmetology Joanna Pilszek).
--
-- Reguła: wiersz jest z formularza beauty, gdy ma pole "beauty" (true/1/tak — wprost; false/0/nie — nie beauty),
-- a bez tego pola — gdy jego ref zaczyna się od nazwy arkusza BeautyPolisa „Zgloszenia_Polisa” (ref = arkusz!wiersz|nip|email).
-- Nowy klient powstaje z segment_beauty = true; istniejący klient z nowym (nie historycznym) zgłoszeniem dostaje
-- segment_beauty = true, jeśli go jeszcze nie miał. Reszta funkcji bez zmian.
--
-- STATUS: nałożona 2026-10-28 przez execute_sql, wpisana do supabase_migrations.schema_migrations.

create or replace function public.crm_przyjmij_zgloszenia(p_hash text, p_wiersze jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  r jsonb;
  v_firma text; v_kontakt text; v_email text; v_tel text; v_nip text;
  v_produkt text; v_przychod text; v_ref text; v_hist boolean; v_data timestamptz;
  v_beauty boolean;
  v_kody text[];
  v_klient crm_clients%rowtype;
  v_lead crm_prospects%rowtype;
  v_poprz timestamptz; v_poprz_typ text;
  v_ponowne boolean; v_status text; v_opis text; v_zg uuid;
  v_wyniki jsonb := '[]'::jsonb;
  n_nowe int := 0; n_ponowne int := 0; n_hist int := 0; n_dup int := 0; n_pom int := 0;
begin
  select tenant_id into v_tenant from crm_klucze_integracji where hash = p_hash and wylaczony_at is null;
  if v_tenant is null then
    raise exception 'zly_klucz' using errcode = '28000';
  end if;
  update crm_klucze_integracji set ostatnio_uzyty_at = now() where hash = p_hash;
  if jsonb_typeof(p_wiersze) is distinct from 'array' then
    raise exception 'zle_dane' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_wiersze) loop
    v_firma := left(nullif(btrim(r->>'company'), ''), 200);
    v_kontakt := left(nullif(btrim(r->>'contact'), ''), 200);
    v_email := left(nullif(lower(btrim(r->>'email')), ''), 254);
    v_tel := left(nullif(btrim(r->>'phone'), ''), 40);
    v_nip := nullif(regexp_replace(coalesce(r->>'nip', ''), '\D', '', 'g'), '');
    v_produkt := left(nullif(btrim(r->>'ubezpieczenie'), ''), 200);
    v_przychod := left(nullif(btrim(r->>'przychod'), ''), 100);
    v_ref := left(nullif(btrim(r->>'ref'), ''), 300);
    v_hist := lower(coalesce(r->>'historyczne', '')) in ('true', '1', 'tak');
    -- Formularz BeautyPolisa: pole „beauty” wprost, a bez niego arkusz „Zgloszenia_Polisa…” w ref.
    v_beauty := case
      when nullif(btrim(coalesce(r->>'beauty', '')), '') is not null then lower(btrim(r->>'beauty')) in ('true', '1', 'tak')
      else coalesce(v_ref, '') ilike 'zgloszenia\_polisa%'
    end;
    begin
      v_data := nullif(btrim(r->>'data'), '')::timestamptz;
    exception when others then
      v_data := null;
    end;
    if v_data is null or v_data > now() + interval '1 day' then
      v_data := now();
    end if;
    v_kody := crm_kody_zainteresowan(v_produkt);

    if v_firma is null and v_email is null and v_nip is null then
      n_pom := n_pom + 1;
      v_wyniki := v_wyniki || jsonb_build_object('ref', v_ref, 'status', 'pominiete');
      continue;
    end if;
    if v_ref is not null and exists (select 1 from crm_zgloszenia z where z.tenant_id = v_tenant and z.ref = v_ref) then
      n_dup := n_dup + 1;
      v_wyniki := v_wyniki || jsonb_build_object('ref', v_ref, 'status', 'duplikat');
      continue;
    end if;

    v_klient := null;
    if length(v_nip) = 10 then
      select c.* into v_klient from crm_clients c
      where c.tenant_id = v_tenant and regexp_replace(coalesce(c.nip, ''), '\D', '', 'g') = v_nip
      order by exists (select 1 from crm_policies p where p.klient_id = c.id and p.deleted_at is null) desc, c.created_at, c.id
      limit 1;
    end if;
    if v_klient.id is null and v_email is not null then
      select c.* into v_klient from crm_clients c
      where c.tenant_id = v_tenant and lower(btrim(c.email)) = v_email
        and (length(coalesce(v_nip, '')) <> 10 or length(regexp_replace(coalesce(c.nip, ''), '\D', '', 'g')) <> 10)
      order by c.created_at, c.id
      limit 1;
    end if;

    v_lead := null;
    if v_klient.id is not null then
      select * into v_lead from crm_prospects where klient_id = v_klient.id;
    end if;
    if v_lead.id is null and length(v_nip) = 10 then
      select * into v_lead from crm_prospects pr
      where pr.tenant_id = v_tenant and pr.klient_id is null
        and regexp_replace(coalesce(pr.nip, ''), '\D', '', 'g') = v_nip
      order by pr.created_at
      limit 1;
    end if;

    v_poprz := null; v_poprz_typ := null;
    select max(z.zgloszono_at) into v_poprz from crm_zgloszenia z
    where z.tenant_id = v_tenant and z.zgloszono_at <= v_data
      and ((v_klient.id is not null and z.klient_id = v_klient.id) or (v_lead.id is not null and z.prospect_id = v_lead.id));
    if v_poprz is not null then
      v_poprz_typ := 'zgloszenie';
    elsif v_lead.id is not null and coalesce(v_lead.ostatnie_zgloszenie_at, v_lead.data_zgloszenia) is not null then
      v_poprz := coalesce(v_lead.ostatnie_zgloszenie_at, v_lead.data_zgloszenia);
      v_poprz_typ := 'zgloszenie';
    elsif v_klient.id is not null then
      v_poprz := v_klient.created_at;
      v_poprz_typ := 'kartoteka';
    end if;
    v_ponowne := v_klient.id is not null or v_lead.id is not null;

    if not v_hist then
      if v_klient.id is null then
        insert into crm_clients (tenant_id, typ, nazwa, nip, email, telefon, segment_beauty)
        values (v_tenant,
                case when v_firma is not null or length(v_nip) = 10 then 'firma' else 'osoba' end,
                coalesce(v_firma, v_kontakt, v_email, v_nip),
                v_nip, v_email, v_tel, v_beauty)
        returning * into v_klient;
      elsif v_beauty and not coalesce(v_klient.segment_beauty, false) then
        -- Istniejący klient zgłasza się z formularza BeautyPolisa: od razu branża beauty (bez czekania na synchronizację z HUB).
        update crm_clients set segment_beauty = true where id = v_klient.id
        returning * into v_klient;
      end if;
      if v_lead.id is null then
        insert into crm_prospects (tenant_id, klient_id, nazwa, nip, telefon, email, status, zrodlo,
                                   zainteresowania, przychod, data_zgloszenia, broker_id)
        values (v_tenant, v_klient.id, v_klient.nazwa, v_klient.nip, coalesce(v_klient.telefon, v_tel),
                coalesce(v_klient.email, v_email), 'nowy', 'formularz', v_kody, v_przychod, v_data, v_klient.opiekun_id)
        returning * into v_lead;
      end if;
    end if;

    if v_lead.id is not null then
      update crm_prospects set
        klient_id = coalesce(klient_id, v_klient.id),
        zainteresowania = (select coalesce(array_agg(distinct k order by k), '{}') from unnest(zainteresowania || v_kody) as k),
        przychod = coalesce(v_przychod, przychod),
        data_zgloszenia = least(coalesce(data_zgloszenia, v_data), v_data),
        ostatnie_zgloszenie_at = greatest(coalesce(ostatnie_zgloszenie_at, v_data), v_data),
        liczba_zgloszen = liczba_zgloszen + 1,
        status = case when not v_hist and status in ('wygrany', 'przegrany') then 'nowy' else status end
      where id = v_lead.id
      returning * into v_lead;
    end if;

    v_status := case when v_hist then 'historyczne' when v_ponowne then 'ponowne' else 'nowe' end;

    insert into crm_zgloszenia (tenant_id, klient_id, prospect_id, ref, zgloszono_at, firma, kontakt, email, telefon, nip,
                                produkt, zainteresowania, przychod, ponowne, poprzednie_at, poprzednie_typ, historyczne, odczytane_at)
    values (v_tenant, v_klient.id, v_lead.id, v_ref, v_data, v_firma, v_kontakt, v_email, v_tel, v_nip,
            v_produkt, v_kody, v_przychod, v_ponowne, case when v_ponowne then v_poprz end,
            case when v_ponowne then v_poprz_typ end, v_hist,
            case when v_status = 'ponowne' then null else now() end)
    returning id into v_zg;

    v_opis := concat_ws(E'\n',
      'Produkt: ' || coalesce(v_produkt, '—'),
      case when v_przychod is not null then 'Przychód: ' || v_przychod end,
      case when v_kontakt is not null then 'Kontakt: ' || v_kontakt end,
      case when v_tel is not null then 'Telefon: ' || v_tel end,
      case when v_email is not null then 'E-mail: ' || v_email end,
      case when v_poprz is not null and v_ponowne then
        case when v_poprz_typ = 'zgloszenie' then 'Poprzednie zgłoszenie: ' else 'W kartotece od: ' end
        || to_char(v_poprz at time zone 'Europe/Warsaw', 'DD.MM.YYYY') end);

    if v_status = 'ponowne' then
      n_ponowne := n_ponowne + 1;
      if not exists (
        select 1 from crm_tasks t
        where t.klient_id = v_klient.id and t.zakonczone_at is null
          and t.tytul like 'Klient po raz kolejny prosi o ofertę%'
          and t.created_at > now() - interval '7 days'
      ) then
        insert into crm_tasks (tenant_id, assigned_to, klient_id, prospect_id, tytul, opis, termin, priorytet)
        values (v_tenant, coalesce(v_lead.broker_id, v_klient.opiekun_id), v_klient.id, v_lead.id,
                'Klient po raz kolejny prosi o ofertę' || coalesce(': ' || v_produkt, ''), v_opis, current_date, 'wysoki');
      end if;
      if v_lead.id is not null then
        insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
        values (v_tenant, v_lead.id, 'notatka', 'Ponowne zgłoszenie z formularza.' || E'\n' || v_opis);
      end if;
      insert into crm_audit_log (tenant_id, action, entity_type, entity_id, entity_label, details)
      values (v_tenant, 'client_resubmitted', 'client', v_klient.id::text, v_klient.nazwa,
              jsonb_build_object('zgloszenie_id', v_zg, 'produkt', v_produkt, 'przychod', v_przychod,
                                 'poprzednie_at', v_poprz, 'poprzednie_typ', v_poprz_typ));
    elsif v_status = 'nowe' then
      n_nowe := n_nowe + 1;
      insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
      values (v_tenant, v_lead.id, 'notatka', 'Zgłoszenie z formularza.' || E'\n' || v_opis);
      insert into crm_audit_log (tenant_id, action, entity_type, entity_id, entity_label, details)
      values (v_tenant, 'client_submitted', 'client', v_klient.id::text, v_klient.nazwa,
              jsonb_build_object('zgloszenie_id', v_zg, 'produkt', v_produkt, 'przychod', v_przychod));
    else
      n_hist := n_hist + 1;
    end if;

    v_wyniki := v_wyniki || jsonb_build_object('ref', v_ref, 'status', v_status, 'klient_id', v_klient.id);
  end loop;

  return jsonb_build_object('nowe', n_nowe, 'ponowne', n_ponowne, 'historyczne', n_hist,
                            'duplikaty', n_dup, 'pominiete', n_pom, 'wyniki', v_wyniki);
end;
$function$;
