import test from 'node:test';
import assert from 'node:assert/strict';
import { koniecOchrony, polisaAktywna, polisaNiezakonczona, polisaOczekujaca, polisaWygasla, statusPolisy } from './statusPolisy.ts';

const DZIS = '2026-11-10';
const polisa = (od: string, doKiedy: string | null, zakonczona_od: string | null = null) => ({ data_od: od, data_do: doKiedy as string, zakonczona_od });

test('aktywna jest polisa, której okres ubezpieczenia obejmuje dziś', () => {
	assert.equal(polisaAktywna(polisa('2025-11-15', '2026-11-14'), DZIS), true);
	// Pierwszy i ostatni dzień okresu należą do okresu.
	assert.equal(polisaAktywna(polisa('2026-11-10', '2027-11-09'), DZIS), true);
	assert.equal(polisaAktywna(polisa('2025-11-11', '2026-11-10'), DZIS), true);
	assert.equal(polisaAktywna(polisa('2025-11-10', '2026-11-09'), DZIS), false);
	// Bezterminowa, która już trwa.
	assert.equal(polisaAktywna(polisa('2024-01-01', null), DZIS), true);
});

test('polisa wystawiona na okres od 15 listopada nie jest aktywna 10 listopada — jest oczekująca', () => {
	const nowa = polisa('2026-11-15', '2027-11-14');
	assert.equal(polisaAktywna(nowa, DZIS), false);
	assert.equal(polisaOczekujaca(nowa, DZIS), true);
	// Ochrona się nie skończyła, więc polisa nie jest archiwalna ani wygasła.
	assert.equal(polisaNiezakonczona(nowa, DZIS), true);
	assert.equal(polisaWygasla(nowa, DZIS), false);
	// W dniu początku okresu staje się aktywna.
	assert.equal(polisaAktywna(nowa, '2026-11-15'), true);
	assert.equal(polisaOczekujaca(nowa, '2026-11-15'), false);
});

test('zakończenie decyzją: liczy się dzień przed zakonczona_od', () => {
	const p = polisa('2026-01-01', '2026-12-31', '2026-11-10');
	assert.equal(koniecOchrony(p), '2026-11-09');
	assert.equal(polisaAktywna(p, DZIS), false);
	assert.equal(polisaAktywna(p, '2026-11-09'), true);
	// Polisa na przyszły okres odwołana przed początkiem nie jest ani aktywna, ani oczekująca.
	const odwolana = polisa('2026-11-15', '2027-11-14', '2026-11-05');
	assert.equal(polisaOczekujaca(odwolana, DZIS), false);
	assert.equal(polisaAktywna(odwolana, DZIS), false);
});

test('status: wznowienie od 15 listopada — poprzednia „Wznowiona”, nowa „Oczekująca”, bez wznowienia też „Oczekująca”', () => {
	const stara = { id: 'a', renewal_of: null, ...polisa('2025-11-15', '2026-11-14') };
	const nowa = { id: 'b', renewal_of: 'a', ...polisa('2026-11-15', '2027-11-14') };
	const ctx = { dzis: DZIS, odnowione: new Set(['a']) };
	assert.equal(statusPolisy(stara, ctx).klucz, 'wznowiona');
	assert.equal(statusPolisy(nowa, ctx).klucz, 'oczekujaca');
	assert.match(statusPolisy(nowa, ctx).tekst, /^Oczekująca od 15 lis/);
	// Pierwsza polisa klienta (nie wznowienie) z początkiem w przyszłości.
	const pierwsza = { id: 'c', renewal_of: null, ...polisa('2026-12-01', '2027-11-30') };
	assert.equal(statusPolisy(pierwsza, { dzis: DZIS, odnowione: new Set() }).klucz, 'oczekujaca');
	// Od dnia początku: zwykły status aktywnej.
	assert.equal(statusPolisy(nowa, { dzis: '2026-11-15', odnowione: new Set(['a']) }).klucz, 'aktywna');
});
