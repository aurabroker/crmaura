-- Kolejne kategorie posiadanych ubezpieczeń prospekta:
-- Flota / Majątek / Gwarancje / Inne (mają / nie mają + krótki opis).
alter table crm_prospects
  add column if not exists ubez_flota text check (ubez_flota in ('maja', 'nie_maja')),
  add column if not exists ubez_flota_opis text,
  add column if not exists ubez_majatek text check (ubez_majatek in ('maja', 'nie_maja')),
  add column if not exists ubez_majatek_opis text,
  add column if not exists ubez_gwarancje text check (ubez_gwarancje in ('maja', 'nie_maja')),
  add column if not exists ubez_gwarancje_opis text,
  add column if not exists ubez_inne text check (ubez_inne in ('maja', 'nie_maja')),
  add column if not exists ubez_inne_opis text;
