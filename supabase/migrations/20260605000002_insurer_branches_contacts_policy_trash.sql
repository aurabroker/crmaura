-- Oddziały TU (branches per insurer, per tenant)
CREATE TABLE IF NOT EXISTS crm_insurer_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  tu_id uuid NOT NULL REFERENCES crm_insurers(id) ON DELETE CASCADE,
  nazwa text NOT NULL,
  adres text,
  telefon text,
  email text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE crm_insurer_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_insurer_branches_tenant ON crm_insurer_branches
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Osoby kontaktowe TU (contacts per branch, per tenant)
CREATE TABLE IF NOT EXISTS crm_insurer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  tu_id uuid NOT NULL REFERENCES crm_insurers(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES crm_insurer_branches(id) ON DELETE SET NULL,
  imie_nazwisko text NOT NULL,
  stanowisko text,
  telefon text,
  email text,
  notatki text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE crm_insurer_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_insurer_contacts_tenant ON crm_insurer_contacts
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Soft-delete dla polis (Kosz)
ALTER TABLE crm_policies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tu_contact_id uuid REFERENCES crm_insurer_contacts(id) ON DELETE SET NULL;

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_crm_insurer_branches_tu ON crm_insurer_branches(tu_id);
CREATE INDEX IF NOT EXISTS idx_crm_insurer_contacts_branch ON crm_insurer_contacts(branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_insurer_contacts_tu ON crm_insurer_contacts(tu_id);
CREATE INDEX IF NOT EXISTS idx_crm_policies_deleted ON crm_policies(deleted_at) WHERE deleted_at IS NOT NULL;
