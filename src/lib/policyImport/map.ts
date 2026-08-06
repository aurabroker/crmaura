// Mapowanie danych z polisy na rekord crm_policies.
// Zasada: nic nie trafia do bazy bez zgodności identyfikatora klienta —
// dopasowanie do złego podmiotu oznaczałoby udostępnienie polisy obcej firmie.

import type { Client, Leasing, Policy, PolicyImportData, Vehicle } from '$lib/types/database';
import type { ExtractedPolicy, ProductTemplate } from './types';
import { digits, isValidNip, isValidRegon } from './parse';

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
	level: IssueLevel;
	text: string;
}

export interface Draft {
	payload: Record<string, unknown>;
	issues: Issue[];
	/** Umowa Generalna rozpoznana po numerze programu z polisy. */
	ug: Policy | null;
	/** Polisa, której to jest wznowienie. */
	poprzednia: Policy | null;
	raty: { nr: number; data: string; kwota: number }[];
	/** Pojazd dopasowany w kartotece klienta. */
	pojazd: Vehicle | null;
	/** Rekord pojazdu do założenia, gdy operator się na to zgodzi. */
	nowyPojazd: Record<string, unknown> | null;
	leasing: Leasing | null;
	/** Finansujący do dopisania do słownika leasingów, gdy jeszcze go nie ma. */
	nowyLeasing: Record<string, unknown> | null;
	/** Ubezpieczony, gdy jest innym podmiotem niż ubezpieczający. */
	ubezpieczony: Client | null;
}

export interface BuildInput {
	extracted: ExtractedPolicy;
	product: ProductTemplate;
	client: Client;
	/** Pełna kartoteka — do dowiązania ubezpieczonego będącego innym podmiotem. */
	clients: Client[];
	insurerId: string;
	/** Nazwa towarzystwa — zapisywana przy odczytanych parametrach jako źródło. */
	insurerNazwa?: string | null;
	/** Nazwa wgranego pliku — trafia do metryki importu. */
	fileName?: string | null;
	policies: Policy[];
	vehicles: Vehicle[];
	leasings: Leasing[];
	tenantId: string;
	/** Operator wyraził zgodę na założenie pojazdu z danych polisy. */
	utworzPojazd?: boolean;
}

