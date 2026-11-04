import test from 'node:test';
import assert from 'node:assert/strict';
import { bezSerii, numerProgramu, tenSamProgram, umowyProgramu, wybierzUmowe } from './umowaGeneralna.ts';

const ug = (nr: string, od: string, do_: string, zawarcia: string | null = null) => ({
	id: nr + od,
	nr_polisy: nr,
	typ_umowy: 'generalna' as const,
	data_od: od,
	data_do: do_,
	data_zawarcia: zawarcia,
	deleted_at: null
});

test('numer programu: bez spacji, wielkie litery, bez dopisku roku; seria odcinana osobno', () => {
	assert.equal(numerProgramu(' wa50/003353/24/a_2026 '), 'WA50/003353/24/A');
	assert.equal(bezSerii('SZUG03982/26/KOM/A'), 'SZUG03982/26/KOM');
	assert.equal(bezSerii('SZUG03982/26/KOM'), 'SZUG03982/26/KOM');
	assert.equal(bezSerii('WA50/003353/24/A'), 'WA50/003353/24');
});

test('ten sam program: pełna zgodność albo zgodność bez litery serii', () => {
	assert.equal(tenSamProgram('SZUG03982/26/KOM/A', 'SZUG03982/26/KOM'), true);
	assert.equal(tenSamProgram('SZUG03982/26/KOM', 'SZUG03982/26/KOM/A'), true);
	assert.equal(tenSamProgram('WA50/003353/24/A', 'WA50/003353/24/A_2026'), true);
	assert.equal(tenSamProgram('SZUG03982/26/KOM/A', 'SZUG03982/26/KOM/B'), true);
	assert.equal(tenSamProgram('SZUG03982/26/KOM/A', 'SZUG03983/26/KOM/A'), false);
	assert.equal(tenSamProgram('', 'SZUG03982/26/KOM'), false);
	assert.equal(tenSamProgram(null, undefined), false);
});

test('umowy programu: certyfikat floty Hestii „…/KOM/A” trafia pod umowę wpisaną jako „…/KOM”', () => {
	const umowy = [ug('SZUG03982/26/KOM', '2026-06-16', '2027-06-15', '2026-06-16'), ug('INNA/26/KOM', '2026-01-01', '2026-12-31')];
	const hit = umowyProgramu(umowy, 'SZUG03982/26/KOM/A');
	assert.equal(hit.length, 1);
	assert.equal(hit[0].nr_polisy, 'SZUG03982/26/KOM');
	assert.equal(wybierzUmowe(hit, '2026-06-23')?.nr_polisy, 'SZUG03982/26/KOM');
});

test('umowy programu: pełna zgodność numeru ma pierwszeństwo przed zgodnością bez serii', () => {
	const umowy = [ug('SZUG03982/26/KOM', '2025-06-16', '2026-06-15'), ug('SZUG03982/26/KOM/A', '2026-06-16', '2027-06-15')];
	const hit = umowyProgramu(umowy, 'SZUG03982/26/KOM/A');
	assert.deepEqual(hit.map((u) => u.nr_polisy), ['SZUG03982/26/KOM/A']);
	assert.deepEqual(umowyProgramu(umowy, 'SZUG03982/26/KOM').map((u) => u.nr_polisy), ['SZUG03982/26/KOM']);
});
