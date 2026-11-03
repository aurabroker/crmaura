// Eksport floty do układu zrzutu Cumulus (STU ERGO Hestia).
// Buduje arkusz identyczny strukturalnie z plikiem, który generuje Hestia:
// dwa wiersze nagłówka (grupy scalone + nazwy kolumn), 151 kolumn w stałej
// kolejności, szerokości jak w oryginale. Wartości logiczne jako "tak"/"nie",
// daty jako RRRR-MM-DD.

import * as XLSX from 'xlsx';
import type { Client, Leasing, Policy, Vehicle } from '$lib/types/database';
import { CUMULUS_ARKUSZ, CUMULUS_GRUPY, CUMULUS_KOLUMNY } from './cumulusLayout';
import { UZYTKOWANIE_FLAGI } from './pojazd';

export type CumulusRow = Record<string, string | number | null | undefined>;

const tn = (b: boolean | null | undefined) => (b ? 'tak' : 'nie');

export interface CumulusMapInput {
	vehicle: Vehicle;
	/** Ubezpieczający (właściciel pojazdu w kartotece); null, gdy klienta nie ma już w pamięci. */
	client: Client | null;
	/** Ubezpieczony, gdy jest innym podmiotem niż ubezpieczający. */
	ubezpieczony?: Client | null;
	/** Finansujący — w zrzucie Hestii występuje jako UBEZPIECZONY. */
	leasing?: Leasing | null;
	policy?: Policy | null;
	/** Umowa generalna, pod którą wystawiono polisę. */
	ug?: Policy | null;
}

/**
 * Adres w CRM to jedna linia ("ul. Zdunowska 116, 63-700 Krotoszyn"), a Cumulus
 * chce osobno kod, miejscowość, przedrostek, ulicę i numer. Rozbijamy po kodzie
 * pocztowym; gdy się nie da — cała linia ląduje w ULICA, żeby nic nie zginęło.
 */
export function rozbijAdres(linia: string | null | undefined): {
	kod: string;
	poczta: string;
	miejscowosc: string;
	przedrostek: string;
	ulica: string;
	nr_domu: string;
	nr_lokalu: string;
} {
	const pusty = { kod: '', poczta: '', miejscowosc: '', przedrostek: '', ulica: '', nr_domu: '', nr_lokalu: '' };
	if (!linia?.trim()) return pusty;
	const s = linia.replace(/\s+/g, ' ').trim();
	const m = s.match(/^(.*?)[,\s]*(\d{2}-\d{3})\s+([^,]+?)\s*$/);
	if (!m) return { ...pusty, ulica: s };

	const przedKodem = m[1].replace(/[,\s]+$/, '').trim();
	const kod = m[2];
	const miejscowosc = m[3].trim();

	let ulica = przedKodem;
	let przedrostek = '';
	const pref = ulica.match(/^(ul\.|al\.|os\.|pl\.)\s*/i);
	if (pref) {
		przedrostek = pref[1].toUpperCase();
		ulica = ulica.slice(pref[0].length);
	}
	let nr_domu = '';
	let nr_lokalu = '';
	const nr = ulica.match(/^(.*?)\s+(\d+[A-Za-z]?)(?:\s*[/m.]+\s*(\d+[A-Za-z]?))?$/);
	if (nr) {
		ulica = nr[1].trim();
		nr_domu = nr[2];
		nr_lokalu = nr[3] ?? '';
	}
	return { kod, poczta: miejscowosc, miejscowosc, przedrostek, ulica, nr_domu, nr_lokalu };
}

function podmiot(prefix: string, c: Client | null | undefined, adrPrefix: string): CumulusRow {
	if (!c) return {};
	const adr = rozbijAdres(c.ulica);
	const osoba = c.typ === 'osoba';
	const row: CumulusRow = {
		[`${prefix}.nazwa`]: osoba ? '' : c.nazwa,
		[`${prefix}.nip`]: c.nip ?? '',
		[`${prefix}.regon`]: c.regon ?? '',
		[`${prefix}.pesel`]: osoba ? (c.pesel ?? '') : '',
		[`${prefix}.kraj`]: 'POLSKA',
		[`${prefix}.obywatelstwo`]: osoba ? 'POLSKIE' : '',
		[`${adrPrefix}.kod_pocztowy`]: adr.kod,
		[`${adrPrefix}.poczta`]: adr.poczta,
		[`${adrPrefix}.miejscowosc`]: adr.miejscowosc,
		[`${adrPrefix}.przedrostek_ulicy`]: adr.przedrostek,
		[`${adrPrefix}.ulica`]: adr.ulica,
		[`${adrPrefix}.numer_domu`]: adr.nr_domu,
		[`${adrPrefix}.numer_lokalu`]: adr.nr_lokalu
	};
	if (osoba) {
		// Imię i nazwisko trzymamy w jednym polu nazwa — dzielimy na pierwszą spację.
		const [imie, ...reszta] = c.nazwa.trim().split(/\s+/);
		row[`${prefix}.imie`] = imie ?? '';
		row[`${prefix}.nazwisko`] = reszta.join(' ');
	}
	return row;
}

