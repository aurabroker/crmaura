// Słowniki i reguły identyfikacji pojazdu wspólne dla całego CRM.
// Pochodzą ze zrzutu Cumulus (STU ERGO Hestia), którego Hestia używa zarówno
// dla agentów, jak i brokerów — te pola decydują o zaszeregowaniu pojazdu
// i wyliczeniu składki, dlatego są obecne w każdym formularzu pojazdu.

// Importy względne z rozszerzeniem, żeby moduł dało się uruchomić w testach node (--experimental-strip-types).
import type { Vehicle, VehicleUsage } from '../types/database.ts';
import { odmiana, validateVin } from '../utils.ts';

/** KALKULACYJNY RODZAJ POJAZDU — wartości zaobserwowane w zrzucie Hestii. */
export const RODZAJE_KALKULACYJNE = [
	'Osobowe',
	'Ciężarowe o ładowności do 850kg',
	'Ciężarowe o ładowności pow. 850kg do 2500kg',
	'Ciężarowe o ładowności pow. 2500kg',
	'Ciągniki siodłowe',
	'Naczepy - pozostałe',
	'Przyczepy - pozostałe',
	'Autobusy',
	'Motocykle',
	'Ciągniki rolnicze',
	'Pojazdy specjalne',
	'Pojazdy wolnobieżne'
] as const;

/** RODZAJ REJESTROWY — jak w dowodzie rejestracyjnym (pole J). */
export const RODZAJE_REJESTROWE = [
	'SAMOCHÓD OSOBOWY',
	'SAMOCHÓD CIĘŻAROWY',
	'CIĄGNIK SAMOCHODOWY',
	'NACZEPA CIĘŻAROWA',
	'PRZYCZEPA CIĘŻAROWA',
	'AUTOBUS',
	'MOTOCYKL',
	'MOTOROWER',
	'CIĄGNIK ROLNICZY',
	'SAMOCHÓD SPECJALNY',
	'POJAZD WOLNOBIEŻNY'
] as const;

export const RODZAJE_TABLIC = ['stała', 'tymczasowa', 'zabytkowa', 'indywidualna', 'brak'] as const;

/**
 * POJAZD WYKORZYSTYWANY — 11 flag użytkowania. Kolejność i etykiety jak
 * w zrzucie Cumulus; `cumulusKey` wskazuje kolumnę eksportu, `skrot` — nazwę na listach.
 */
export const UZYTKOWANIE_FLAGI: readonly {
	key: keyof VehicleUsage;
	label: string;
	skrot: string;
	cumulusKey: string;
}[] = [
	{ key: 'zastepczy_aso', label: 'Pojazd zastępczy na zasadach innych niż wynajem (ASO)', skrot: 'zastępczy ASO', cumulusKey: 'uzytkowanie.pojazd_zastepczy_na_zasadach_innych_niz_wynajem_aso' },
	{ key: 'wynajem_dlugoterminowy', label: 'Przedmiot wynajmu długoterminowego lub CFM', skrot: 'wynajem długoterminowy / CFM', cumulusKey: 'uzytkowanie.przedmiot_wynajmu_dlugoterminowego_lub_cfm' },
	{ key: 'kurier', label: 'Usługi kurierskie', skrot: 'kurier', cumulusKey: 'uzytkowanie.uslugi_kurierskie' },
	{ key: 'adr', label: 'Transport towarów i ładunków niebezpiecznych', skrot: 'ADR', cumulusKey: 'uzytkowanie.transport_towarow_i_ladunkow_niebezpiecznych' },
	{ key: 'jazdy_probne', label: 'Jazdy próbne i demonstracyjne', skrot: 'jazdy próbne', cumulusKey: 'uzytkowanie.jazdy_probne_i_demonstracyjne' },
	{ key: 'nauka_jazdy', label: 'Nauka jazdy', skrot: 'nauka jazdy', cumulusKey: 'uzytkowanie.nauka_jazdy' },
	{ key: 'woz_interwencyjny', label: 'Wóz interwencyjny (ochrona)', skrot: 'wóz interwencyjny', cumulusKey: 'uzytkowanie.woz_interwencyjny_ochrona' },
	{ key: 'leasing', label: 'Przedmiot leasingu', skrot: 'leasing', cumulusKey: 'uzytkowanie.przedmiot_leasingu' },
	{ key: 'rac', label: 'Wynajem zarobkowy (RAC)', skrot: 'RAC', cumulusKey: 'uzytkowanie.wynajem_zarobkowy_rac' },
	{ key: 'taxi', label: 'Przewóz osób (taxi, Uber itp.)', skrot: 'taxi', cumulusKey: 'uzytkowanie.przewoz_osob_taxi_uber_itp' },
	{ key: 'jazdy_testowe', label: 'Jazdy testowe', skrot: 'jazdy testowe', cumulusKey: 'uzytkowanie.jazdy_testowe' }
];

export interface VehicleIdentity {
	nr_rejestracyjny?: string | null;
	vin?: string | null;
	nr_nadwozia?: string | null;
	nr_silnika?: string | null;
	bez_rejestracji?: boolean | null;
}

const puste = (s: string | null | undefined) => !s || !s.trim();

/**
 * WARUNEK BEZWZGLĘDNY (lustro CHECK-a crm_vehicles_identyfikacja_chk):
 * pojazdu nie da się dodać bez numeru VIN i numeru rejestracyjnego.
 * Wyjątek: pojazd niepodlegający rejestracji (specjalny, wolnobieżny) —
 * zamiast tablic wystarczy VIN, numer nadwozia/ramy albo numer silnika.
 * Zwraca komunikat błędu albo null, gdy identyfikacja jest kompletna.
 */
