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
	/** Propozycja odnowienia rozpoznana po pojeździe — czeka na potwierdzenie. */
	kandydatOdnowienia: Policy | null;
	raty: { nr: number; data: string; kwota: number }[];
	/** Pojazd dopasowany w kartotece klienta. */
	pojazd: Vehicle | null;
	/** Rekord pojazdu do założenia, gdy operator się na to zgodzi. */
	nowyPojazd: Record<string, unknown> | null;
	/** Wniosek do administratora o dodanie pojazdu, którego nie da się zapisać wprost. */
	wniosekPojazd: Record<string, unknown> | null;
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
	/** Operator zdecydował się złożyć wniosek o pojazd bez numeru rejestracyjnego. */
	wnioskujPojazd?: boolean;
	/** Operator potwierdził, że polisa jest odnowieniem znalezionego poprzednika. */
	potwierdzOdnowienie?: boolean;
	/** Odnowienie wskazane wprost (wejście z karty polisy). */
	renewalOf?: string | null;
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

	// Odnowienie wskazane wprost — broker wszedł do importu z karty polisy.
	let poprzednia: Policy | null = null;
	if (input.renewalOf) {
		poprzednia = policies.find((p) => p.id === input.renewalOf) ?? null;
		if (poprzednia)
			issues.push({
				level: 'info',
				text: `Import jako odnowienie polisy ${poprzednia.nr_polisy} (${poprzednia.data_od} — ${poprzednia.data_do}).`
			});
	}

	// Wznowienie — Warta drukuje numer polisy poprzedniej.
	if (!poprzednia && extracted.wznowienie_nr) {
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

	const { pojazd, nowyPojazd, wniosekPojazd } = dopasujPojazd(input, issues);
	const { leasing, nowyLeasing } = dopasujLeasing(input, issues);
	const ubezpieczony = dopasujUbezpieczonego(input, issues);

	// Polisa komunikacyjna rzadko podaje numer poprzedniej. Gdy pojazd jest już
	// w kartotece, poprzednika szukamy po ciągłości okresów na tym pojeździe.
	let kandydatOdnowienia: Policy | null = null;
	if (!poprzednia && pojazd && extracted.data_od) {
		kandydatOdnowienia = znajdzPoprzedniaPoPojezdzie(pojazd, extracted.data_od, policies);
		if (kandydatOdnowienia) {
			if (input.potwierdzOdnowienie) {
				poprzednia = kandydatOdnowienia;
				issues.push({
					level: 'info',
					text: `Polisa zostanie powiązana jako odnowienie ${kandydatOdnowienia.nr_polisy} (${kandydatOdnowienia.data_od} — ${kandydatOdnowienia.data_do}).`
				});
			} else {
				issues.push({
					level: 'warn',
					text: `Ten pojazd ma polisę ${kandydatOdnowienia.nr_polisy} kończącą się ${kandydatOdnowienia.data_do}, a nowa zaczyna się ${extracted.data_od}. Potwierdź, czy to jej odnowienie.`
				});
			}
		}
	}

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
		kandydatOdnowienia,
		raty,
		pojazd,
		nowyPojazd,
		wniosekPojazd,
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
): {
	pojazd: Vehicle | null;
	nowyPojazd: Record<string, unknown> | null;
	wniosekPojazd: Record<string, unknown> | null;
} {
	const { extracted, client, vehicles, policies, tenantId, utworzPojazd, wnioskujPojazd } = input;
	const dane = extracted.pojazd;
	if (!dane) return { pojazd: null, nowyPojazd: null, wniosekPojazd: null };

	const vin = dane.vin?.toUpperCase() ?? null;
	const rej = normRej(dane.nr_rejestracyjny);

	// VIN jest stały przez całe życie pojazdu, numer rejestracyjny bywa zmieniany
	// (przerejestrowanie, zmiana właściciela), więc dopasowanie po VIN ma
	// pierwszeństwo — inaczej ten sam pojazd zdublowałby się po zmianie tablic.
	const poVin = vin ? vehicles.filter((v) => v.vin?.toUpperCase() === vin) : [];
	const poRej = rej ? vehicles.filter((v) => normRej(v.nr_rejestracyjny) === rej) : [];
	const kandydaci = poVin.length ? poVin : poRej;
	const wlasny = kandydaci.find((v) => v.klient_id === client.id) ?? null;

	if (wlasny) {
		issues.push({
			level: 'info',
			text: `Pojazd ${wlasny.nr_rejestracyjny} znaleziony w kartotece klienta — polisa zostanie z nim powiązana.`
		});

		// Rozpoznany po VIN, ale z inną rejestracją — pojazd przerejestrowano.
		if (poVin.length && rej && normRej(wlasny.nr_rejestracyjny) !== rej)
			issues.push({
				level: 'warn',
				text: `Pojazd rozpoznany po VIN, ale ma inny numer rejestracyjny: w kartotece ${wlasny.nr_rejestracyjny}, na polisie ${dane.nr_rejestracyjny}. Potwierdź aktualizację numeru w kartotece.`
			});

		const zajety = policies.find(
			(p) =>
				p.pojazd_id === wlasny.id &&
				!p.deleted_at &&
				p.data_do >= (extracted.data_od ?? '') &&
				p.data_od <= (extracted.data_do ?? '')
		);
		if (zajety)
			issues.push({
				level: 'warn',
				text: `Pojazd ma już polisę ${zajety.nr_polisy} obejmującą ten sam okres (${zajety.data_od} — ${zajety.data_do}).`
			});
		return { pojazd: wlasny, nowyPojazd: null, wniosekPojazd: null };
	}

	if (kandydaci.length) {
		issues.push({
			level: 'error',
			text: `Pojazd ${dane.nr_rejestracyjny ?? dane.vin} istnieje w bazie, ale jest przypisany do innego klienta.`
		});
		return { pojazd: null, nowyPojazd: null, wniosekPojazd: null };
	}

	const opis = [dane.nr_rejestracyjny, dane.vin, dane.marka_model].filter(Boolean).join(' — ');

	const wspolne = {
		nr_rejestracyjny: dane.nr_rejestracyjny,
		marka_model: dane.marka_model,
		vin: dane.vin,
		rok_produkcji: dane.rok_produkcji,
		rodzaj_pojazdu: dane.rodzaj_pojazdu,
		moc: dane.moc,
		pojemnosc_silnika: dane.pojemnosc_silnika,
		ladownosc: dane.ladownosc
	};

	// Kartoteka pojazdów wymaga numeru rejestracyjnego, a polisa nie zawsze go
	// niesie (bywa sam VIN). Takiego pojazdu broker nie zakłada sam — składa
	// wniosek, który administrator uzupełnia i akceptuje albo odrzuca.
	if (!dane.nr_rejestracyjny) {
		if (!wnioskujPojazd) {
			issues.push({
				level: 'error',
				text: `Polisa nie zawiera numeru rejestracyjnego pojazdu (${opis}), więc nie da się go zapisać w kartotece. Złóż wniosek do administratora albo dodaj pojazd wcześniej ręcznie.`
			});
			return { pojazd: null, nowyPojazd: null, wniosekPojazd: null };
		}
		issues.push({
			level: 'warn',
			text: `Pojazd ${opis} nie ma numeru rejestracyjnego — powstanie wniosek do administratora. Polisa zostanie zapisana bez powiązania z pojazdem.`
		});
		return {
			pojazd: null,
			nowyPojazd: null,
			wniosekPojazd: {
				tenant_id: tenantId,
				klient_id: client.id,
				...wspolne,
				zrodlo: input.fileName ?? null,
				status: 'oczekuje'
			}
		};
	}

	if (!utworzPojazd) {
		issues.push({
			level: 'error',
			text: `Pojazd ${opis} nie występuje w kartotece klienta. Potwierdź założenie go z danych polisy albo dodaj go wcześniej ręcznie.`
		});
		return { pojazd: null, nowyPojazd: null, wniosekPojazd: null };
	}

	issues.push({
		level: 'warn',
		text: `Pojazd ${opis} zostanie założony w kartotece klienta na podstawie danych z polisy.`
	});
	return {
		pojazd: null,
		nowyPojazd: { tenant_id: tenantId, klient_id: client.id, ...wspolne },
		wniosekPojazd: null
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

/** Ile dni przerwy między polisami wciąż uznajemy za ciągłość ochrony. */
const TOLERANCJA_ODNOWIENIA_DNI = 45;

/**
 * Poprzednia polisa tego samego pojazdu: taka, która kończy się tuż przed
 * początkiem nowej. Dopuszczamy krótką przerwę i niewielkie nachodzenie okresów
 * (polisa bywa wystawiana z wyprzedzeniem), ale odrzucamy polisy nachodzące
 * na cały nowy okres — to nie odnowienie, tylko druga równoległa ochrona.
 */
function znajdzPoprzedniaPoPojezdzie(
	pojazd: Vehicle,
	dataOd: string,
	policies: Policy[]
): Policy | null {
	const kandydaci = policies
		.filter((p) => p.pojazd_id === pojazd.id && !p.deleted_at && p.data_do && p.data_od < dataOd)
		.filter((p) => {
			const przerwa = dniMiedzy(p.data_do, dataOd);
			return przerwa >= -TOLERANCJA_ODNOWIENIA_DNI && przerwa <= TOLERANCJA_ODNOWIENIA_DNI;
		})
		.sort((a, b) => b.data_do.localeCompare(a.data_do));
	return kandydaci[0] ?? null;
}

function dniMiedzy(od: string, do_: string): number {
	const a = Date.parse(od);
	const b = Date.parse(do_);
	if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
	return Math.round((b - a) / 86_400_000);
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