export function buildDraft(input: BuildInput): Draft {
	const { extracted, product, client, insurerId, policies, tenantId } = input;
	const issues: Issue[] = [];

	issues.push(...sprawdzKlienta(extracted, client));

	if (!extracted.nr_polisy) issues.push({ level: 'error', text: 'Nie odczytano numeru polisy.' });
	if (!extracted.data_od || !extracted.data_do)
		issues.push({ level: 'error', text: 'Nie odczytano okresu ubezpieczenia.' });
	if (extracted.skladka == null)
		issues.push({ level: 'error', text: 'Nie odczytano składki.' });

	const duplikat = policies.find(
		(p) => p.nr_polisy?.trim() === extracted.nr_polisy?.trim() && !p.deleted_at
	);
	if (duplikat)
		issues.push({
			level: 'error',
			text: `Polisa o numerze ${extracted.nr_polisy} już istnieje w CRM.`
		});

	// Umowa Generalna po numerze programu wskazanym na polisie.
	let ug: Policy | null = null;
	if (extracted.program_ug) {
		const szukany = normNr(extracted.program_ug);
		ug =
			policies.find((p) => p.typ_umowy === 'generalna' && normNr(p.nr_polisy) === szukany) ?? null;
		if (ug)
			issues.push({
				level: 'info',
				text: `Polisa zostanie podpięta pod Umowę Generalną ${ug.nr_polisy} (program ${extracted.program_ug}).`
			});
		else
			issues.push({
				level: 'warn',
				text: `Na polisie wskazano Program Ubezpieczenia ${extracted.program_ug}, ale nie ma w CRM Umowy Generalnej o takim numerze — polisa zostanie zapisana jako jednostkowa.`
			});
	}

	// Wznowienie — Warta drukuje numer polisy poprzedniej.
	let poprzednia: Policy | null = null;
	if (extracted.wznowienie_nr) {
		poprzednia =
			policies.find((p) => normNr(p.nr_polisy) === normNr(extracted.wznowienie_nr)) ?? null;
		if (poprzednia)
			issues.push({
				level: 'info',
				text: `Rozpoznano wznowienie polisy ${poprzednia.nr_polisy} — zostanie powiązana jako odnowienie.`
			});
		else
			issues.push({
				level: 'warn',
				text: `Polisa jest wznowieniem numeru ${extracted.wznowienie_nr}, którego nie ma w CRM — powiązanie zostanie pominięte.`
			});
	}

	// Prowizji nie ma na żadnej polisie — to dana brokerska. Pochodzi z UG albo
	// jest wpisywana ręcznie, więc jej brak nie jest niczym, o czym trzeba mówić.
	const prowizjaPct = ug?.ug_default_prowizja_pct ?? 0;
	if (prowizjaPct > 0)
		issues.push({
			level: 'info',
			text: `Prowizja ${prowizjaPct}% przejęta z Umowy Generalnej.`
		});

	const raty = buildRaty(extracted);
	if (!raty.length && extracted.skladka != null)
		issues.push({
			level: 'warn',
			text: 'Nie odczytano harmonogramu rat — nie powstaną pozycje w Płatnościach.'
		});

	const { pojazd, nowyPojazd } = dopasujPojazd(input, issues);
	const { leasing, nowyLeasing } = dopasujLeasing(input, issues);
	const ubezpieczony = dopasujUbezpieczonego(input, issues);

	const skladka = extracted.skladka ?? 0;
	const payload: Record<string, unknown> = {
		tenant_id: tenantId,
		klient_id: client.id,
		tu_id: insurerId,
		nr_polisy: extracted.nr_polisy ?? '',
		rodzaj: extracted.rodzaj ?? product.rodzaj,
		typ_umowy: 'jednostkowa',
		ug_podtyp: null,
		ug_default_prowizja_pct: null,
		parent_id: ug?.id ?? null,
		renewal_of: poprzednia?.id ?? null,
		ubezpieczony_id: ubezpieczony?.id ?? null,
		przedmiot: extracted.przedmiot,
		// Pojazd zakładany w tej samej operacji nie ma jeszcze id — uzupełnia je zapis.
		pojazd_id: pojazd?.id ?? null,
		leasing_id: leasing?.id ?? null,
		nr_umowy_leasingowej: null,
		data_od: extracted.data_od,
		data_do: extracted.data_do,
		data_zawarcia: extracted.data_zawarcia,
		ilosc_rat: String(raty.length || extracted.ilosc_rat || 1),
		daty_rat: raty.map((r) => r.data).join(', ') || null,
		kwoty_rat: raty.map((r) => r.kwota.toFixed(2)).join(', ') || null,
		skladka_przypisana: skladka,
		skladka_zainkasowana: 0,
		skladka_zaliczkowa: 0,
		prowizja_pct: prowizjaPct,
		prowizja_przypisana: (skladka * prowizjaPct) / 100,
		prowizja_zainkasowana: 0,
		rozliczaj_platnosci: null,
		// Parametry bez własnych kolumn — pokazywane na karcie polisy.
		dane_importu: buildDaneImportu(input)
	};

	return {
		payload,
		issues,
		ug,
		poprzednia,
		raty,
		pojazd,
		nowyPojazd,
		leasing,
		nowyLeasing,
		ubezpieczony
	};
}

/**
 * Ubezpieczony bywa innym podmiotem niż ubezpieczający (spółka z grupy,
 * właściciel pojazdu). Wiążemy go z istniejącą kartoteką — nowego klienta
 * nie zakładamy nigdy.
 */
function dopasujUbezpieczonego(input: BuildInput, issues: Issue[]): Client | null {
	const { extracted, client, clients } = input;
	const nip = digits(extracted.ubezpieczony_nip);
	const regon = digits(extracted.ubezpieczony_regon);
	if (!nip && !regon) return null;

	// Ten sam podmiot co ubezpieczający — pole "ubezpieczony" zostaje puste.
	const jakKlient =
		(nip && nip === digits(client.nip)) || (regon && regon === digits(client.regon));
	if (jakKlient) return null;

	// Finansującego obsługuje słownik leasingów, nie kartoteka klientów.
	if (extracted.leasing) return null;

	const hit =
		clients.find((c) => nip && digits(c.nip) === nip) ??
		clients.find((c) => regon && digits(c.regon) === regon) ??
		null;

	if (hit)
		issues.push({
			level: 'info',
			text: `Ubezpieczonym jest inny podmiot — „${hit.nazwa}” z kartoteki, zostanie wpisany w pole Ubezpieczony.`
		});
	else
		issues.push({
			level: 'warn',
			text: `Ubezpieczonym jest inny podmiot („${extracted.ubezpieczony_nazwa ?? nip ?? regon}”), którego nie ma w kartotece — pole Ubezpieczony zostanie puste.`
		});
	return hit;
}

