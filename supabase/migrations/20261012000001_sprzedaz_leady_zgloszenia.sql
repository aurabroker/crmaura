-- ============================================================
-- STATUS: ZASTOSOWANA na produkcji 11.10.2026 (execute_sql, krokami; 1311 leadów powiązanych, 184 nowe, 11 wygranych).
-- Sprzedaż: leady powiązane z klientami, zgłoszenia z formularza, maile kampanii z BEAUTY.
--
-- 1. crm_prospects.klient_id — lead firmy z kartoteki (jeden na klienta). Dane firmy (nazwa, NIP, kontakt)
--    są w kliencie; lead trzyma etap sprzedaży, zainteresowania, przychód i historię zgłoszeń.
--    Każda firma bez polisy ma lead; dodanie polisy zamyka otwarty lead jako „wygrany”.
-- 2. crm_zgloszenia — każde zgłoszenie z formularza (arkusz Google → Apps Script → /api/leady/zgloszenia).
--    Zgłoszenie firmy, którą już znamy, jest „ponowne”: agent dostaje komunikat i zadanie na dziś.
-- 3. crm_klucze_integracji — klucze, którymi arkusz wysyła zgłoszenia (w bazie tylko skrót SHA-256).
-- 4. crm_kampanie_maile — maile kampanii wysłane przez BEAUTY (Aura HUB) z ich statusem (synchronizacja nocna).
--
-- Kody zainteresowań: oc, tax, utrata_dochodu, zdrowie, grupowe, konsultacja, inne.
-- ============================================================

-- ---------- Zainteresowania: tekst z formularza → kody ----------
create or replace function public.crm_kody_zainteresowan(p_tekst text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct kod order by kod), '{}')
  from (
    select case
      when x ~* '(karno|skarbow|podatkow|\mtax\M)' then 'tax'
      when x ~* 'utrat' then 'utrata_dochodu'
      when x ~* '(zdrow|medycz)' then 'zdrowie'
      when x ~* 'grupow' then 'grupowe'
      when x ~* '(nie wiem|konsult)' then 'konsultacja'
      when x ~ '\mOC\M' or x ~* 'odpowiedzialno' then 'oc'
      when btrim(x) <> '' then 'inne'
    end as kod
    from regexp_split_to_table(coalesce(p_tekst, ''), '\s*[,;]\s*') as x
  ) k
  where kod is not null;
$$;

-- ---------- 1. Lead powiązany z klientem ----------
alter table public.crm_prospects add column if not exists klient_id uuid references public.crm_clients(id) on delete set null;
alter table public.crm_prospects add column if not exists zainteresowania text[] not null default '{}';
alter table public.crm_prospects add column if not exists przychod text;
alter table public.crm_prospects add column if not exists zrodlo text;
alter table public.crm_prospects add column if not exists data_zgloszenia timestamptz;
alter table public.crm_prospects add column if not exists ostatnie_zgloszenie_at timestamptz;
alter table public.crm_prospects add column if not exists liczba_zgloszen integer not null default 0;
alter table public.crm_prospects add column if not exists status_zmieniony_at timestamptz;

create unique index if not exists crm_prospects_klient_uq on public.crm_prospects (klient_id) where klient_id is not null;
create index if not exists crm_prospects_tenant_status_idx on public.crm_prospects (tenant_id, status);

