-- Update ug_podtyp check constraint to include beauty_tax
alter table crm_policies drop constraint if exists crm_policies_ug_podtyp_check;
alter table crm_policies add constraint crm_policies_ug_podtyp_check
  check (ug_podtyp in ('flota','gwarancje','cpm','car_ear','oc_beauty','beauty_tax'));

-- Update rodzaj check constraint to include karno_skarbowa
alter table crm_policies drop constraint if exists crm_policies_rodzaj_check;
alter table crm_policies add constraint crm_policies_rodzaj_check
  check (rodzaj in (
    'majątkowa','życie','grupowe_medyczne','grupowe_życie','utrata_dochodu',
    'komunikacja','flota','finansowa','OC','techniczna','karno_skarbowa','polisa_obca',
    'umowa_generalna_flota','umowa_generalna_gwarancje','umowa_generalna_cpm',
    'umowa_generalna_car_ear','umowa_generalna_oc_beauty','umowa_generalna_beauty_tax'
  ));
