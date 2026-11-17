import test from 'node:test';
import assert from 'node:assert/strict';
import { opisZakresu, polisaWOkresie, rozpoznajOkres, zakresOkresu } from './okresPolis.ts';

const DZIS = '2026-11-17';

test('gotowe okresy: miesiące i kwartały kalendarzowe, przejście przez rok', () => {
	assert.deepEqual(zakresOkresu('ten_miesiac', DZIS), { od: '2026-11-01', do: '2026-11-30' });
	assert.deepEqual(zakresOkresu('poprzedni_miesiac', DZIS), { od: '2026-10-01', do: '2026-10-31' });
	assert.deepEqual(zakresOkresu('nastepny_miesiac', DZIS), { od: '2026-12-01', do: '2026-12-31' });
	assert.deepEqual(zakresOkresu('ten_kwartal', DZIS), { od: '2026-10-01', do: '2026-12-31' });
	assert.deepEqual(zakresOkresu('poprzedni_kwartal', DZIS), { od: '2026-07-01', do: '2026-09-30' });
	assert.deepEqual(zakresOkresu('ten_rok', DZIS), { od: '2026-01-01', do: '2026-12-31' });
	assert.deepEqual(zakresOkresu('poprzedni_rok', DZIS), { od: '2025-01-01', do: '2025-12-31' });
	assert.deepEqual(zakresOkresu('nastepne_30', DZIS), { od: '2026-11-17', do: '2026-12-16' });
	assert.deepEqual(zakresOkresu('ostatnie_30', DZIS), { od: '2026-10-19', do: '2026-11-17' });
	// Styczeń: poprzedni miesiąc i kwartał w poprzednim roku; luty przestępny.
	assert.deepEqual(zakresOkresu('poprzedni_miesiac', '2026-01-10'), { od: '2025-12-01', do: '2025-12-31' });
	assert.deepEqual(zakresOkresu('poprzedni_kwartal', '2026-02-10'), { od: '2025-10-01', do: '2025-12-31' });
	assert.deepEqual(zakresOkresu('nastepny_miesiac', '2028-01-31'), { od: '2028-02-01', do: '2028-02-29' });
});

test('filtr: początek, koniec, data zawarcia i ochrona w okresie', () => {
	const pazdziernik = { od: '2026-10-01', do: '2026-10-31' };
	const roczna = { data_od: '2026-03-15', data_do: '2027-03-14', zakonczona_od: null, data_zawarcia: '2026-03-01' };
	const nowa = { data_od: '2026-10-15', data_do: '2027-10-14', zakonczona_od: null, data_zawarcia: null };
	const wypowiedziana = { data_od: '2026-01-01', data_do: '2026-12-31', zakonczona_od: '2026-09-01', data_zawarcia: '2025-12-20' };
	assert.equal(polisaWOkresie(nowa, 'od', pazdziernik), true);
	assert.equal(polisaWOkresie(roczna, 'od', pazdziernik), false);
	assert.equal(polisaWOkresie(roczna, 'ochrona', pazdziernik), true);
	// Ochrona skończona decyzją przed październikiem.
	assert.equal(polisaWOkresie(wypowiedziana, 'ochrona', pazdziernik), false);
	assert.equal(polisaWOkresie(wypowiedziana, 'do', { od: '2026-12-01', do: '2026-12-31' }), true);
	assert.equal(polisaWOkresie(roczna, 'zawarcia', { od: '2026-03-01', do: '2026-03-31' }), true);
	// Bez daty zawarcia — nie spełnia filtru z zakresem; pusty zakres przepuszcza wszystko.
	assert.equal(polisaWOkresie(nowa, 'zawarcia', pazdziernik), false);
	assert.equal(polisaWOkresie(nowa, 'zawarcia', { od: '', do: '' }), true);
	// Zakres otwarty z jednej strony.
	assert.equal(polisaWOkresie(roczna, 'do', { od: '2027-01-01', do: '' }), true);
	assert.equal(polisaWOkresie(roczna, 'od', { od: '', do: '2026-01-31' }), false);
});

test('podpis zakresu: gotowy okres po nazwie, własny po datach', () => {
	assert.equal(rozpoznajOkres({ od: '2026-10-01', do: '2026-12-31' }, DZIS), 'ten_kwartal');
	assert.equal(opisZakresu({ od: '2026-11-01', do: '2026-11-30' }, DZIS), 'ten miesiąc');
	assert.equal(opisZakresu({ od: '2026-10-05', do: '2026-10-20' }, DZIS), '5 października 2026 – 20 października 2026');
	assert.equal(opisZakresu({ od: '2026-10-05', do: '' }, DZIS), 'od 5 października 2026');
	assert.equal(opisZakresu({ od: '', do: '2026-10-20' }, DZIS), 'do 20 października 2026');
});