-- Lead i jego klient muszą należeć do tej samej firmy; zmiana etapu zapisuje datę.
create or replace function public.crm_prospects_przed_zapisem()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.klient_id is not null and not exists (
    select 1 from crm_clients c where c.id = new.klient_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Klient leada należy do innej firmy';
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_zmieniony_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists crm_prospects_przed_zapisem on public.crm_prospects;
create trigger crm_prospects_przed_zapisem
  before insert or update of klient_id, tenant_id, status on public.crm_prospects
  for each row execute function public.crm_prospects_przed_zapisem();

-- Polisa klienta zamyka jego otwarty lead jako „wygrany” (z wpisem w aktywności leada).
create or replace function public.crm_lead_wygrany_po_polisie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead record;
begin
  if new.deleted_at is not null or new.klient_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is null and old.klient_id is not distinct from new.klient_id then
    return new;
  end if;
  for v_lead in
    update crm_prospects set status = 'wygrany'
    where klient_id = new.klient_id and tenant_id = new.tenant_id
      and status in ('nowy', 'w_kontakcie', 'oferta_wyslana')
    returning id, tenant_id
  loop
    insert into crm_prospect_activities (tenant_id, prospect_id, typ, tresc)
    values (v_lead.tenant_id, v_lead.id, 'notatka',
            'Automatycznie: Wygrany — klient ma polisę ' || coalesce(new.nr_polisy, '') || ' (' || coalesce(new.rodzaj, '') || ').');
  end loop;
  return new;
end;
$$;

drop trigger if exists crm_policies_lead_wygrany on public.crm_policies;
create trigger crm_policies_lead_wygrany
  after insert or update of deleted_at, klient_id on public.crm_policies
  for each row execute function public.crm_lead_wygrany_po_polisie();

-- ---------- Jednorazowo: istniejące leady i firmy bez polis ----------
-- a) Leady (kopie z importu) wiążemy z klientem o tym samym NIP w tej samej firmie.
--    Klient bazowy: z polisą, potem najstarszy. Jeden lead na klienta (najstarszy).
with kandydaci as (
  select pr.id as lead_id, pr.created_at as lead_utworzony, c.id as klient_id,
         row_number() over (
           partition by pr.id
           order by exists (select 1 from crm_policies p where p.klient_id = c.id and p.deleted_at is null) desc,
                    c.created_at, c.id
         ) as nr_klienta
  from crm_prospects pr
  join crm_clients c
    on c.tenant_id = pr.tenant_id
   and regexp_replace(coalesce(c.nip, ''), '\D', '', 'g') = regexp_replace(coalesce(pr.nip, ''), '\D', '', 'g')
  where pr.klient_id is null
    and length(regexp_replace(coalesce(pr.nip, ''), '\D', '', 'g')) = 10
),
jeden as (
  select lead_id, klient_id,
         row_number() over (partition by klient_id order by lead_utworzony, lead_id) as nr_leada
  from kandydaci
  where nr_klienta = 1
)
update crm_prospects pr
set klient_id = j.klient_id
from jeden j
where pr.id = j.lead_id
  and j.nr_leada = 1
  and not exists (select 1 from crm_prospects x where x.klient_id = j.klient_id);

update crm_prospects set zrodlo = 'import'
where zrodlo is null and notatki like 'Import z bazy klientów%';

-- b) Klient ma już polisę → jego lead jest wygrany.
update crm_prospects pr set status = 'wygrany'
where pr.klient_id is not null
  and pr.status in ('nowy', 'w_kontakcie', 'oferta_wyslana')
  and exists (select 1 from crm_policies p where p.klient_id = pr.klient_id and p.deleted_at is null);

-- c) Firmy bez polis (także jako ubezpieczony) i bez leada dostają lead „Nowy”.
insert into crm_prospects (tenant_id, klient_id, nazwa, nip, adres, telefon, email, status, zrodlo, broker_id)
select c.tenant_id, c.id, c.nazwa, c.nip, c.ulica, c.telefon, c.email, 'nowy',
       case when c.beauty_id is not null then 'beauty' else 'kartoteka' end, c.opiekun_id
from crm_clients c
where c.typ = 'firma'
  and not exists (select 1 from crm_policies p where (p.klient_id = c.id or p.ubezpieczony_id = c.id) and p.deleted_at is null)
  and not exists (select 1 from crm_prospects x where x.klient_id = c.id);

-- ---------- 2. Zgłoszenia z formularza ----------
create table if not exists public.crm_zgloszenia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  klient_id uuid references public.crm_clients(id) on delete set null,
  prospect_id uuid references public.crm_prospects(id) on delete set null,
  zrodlo text not null default 'arkusz',
  ref text,
  zgloszono_at timestamptz not null default now(),
  firma text,
  kontakt text,
  email text,
  telefon text,
  nip text,
  produkt text,
  zainteresowania text[] not null default '{}',
  przychod text,
  ponowne boolean not null default false,
  poprzednie_at timestamptz,
  poprzednie_typ text check (poprzednie_typ is null or poprzednie_typ in ('zgloszenie', 'kartoteka')),
  historyczne boolean not null default false,
  odczytane_at timestamptz,
  odczytal uuid references public.crm_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists crm_zgloszenia_ref_uq on public.crm_zgloszenia (tenant_id, ref) where ref is not null;
create index if not exists crm_zgloszenia_klient_idx on public.crm_zgloszenia (klient_id, zgloszono_at desc);
create index if not exists crm_zgloszenia_nieodczytane_idx on public.crm_zgloszenia (tenant_id) where ponowne and odczytane_at is null;

alter table public.crm_zgloszenia enable row level security;
drop policy if exists crm_zgloszenia_tenant_select on public.crm_zgloszenia;
create policy crm_zgloszenia_tenant_select on public.crm_zgloszenia
  for select to authenticated using (tenant_id = get_my_tenant_id());
drop policy if exists crm_zgloszenia_tenant_odczyt on public.crm_zgloszenia;
create policy crm_zgloszenia_tenant_odczyt on public.crm_zgloszenia
  for update to authenticated using (tenant_id = get_my_tenant_id()) with check (tenant_id = get_my_tenant_id());
