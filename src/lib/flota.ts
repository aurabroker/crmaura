// Flota klienta: ochrona pojazdu liczona z jego polis, podsumowanie floty, opis techniczny i polisy komunikacyjne
// bez pojazdu — wspólne dla zakładki Flota / Pojazdy na karcie klienta i listy Pojazdy.
import type { Policy, Vehicle } from '$lib/types/database';
import { dateDiffDays, fmtDzien, odmiana } from '$lib/utils';
import { koniecOchrony, polisaAktywna } from '$lib/statusPolisy';

/** Tyle dni przed końcem ochrony pojazd pokazuje się jako „kończy się” (jak kolejka odnowień na pulpicie). */
export const DNI_OSTRZEZENIA_FLOTY = 30;

/** Podpowiedzi rodzaju pojazdu (pole tekstowe — import z PDF zostawia własne nazwy z dowodu). */
export const RODZAJE_POJAZDU = [
	'Samochód osobowy',
	'Samochód ciężarowy do 3,5 t',
	'Samochód ciężarowy pow. 3,5 t',
	'Ciągnik siodłowy',
	'Przyczepa',
	'Naczepa',
	'Autobus',
	'Motocykl',
	'Inny'
] as const;

// Stare, jednowyrazowe wartości z formularza /vehicles/new.
const RODZAJ_STARY: Record<string, string> = {
	osobowy: 'Samochód osobowy',
	'ciężarowy': 'Samochód ciężarowy',
	'ciągnik siodłowy': 'Ciągnik siodłowy',
	przyczepka: 'Przyczepa',
	naczepa: 'Naczepa',
	autobus: 'Autobus'
};

export function etykietaRodzajuPojazdu(r: string | null | undefined): string {
	const t = (r ?? '').trim();
	if (!t) return '';
	return RODZAJ_STARY[t.toLowerCase()] ?? t;
}

type PolisaPojazdu = Pick<Policy, 'id' | 'pojazd_id' | 'deleted_at' | 'data_od' | 'data_do' | 'typ_umowy'> & Partial<Pick<Policy, 'zakonczona_od'>>;

/** Polisy pojazdu (bez kosza i umów generalnych), najnowsza pierwsza. */
export function polisyPojazdu<T extends PolisaPojazdu>(pojazdId: string, policies: T[]): T[] {
	return policies
		.filter((p) => p.pojazd_id === pojazdId && !p.deleted_at && p.typ_umowy !== 'generalna')
		.sort((a, b) => (b.data_od ?? '').localeCompare(a.data_od ?? ''));
}

export type StanOchrony = 'czynna' | 'konczy_sie' | 'oczekujaca' | 'wygasla' | 'brak';

export type OchronaPojazdu<T> = {
	stan: StanOchrony;
	/** Polisy chroniące dziś (OC i AC mogą być osobno). */
	czynne: T[];
	/** Polisa, która zacznie chronić w przyszłości (odnowienie już w CRM). */
	nastepna: T | null;
	/** Najnowsza polisa pojazdu (do odnowienia, gdy ochrony nie ma). */
	ostatnia: T | null;
	/** Koniec najbliższej czynnej ochrony. */
	koniec: string | null;
	/** Dni do końca ochrony (czynna / kończy się), do startu (oczekująca) albo od wygaśnięcia (wygasła). */
	dni: number | null;
	tekst: string;
	cls: string;
	/** Kolejność na liście: najpierw to, co wymaga działania. */
	waga: number;
};

const dzien = (iso: string) => fmtDzien(iso.slice(0, 10), true);

