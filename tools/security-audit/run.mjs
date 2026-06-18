#!/usr/bin/env node
// ============================================================================
// AURA SECURITY AUDIT — CLI
// ----------------------------------------------------------------------------
// Uruchamia audit.sql na bazie Postgresa (Supabase) i drukuje priorytetowany
// raport. Read-only. Nadaje się do CI (zwraca kod wyjścia != 0 przy naruszeniach).
//
// Użycie:
//   SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
//   node tools/security-audit/run.mjs [--json] [--fail-on=critical|high|none]
//
// Connection string znajdziesz w: Supabase → Project Settings → Database →
// Connection string (URI). Trzymaj go jako SEKRET (bez prefiksu VITE_).
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failOn = (args.find((a) => a.startsWith('--fail-on=')) ?? '--fail-on=critical').split('=')[1];

const SEVERITY_RANK = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
// Próg fail dla CI: 'critical' => tylko CRITICAL psuje build; 'high' => CRITICAL+HIGH; 'none' => nigdy.
const FAIL_THRESHOLD = { critical: 1, high: 2, none: 0 }[failOn] ?? 1;

function ownerOf(object, owners) {
  const name = object.split('.')[0];
  if (owners.exact?.[name]) return owners.exact[name];
  for (const [prefix, repo] of Object.entries(owners.prefixes ?? {})) {
    if (name.startsWith(prefix)) return repo;
  }
  return owners.default ?? '?';
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('✖ Brak SUPABASE_DB_URL (connection string do Postgresa Supabase).');
    process.exit(2);
  }

  // pg jest zależnością tego narzędzia (tools/security-audit/package.json)
  const { default: pg } = await import('pg');
  const sql = readFileSync(join(here, 'audit.sql'), 'utf8');
  const owners = JSON.parse(readFileSync(join(here, 'owners.json'), 'utf8'));

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let rows;
  try {
    ({ rows } = await client.query(sql));
  } finally {
    await client.end();
  }

  const findings = rows.map((r) => ({ ...r, owner: ownerOf(r.object, owners) }));
  const counts = findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] ?? 0) + 1), acc), {});

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), counts, findings }, null, 2));
  } else {
    const icon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪' };
    console.log('\n=== AURA SECURITY AUDIT ===  ' + new Date().toISOString() + '\n');
    let lastSev = '';
    for (const f of findings) {
      if (f.severity !== lastSev) {
        console.log(`\n${icon[f.severity] ?? '•'} ${f.severity}`);
        lastSev = f.severity;
      }
      console.log(`  [${f.check_id}] ${f.object}  (repo: ${f.owner})`);
      console.log(`      ${f.detail}`);
      if (f.remediation && !f.remediation.startsWith('--')) console.log(`      fix: ${f.remediation}`);
    }
    const summary = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => `${s}:${counts[s] ?? 0}`).join('  ');
    console.log(`\n📊 ${summary}\n`);
  }

  // Kod wyjścia dla CI: fail gdy istnieje naruszenie o randze <= próg.
  const failing = findings.some((f) => (SEVERITY_RANK[f.severity] ?? 9) <= FAIL_THRESHOLD);
  process.exit(failing ? 1 : 0);
}

main().catch((err) => {
  console.error('✖ Audyt nie powiódł się:', err.message);
  process.exit(2);
});
