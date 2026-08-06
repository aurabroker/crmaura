-- Towarzystwa obsługiwane przez moduł Importu polis.
-- Dopisujemy wyłącznie brakujące rekordy — istniejące zostają nietknięte,
-- nic nie jest usuwane ani nadpisywane.

do $$
declare
  t record;
  tu record;
begin
  for t in select id from crm_tenants loop
    for tu in
      select * from (values
        ('WARTA',   'TUiR WARTA S.A.',            '521-04-20-047', '0000016432'),
        ('ALLIANZ', 'TU Allianz Polska S.A.',     '525-15-65-015', '0000028261'),
        ('ERGO',    'STU ERGO Hestia S.A.',       '585-00-01-690', '0000024812'),
        ('PZU',     'PZU S.A.',                   '526-02-52-822', '0000009831'),
        ('UNIQA',   'UNIQA TU S.A.',              '107-00-06-155', '0000009075')
      ) as v(skrot, nazwa, nip, krs)
    loop
      -- Dopasowanie po skrócie ORAZ po nazwie, żeby nie zdublować towarzystwa
      -- wpisanego wcześniej ręcznie pod inną formą zapisu. Porównujemy tylko
      -- w obrębie działu majątkowego — spółki życiowe (np. PZU Życie) to odrębne
      -- podmioty i nie mogą blokować dodania spółki majątkowej.
      if not exists (
        select 1 from crm_insurers i
        where i.tenant_id = t.id
          and coalesce(i.dzial, 'Majątkowy') = 'Majątkowy'
          and (
            upper(coalesce(i.skrot, '')) = tu.skrot
            or upper(i.nazwa) like '%' || tu.skrot || '%'
          )
      ) then
        insert into crm_insurers (tenant_id, nazwa, skrot, dzial, nip, krs)
        values (t.id, tu.nazwa, tu.skrot, 'Majątkowy', tu.nip, tu.krs);
      end if;
    end loop;
  end loop;
end $$;
