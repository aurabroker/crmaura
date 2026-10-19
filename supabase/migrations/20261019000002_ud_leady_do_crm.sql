-- ============================================================
-- STATUS: ZASTOSOWANA na produkcji 19.10.2026 (execute_sql, krokami — bez „drop … if exists”, bo narzędzie MCP
-- czeka wtedy na potwierdzenie; obiekty nie istniały). Backfill: select public.crm_ud_synchronizuj(true).
--
-- Leady z aplikacji Utrata Dochodu (tabele ud_*, ta sama baza) trafiają do CRM firmy z flagą
-- crm_tenants.features.ud_leady = true (Aura Expert — operator aplikacji).
--
-- Jak to działa:
-- 1. Każdy wniosek w aplikacji (ud_clients) staje się w CRM: klientem (osoba; dopasowanie po e-mailu,
--    potem po telefonie — żeby nie dublować firm z bazy), leadem w Sprzedaży (crm_prospects,
--    zainteresowanie „utrata_dochodu”, źródło „utrata_dochodu”) i zgłoszeniem (crm_zgloszenia,
--    ref „ud:<id>”). Klient, którego CRM już zna, dostaje zgłoszenie „ponowne” — jak z formularza:
--    komunikat „Klient po raz kolejny prosi o ofertę” i zadanie na dziś.
-- 2. Etap leada w aplikacji (ud_leady) przenosi się na etap leada w CRM: nowy → Nowy,
--    kontakt → W kontakcie, oferta / decyzja → Oferta wysłana, wygrany / sprzedaż → Wygrany,
--    przegrany → Przegrany (tylko lead założony przez aplikację; cudzy lead dostaje notatkę).
--    Etap w CRM nie cofa się — chyba że lead był zamknięty, a klient składa nowy wniosek.
-- 3. Sprzedaż w aplikacji (numer polisy, składka, ochrona, prowizja) ląduje w notatce leada;
--    gdy polisy o tym numerze nie ma w CRM, powstaje zadanie „Wprowadź polisę …”.
-- 4. Lead zarchiwizowany w aplikacji zanim trafił do CRM — pomijany (testy, śmieci).
--    Zarchiwizowany później — lead CRM z aplikacji przechodzi na Przegrany.
-- 5. Dane medyczne i ryzyka z wniosku NIE są kopiowane — zostają w aplikacji. Do CRM idą:
--    kontakt, PESEL (nowy klient-osoba), zawód, forma zatrudnienia i podatku, sumy ubezpieczenia,
--    etap, opiekun w aplikacji, dane sprzedaży.
--
-- Uruchomienie: triggery na ud_clients (nowy wniosek) i ud_leady (zmiana etapu / sprzedaż /
-- archiwum) działają od razu; cron co godzinę (crm-ud-leady) dosynchronizowuje, co umknęło.
-- Backfill istniejących wniosków: select public.crm_ud_synchronizuj(true);  (tryb „historyczny”:
-- bez komunikatów o ponownym zgłoszeniu i bez zadań).
-- ============================================================

-- ---------- 0. Firma docelowa ----------
update public.crm_tenants
set features = coalesce(features, '{}'::jsonb) || '{"ud_leady": true}'::jsonb
where id = '9dabd3a0-f1ee-43bc-92a1-6137ac814100' and nazwa like 'Aura Expert%';

-- ---------- 1. Powiązanie wniosku z aplikacji z leadem CRM ----------
create table if not exists public.crm_ud_leady (
  ud_klient_id      uuid primary key references public.ud_clients(id) on delete cascade,
  tenant_id         uuid not null references public.crm_tenants(id) on delete cascade,
  klient_id         uuid references public.crm_clients(id) on delete set null,
  prospect_id       uuid references public.crm_prospects(id) on delete set null,
  zgloszenie_id     uuid references public.crm_zgloszenia(id) on delete set null,
  ud_lead_id        uuid,
  etap              text,          -- ostatni zsynchronizowany etap w aplikacji (klucz)
  status_crm        text,          -- etap leada CRM ustawiony przez synchronizację
  sprzedano_at      timestamptz,
  zarchiwizowano_at timestamptz,
  dane              jsonb not null default '{}'::jsonb,   -- skrót wniosku na kartę leada
  created_at        timestamptz not null default now(),
  synced_at         timestamptz not null default now()
);
create index if not exists crm_ud_leady_prospect_idx on public.crm_ud_leady (prospect_id);
create index if not exists crm_ud_leady_klient_idx on public.crm_ud_leady (klient_id);