// Pojazd wiążemy po VIN, a gdy go brak — po numerze rejestracyjnym.
// Nowy rekord powstaje wyłącznie na wyraźną zgodę operatora.
function dopasujPojazd(
	input: BuildInput,
	issues: Issue[]
): { pojazd: Vehicle | null; nowyPojazd: Record<string, unknown> | null } {
	const { extracted, client, vehicles, policies, tenantId, utworzPojazd } = input;
	const dane = extracted.pojazd;
	if (!dane) return { pojazd: null, nowyPojazd: null };

	const vin = dane.vin?.toUpperCase() ?? null;
	const rej = normRej(dane.nr_rejestracyjny);

	const kandydaci = vehicles.filter(
		(v) => (vin && v.vin?.toUpperCase() === vin) || (rej && normRej(v.nr_rejestracyjny) === rej)
	);
	const wlasny = kandydaci.find((v) => v.klient_id === client.id) ?? null;

	if (wlasny) {
		issues.push({
			level: 'info',
			text: `Pojazd ${wlasny.nr_rejestracyjny} znaleziony w kartotece klienta — polisa zostanie z nim powiązana.`
		});
		const zajety = policies.find(
			(p) => p.pojazd_id === wlasny.id && !p.deleted_at && p.data_do >= (extracted.data_od ?? '')
		);
		if (zajety)
			issues.push({
				level: 'warn',
				text: `Pojazd jest już przypisany do polisy ${zajety.nr_polisy} obejmującej ten okres.`
			});
		return { pojazd: wlasny, nowyPojazd: null };
	}

	if (kandydaci.length) {
		issues.push({
			level: 'error',
			text: `Pojazd ${dane.nr_rejestracyjny ?? dane.vin} istnieje w bazie, ale jest przypisany do innego klienta.`
		});
		return { pojazd: null, nowyPojazd: null };
	}

	const opis = [dane.nr_rejestracyjny, dane.marka_model].filter(Boolean).join(' — ');
	if (!utworzPojazd) {
		issues.push({
			level: 'error',
			text: `Pojazd ${opis} nie występuje w kartotece klienta. Potwierdź założenie go z danych polisy albo dodaj go wcześniej ręcznie.`
		});
		return { pojazd: null, nowyPojazd: null };
	}

	issues.push({
		level: 'warn',
		text: `Pojazd ${opis} zostanie założony w kartotece klienta na podstawie danych z polisy.`
	});
	return {
		pojazd: null,
		nowyPojazd: {
			tenant_id: tenantId,
			klient_id: client.id,
			nr_rejestracyjny: dane.nr_rejestracyjny,
			marka_model: dane.marka_model,
			vin: dane.vin,
			rok_produkcji: dane.rok_produkcji,
			rodzaj_pojazdu: dane.rodzaj_pojazdu,
			moc: dane.moc,
			pojemnosc_silnika: dane.pojemnosc_silnika,
			ladownosc: dane.ladownosc
		}
	};
}

/**
 * Polityka leasingu: gdy ubezpieczonym jest finansujący, polisa i tak należy
 * do ubezpieczającego — to on jest klientem w CRM (pole "ubezpieczony" zostaje
 * puste, bo leasing nie jest klientem kancelarii). Finansującego wskazujemy ze
 * słownika leasingów, a gdy go tam nie ma — dopisujemy go na podstawie polisy.
 */
function dopasujLeasing(
	input: BuildInput,
	issues: Issue[]
): { leasing: Leasing | null; nowyLeasing: Record<string, unknown> | null } {
	const dane = input.extracted.leasing;
	if (!dane?.nazwa) return { leasing: null, nowyLeasing: null };

	const nip = digits(dane.nip);
	const szukana = uprosc(dane.nazwa);
	const hit =
		input.leasings.find((l) => nip && digits(l.nip) === nip) ??
		input.leasings.find((l) => {
			const n = uprosc(l.nazwa);
			return !!n && !!szukana && (n === szukana || szukana.startsWith(n) || n.startsWith(szukana));
		}) ??
		null;

	if (hit) {
		issues.push({
			level: 'info',
			text: `Ubezpieczonym jest finansujący „${hit.nazwa}” ze słownika leasingów — polisa pozostaje przy ubezpieczającym.`
		});
		return { leasing: hit, nowyLeasing: null };
	}

	issues.push({
		level: 'info',
		text: `Finansujący „${dane.nazwa}” zostanie dopisany do słownika leasingów i powiązany z polisą.`
	});
	return {
		leasing: null,
		nowyLeasing: {
			tenant_id: input.tenantId,
			nazwa: dane.nazwa,
			nip: nip,
			adres: dane.adres
		}
	};
}

function normRej(raw: string | null | undefined): string {
	return (raw ?? '').replace(/\s/g, '').toUpperCase();
}

