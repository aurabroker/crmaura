-- ============================================================
-- STATUS: ZASTOSOWANA na produkcji 19.10.2026 (execute_sql, bez „drop”; ponowna synchronizacja:
-- select public.crm_ud_lead_do_crm(id, true) from public.ud_clients).
--
-- Oferty z aplikacji Utrata Dochodu (ud_offers) spięte z leadem CRM:
-- 1. Skrót wniosku (crm_ud_leady.dane) dostaje listę ofert klienta: numer, stan (wysłana / obejrzana /
--    wybrana / zakupiona / odrzucona), daty, liczbę wariantów, widełki składki rocznej, TU i wybór klienta.
-- 2. Etap leada w CRM podnoszą także oferty: wysłana, obejrzana albo wybrana → „Oferta wysłana”,
--    zakupiona → „Wygrany” (etap w aplikacji zostaje bez zmian — to dane aplikacji).
-- 3. Każda nowa oferta albo zmiana jej stanu zapisuje się w aktywności leada.
-- 4. Trigger na ud_offers synchronizuje od razu; cron co godzinę dosynchronizowuje.
-- ============================================================

create or replace function public.crm_ud_etykieta(p_rodzaj text, p_wartosc text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_rodzaj
    when 'zatrudnienie' then case p_wartosc when 'b2b' then 'działalność (B2B)' when 'uop' then 'umowa o pracę' when 'zlecenie' then 'umowa zlecenie' else p_wartosc end
    when 'podatek' then case p_wartosc when 'zasady_ogolne' then 'zasady ogólne' when 'ryczalt' then 'ryczałt' when 'liniowy' then 'podatek liniowy' when 'karta_podatkowa' then 'karta podatkowa' else p_wartosc end
    when 'zrodlo' then case p_wartosc when 'form' then 'wniosek online' when 'direct' then 'dodany przez agenta' when 'polisa' then 'z polisy' else p_wartosc end
    when 'status' then case p_wartosc when 'nowy' then 'Nowy' when 'w_kontakcie' then 'W kontakcie' when 'oferta_wyslana' then 'Oferta wysłana' when 'wygrany' then 'Wygrany' when 'przegrany' then 'Przegrany' else p_wartosc end
    when 'tu' then case lower(p_wartosc) when 'leadenhall' then 'Leadenhall' when 'colonnade' then 'Colonnade' when 'ceu' then 'CEU' else initcap(p_wartosc) end
    else p_wartosc end
$$;

-- Skrót wniosku (bez danych medycznych i ryzyk) + oferty klienta z aplikacji.
create or replace function public.crm_ud_dane(u public.ud_clients, l public.ud_leady, p_etap text, p_etap_nazwa text, p_opiekun text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'wniosek_at', u.created_at,
    'zrodlo_ud', u.source,
    'polecenie', nullif(btrim(u.affiliate_code_used), ''),
    'zawod', nullif(btrim(u.profession), ''),
    'zatrudnienie', u.employment_type,
    'forma_podatku', u.tax_form,
    'branza', nullif(btrim(u.b2b_industry), ''),
    'zatrudnia', u.employs_people,
    'zakres', jsonb_strip_nulls(jsonb_build_object(
      'okresowa', case when coalesce(u.risk_temp_incapacity, true) then nullif(crm_ud_liczba(u.temp_incapacity_sum), 0) end,
      'trwala', case when coalesce(u.risk_perm_incapacity, true) then nullif(crm_ud_liczba(u.perm_incapacity_sum), 0) end,
      'zgon', case when coalesce(u.risk_death_invalidity, true) then nullif(crm_ud_liczba(u.nw_death_sum), 0) end)),
    'etap', p_etap,
    'etap_nazwa', p_etap_nazwa,
    'etap_od', l.etap_od,
    'opiekun', p_opiekun,
    'zarchiwizowano_at', l.zarchiwizowano_at,
    'powod_utraty', nullif(btrim(l.powod_utraty), ''),
    'nastepne_dzialanie', case when l.nastepne_dzialanie_at is not null or nullif(btrim(l.nastepne_dzialanie_opis), '') is not null then
      jsonb_strip_nulls(jsonb_build_object('typ', l.nastepne_dzialanie_typ, 'at', l.nastepne_dzialanie_at, 'opis', nullif(btrim(l.nastepne_dzialanie_opis), ''))) end,
    'sprzedaz', case when l.sprzedano_at is not null or nullif(btrim(l.polisa_numer), '') is not null then jsonb_strip_nulls(jsonb_build_object(
      'sprzedano_at', l.sprzedano_at,
      'polisa', nullif(btrim(l.polisa_numer), ''),
      'skladka_roczna', l.skladka_roczna,
      'skladka_mies', l.skladka_mies,
      'ochrona_od', l.ochrona_od,
      'ochrona_do', l.ochrona_do,
      'prowizja_pct', l.prowizja_procent,
      'swiadczenie_okresowa', l.swiadczenie_okresowa,
      'swiadczenie_trwala', l.swiadczenie_trwala,
      'swiadczenie_zgon', l.swiadczenie_zgon)) end,
    'oferty', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', o.id,
        'nr', nullif(btrim(o.offer_number), ''),
        'status', o.status,
        'wyslano_at', o.sent_at,
        'obejrzano_at', o.viewed_at,
        'decyzja_at', o.decided_at,
        'zarchiwizowano_at', o.archived_at,
        'warianty', (select count(*) from ud_offer_documents d where d.offer_id = o.id),
        'skladka_od', (select min(d.premium_total) from ud_offer_documents d where d.offer_id = o.id),
        'skladka_do', (select max(d.premium_total) from ud_offer_documents d where d.offer_id = o.id),
        'tu', (select string_agg(distinct crm_ud_etykieta('tu', d.insurer_type), ', ') from ud_offer_documents d where d.offer_id = o.id and d.insurer_type is not null),
        'wybor', case when o.client_choice is not null and o.client_choice <> '{}'::jsonb then jsonb_strip_nulls(jsonb_build_object(
          'tu', o.client_choice->>'insurer_name', 'nr', o.client_choice->>'offer_number', 'at', o.client_choice->>'chosen_at')) end
      )) order by coalesce(o.sent_at, o.created_at) desc)
      from ud_offers o where o.client_id = u.id and o.status <> 'draft')
  ))
