-- Stabilizacja modułu Gwarancje (bond_*) pod SaaS:
-- 1) bond_skladka jako kolumna utrzymywana triggerem (była GENERATED i zwracała NULL,
--    bo generated column nie może sięgać do bond_insurers po stawkę bazową)
-- 2) widok limitu wyklucza wygasłe i "poza limitem"
-- 3) audit zapisuje rolę z crm_profiles (spójnie z RLS)
-- 4) utwardzenie integralności (NOT NULL, defaulty, CHECK)

-- 0) Zamiana generowanej składki na zwykłą kolumnę
ALTER TABLE public.bond_bonds ALTER COLUMN bond_skladka DROP EXPRESSION;

-- 1) Składka liczona w bazie (jedno źródło prawdy)
CREATE OR REPLACE FUNCTION public.fn_bond_calc_skladka()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_stawka numeric;
  v_min numeric;
  v_dni integer;
  v_sk numeric;
BEGIN
  IF NEW.bond_stawka_override IS TRUE AND NEW.bond_stawka IS NOT NULL THEN
    v_stawka := NEW.bond_stawka;
  ELSE
    SELECT bond_stawka_bazowa INTO v_stawka FROM bond_insurers WHERE bond_id = NEW.bond_insurer_id;
  END IF;
  SELECT bond_skladka_min INTO v_min FROM bond_insurers WHERE bond_id = NEW.bond_insurer_id;

  v_dni := GREATEST(0, (NEW.bond_data_do - NEW.bond_data_od));

  IF v_stawka IS NULL OR NEW.bond_suma IS NULL OR NEW.bond_suma <= 0 OR v_dni <= 0 THEN
    NEW.bond_skladka := NULL;
  ELSE
    v_sk := NEW.bond_suma * (v_stawka / 100.0) * (v_dni::numeric / 365.0);
    IF v_min IS NOT NULL AND v_sk < v_min THEN
      v_sk := v_min;
    END IF;
    NEW.bond_skladka := round(v_sk, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bond_calc_skladka ON public.bond_bonds;
CREATE TRIGGER trg_bond_calc_skladka
  BEFORE INSERT OR UPDATE ON public.bond_bonds
  FOR EACH ROW EXECUTE FUNCTION public.fn_bond_calc_skladka();

-- 2) Backfill istniejących składek (bez zaśmiecania audytu)
ALTER TABLE public.bond_bonds DISABLE TRIGGER trg_audit_bond_bonds;
UPDATE public.bond_bonds SET bond_skladka = NULL;
ALTER TABLE public.bond_bonds ENABLE TRIGGER trg_audit_bond_bonds;

-- 3) Widok limitu: wyklucz wygasłe ORAZ gwarancje "poza limitem"
CREATE OR REPLACE VIEW public.bond_limits_view AS
SELECT
  i.bond_id AS bond_insurer_id,
  i.bond_tenant_id,
  i.bond_nazwa AS bond_insurer_nazwa,
  i.bond_limit,
  COALESCE(sum(CASE WHEN b.bond_data_do >= CURRENT_DATE AND b.bond_bez_limitu IS NOT TRUE THEN b.bond_suma ELSE 0 END), 0) AS bond_zaangazowane,
  i.bond_limit - COALESCE(sum(CASE WHEN b.bond_data_do >= CURRENT_DATE AND b.bond_bez_limitu IS NOT TRUE THEN b.bond_suma ELSE 0 END), 0) AS bond_wolny_limit
FROM public.bond_insurers i
LEFT JOIN public.bond_bonds b ON b.bond_insurer_id = i.bond_id
GROUP BY i.bond_id, i.bond_tenant_id, i.bond_nazwa, i.bond_limit;

-- 4) Audit: rola z crm_profiles (spójnie z RLS), nie z bond_profiles
CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_record_id UUID;
  v_old JSONB;
  v_new JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := (OLD.bond_id)::UUID; v_old := to_jsonb(OLD); v_new := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := (NEW.bond_id)::UUID; v_old := NULL; v_new := to_jsonb(NEW);
  ELSE
    v_record_id := (NEW.bond_id)::UUID; v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  END IF;
  INSERT INTO bond_audit_log (actor_id, actor_role, operation, table_name, record_id, old_data, new_data)
  VALUES (auth.uid(), public.bp_get_role(), TG_OP, TG_TABLE_NAME, v_record_id, v_old, v_new);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5) Utwardzenie integralności
UPDATE public.bond_bonds SET bond_bez_limitu = COALESCE(bond_bez_limitu, false), bond_stawka_override = COALESCE(bond_stawka_override, false);
ALTER TABLE public.bond_bonds
  ALTER COLUMN bond_bez_limitu SET DEFAULT false,
  ALTER COLUMN bond_bez_limitu SET NOT NULL,
  ALTER COLUMN bond_stawka_override SET DEFAULT false,
  ALTER COLUMN bond_stawka_override SET NOT NULL,
  ALTER COLUMN bond_created_at SET NOT NULL;
ALTER TABLE public.bond_bonds
  ADD CONSTRAINT bond_dates_chk CHECK (bond_data_do >= bond_data_od),
  ADD CONSTRAINT bond_suma_pos_chk CHECK (bond_suma > 0);

UPDATE public.bond_insurers SET bond_stawka_negocjowana = COALESCE(bond_stawka_negocjowana, false);
ALTER TABLE public.bond_insurers
  ALTER COLUMN bond_stawka_negocjowana SET DEFAULT false,
  ALTER COLUMN bond_stawka_negocjowana SET NOT NULL,
  ALTER COLUMN bond_created_at SET NOT NULL;
ALTER TABLE public.bond_insurers
  ADD CONSTRAINT ul_limit_nonneg CHECK (bond_limit IS NULL OR bond_limit >= 0),
  ADD CONSTRAINT ul_min_nonneg CHECK (bond_skladka_min IS NULL OR bond_skladka_min >= 0),
  ADD CONSTRAINT ul_stawka_nonneg CHECK (bond_stawka_bazowa IS NULL OR bond_stawka_bazowa >= 0);

UPDATE public.bond_tenants SET bond_aktywny = COALESCE(bond_aktywny, true);
ALTER TABLE public.bond_tenants
  ALTER COLUMN bond_aktywny SET DEFAULT true,
  ALTER COLUMN bond_aktywny SET NOT NULL;
