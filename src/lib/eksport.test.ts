import test from 'node:test';
import assert from 'node:assert/strict';
import { komorkaExcela, nazwaPlikuExcela } from './eksport.ts';

test('data ISO → data Excela (numer seryjny bez przesunięcia strefy)', () => {
	assert.deepEqual(komorkaExcela('2026-11-02', null), { t: 'n', v: 46328, z: 'dd.mm.yyyy' });
	assert.deepEqual(komorkaExcela('1900-03-01', 'data'), { t: 'n', v: 61, z: 'dd.mm.yyyy' });
});

test('kwota z bazy jako tekst → liczba z formatem złotych', () => {
	assert.deepEqual(komorkaExcela('212.00', 'zl'), { t: 'n', v: 212, z: '#,##0.00' });
	assert.deepEqual(komorkaExcela(1606, 'zl'), { t: 'n', v: 1606, z: '#,##0.00' });
	assert.deepEqual(komorkaExcela(17.5, 'proc'), { t: 'n', v: 17.5, z: '0.00' });
});

test('tekst wprost: NIP i numery polis zostają tekstem', () => {
	assert.deepEqual(komorkaExcela('7271101277', 'tekst'), { t: 's', v: '7271101277' });
	assert.deepEqual(komorkaExcela('2026-11-02', 'tekst'), { t: 's', v: '2026-11-02' });
	assert.deepEqual(komorkaExcela('WA50/003353/24/A', null), { t: 's', v: 'WA50/003353/24/A' });
});

test('puste, tak/nie i liczby bez formatu', () => {
	assert.equal(komorkaExcela(null, 'zl'), null);
	assert.equal(komorkaExcela('', null), null);
	assert.deepEqual(komorkaExcela(true, null), { t: 's', v: 'tak' });
	assert.deepEqual(komorkaExcela(false, null), { t: 's', v: 'nie' });
	assert.deepEqual(komorkaExcela(3, null), { t: 'n', v: 3, z: undefined });
	assert.equal(komorkaExcela(Number.NaN, 'zl'), null);
});

test('nazwa pliku z datą', () => {
	assert.equal(nazwaPlikuExcela('polisy', new Date(2026, 10, 2)), 'polisy-2026-11-02.xlsx');
});