function podmiotLeasing(l: Leasing): CumulusRow {
	const adr = rozbijAdres(l.adres);
	return {
		'ubezpieczony.nazwa': l.nazwa,
		'ubezpieczony.nip': l.nip ?? '',
		'ubezpieczony.kraj': 'POLSKA',
		'ubezpieczony_adr.kod_pocztowy': adr.kod,
		'ubezpieczony_adr.poczta': adr.poczta,
		'ubezpieczony_adr.miejscowosc': adr.miejscowosc,
		'ubezpieczony_adr.przedrostek_ulicy': adr.przedrostek,
		'ubezpieczony_adr.ulica': adr.ulica,
		'ubezpieczony_adr.numer_domu': adr.nr_domu,
		'ubezpieczony_adr.numer_lokalu': adr.nr_lokalu
	};
}

/** Marka i model w CRM są jednym polem — Cumulus chce osobno. */
function rozbijMarkeModel(mm: string | null | undefined): { marka: string; model: string } {
	const s = (mm ?? '').trim();
	if (!s) return { marka: '', model: '' };
	const [marka, ...reszta] = s.split(/\s+/);
	return { marka, model: reszta.join(' ') };
}

export function mapToCumulus(input: CumulusMapInput): CumulusRow {
	const { vehicle: v, client, ubezpieczony, leasing, policy, ug } = input;
	const { marka, model } = rozbijMarkeModel(v.marka_model);
	const today = new Date().toISOString().slice(0, 10);
	const aktywna = !!policy && policy.data_od <= today && policy.data_do >= today;

	const row: CumulusRow = {
		'ug.numer_ug': ug?.nr_polisy ?? '',
		...podmiot('ubezpieczajacy', client, 'ubezpieczajacy_adr'),
		// UBEZPIECZONY: finansujący, inny podmiot, albo ten sam co ubezpieczający.
		...(leasing
			? podmiotLeasing(leasing)
			: podmiot('ubezpieczony', ubezpieczony ?? client, 'ubezpieczony_adr')),
		'ubezpieczony.id': leasing ? '' : ((ubezpieczony ?? client)?.regon ?? ''),
		'korzystajacy.czy_wystepuje': 'nie',
		'wspolwlasciciel.czy_wystepuje': 'nie',

		'pojazd.numer_rejestracyjny': v.bez_rejestracji ? '' : (v.nr_rejestracyjny ?? ''),
		'pojazd.nr_vin': v.vin ?? '',
		'pojazd.kalkulacyjny_rodzaj_pojazdu': v.rodzaj_kalkulacyjny ?? '',
		'pojazd.marka': marka,
		'pojazd.model': model,
		'pojazd.typ_pojazdu': v.typ_pojazdu ?? '',
		'pojazd.rodzaj_rejestrowy': v.rodzaj_rejestrowy ?? '',
		'pojazd.numer_nadwozia_ramy': v.nr_nadwozia ?? '',
		'pojazd.rodzaj_tablic': v.bez_rejestracji ? 'brak' : (v.rodzaj_tablic ?? ''),
		'pojazd.rok_produkcji': v.rok_produkcji ?? '',
		'pojazd.data_pierwszej_rejestracji': v.data_pierwszej_rejestracji ?? '',
		'pojazd.pojemnosc_silnika': v.pojemnosc_silnika ?? '',
		'pojazd.ladownosc': v.ladownosc ?? '',
		'pojazd.liczba_miejsc': v.liczba_miejsc ?? '',

		'polisa.numer_wniosku': policy?.nr_polisy ?? '',
		'polisa.rodzaj_wniosku': policy ? 'standardowe roczne' : '',
		'polisa.data_zawarcia': policy?.data_zawarcia ?? '',
		'polisa.data_rozpoczecia_ochrony': policy?.data_od ?? '',
		'polisa.data_zakonczenia_ochrony': policy?.data_do ?? '',
		'polisa.status_polisy': aktywna ? 'polisa aktywna' : '',
		'polisa.data_statusu': policy?.data_zawarcia ?? '',

		'ryzyka_obow.oc': policy ? 'tak' : '',
		'ryzyka_obow.zk': policy ? 'nie' : '',

		'parametry.pojazd_fabrycznie_nowy': 'nie',
		'raty.systemowa_liczba_rat': policy?.ilosc_rat ?? '',
		'raty.systemowa_mnoznik': policy ? 1 : ''
	};

	for (const f of UZYTKOWANIE_FLAGI) row[f.cumulusKey] = tn(v.uzytkowanie?.[f.key]);
	if (v.uzytkowanie?.leasing == null && leasing) row['uzytkowanie.przedmiot_leasingu'] = 'tak';

	return row;
}

/** Arkusz w układzie Cumulus: R1 grupy (scalone), R2 nagłówki, dalej dane. */
export function buildCumulusWorkbook(rows: CumulusRow[]): XLSX.WorkBook {
	const r1 = CUMULUS_KOLUMNY.map(() => '');
	for (const g of CUMULUS_GRUPY) r1[g.from] = g.group;
	const r2 = CUMULUS_KOLUMNY.map((c) => c.header);
	const data = rows.map((row) => CUMULUS_KOLUMNY.map((c) => row[c.key] ?? ''));

	const ws = XLSX.utils.aoa_to_sheet([r1, r2, ...data]);
	ws['!merges'] = CUMULUS_GRUPY.filter((g) => g.to > g.from).map((g) => ({
		s: { r: 0, c: g.from },
		e: { r: 0, c: g.to }
	}));
	ws['!cols'] = CUMULUS_KOLUMNY.map((c) => ({ wch: c.width }));

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, CUMULUS_ARKUSZ);
	return wb;
}

export function downloadCumulus(rows: CumulusRow[], filename: string) {
	XLSX.writeFile(buildCumulusWorkbook(rows), filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
