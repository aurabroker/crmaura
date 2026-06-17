-- Gwarancje UG: limit field and guarantee metadata
ALTER TABLE crm_policies
  ADD COLUMN IF NOT EXISTS ug_limit numeric(15,2),
  ADD COLUMN IF NOT EXISTS gwarancja_typ text,
  ADD COLUMN IF NOT EXISTS gwarancja_stawka_pct numeric(8,4),
  ADD COLUMN IF NOT EXISTS gwarancja_beneficjent_nazwa text,
  ADD COLUMN IF NOT EXISTS gwarancja_beneficjent_nip text,
  ADD COLUMN IF NOT EXISTS gwarancja_kontrakt text;

-- Leasings table
CREATE TABLE IF NOT EXISTS crm_leasings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id),
  nazwa text NOT NULL,
  nip text,
  adres text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE crm_leasings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'crm_leasings' AND policyname = 'tenant_leasings'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_leasings ON crm_leasings
      USING (tenant_id = (SELECT tenant_id FROM crm_profiles WHERE id = auth.uid()))';
  END IF;
END $$;

-- Leasing link on policies
ALTER TABLE crm_policies
  ADD COLUMN IF NOT EXISTS leasing_id uuid REFERENCES crm_leasings(id),
  ADD COLUMN IF NOT EXISTS nr_umowy_leasingowej text;