function uprosc(raw: string | null | undefined): string {
	return (raw ?? '')
		.toUpperCase()
		.replace(/\b(S\.?A\.?|SP\.? Z O\.?O\.?|SPÓŁKA AKCYJNA|ODDZIAŁ.*)$/g, '')
		.replace(/[^A-ZŁŚĆŻŹÓĄĘŃ0-9]/g, '')
		.trim();
}

function sprawdzKlienta(extracted: ExtractedPolicy, client: Client): Issue[] {
	const issues: Issue[] = [];
	const polisaNip = digits(extracted.klient_nip);
	const polisaRegon = digits(extracted.klient_regon);
	const klientNip = digits(client.nip);
	const klientRegon = digits(client.regon);

	if (!polisaNip && !polisaRegon)
		return [
			{
				level: 'error',
				text: 'Na polisie nie odczytano ani NIP, ani REGON — nie da się potwierdzić, że dokument należy do wybranego klienta.'
			}
		];

	if (polisaNip && !isValidNip(polisaNip))
		issues.push({
			level: 'warn',
			text: `NIP z polisy (${polisaNip}) ma błędną sumę kontrolną.`
		});
	if (polisaRegon && !isValidRegon(polisaRegon))
		issues.push({
			level: 'warn',
			text: `REGON z polisy (${polisaRegon}) ma błędną sumę kontrolną.`
		});

	let potwierdzone = false;

	if (polisaNip && klientNip) {
		if (polisaNip === klientNip) {
			issues.push({ level: 'info', text: `NIP zgodny z kartoteką klienta (${polisaNip}).` });
			potwierdzone = true;
		} else {
			issues.push({
				level: 'error',
				text: `NIP z polisy (${polisaNip}) nie zgadza się z NIP klienta (${klientNip}).`
			});
		}
	}

	if (polisaRegon && klientRegon) {
		// REGON 14-znakowy zaczyna się od 9-znakowego tej samej jednostki.
		const zgodny =
			polisaRegon === klientRegon ||
			polisaRegon.startsWith(klientRegon) ||
			klientRegon.startsWith(polisaRegon);
		if (zgodny) {
			issues.push({ level: 'info', text: `REGON zgodny z kartoteką klienta (${polisaRegon}).` });
			potwierdzone = true;
		} else {
			issues.push({
				level: 'error',
				text: `REGON z polisy (${polisaRegon}) nie zgadza się z REGON klienta (${klientRegon}).`
			});
		}
	}

	if (!potwierdzone && !issues.some((i) => i.level === 'error')) {
		const brakujace = [
			polisaNip && !klientNip ? 'NIP' : null,
			polisaRegon && !klientRegon ? 'REGON' : null
		].filter(Boolean);
		issues.push({
			level: 'error',
			text: `Klient nie ma w kartotece ${brakujace.join(' ani ')} — uzupełnij dane klienta, żeby potwierdzić, że polisa należy do niego.`
		});
	}

	return issues;
}

/**
 * Wszystko, co polisa niesie poza kolumnami crm_policies: pozycje ryzyk z sumami,
 * klauzule, franszyzy, miejsca ubezpieczenia, konto do wpłat, numer OWU.
 * Bez tego dane odczytane z pliku ginęłyby zaraz po imporcie.
 */
function buildDaneImportu(input: BuildInput): PolicyImportData | null {
	const { extracted, product, insurerNazwa, fileName } = input;
	const dane: PolicyImportData = {
		zrodlo: {
			ubezpieczyciel: insurerNazwa ?? undefined,
			produkt: product.label,
			plik: fileName ?? undefined,
			data: new Date().toISOString().slice(0, 10)
		},
		ryzyka: extracted.ryzyka.length ? extracted.ryzyka : undefined,
		konto_do_wplat: extracted.konto_do_wplat,
		owu: extracted.produkt_owu,
		dodatkowe: Object.keys(extracted.dodatkowe).length ? extracted.dodatkowe : undefined
	};
	const maTresc =
		dane.ryzyka?.length || dane.konto_do_wplat || dane.owu || dane.dodatkowe;
	return maTresc ? dane : null;
}

function buildRaty(extracted: ExtractedPolicy): { nr: number; data: string; kwota: number }[] {
	const raty = extracted.raty.filter((r) => r.data);
	if (!raty.length) return [];
	const skladka = extracted.skladka ?? 0;
	const rowno = raty.length > 0 ? skladka / raty.length : skladka;
	return raty.map((r, i) => ({
		nr: i + 1,
		data: r.data,
		kwota: r.kwota ?? rowno
	}));
}

function normNr(nr: string | null | undefined): string {
	return (nr ?? '').replace(/\s/g, '').toUpperCase();
}
