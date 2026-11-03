import test from 'node:test';
import assert from 'node:assert/strict';
import {
	opisUzytkowania,
	opisZaszeregowania,
	rodzajKalkulacyjny,
	uzytkowanieZTekstu,
	validateVehicleIdentity,
	vehicleLabel
} from './pojazd.ts';

test('kalkulacyjny rodzaj pojazdu z rodzaju rejestrowego i ładowności (reguła z wykazu Cumulus)', () => {
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD OSOBOWY', 400), 'Osobowe');
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD CIĘŻAROWY', 610), 'Ciężarowe o ładowności do 850kg');
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD CIĘŻAROWY', 850), 'Ciężarowe o ładowności do 850kg');
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD CIĘŻAROWY', 855), 'Ciężarowe o ładowności pow. 850kg do 2500kg');
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD CIĘŻAROWY', 1180), 'Ciężarowe o ładowności pow. 850kg do 2500kg');
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD CIĘŻAROWY', 3200), 'Ciężarowe o ładowności pow. 2500kg');
	// Ciężarowy bez ładowności nie da się zaszeregować — operator wybiera sam.
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD CIĘŻAROWY', null), null);
	assert.equal(rodzajKalkulacyjny('CIĄGNIK SAMOCHODOWY', 10180), 'Ciągniki siodłowe');
	// Naczepa jest „ciężarowa” z nazwy, ale to naczepa, nie ciężarówka.
	assert.equal(rodzajKalkulacyjny('NACZEPA CIĘŻAROWA', 30500), 'Naczepy - pozostałe');
	assert.equal(rodzajKalkulacyjny('PRZYCZEPA CIĘŻAROWA', 750), 'Przyczepy - pozostałe');
	assert.equal(rodzajKalkulacyjny('AUTOBUS', null), 'Autobusy');
	assert.equal(rodzajKalkulacyjny('motocykl', null), 'Motocykle');
	assert.equal(rodzajKalkulacyjny('CIĄGNIK ROLNICZY', null), 'Ciągniki rolnicze');
	assert.equal(rodzajKalkulacyjny('SAMOCHÓD SPECJALNY', 2000), 'Pojazdy specjalne');
	assert.equal(rodzajKalkulacyjny('POJAZD WOLNOBIEŻNY', null), 'Pojazdy wolnobieżne');
	assert.equal(rodzajKalkulacyjny('', 100), null);
	assert.equal(rodzajKalkulacyjny('ŁÓDŹ', 100), null);
});

test('flagi użytkowania z tekstu certyfikatu', () => {
	assert.deepEqual(uzytkowanieZTekstu('pojazd zastępczy na zasadach innych niż wynajem (ASO)'), { zastepczy_aso: true });
	assert.deepEqual(uzytkowanieZTekstu('przedmiot leasingu; przewóz osób (taxi, Uber itp.)'), { leasing: true, taxi: true });
	assert.deepEqual(uzytkowanieZTekstu('przedmiot wynajmu długoterminowego lub CFM'), { wynajem_dlugoterminowy: true });
	assert.deepEqual(uzytkowanieZTekstu('transport towarów i ładunków niebezpiecznych'), { adr: true });
	assert.deepEqual(uzytkowanieZTekstu(''), {});
	assert.deepEqual(uzytkowanieZTekstu(null), {});
	assert.equal(opisUzytkowania({ uzytkowanie: { leasing: true, taxi: true, rac: false } }), 'leasing, taxi');
});

test('warunek bezwzględny identyfikacji: VIN i rejestracja, albo pojazd bez rejestracji z zamiennikiem', () => {
	assert.equal(validateVehicleIdentity({ nr_rejestracyjny: 'WX12345', vin: 'WMA06XZZ8CP000001' }), null);
	assert.match(validateVehicleIdentity({ nr_rejestracyjny: '', vin: 'WMA06XZZ8CP000001' }) ?? '', /rejestracyjny/);
	assert.match(validateVehicleIdentity({ nr_rejestracyjny: 'WX12345', vin: '' }) ?? '', /VIN/);
	assert.match(validateVehicleIdentity({ nr_rejestracyjny: 'WX12345', vin: 'ZAKROTKI' }) ?? '', /17 znaków/);
	assert.equal(validateVehicleIdentity({ bez_rejestracji: true, nr_nadwozia: 'NADW-1' }), null);
	assert.equal(validateVehicleIdentity({ bez_rejestracji: true, nr_silnika: 'SIL-1' }), null);
	assert.match(validateVehicleIdentity({ bez_rejestracji: true }) ?? '', /nadwozia/);
	assert.match(validateVehicleIdentity({ bez_rejestracji: true, vin: 'ZLY' }) ?? '', /17 znaków/);
});

test('etykieta i zaszeregowanie pojazdu do list', () => {
	assert.equal(vehicleLabel({ nr_rejestracyjny: ' WX12345 ', vin: 'WMA06XZZ8CP000001' }), 'WX12345');
	assert.equal(vehicleLabel({ nr_rejestracyjny: null, vin: 'WMA06XZZ8CP000001' }), 'VIN WMA06XZZ8CP000001');
	assert.equal(vehicleLabel({ nr_rejestracyjny: null, vin: null, nr_nadwozia: 'NADW-1' }), 'nadwozie NADW-1');
	assert.equal(vehicleLabel({ nr_rejestracyjny: null, nr_silnika: 'SIL-1' }), 'silnik SIL-1');
	assert.equal(vehicleLabel({}, { zModelem: true }), 'bez identyfikatora');
	assert.equal(vehicleLabel({ nr_rejestracyjny: 'WX12345', marka_model: 'MAN TGX' }, { zModelem: true }), 'WX12345 — MAN TGX');
	assert.equal(
		opisZaszeregowania({ rodzaj_kalkulacyjny: 'Osobowe', rodzaj_rejestrowy: 'SAMOCHÓD OSOBOWY', liczba_miejsc: 5, uzytkowanie: { taxi: true } }),
		'Osobowe · SAMOCHÓD OSOBOWY · 5 miejsc · taxi'
	);
	assert.equal(opisZaszeregowania({ rodzaj_kalkulacyjny: null, rodzaj_rejestrowy: null, liczba_miejsc: null, uzytkowanie: null }), '');
});
