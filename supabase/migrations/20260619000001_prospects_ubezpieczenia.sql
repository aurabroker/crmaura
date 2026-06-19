-- Posiadane ubezpieczenia prospekta: Życie / Medyczne (mają / nie mają + opis).
alter table crm_prospects
  add column if not exists ubez_zycie text check (ubez_zycie in ('maja', 'nie_maja')),
  add column if not exists ubez_zycie_opis text,
  add column if not exists ubez_medyczne text check (ubez_medyczne in ('maja', 'nie_maja')),
  add column if not exists ubez_medyczne_opis text;
