-- Client Portal: lets a crm_clients record log in (via Supabase Auth) to view
-- its own policies/claims/vehicles/payments. The auth user account itself is
-- created by an Admin Broker (see /api/admin/create-client-access); clients
-- never self-register.
alter table crm_clients add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

create index if not exists idx_crm_clients_auth_user_id on crm_clients(auth_user_id);

-- Additive, read-only RLS policies scoped by the auth_user_id link. These are
-- permissive policies combined via OR with the existing staff tenant
-- policies, so they only ever add access for the linked client — never take
-- access away from staff, and never grant insert/update/delete.
create policy crm_clients_self_select on crm_clients
	for select
	using (auth_user_id = auth.uid());

create policy crm_policies_client_select on crm_policies
	for select
	using (klient_id in (select id from crm_clients where auth_user_id = auth.uid()));

create policy crm_claims_client_select on crm_claims
	for select
	using (klient_id in (select id from crm_clients where auth_user_id = auth.uid()));

create policy crm_vehicles_client_select on crm_vehicles
	for select
	using (klient_id in (select id from crm_clients where auth_user_id = auth.uid()));

create policy crm_policy_payments_client_select on crm_policy_payments
	for select
	using (polisa_id in (
		select id from crm_policies where klient_id in (
			select id from crm_clients where auth_user_id = auth.uid()
		)
	));
