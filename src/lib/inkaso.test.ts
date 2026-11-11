import test from 'node:test';
import assert from 'node:assert/strict';
import { dzienWplaty, grupujPozycje, miesiecznieSkladki, pozycjeInkasa, pozycjePrzypisu, pozycjeWOkresie, sumujPozycje } from './inkaso.ts';

// Polisa grupowa na życie jak w zgłoszeniu: 4380 zł rocznie, od 1.12.2025, 12 rat po 365 zł, prowizja 25%.
const grupowa = { id: 'g', klient_id: 'k1', data_od: '2025-12-01', skladka_przypisana: 4380, prowizja_przypisana: 1095, tu_id: 'ergo-zycie' };
const oc = { id: 'o', klient_id: 'k2', data_od: '2026-03-10', skladka_przypisana: 650, prowizja_przypisana: 130, tu_id: 'hestia' };
const raty = [
	...Array.from({ length: 12 }, (_, i) => {
		const m = new Date(Date.UTC(2025, 11 + i, 1)).toISOString().slice(0, 10);
		const oplacona = i < 10;
		return { polisa_id: 'g', status: oplacona ? 'Opłacona' : 'Oczekująca', kwota: 365, data_platnosci: m, data_oplacenia: oplacona ? m.slice(0, 8) + '05' : null };
	}),
	{ polisa_id: 'o', status: 'Opłacona', kwota: 650, data_platnosci: '2026-03-24', data_oplacenia: null },
	// Rata umowy generalnej (nie ma jej na liście polis) — pomijana.
	{ polisa_id: 'ug', status: 'Opłacona', kwota: 9999, data_platnosci: '2026-02-01', data_oplacenia: '2026-02-01' }
] as never[];
const ROK_2026 = { od: '2026-01-01', do: '2026-11-11' };

test('inkaso: opłacone raty w dniu wpłaty, bez rat nieopłaconych i rat spoza listy polis', () => {
	const ink = pozycjeInkasa([grupowa, oc] as never[], raty);
	assert.equal(ink.length, 11);
	const w2026 = sumujPozycje(pozycjeWOkresie(ink, ROK_2026));
	// 9 wpłat grupowej w 2026 (sty–wrz; grudniowa wpadła w 2025) + OC.
	assert.equal(w2026.skladka, 9 * 365 + 650);
	assert.equal(w2026.polisy, 2);
	assert.equal(w2026.klienci, 2);
	assert.equal(w2026.pozycji, 10);
	// Prowizja od inkasa proporcjonalna do raty: 25% z 365 zł i 20% z 650 zł.
	assert.equal(Math.round(w2026.prowizja * 100) / 100, 9 * 91.25 + 130);
});

test('przypis: cała składka w dniu początku — polisa od grudnia 2025 nie wchodzi do 2026, w inkasie jest', () => {
	const prz = sumujPozycje(pozycjeWOkresie(pozycjePrzypisu([grupowa, oc] as never[]), ROK_2026));
	assert.equal(prz.skladka, 650);
	assert.equal(prz.polisy, 1);
	const tu = grupujPozycje(pozycjeWOkresie(pozycjeInkasa([grupowa, oc] as never[], raty), ROK_2026), (p) => (p as { tu_id: string }).tu_id);
	assert.equal(tu.get('ergo-zycie')?.skladka, 9 * 365);
	assert.equal(tu.get('ergo-zycie')?.polisy, 1);
});

test('miesięcznie: każda wpłata w swoim miesiącu, rata bez daty opłacenia w miesiącu terminu', () => {
	const mies = miesiecznieSkladki(pozycjeInkasa([grupowa, oc] as never[], raty), ['2026-01', '2026-02', '2026-03', '2026-10', '2026-11']);
	const wg = Object.fromEntries(mies.map(({ ym, s }) => [ym, s.skladka]));
	assert.deepEqual(wg, { '2026-01': 365, '2026-02': 365, '2026-03': 365 + 650, '2026-10': 0, '2026-11': 0 });
	assert.equal(dzienWplaty({ data_oplacenia: null, data_platnosci: '2026-03-24' }), '2026-03-24');
	assert.equal(dzienWplaty({ data_oplacenia: '2026-03-20T10:00:00Z', data_platnosci: '2026-03-24' }), '2026-03-20');
});

test('polisa bez składki: prowizja od inkasa 0 zamiast dzielenia przez zero', () => {
	const ink = pozycjeInkasa([{ id: 'z', klient_id: null, data_od: '2026-01-01', skladka_przypisana: 0, prowizja_przypisana: 50 }] as never[], [
		{ polisa_id: 'z', status: 'Opłacona', kwota: 100, data_platnosci: '2026-01-10', data_oplacenia: '2026-01-10' }
	] as never[]);
	assert.equal(ink[0].prowizja, 0);
	assert.equal(sumujPozycje(ink).klienci, 0);
});