$$;

-- Etap leada z ofert: zakupiona → Wygrany; wysłana / obejrzana / wybrana (niezarchiwizowana) → Oferta wysłana.
create or replace function public.crm_ud_status_ofert(p_oferty jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when exists (select 1 from jsonb_array_elements(coalesce(p_oferty, '[]'::jsonb)) o where o->>'status' = 'bought') then 'wygrany'
    when exists (select 1 from jsonb_array_elements(coalesce(p_oferty, '[]'::jsonb)) o
                 where o->>'status' in ('sent', 'viewed', 'chosen') and o->>'zarchiwizowano_at' is null) then 'oferta_wyslana'
    else null end
$$;

-- Notatka o ofercie (nowej albo ze zmienionym stanem).
create or replace function public.crm_ud_opis_oferty(o jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(E'\n',
    'Aplikacja Utrata Dochodu: oferta ' || coalesce(o->>'nr', '')
      || case o->>'status'
           when 'sent' then ' wysłana do klienta' || coalesce(' ' || to_char((o->>'wyslano_at')::timestamptz at time zone 'Europe/Warsaw', 'DD.MM.YYYY'), '')
           when 'viewed' then ' obejrzana przez klienta' || coalesce(' ' || to_char((o->>'obejrzano_at')::timestamptz at time zone 'Europe/Warsaw', 'DD.MM.YYYY'), '')
           when 'chosen' then ' — klient wybrał wariant' || coalesce(': ' || nullif(concat_ws(' ', o->'wybor'->>'tu', o->'wybor'->>'nr'), ''), '')
           when 'bought' then ' — zakupiona'
           when 'rejected' then ' — odrzucona przez klienta'
           else ' — ' || coalesce(o->>'status', '?') end
      || case when o->>'zarchiwizowano_at' is not null then ' (zarchiwizowana)' else '' end || '.',
    nullif(concat_ws(' · ',
      case when coalesce((o->>'warianty')::int, 0) > 0 then (o->>'warianty') || case when (o->>'warianty')::int = 1 then ' wariant' when (o->>'warianty')::int between 2 and 4 then ' warianty' else ' wariantów' end end,
      'składka ' || crm_ud_kwota((o->>'skladka_od')::numeric)
        || case when (o->>'skladka_do')::numeric > (o->>'skladka_od')::numeric then ' – ' || crm_ud_kwota((o->>'skladka_do')::numeric) else '' end || '/rok',
      o->>'tu'), ''))
$$;

-- ---------- Jeden wniosek → CRM (z ofertami) ----------
create or replace function public.crm_ud_lead_do_crm(p_ud_klient uuid, p_backfill boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  u ud_clients%rowtype;
  l ud_leady%rowtype;
  m crm_ud_leady%rowtype;
  v_klient crm_clients%rowtype;
  v_lead crm_prospects%rowtype;
  v_etap text; v_etap_nazwa text; v_opiekun text;
  v_status_etap text; v_status_ofert text; v_status_ud text; v_status_nowy text;
  v_email text; v_tel text; v_tel9 text; v_nazwa text; v_pesel text;
  v_ponowne boolean; v_poprz timestamptz; v_poprz_typ text;
  v_zg uuid; v_dane jsonb; v_opis text; v_wynik text; v_n text;
  v_etap_zmiana boolean; v_sprzedaz_nowa boolean; v_arch_nowe boolean; v_oferty_zmiana boolean := false;
  v_notatki_ofert text[] := '{}'::text[];
  o jsonb; o_poprz jsonb;
begin
  v_tenant := crm_ud_tenant();
  if v_tenant is null then
    return jsonb_build_object('status', 'wylaczone');
  end if;
  select * into u from ud_clients where id = p_ud_klient;
  if not found then
    return jsonb_build_object('status', 'brak_wniosku');
  end if;
  select * into l from ud_leady where klient_id = u.id order by created_at limit 1;
  if l.id is not null then
    select e.klucz, e.nazwa into v_etap, v_etap_nazwa from ud_leady_etap e where e.id = l.etap_id;
    select p.full_name into v_opiekun from ud_user_profiles p where p.id = l.opiekun_id;
  end if;
  v_etap := coalesce(v_etap, 'nowy');
  v_etap_nazwa := coalesce(v_etap_nazwa, 'Nowy');

  v_email := left(nullif(lower(btrim(u.email)), ''), 254);
  v_tel := left(nullif(btrim(u.phone), ''), 40);
  v_tel9 := case when length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) >= 9 then right(regexp_replace(v_tel, '\D', '', 'g'), 9) end;
  v_nazwa := left(coalesce(nullif(btrim(u.full_name), ''), v_email, v_tel, 'Klient z aplikacji Utrata Dochodu'), 200);
  v_pesel := nullif(regexp_replace(coalesce(u.pesel, ''), '\D', '', 'g'), '');
  if length(v_pesel) <> 11 then v_pesel := null; end if;
  v_dane := crm_ud_dane(u, l, v_etap, v_etap_nazwa, v_opiekun);

  select * into m from crm_ud_leady where ud_klient_id = u.id;

  -- Etap docelowy: z etapu w aplikacji, podniesiony przez oferty (wysłana / obejrzana / wybrana → Oferta wysłana,
  -- zakupiona → Wygrany). Zamknięty etap w aplikacji (wygrany / przegrany) ma pierwszeństwo przed ofertami.
  v_status_etap := crm_ud_status_z_etapu(v_etap);
  v_status_ofert := crm_ud_status_ofert(v_dane->'oferty');
  v_status_ud := case
    when l.sprzedano_at is not null or v_status_ofert = 'wygrany' then 'wygrany'
    when v_status_etap in ('wygrany', 'przegrany') then v_status_etap
    when v_status_ofert = 'oferta_wyslana' then 'oferta_wyslana'
    else v_status_etap end;

  -- Oferty nowe albo ze zmienionym stanem od ostatniej synchronizacji → notatki w aktywności leada.
  for o in select value from jsonb_array_elements(coalesce(v_dane->'oferty', '[]'::jsonb)) loop
    o_poprz := null;
    select p.value into o_poprz from jsonb_array_elements(coalesce(m.dane->'oferty', '[]'::jsonb)) p where p.value->>'id' = o->>'id';
    if o_poprz is null or o_poprz->>'status' is distinct from o->>'status' or o_poprz->>'zarchiwizowano_at' is distinct from o->>'zarchiwizowano_at' then
      v_oferty_zmiana := true;
      v_notatki_ofert := v_notatki_ofert || crm_ud_opis_oferty(o);
    end if;
  end loop;

  -- ===== Pierwsza synchronizacja =====
  if m.ud_klient_id is null then
    if l.zarchiwizowano_at is not null and l.sprzedano_at is null then
      return jsonb_build_object('status', 'pominiety_archiwum');
    end if;

    if v_email is not null then
      select c.* into v_klient from crm_clients c
      where c.tenant_id = v_tenant and lower(btrim(c.email)) = v_email
      order by exists (select 1 from crm_policies p where p.klient_id = c.id and p.deleted_at is null) desc, c.created_at, c.id
      limit 1;
    end if;
    if v_klient.id is null and v_tel9 is not null then
      select c.* into v_klient from crm_clients c
      where c.tenant_id = v_tenant
        and length(regexp_replace(coalesce(c.telefon, ''), '\D', '', 'g')) >= 9
        and right(regexp_replace(c.telefon, '\D', '', 'g'), 9) = v_tel9
      order by exists (select 1 from crm_policies p where p.klient_id = c.id and p.deleted_at is null) desc, c.created_at, c.id
      limit 1;
    end if;
    if v_klient.id is not null then
      select * into v_lead from crm_prospects where klient_id = v_klient.id;
    end if;
    v_ponowne := v_klient.id is not null;

    v_poprz := null; v_poprz_typ := null;
    if v_klient.id is not null then
      select max(z.zgloszono_at) into v_poprz from crm_zgloszenia z
      where z.tenant_id = v_tenant and z.klient_id = v_klient.id and z.zgloszono_at <= u.created_at;
      if v_poprz is not null then
        v_poprz_typ := 'zgloszenie';
      elsif coalesce(v_lead.ostatnie_zgloszenie_at, v_lead.data_zgloszenia) <= u.created_at then
        v_poprz := coalesce(v_lead.ostatnie_zgloszenie_at, v_lead.data_zgloszenia);
        v_poprz_typ := 'zgloszenie';
      elsif v_klient.created_at <= u.created_at then
        v_poprz := v_klient.created_at;
        v_poprz_typ := 'kartoteka';
      end if;
    end if;

    if v_klient.id is null then
      insert into crm_clients (tenant_id, typ, nazwa, email, telefon, pesel)
      values (v_tenant, 'osoba', v_nazwa, v_email, v_tel, v_pesel)
      returning * into v_klient;
    elsif v_klient.email is null or v_klient.telefon is null then
      update crm_clients set email = coalesce(email, v_email), telefon = coalesce(telefon, v_tel)
      where id = v_klient.id
      returning * into v_klient;
    end if;

    if v_lead.id is null then
      v_status_nowy := v_status_ud;
      insert into crm_prospects (tenant_id, klient_id, nazwa, nip, telefon, email, status, zrodlo,
                                 zainteresowania, data_zgloszenia, ostatnie_zgloszenie_at, liczba_zgloszen, broker_id)
      values (v_tenant, v_klient.id, v_klient.nazwa, v_klient.nip, coalesce(v_klient.telefon, v_tel), coalesce(v_klient.email, v_email),
              v_status_nowy, 'utrata_dochodu', '{utrata_dochodu}'::text[], u.created_at, u.created_at, 1, v_klient.opiekun_id)
      returning * into v_lead;
      v_wynik := 'nowy';
    else
      v_status_nowy := crm_ud_status_docelowy(v_lead.status, v_status_ud, v_lead.zrodlo, true);
      update crm_prospects set
        klient_id = coalesce(klient_id, v_klient.id),
        zainteresowania = (select coalesce(array_agg(distinct k order by k), '{}') from unnest(zainteresowania || '{utrata_dochodu}'::text[]) as k),
        data_zgloszenia = least(coalesce(data_zgloszenia, u.created_at), u.created_at),
        ostatnie_zgloszenie_at = greatest(coalesce(ostatnie_zgloszenie_at, u.created_at), u.created_at),
        liczba_zgloszen = liczba_zgloszen + 1,
        zrodlo = coalesce(zrodlo, 'utrata_dochodu'),
        status = v_status_nowy
      where id = v_lead.id
      returning * into v_lead;
      v_wynik := 'ponowny';
    end if;

    insert into crm_zgloszenia (tenant_id, klient_id, prospect_id, zrodlo, ref, zgloszono_at, firma, kontakt, email, telefon, nip,
                                produkt, zainteresowania, przychod, ponowne, poprzednie_at, poprzednie_typ, historyczne, odczytane_at)
    values (v_tenant, v_klient.id, v_lead.id, 'utrata_dochodu', 'ud:' || u.id::text, u.created_at, null, v_nazwa, v_email, v_tel, null,
            'Ubezpieczenie utraty dochodu (wniosek w aplikacji)', '{utrata_dochodu}'::text[], null, v_ponowne,
            case when v_ponowne then v_poprz end, case when v_ponowne then v_poprz_typ end, false,
            case when v_ponowne and not p_backfill then null else now() end)
    on conflict (tenant_id, ref) where ref is not null do nothing
    returning id into v_zg;
    if v_zg is null then
      select id into v_zg from crm_zgloszenia where tenant_id = v_tenant and ref = 'ud:' || u.id::text;
    end if;

    v_opis := crm_ud_opis(v_dane, v_nazwa, v_tel, v_email);
    insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
    values (v_tenant, v_lead.id, 'notatka',
            case when v_ponowne then 'Ponowne zgłoszenie — wniosek w aplikacji Utrata Dochodu.' else 'Zgłoszenie z aplikacji Utrata Dochodu.' end || E'\n' || v_opis);
    if v_etap = 'przegrany' and l.sprzedano_at is null then
      insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
      values (v_tenant, v_lead.id, 'notatka', 'Przegrany w aplikacji Utrata Dochodu' || coalesce(': ' || nullif(btrim(l.powod_utraty), ''), '.'));
    end if;
    foreach v_n in array v_notatki_ofert loop
      insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc) values (v_tenant, v_lead.id, 'notatka', v_n);
    end loop;
    if l.sprzedano_at is not null then
      insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
      values (v_tenant, v_lead.id, 'notatka', crm_ud_opis_sprzedazy(v_dane));
    end if;

    if v_ponowne and not p_backfill and not exists (
      select 1 from crm_tasks t
      where t.klient_id = v_klient.id and t.zakonczone_at is null
        and t.tytul like 'Klient po raz kolejny prosi o ofertę%'
        and t.created_at > now() - interval '7 days'
    ) then
      insert into crm_tasks (tenant_id, assigned_to, klient_id, prospect_id, tytul, opis, termin, priorytet, status)
      values (v_tenant, coalesce(v_lead.broker_id, v_klient.opiekun_id), v_klient.id, v_lead.id,
              'Klient po raz kolejny prosi o ofertę: utrata dochodu (wniosek w aplikacji)', v_opis, current_date, 'wysoki', 'otwarte');
    end if;

    insert into crm_audit_log (tenant_id, action, entity_type, entity_id, entity_label, details)
    values (v_tenant, case when v_ponowne then 'client_resubmitted' else 'client_submitted' end, 'client', v_klient.id::text, v_klient.nazwa,
            jsonb_build_object('zgloszenie_id', v_zg, 'zrodlo', 'utrata_dochodu', 'ud_klient_id', u.id,
                               'produkt', 'Ubezpieczenie utraty dochodu', 'poprzednie_at', v_poprz, 'poprzednie_typ', v_poprz_typ));

    insert into crm_ud_leady (ud_klient_id, tenant_id, klient_id, prospect_id, zgloszenie_id, ud_lead_id, etap, status_crm, sprzedano_at, zarchiwizowano_at, dane)
    values (u.id, v_tenant, v_klient.id, v_lead.id, v_zg, l.id, v_etap, v_status_nowy, l.sprzedano_at, l.zarchiwizowano_at, v_dane);

    return jsonb_build_object('status', v_wynik, 'klient_id', v_klient.id, 'prospect_id', v_lead.id, 'etap', v_etap, 'status_crm', v_status_nowy);
  end if;

  -- ===== Kolejna synchronizacja: etap, oferty, sprzedaż, archiwum =====
  select * into v_lead from crm_prospects where id = m.prospect_id;
  if v_lead.id is null and m.klient_id is not null then
    select * into v_lead from crm_prospects where klient_id = m.klient_id;
  end if;
  if m.klient_id is not null then
    update crm_clients set email = coalesce(email, v_email), telefon = coalesce(telefon, v_tel)
    where id = m.klient_id and (email is null or telefon is null);
  end if;
  if v_lead.id is null then
    update crm_ud_leady set ud_lead_id = coalesce(ud_lead_id, l.id), etap = v_etap, sprzedano_at = l.sprzedano_at,
                            zarchiwizowano_at = l.zarchiwizowano_at, dane = v_dane, synced_at = now()
    where ud_klient_id = u.id;
    return jsonb_build_object('status', 'brak_leada_crm');
  end if;

  v_etap_zmiana := v_etap is distinct from m.etap;
  v_sprzedaz_nowa := l.sprzedano_at is not null and m.sprzedano_at is null;
  v_arch_nowe := l.zarchiwizowano_at is not null and m.zarchiwizowano_at is null;
  v_status_nowy := crm_ud_status_docelowy(v_lead.status, v_status_ud, v_lead.zrodlo, false);
  if v_arch_nowe and l.sprzedano_at is null and v_lead.zrodlo = 'utrata_dochodu' and v_lead.status not in ('wygrany', 'przegrany') then
    v_status_nowy := 'przegrany';
  end if;

  if v_status_nowy is distinct from v_lead.status then
    update crm_prospects set status = v_status_nowy where id = v_lead.id;
  end if;

  if v_etap_zmiana and not v_sprzedaz_nowa then
    insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
    values (v_lead.tenant_id, v_lead.id, 'notatka', concat_ws(E'\n',
      'Aplikacja Utrata Dochodu: etap „' || v_etap_nazwa || '”' || coalesce(' (wcześniej „' || (m.dane->>'etap_nazwa') || '”)', '') || '.',
      case when v_etap = 'przegrany' then 'Powód: ' || nullif(btrim(l.powod_utraty), '') end,
      case when v_status_nowy is distinct from v_lead.status then 'Etap leada w CRM: ' || crm_ud_etykieta('status', v_status_nowy) end));
  end if;
  foreach v_n in array v_notatki_ofert loop
    insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
    values (v_lead.tenant_id, v_lead.id, 'notatka', v_n
      || case when not v_etap_zmiana and v_status_nowy is distinct from v_lead.status then E'\nEtap leada w CRM: ' || crm_ud_etykieta('status', v_status_nowy) else '' end);
  end loop;
  if v_sprzedaz_nowa then
    insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
    values (v_lead.tenant_id, v_lead.id, 'notatka', crm_ud_opis_sprzedazy(v_dane));
    if not p_backfill and nullif(btrim(l.polisa_numer), '') is not null
       and not exists (
         select 1 from crm_policies p
         where p.tenant_id = v_lead.tenant_id and p.deleted_at is null
           and upper(regexp_replace(p.nr_polisy, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(l.polisa_numer, '[^A-Za-z0-9]', '', 'g')))
       and not exists (
         select 1 from crm_tasks t where t.prospect_id = v_lead.id and t.zakonczone_at is null and t.tytul like 'Wprowadź polisę ' || btrim(l.polisa_numer) || '%')
    then
      insert into crm_tasks (tenant_id, assigned_to, klient_id, prospect_id, tytul, opis, termin, priorytet, status)
      values (v_lead.tenant_id, coalesce(v_lead.broker_id, (select opiekun_id from crm_clients where id = v_lead.klient_id)), v_lead.klient_id, v_lead.id,
              'Wprowadź polisę ' || btrim(l.polisa_numer) || ' (utrata dochodu) sprzedaną w aplikacji', crm_ud_opis_sprzedazy(v_dane), current_date, 'normalny', 'otwarte');
    end if;
  end if;
  if v_arch_nowe and l.sprzedano_at is null then
    insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
    values (v_lead.tenant_id, v_lead.id, 'notatka', 'Lead zarchiwizowany w aplikacji Utrata Dochodu.'
      || case when v_status_nowy is distinct from v_lead.status then E'\nEtap leada w CRM: ' || crm_ud_etykieta('status', v_status_nowy) else '' end);
  end if;

  update crm_ud_leady set prospect_id = v_lead.id, klient_id = coalesce(klient_id, v_lead.klient_id), ud_lead_id = l.id, etap = v_etap,
                          status_crm = v_status_nowy, sprzedano_at = l.sprzedano_at, zarchiwizowano_at = l.zarchiwizowano_at,
                          dane = v_dane, synced_at = now()
  where ud_klient_id = u.id;

  return jsonb_build_object('status', case when v_etap_zmiana or v_sprzedaz_nowa or v_arch_nowe or v_oferty_zmiana or v_status_nowy is distinct from v_lead.status then 'zaktualizowany' else 'bez_zmian' end,
                            'klient_id', v_lead.klient_id, 'prospect_id', v_lead.id, 'etap', v_etap, 'status_crm', v_status_nowy);
end;
$$;

-- Cron / backfill: także wnioski, których oferty zmieniły się od ostatniej synchronizacji.
create or replace function public.crm_ud_synchronizuj(p_backfill boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v jsonb;
  v_st text;
  n jsonb := '{}'::jsonb;
  v_bledy int := 0;
begin
  if crm_ud_tenant() is null then
    return jsonb_build_object('status', 'wylaczone');
  end if;
  perform pg_advisory_xact_lock(hashtext('crm_ud_synchronizuj'));
  for r in
    select u.id
    from ud_clients u
    left join crm_ud_leady m on m.ud_klient_id = u.id
    left join ud_leady l on l.klient_id = u.id
    where m.ud_klient_id is null or l.updated_at > m.synced_at or l.etap_od > m.synced_at
       or exists (select 1 from ud_offers o where o.client_id = u.id
                  and greatest(o.updated_at, coalesce(o.sent_at, o.updated_at), coalesce(o.viewed_at, o.updated_at),
                               coalesce(o.decided_at, o.updated_at), coalesce(o.archived_at, o.updated_at)) > m.synced_at)
    order by u.created_at, u.id
  loop
    begin
      v := crm_ud_lead_do_crm(r.id, p_backfill);
      v_st := coalesce(v->>'status', 'nieznany');
    exception when others then
      v_st := 'blad';
      v_bledy := v_bledy + 1;
      raise warning 'crm_ud_synchronizuj %: %', r.id, sqlerrm;
    end;
    n := jsonb_set(n, array[v_st], to_jsonb(coalesce((n->>v_st)::int, 0) + 1));
  end loop;
  return n || jsonb_build_object('bledy', v_bledy);
end;
$$;

-- Trigger w aplikacji: wysłanie / obejrzenie / wybór / archiwum oferty.
create or replace function public.crm_ud_po_zmianie_oferty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null then
    begin
      perform crm_ud_lead_do_crm(new.client_id, false);
    exception when others then
      raise warning 'crm_ud (ud_offers %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_ud_oferta_do_crm on public.ud_offers;
create trigger crm_ud_oferta_do_crm
  after insert or update of status, sent_at, viewed_at, decided_at, archived_at, client_id, client_choice on public.ud_offers
  for each row execute function public.crm_ud_po_zmianie_oferty();

revoke execute on function public.crm_ud_po_zmianie_oferty() from public, anon, authenticated;