-- Z aplikacji wolno tylko oznaczyć zgłoszenie jako odczytane; zapis zgłoszeń wyłącznie przez funkcję poniżej.
revoke insert, update, delete on public.crm_zgloszenia from anon, authenticated;
grant select on public.crm_zgloszenia to authenticated;
grant update (odczytane_at, odczytal) on public.crm_zgloszenia to authenticated;

-- ---------- 3. Klucze integracji (arkusz → CRM) ----------
create table if not exists public.crm_klucze_integracji (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  nazwa text not null default 'Formularz zgłoszeń',
  hash text not null unique,
  prefiks text not null,
  utworzyl uuid references public.crm_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  ostatnio_uzyty_at timestamptz,
  wylaczony_at timestamptz
);
-- Bez polityk: tabelę czyta i zapisuje tylko serwer (klucz service role).
alter table public.crm_klucze_integracji enable row level security;
revoke all on public.crm_klucze_integracji from anon, authenticated;

-- ---------- Przyjęcie paczki zgłoszeń (wywołuje wyłącznie serwer CRM) ----------
-- Wiersz: { company, contact, email, phone, nip, ubezpieczenie, przychod, ref?, data?, historyczne? }
-- historyczne = wiersz sprzed uruchomienia integracji: tylko zapis w historii (bez zakładania klientów,
-- komunikatów i zadań). Każde zgłoszenie jest zapisywane raz (ref).
create or replace function public.crm_przyjmij_zgloszenia(p_hash text, p_wiersze jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  r jsonb;
  v_firma text; v_kontakt text; v_email text; v_tel text; v_nip text;
  v_produkt text; v_przychod text; v_ref text; v_hist boolean; v_data timestamptz;
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

    -- Klient: po NIP, a bez NIP po e-mailu (tylko gdy któraś strona nie ma NIP — inny NIP to inna firma).
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

    -- Lead klienta albo niepowiązany lead z tym samym NIP.
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

    -- Poprzednie zgłoszenie: z historii zgłoszeń, z leada (np. data z BEAUTY), a w ostateczności data w kartotece.
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
      -- Nowa firma: od razu klient w kartotece.
      if v_klient.id is null then
        insert into crm_clients (tenant_id, typ, nazwa, nip, email, telefon)
        values (v_tenant,
                case when v_firma is not null or length(v_nip) = 10 then 'firma' else 'osoba' end,
                coalesce(v_firma, v_kontakt, v_email, v_nip),
                v_nip, v_email, v_tel)
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
        -- Ponowna prośba o ofertę otwiera zamknięty lead na nowo.
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
      -- Jedno otwarte zadanie na klienta (podwójne wysłanie formularza nie mnoży zadań).
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
$$;

revoke all on function public.crm_przyjmij_zgloszenia(text, jsonb) from public, anon, authenticated;
grant execute on function public.crm_przyjmij_zgloszenia(text, jsonb) to service_role;

-- ---------- Zainteresowania z BEAUTY (wywołuje nocna synchronizacja) ----------
-- Wiersz: { klient_id, ubezpieczenie, zainteresowania, przychod, data }.
-- Firma bez polisy i bez leada dostaje lead „Nowy”; istniejący lead dostaje brakujące zainteresowania,
-- przychód i datę pierwszego zgłoszenia (nic, co ustawiono w CRM, nie jest nadpisywane).
create or replace function public.crm_beauty_leady(p_tenant uuid, p_wiersze jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_klient crm_clients%rowtype;
  v_lead crm_prospects%rowtype;
  v_kody text[]; v_przychod text; v_data timestamptz;
  n_nowe int := 0; n_uzup int := 0;
begin
  if jsonb_typeof(p_wiersze) is distinct from 'array' then
    raise exception 'zle_dane' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_wiersze) loop
    v_klient := null;
    begin
      select * into v_klient from crm_clients where id = (r->>'klient_id')::uuid and tenant_id = p_tenant;
    exception when others then
      continue;
    end;
    if v_klient.id is null then
      continue;
    end if;
    v_kody := crm_kody_zainteresowan(concat_ws(', ', r->>'ubezpieczenie', r->>'zainteresowania'));
    v_przychod := left(nullif(btrim(r->>'przychod'), ''), 100);
    begin
      v_data := nullif(btrim(r->>'data'), '')::timestamptz;
    exception when others then
      v_data := null;
    end;

    v_lead := null;
    select * into v_lead from crm_prospects where klient_id = v_klient.id;
    if v_lead.id is null and length(regexp_replace(coalesce(v_klient.nip, ''), '\D', '', 'g')) = 10 then
      select * into v_lead from crm_prospects pr
      where pr.tenant_id = p_tenant and pr.klient_id is null
        and regexp_replace(coalesce(pr.nip, ''), '\D', '', 'g') = regexp_replace(v_klient.nip, '\D', '', 'g')
      order by pr.created_at
      limit 1;
      if v_lead.id is not null then
        update crm_prospects set klient_id = v_klient.id where id = v_lead.id;
      end if;
    end if;

    if v_lead.id is null then
      if v_klient.typ <> 'firma' or exists (
        select 1 from crm_policies p
        where (p.klient_id = v_klient.id or p.ubezpieczony_id = v_klient.id) and p.deleted_at is null
      ) then
        continue;
      end if;
      insert into crm_prospects (tenant_id, klient_id, nazwa, nip, adres, telefon, email, status, zrodlo,
                                 zainteresowania, przychod, data_zgloszenia, broker_id)
      values (p_tenant, v_klient.id, v_klient.nazwa, v_klient.nip, v_klient.ulica, v_klient.telefon, v_klient.email,
              'nowy', 'beauty', v_kody, v_przychod, v_data, v_klient.opiekun_id);
      n_nowe := n_nowe + 1;
    else
      update crm_prospects set
        zainteresowania = (select coalesce(array_agg(distinct k order by k), '{}') from unnest(zainteresowania || v_kody) as k),
        przychod = coalesce(przychod, v_przychod),
        data_zgloszenia = coalesce(data_zgloszenia, v_data),
        zrodlo = coalesce(zrodlo, 'beauty')
      where id = v_lead.id
        and (not (zainteresowania @> v_kody)
             or (przychod is null and v_przychod is not null)
             or (data_zgloszenia is null and v_data is not null)
             or zrodlo is null);
      if found then
        n_uzup := n_uzup + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('nowe_leady', n_nowe, 'uzupelnione', n_uzup);
end;
$$;

revoke all on function public.crm_beauty_leady(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_beauty_leady(uuid, jsonb) to service_role;

-- ---------- 4. Maile kampanii z BEAUTY ----------
create table if not exists public.crm_kampanie_maile (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  klient_id uuid not null references public.crm_clients(id) on delete cascade,
  zrodlo text not null default 'beauty',
  zewn_id text not null,
  kampania text,
  kod text,
  temat text,
  adres text,
  status text,
  wyslano_at timestamptz,
  dostarczono_at timestamptz,
  otwarto_at timestamptz,
  kliknieto_at timestamptz,
  odbito_at timestamptz,
  zaktualizowano_at timestamptz not null default now(),
  constraint crm_kampanie_maile_zewn_uq unique (tenant_id, zrodlo, zewn_id)
);
create index if not exists crm_kampanie_maile_klient_idx on public.crm_kampanie_maile (klient_id, wyslano_at desc);

alter table public.crm_kampanie_maile enable row level security;
drop policy if exists crm_kampanie_maile_tenant_select on public.crm_kampanie_maile;
create policy crm_kampanie_maile_tenant_select on public.crm_kampanie_maile
  for select to authenticated using (tenant_id = get_my_tenant_id());
revoke insert, update, delete on public.crm_kampanie_maile from anon, authenticated;
grant select on public.crm_kampanie_maile to authenticated;

-- Podsumowanie na klienta (lista leadów): ile maili, otwarcia, kliknięcia, odbicia.
create or replace view public.crm_kampanie_podsumowanie
with (security_invoker = true) as
select tenant_id, klient_id,
       count(*)::int as maile,
       count(otwarto_at)::int as otwarte,
       count(kliknieto_at)::int as klikniete,
       count(odbito_at)::int as odbite,
       max(wyslano_at) as ostatni_at,
       (array_agg(kampania order by wyslano_at desc nulls last))[1] as ostatnia_kampania,
       max(kliknieto_at) as ostatni_klik_at,
       (array_agg(kampania order by kliknieto_at desc) filter (where kliknieto_at is not null))[1] as ostatni_klik_kampania
from public.crm_kampanie_maile
group by tenant_id, klient_id;
grant select on public.crm_kampanie_podsumowanie to authenticated;

-- ROLLBACK:
--   drop view if exists crm_kampanie_podsumowanie;
--   drop table if exists crm_kampanie_maile, crm_zgloszenia, crm_klucze_integracji;
--   drop function if exists crm_przyjmij_zgloszenia(text, jsonb), crm_beauty_leady(uuid, jsonb), crm_kody_zainteresowan(text);
--   drop trigger if exists crm_policies_lead_wygrany on crm_policies; drop function if exists crm_lead_wygrany_po_polisie();
--   drop trigger if exists crm_prospects_przed_zapisem on crm_prospects; drop function if exists crm_prospects_przed_zapisem();
--   alter table crm_prospects drop column klient_id, drop column zainteresowania, drop column przychod, drop column zrodlo,
--     drop column data_zgloszenia, drop column ostatnie_zgloszenie_at, drop column liczba_zgloszen, drop column status_zmieniony_at;
--   (statusy „wygrany” ustawione w kroku b) i leady z kroku c) — patrz zrzut przed migracją w scratchpad)