export function validateVehicleIdentity(v: VehicleIdentity): string | null {
	if (v.bez_rejestracji) {
		if (puste(v.vin) && puste(v.nr_nadwozia) && puste(v.nr_silnika))
			return 'Pojazd niepodlegający rejestracji musi mieć VIN, numer nadwozia/ramy albo numer silnika.';
		if (!puste(v.vin)) return validateVin(v.vin!, false);
		return null;
	}
	if (puste(v.nr_rejestracyjny)) return 'Numer rejestracyjny jest wymagany.';
	if (puste(v.vin)) return 'Numer VIN jest wymagany — bez niego pojazdu nie da się zapisać.';
	return validateVin(v.vin!, true);
}

/** Etykieta pojazdu do list i nagłówków — rejestracja albo identyfikator zastępczy. */
export function vehicleLabel(
	v: VehicleIdentity & { marka_model?: string | null },
	opts: { zModelem?: boolean } = {}
): string {
	const id = !puste(v.nr_rejestracyjny)
		? v.nr_rejestracyjny!.trim()
		: !puste(v.vin)
			? `VIN ${v.vin!.trim()}`
			: !puste(v.nr_nadwozia)
				? `nadwozie ${v.nr_nadwozia!.trim()}`
				: !puste(v.nr_silnika)
					? `silnik ${v.nr_silnika!.trim()}`
					: 'bez identyfikatora';
	return opts.zModelem && v.marka_model ? `${id} — ${v.marka_model}` : id;
}

/**
 * Kalkulacyjny rodzaj pojazdu (Cumulus) z rodzaju rejestrowego i ładowności — reguła
 * odczytana z wykazu floty Hestii: ciężarowe dzielą się progami ładowności 850 / 2500 kg.
 * Null, gdy rodzaj jest nieznany albo ciężarowy bez ładowności (operator wybiera sam).
 */
export function rodzajKalkulacyjny(
	rodzajRejestrowy: string | null | undefined,
	ladownosc?: number | null
): string | null {
	const r = (rodzajRejestrowy ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
	if (!r) return null;
	if (/CI[ĄA]GNIK SAMOCHODOWY|SIOD[ŁL]OW/.test(r)) return 'Ciągniki siodłowe';
	if (/CI[ĄA]GNIK ROLNICZY/.test(r)) return 'Ciągniki rolnicze';
	if (/NACZEP/.test(r)) return 'Naczepy - pozostałe';
	if (/PRZYCZEP/.test(r)) return 'Przyczepy - pozostałe';
	if (/AUTOBUS/.test(r)) return 'Autobusy';
	if (/MOTOCYKL|MOTOROWER/.test(r)) return 'Motocykle';
	if (/SPECJALN/.test(r)) return 'Pojazdy specjalne';
	if (/WOLNOBIE[ŻZ]N/.test(r)) return 'Pojazdy wolnobieżne';
	if (/OSOBOW/.test(r)) return 'Osobowe';
	if (/CI[ĘE][ŻZ]AROW/.test(r)) {
		if (ladownosc == null) return null;
		if (ladownosc <= 850) return 'Ciężarowe o ładowności do 850kg';
		if (ladownosc <= 2500) return 'Ciężarowe o ładowności pow. 850kg do 2500kg';
		return 'Ciężarowe o ładowności pow. 2500kg';
	}
	return null;
}

/**
 * Flagi użytkowania z tekstu certyfikatu („WYKORZYSTANIE POJAZDU: pojazd zastępczy na
 * zasadach innych niż wynajem (ASO)”) — po słowach kluczowych etykiet Cumulus.
 */
export function uzytkowanieZTekstu(tekst: string | null | undefined): VehicleUsage {
	const t = (tekst ?? '').toLowerCase();
	const u: VehicleUsage = {};
	if (!t.trim()) return u;
	const testy: [keyof VehicleUsage, RegExp][] = [
		['zastepczy_aso', /zast[eę]pcz/],
		['wynajem_dlugoterminowy', /d[łl]ugoterminow|\bcfm\b/],
		['kurier', /kurier/],
		['adr', /niebezpieczn|\badr\b/],
		['jazdy_probne', /pr[oó]bn|demonstracyjn/],
		['nauka_jazdy', /nauk[aią] jazdy/],
		['woz_interwencyjny', /interwencyjn/],
		['leasing', /leasing/],
		['rac', /\brac\b|zarobkow/],
		['taxi', /taxi|uber|przew[oó]z os[oó]b/],
		['jazdy_testowe', /testow/]
	];
	for (const [klucz, re] of testy) if (re.test(t)) u[klucz] = true;
	return u;
}

/** „leasing, taxi” — zaznaczone flagi użytkowania; pusty napis, gdy żadna. */
export function opisUzytkowania(v: { uzytkowanie?: VehicleUsage | null }): string {
	return UZYTKOWANIE_FLAGI.filter((f) => v.uzytkowanie?.[f.key]).map((f) => f.skrot).join(', ');
}

/** Zaszeregowanie w jednej linii: „Osobowe · SAMOCHÓD OSOBOWY · 5 miejsc · leasing” — tylko to, co jest. */
export function opisZaszeregowania(
	v: Pick<Vehicle, 'rodzaj_kalkulacyjny' | 'rodzaj_rejestrowy' | 'liczba_miejsc' | 'uzytkowanie'>
): string {
	return [
		v.rodzaj_kalkulacyjny,
		v.rodzaj_rejestrowy,
		v.liczba_miejsc ? odmiana(v.liczba_miejsc, 'miejsce', 'miejsca', 'miejsc') : null,
		opisUzytkowania(v)
	]
		.filter(Boolean)
		.join(' · ');
}
