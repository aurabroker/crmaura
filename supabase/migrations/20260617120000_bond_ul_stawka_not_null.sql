-- Twarda gwarancja: każda Umowa Limitowa (UL) musi mieć stawkę bazową.
-- Dzięki temu trigger fn_bond_calc_skladka zawsze policzy składkę gwarancji (nigdy NULL),
-- bo stawka efektywna = stawka indywidualna (override) ALBO stawka bazowa z UL.
ALTER TABLE public.bond_insurers
  ALTER COLUMN bond_stawka_bazowa SET NOT NULL;