export function ochronaPojazdu<T extends PolisaPojazdu>(pojazdId: string, policies: T[], dzis: string): OchronaPojazdu<T> {
	const wszystkie = polisyPojazdu(pojazdId, policies);
	const czynne = wszystkie.filter((p) => (p.data_od ?? '') <= dzis && polisaAktywna(p, dzis));
	const przyszle = wszystkie
		.filter((p) => (p.data_od ?? '') > dzis && polisaAktywna(p, dzis))
		.sort((a, b) => (a.data_od ?? '').localeCompare(b.data_od ?? ''));
	const nastepna = przyszle[0] ?? null;
	const ostatnia = wszystkie[0] ?? null;

	if (czynne.length) {
		// Gdy OC i AC są osobno, decyduje ta, która kończy się wcześniej.
		const konce = czynne.map((p) => koniecOchrony(p)).filter((k): k is string => !!k).sort();
		const koniec = konce[0] ?? null;
		const dni = koniec ? dateDiffDays(dzis, koniec) : null;
		if (dni != null && dni <= DNI_OSTRZEZENIA_FLOTY && !nastepna) {
			return {
				stan: 'konczy_sie', czynne, nastepna, ostatnia, koniec, dni,
				tekst: dni === 0 ? 'kończy się dziś' : `kończy się za ${odmiana(dni, 'dzień', 'dni', 'dni')}`,
				cls: 'bg-warn-soft text-warn', waga: 1
			};
		}
		return {
			stan: 'czynna', czynne, nastepna, ostatnia, koniec, dni,
			tekst: koniec ? `czynna do ${dzien(koniec)}${nastepna ? ' · odnowiona' : ''}` : 'czynna',
			cls: 'bg-ok-soft text-ok', waga: 4
		};
	}
	if (nastepna) {
		const dni = dateDiffDays(dzis, nastepna.data_od);
		return { stan: 'oczekujaca', czynne, nastepna, ostatnia, koniec: null, dni, tekst: `ochrona od ${dzien(nastepna.data_od)}`, cls: 'bg-accent-soft text-accent-text', waga: 3 };
	}
	if (ostatnia) {
		const k = koniecOchrony(ostatnia);
		const dni = k ? dateDiffDays(k, dzis) : null;
		return {
			stan: 'wygasla', czynne, nastepna, ostatnia, koniec: k, dni,
			tekst: dni != null && dni > 0 ? `wygasła ${odmiana(dni, 'dzień', 'dni', 'dni')} temu` : 'wygasła',
			cls: 'bg-danger-soft text-danger', waga: 0
		};
	}
	return { stan: 'brak', czynne, nastepna, ostatnia, koniec: null, dni: null, tekst: 'brak polisy w CRM', cls: 'bg-danger-soft text-danger', waga: 2 };
}

export type PodsumowanieFloty = { n: number; zOchrona: number; konczaceSie: number; bezOchrony: number };

/** Liczby do nagłówka: z ochroną (czynna, kończąca się, oczekująca), w tym kończące się, oraz bez ochrony (wygasła, brak). */
export function podsumowanieFloty<T extends PolisaPojazdu>(pojazdy: Pick<Vehicle, 'id'>[], policies: T[], dzis: string): PodsumowanieFloty {
	const s: PodsumowanieFloty = { n: pojazdy.length, zOchrona: 0, konczaceSie: 0, bezOchrony: 0 };
	for (const v of pojazdy) {
		const o = ochronaPojazdu(v.id, policies, dzis);
		if (o.stan === 'wygasla' || o.stan === 'brak') s.bezOchrony++;
		else {
			s.zOchrona++;
			if (o.stan === 'konczy_sie') s.konczaceSie++;
		}
	}
	return s;
}

/** Pojazdy wymagające działania pierwsze (wygasła, kończy się, brak), potem oczekujące i czynne; w grupie po rejestracji. */
export function sortujPojazdy<V extends Pick<Vehicle, 'id' | 'nr_rejestracyjny'>, T extends PolisaPojazdu>(pojazdy: V[], policies: T[], dzis: string): V[] {
	return [...pojazdy].sort((a, b) => {
		const wa = ochronaPojazdu(a.id, policies, dzis).waga;
		const wb = ochronaPojazdu(b.id, policies, dzis).waga;
		return wa - wb || (a.nr_rejestracyjny ?? '').localeCompare(b.nr_rejestracyjny ?? '', 'pl');
	});
}

/** „1 997 cm³ · 110 kW · ład. 1 200 kg” — tylko to, co jest. */
export function opisTechniczny(v: Pick<Vehicle, 'pojemnosc_silnika' | 'moc' | 'ladownosc'>): string {
	const liczba = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return [
		v.pojemnosc_silnika ? `${liczba(v.pojemnosc_silnika)} cm³` : null,
		v.moc ? `${liczba(v.moc)} kW` : null,
		v.ladownosc ? `ład. ${liczba(v.ladownosc)} kg` : null
	].filter(Boolean).join(' · ');
}

/** Polisy komunikacyjne / flotowe klienta bez przypisanego pojazdu — do powiązania z zakładki Flota. */
export function polisyBezPojazdu<T extends Pick<Policy, 'pojazd_id' | 'deleted_at' | 'rodzaj' | 'typ_umowy'>>(policies: T[]): T[] {
	return policies.filter((p) => !p.pojazd_id && !p.deleted_at && p.typ_umowy !== 'generalna' && ['komunikacja', 'flota'].includes(p.rodzaj ?? ''));
}
