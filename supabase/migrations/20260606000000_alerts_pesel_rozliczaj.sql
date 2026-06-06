-- PESEL brokerów (do matchowania noty Leadenhall)
ALTER TABLE crm_profiles ADD COLUMN IF NOT EXISTS pesel text;

-- Flaga rozliczania płatności na poziomie UG (domyślnie false = brak rozliczania)
ALTER TABLE crm_policies ADD COLUMN IF NOT EXISTS rozliczaj_platnosci boolean DEFAULT false;

-- Alerty systemowe (błędy prowizji, ujemne kwoty itp.)
CREATE TABLE IF NOT EXISTS crm_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id) ON DELETE CASCADE,
  typ text NOT NULL CHECK (typ IN ('prowizja_rozjazd', 'ujemna_prowizja', 'aneks_wymagany')),
  polisa_id uuid REFERENCES crm_policies(id) ON DELETE SET NULL,
  nr_polisy text,
  opis text NOT NULL,
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES crm_profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE crm_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_alerts_tenant ON crm_alerts
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE INDEX IF NOT EXISTS idx_crm_alerts_tenant_resolved ON crm_alerts(tenant_id, resolved);
