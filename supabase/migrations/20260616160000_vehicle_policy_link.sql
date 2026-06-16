-- Structured link between vehicles and the policy they are currently assigned to,
-- replacing the previous free-text-only match via crm_policies.przedmiot.
alter table crm_policies add column if not exists pojazd_id uuid references crm_vehicles(id) on delete set null;

create index if not exists idx_crm_policies_pojazd_id on crm_policies(pojazd_id);

-- Best-effort backfill: link existing "komunikacja" policies to a vehicle of the
-- same client when the free-text przedmiot contains that vehicle's plate or VIN.
update crm_policies p
set pojazd_id = v.id
from crm_vehicles v
where p.pojazd_id is null
	and p.rodzaj = 'komunikacja'
	and p.deleted_at is null
	and v.klient_id = p.klient_id
	and p.przedmiot is not null
	and (
		p.przedmiot ilike '%' || v.nr_rejestracyjny || '%'
		or (v.vin is not null and p.przedmiot ilike '%' || v.vin || '%')
	);