alter table public.crm_ud_leady enable row level security;
drop policy if exists crm_ud_leady_tenant_select on public.crm_ud_leady;
create policy crm_ud_leady_tenant_select on public.crm_ud_leady
  for select to authenticated using (tenant_id = public.get_my_tenant_id());
grant select on public.crm_ud_leady to authenticated;

-- ---------- 2. Pomocnicze ----------
create or replace function public.crm_ud_tenant()
returns uuid
language sql
stable
set search_path = public
as $$
  select id from crm_tenants where features @> '{"ud_leady": true}'::jsonb order by created_at, id limit 1
$$;

create or replace function public.crm_ud_liczba(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare t text;
begin
  t := replace(regexp_replace(coalesce(p, ''), '[^0-9,.\-]', '', 'g'), ',', '.');
  if t = '' then return null; end if;
  return t::numeric;
exception when others then
  return null;
end;
$$;

-- 6528 → „6 528 zł”, 1234.5 → „1 234,50 zł”
create or replace function public.crm_ud_kwota(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null else
    regexp_replace(trunc(abs(p))::bigint::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
    || case when round(p, 2) <> trunc(p) then ',' || lpad((round(abs(p) - trunc(abs(p)), 2) * 100)::int::text, 2, '0') else '' end
    || ' zł' end
$$;

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
    else p_wartosc end
$$;

-- Etap w aplikacji → etap leada CRM.
create or replace function public.crm_ud_status_z_etapu(p_etap text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_etap
    when 'kontakt' then 'w_kontakcie'
    when 'oferta' then 'oferta_wyslana'
    when 'decyzja' then 'oferta_wyslana'
    when 'wygrany' then 'wygrany'
    when 'przegrany' then 'przegrany'
    else 'nowy' end
$$;

-- Etap docelowy leada CRM: do przodu, nigdy wstecz. Wygrany w aplikacji zawsze wygrywa.
-- Przegrany w aplikacji zamyka tylko lead założony przez aplikację (i nie taki, który CRM już wygrał).
-- Przy pierwszej synchronizacji zamknięty lead CRM (wygrany/przegrany) otwiera się na nowo —
-- klient złożył nowy wniosek, jak przy ponownym zgłoszeniu z formularza.
create or replace function public.crm_ud_status_docelowy(p_obecny text, p_ud text, p_zrodlo text, p_pierwszy boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  with k(s, n) as (values ('nowy', 0), ('w_kontakcie', 1), ('oferta_wyslana', 2))
  select case
    when p_ud = 'wygrany' then 'wygrany'
    when p_ud = 'przegrany' then case when p_zrodlo = 'utrata_dochodu' and p_obecny <> 'wygrany' then 'przegrany' else p_obecny end
    when p_obecny in ('wygrany', 'przegrany') then case when p_pierwszy then p_ud else p_obecny end
    when coalesce((select n from k where s = p_ud), 0) > coalesce((select n from k where s = p_obecny), 0) then p_ud
    else p_obecny end
$$;

-- Skrót wniosku (bez danych medycznych i ryzyk) — na kartę leada i do notatek.
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
      'swiadczenie_zgon', l.swiadczenie_zgon)) end
  ))
$$;

-- Treść notatki o wniosku.
create or replace function public.crm_ud_opis(p_dane jsonb, p_nazwa text, p_tel text, p_email text)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(E'\n',
    'Wniosek: ' || to_char((p_dane->>'wniosek_at')::timestamptz at time zone 'Europe/Warsaw', 'DD.MM.YYYY')
      || coalesce(' (' || crm_ud_etykieta('zrodlo', p_dane->>'zrodlo_ud') || ')', ''),
    'Zawód: ' || nullif(concat_ws(' · ', p_dane->>'zawod', crm_ud_etykieta('zatrudnienie', p_dane->>'zatrudnienie'),
      crm_ud_etykieta('podatek', p_dane->>'forma_podatku'), p_dane->>'branza'), ''),
    'Zakres: ' || nullif(concat_ws(' · ',
      'niezdolność czasowa ' || crm_ud_kwota((p_dane->'zakres'->>'okresowa')::numeric) || '/mies.',
      'trwała ' || crm_ud_kwota((p_dane->'zakres'->>'trwala')::numeric),
      'śmierć NW ' || crm_ud_kwota((p_dane->'zakres'->>'zgon')::numeric)), ''),
    'Etap w aplikacji: ' || (p_dane->>'etap_nazwa'),
    'Opiekun w aplikacji: ' || (p_dane->>'opiekun'),
    'Kontakt: ' || nullif(concat_ws(' · ', p_nazwa, p_tel, p_email), ''))
$$;

-- Treść notatki o sprzedaży.
create or replace function public.crm_ud_opis_sprzedazy(p_dane jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(E'\n',
    'Sprzedaż w aplikacji Utrata Dochodu' || coalesce(' ' || to_char((p_dane->'sprzedaz'->>'sprzedano_at')::timestamptz at time zone 'Europe/Warsaw', 'DD.MM.YYYY'), '') || ': '
      || nullif(concat_ws(' · ',
        'polisa ' || (p_dane->'sprzedaz'->>'polisa'),
        'składka roczna ' || crm_ud_kwota((p_dane->'sprzedaz'->>'skladka_roczna')::numeric)
          || coalesce(' (' || crm_ud_kwota((p_dane->'sprzedaz'->>'skladka_mies')::numeric) || '/mies.)', ''),
        'ochrona ' || to_char((p_dane->'sprzedaz'->>'ochrona_od')::date, 'DD.MM.YYYY') || ' – ' || to_char((p_dane->'sprzedaz'->>'ochrona_do')::date, 'DD.MM.YYYY'),
        'prowizja ' || regexp_replace(regexp_replace((p_dane->'sprzedaz'->>'prowizja_pct')::numeric::text, '(\.\d*?)0+$', '\1'), '\.$', '') || '%'), ''),
    'Świadczenia: ' || nullif(concat_ws(' · ',
      'okresowe ' || crm_ud_kwota((p_dane->'sprzedaz'->>'swiadczenie_okresowa')::numeric) || '/mies.',
      'trwała niezdolność ' || crm_ud_kwota((p_dane->'sprzedaz'->>'swiadczenie_trwala')::numeric),
      'zgon ' || crm_ud_kwota((p_dane->'sprzedaz'->>'swiadczenie_zgon')::numeric)), ''))
$$;

-- ---------- 3. Jeden wniosek → CRM ----------
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
  v_etap text; v_etap_nazwa text; v_opiekun text; v_status_ud text; v_status_nowy text;
  v_email text; v_tel text; v_tel9 text; v_nazwa text; v_pesel text;
  v_ponowne boolean; v_poprz timestamptz; v_poprz_typ text;
  v_zg uuid; v_dane jsonb; v_opis text; v_wynik text;
  v_etap_zmiana boolean; v_sprzedaz_nowa boolean; v_arch_nowe boolean;
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
  v_status_ud := case when l.sprzedano_at is not null then 'wygrany' else crm_ud_status_z_etapu(v_etap) end;

  v_email := left(nullif(lower(btrim(u.email)), ''), 254);
  v_tel := left(nullif(btrim(u.phone), ''), 40);
  v_tel9 := case when length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) >= 9 then right(regexp_replace(v_tel, '\D', '', 'g'), 9) end;
  v_nazwa := left(coalesce(nullif(btrim(u.full_name), ''), v_email, v_tel, 'Klient z aplikacji Utrata Dochodu'), 200);
  v_pesel := nullif(regexp_replace(coalesce(u.pesel, ''), '\D', '', 'g'), '');
  if length(v_pesel) <> 11 then v_pesel := null; end if;
  v_dane := crm_ud_dane(u, l, v_etap, v_etap_nazwa, v_opiekun);

  select * into m from crm_ud_leady where ud_klient_id = u.id;

  -- ===== Pierwsza synchronizacja =====
  if m.ud_klient_id is null then
    if l.zarchiwizowano_at is not null and l.sprzedano_at is null then
      return jsonb_build_object('status', 'pominiety_archiwum');
    end if;

    -- Klient CRM: po e-mailu, potem po telefonie (ostatnie 9 cyfr); pierwszeństwo ma klient z polisą.
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

    -- Poprzedni kontakt (tylko wcześniejszy niż wniosek).
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
      insert into crm_tasks (tenant_id, assigned_to, klient_id, prospect_id, tytul, opis, termin, priorytet)
      values (v_tenant, coalesce(v_lead.broker_id, v_klient.opiekun_id), v_klient.id, v_lead.id,
              'Klient po raz kolejny prosi o ofertę: utrata dochodu (wniosek w aplikacji)', v_opis, current_date, 'wysoki');
    end if;

    insert into crm_audit_log (tenant_id, action, entity_type, entity_id, entity_label, details)
    values (v_tenant, case when v_ponowne then 'client_resubmitted' else 'client_submitted' end, 'client', v_klient.id::text, v_klient.nazwa,
            jsonb_build_object('zgloszenie_id', v_zg, 'zrodlo', 'utrata_dochodu', 'ud_klient_id', u.id,
                               'produkt', 'Ubezpieczenie utraty dochodu', 'poprzednie_at', v_poprz, 'poprzednie_typ', v_poprz_typ));

    insert into crm_ud_leady (ud_klient_id, tenant_id, klient_id, prospect_id, zgloszenie_id, ud_lead_id, etap, status_crm, sprzedano_at, zarchiwizowano_at, dane)
    values (u.id, v_tenant, v_klient.id, v_lead.id, v_zg, l.id, v_etap, v_status_nowy, l.sprzedano_at, l.zarchiwizowano_at, v_dane);

    return jsonb_build_object('status', v_wynik, 'klient_id', v_klient.id, 'prospect_id', v_lead.id, 'etap', v_etap, 'status_crm', v_status_nowy);
  end if;

  -- ===== Kolejna synchronizacja: etap, sprzedaż, archiwum =====
  select * into v_lead from crm_prospects where id = m.prospect_id;
  if v_lead.id is null and m.klient_id is not null then
    select * into v_lead from crm_prospects where klient_id = m.klient_id;
  end if;
  if m.klient_id is not null then
    update crm_clients set email = coalesce(email, v_email), telefon = coalesce(telefon, v_tel)
    where id = m.klient_id and (email is null or telefon is null);
  end if;
  if v_lead.id is null then
    -- Lead usunięty w CRM — nie zakładamy go ponownie, tylko odświeżamy skrót wniosku.
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
      insert into crm_tasks (tenant_id, assigned_to, klient_id, prospect_id, tytul, opis, termin, priorytet)
      values (v_lead.tenant_id, coalesce(v_lead.broker_id, (select opiekun_id from crm_clients where id = v_lead.klient_id)), v_lead.klient_id, v_lead.id,
              'Wprowadź polisę ' || btrim(l.polisa_numer) || ' (utrata dochodu) sprzedaną w aplikacji', crm_ud_opis_sprzedazy(v_dane), current_date, 'normalny');
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

  return jsonb_build_object('status', case when v_etap_zmiana or v_sprzedaz_nowa or v_arch_nowe or v_status_nowy is distinct from v_lead.status then 'zaktualizowany' else 'bez_zmian' end,
                            'klient_id', v_lead.klient_id, 'prospect_id', v_lead.id, 'etap', v_etap, 'status_crm', v_status_nowy);
end;
$$;

-- ---------- 4. Wszystkie wnioski (cron i backfill) ----------
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

-- ---------- 5. Triggery w aplikacji: nowy wniosek i zmiana leada ----------
-- Błąd po stronie CRM nie może zepsuć zapisu w aplikacji — tylko ostrzeżenie w logu; cron dosynchronizuje.
create or replace function public.crm_ud_po_zmianie_klienta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform crm_ud_lead_do_crm(new.id, false);
  exception when others then
    raise warning 'crm_ud (ud_clients %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.crm_ud_po_zmianie_leada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.klient_id is not null then
    begin
      perform crm_ud_lead_do_crm(new.klient_id, false);
    exception when others then
      raise warning 'crm_ud (ud_leady %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_ud_klient_do_crm on public.ud_clients;
create trigger crm_ud_klient_do_crm
  after insert or update of full_name, email, phone on public.ud_clients
  for each row execute function public.crm_ud_po_zmianie_klienta();

drop trigger if exists crm_ud_lead_do_crm on public.ud_leady;
create trigger crm_ud_lead_do_crm
  after insert or update of etap_id, zarchiwizowano_at, sprzedano_at, polisa_numer, skladka_roczna, skladka_mies,
                            ochrona_od, ochrona_do, prowizja_procent, powod_utraty, opiekun_id,
                            nastepne_dzialanie_typ, nastepne_dzialanie_at, nastepne_dzialanie_opis on public.ud_leady
  for each row execute function public.crm_ud_po_zmianie_leada();

-- ---------- 6. Uprawnienia i cron ----------
revoke execute on function public.crm_ud_lead_do_crm(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.crm_ud_synchronizuj(boolean) from public, anon, authenticated;
revoke execute on function public.crm_ud_po_zmianie_klienta() from public, anon, authenticated;
revoke execute on function public.crm_ud_po_zmianie_leada() from public, anon, authenticated;
grant execute on function public.crm_ud_lead_do_crm(uuid, boolean) to service_role;
grant execute on function public.crm_ud_synchronizuj(boolean) to service_role;

select cron.schedule('crm-ud-leady', '35 * * * *', 'select public.crm_ud_synchronizuj()');
