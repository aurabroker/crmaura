-- Reason for adding a payment manually (e.g. annex, settlement correction)
alter table crm_policy_payments add column if not exists powod text;

-- Client knowingly declined to complete the APK (needs analysis) form
alter table apk_forms add column if not exists client_declined boolean not null default false;
alter table apk_forms add column if not exists client_declined_reason text;
