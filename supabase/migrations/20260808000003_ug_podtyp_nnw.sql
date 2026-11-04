-- Umowa generalna NNW (program następstw nieszczęśliwych wypadków, np. ERGO Hestia
-- Biznes & Podróż dla gabinetów z programu beauty): nowy podtyp 'nnw'. Certyfikaty NNW
-- nie drukują numeru programu, więc import wiąże je z umową po podtypie i towarzystwie.
alter table crm_policies drop constraint if exists crm_policies_ug_podtyp_check;
alter table crm_policies add constraint crm_policies_ug_podtyp_check
  check (ug_podtyp in ('flota','gwarancje','cpm','car_ear','oc_beauty','beauty_tax','nnw'));
