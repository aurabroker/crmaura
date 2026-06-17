-- Add second insured party (ubezpieczony) to policies
ALTER TABLE crm_policies
ADD COLUMN IF NOT EXISTS ubezpieczony_id uuid REFERENCES crm_clients(id);
