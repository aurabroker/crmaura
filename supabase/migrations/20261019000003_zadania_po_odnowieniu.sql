-- ============================================================
-- STATUS: ZASTOSOWANA na produkcji 19.10.2026 (execute_sql).
--
-- Zadania:
-- 1. Domyślny stan zadania to „otwarte”. Dotąd kolumna miała domyślne „Oczekujące” — stan, którego interfejs
--    nie zna, więc zadania zakładane przez funkcje w bazie (ponowne zgłoszenia z formularza, konsultacje,
--    wnioski z aplikacji Utrata Dochodu) nie trafiały do Kolejki na dziś ani do listy zadań.
--    Istniejące „Oczekujące” stają się „otwarte” (zakończone, jeśli mają datę zakończenia).
-- 2. Zadanie z wniosku online (crm_tasks.renewal_id) zamyka się samo, gdy w CRM pojawia się polisa, która
--    ten wniosek załatwia: odnowienie — nowa polisa z renewal_of wskazującym na certyfikat z wniosku;
--    pierwsza polisa — polisa klienta zawarta po złożeniu wniosku. Zamknięcie trafia do rejestru zadań
--    (crm_task_history, bez autora) i do opisu zadania.
-- ============================================================

alter table public.crm_tasks alter column status set default 'otwarte';

update public.crm_tasks
set status = case when zakonczone_at is not null then 'zakonczone' else 'otwarte' end,
    updated_at = now()
where status = 'Oczekujące';

-- Zamyka otwarte zadania z wniosków, które załatwia polisa (odnowienie certyfikatu p_renewal_of albo pierwsza
-- polisa klienta p_klient zawarta po złożeniu wniosku). Zwraca liczbę zamkniętych zadań.
create or replace function public.crm_zamknij_zadania_po_polisie(p_tenant uuid, p_renewal_of uuid, p_klient uuid, p_od timestamptz, p_nr text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n integer := 0;
begin
  if p_tenant is null or (p_renewal_of is null and p_klient is null) then
    return 0;
  end if;
  for t in
    select z.* from crm_tasks z
    where z.tenant_id = p_tenant
      and z.zakonczone_at is null
      and z.status in ('otwarte', 'w_toku', 'Oczekujące')
      and z.renewal_id in (
        select r.id from crm_renewals r
        where r.tenant_id = p_tenant
          and ((p_renewal_of is not null and r.polisa_id = p_renewal_of)
               or (p_klient is not null and r.klient_id = p_klient and (r.rodzaj = 'nowa' or r.polisa_id is null)
                   and coalesce(r.zlozono_at, r.created_at) <= coalesce(p_od, now()) + interval '1 day')))
  loop
    update crm_tasks
    set status = 'zakonczone', zakonczone_at = now(), postep_pct = 100, updated_at = now(),
        opis = concat_ws(E'\n', nullif(opis, ''),
          'Zamknięte automatycznie: polisa ' || coalesce(nullif(btrim(p_nr), ''), '') || ' jest już w CRM ('
          || to_char(now() at time zone 'Europe/Warsaw', 'DD.MM.YYYY') || ').')
    where id = t.id;
    insert into crm_task_history (tenant_id, task_id, tytul_zadania, zmiana, stary_status, nowy_status, autor_id, klient_id, prospect_id)
    values (t.tenant_id, t.id, t.tytul, 'zakonczone', t.status, 'zakonczone', null, t.klient_id, t.prospect_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.crm_policies_zadania_po_odnowieniu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is null
     and old.renewal_of is not distinct from new.renewal_of and old.klient_id is not distinct from new.klient_id then
    return new;
  end if;
  begin
    perform crm_zamknij_zadania_po_polisie(new.tenant_id, new.renewal_of, new.klient_id, coalesce(new.created_at, now()), new.nr_polisy);
  exception when others then
    raise warning 'crm_policies_zadania_po_odnowieniu %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists crm_policies_zadania_po_odnowieniu on public.crm_policies;
create trigger crm_policies_zadania_po_odnowieniu
  after insert or update of renewal_of, deleted_at, klient_id on public.crm_policies
  for each row execute function public.crm_policies_zadania_po_odnowieniu();

revoke execute on function public.crm_zamknij_zadania_po_polisie(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.crm_policies_zadania_po_odnowieniu() from public, anon, authenticated;
grant execute on function public.crm_zamknij_zadania_po_polisie(uuid, uuid, uuid, timestamptz, text) to service_role;

-- Jednorazowo: zadania z wniosków, które polisy w CRM już załatwiły.
select coalesce(sum(public.crm_zamknij_zadania_po_polisie(p.tenant_id, p.renewal_of, p.klient_id, p.created_at, p.nr_polisy)), 0) as zamkniete
from public.crm_policies p
where p.deleted_at is null
  and (p.renewal_of is not null
       or exists (select 1 from public.crm_renewals r where r.tenant_id = p.tenant_id and r.klient_id = p.klient_id and (r.rodzaj = 'nowa' or r.polisa_id is null)));
