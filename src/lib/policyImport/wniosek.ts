// Lekka walidacja importowanej polisy ze złożonym wnioskiem klienta z programu OC beauty (crm_renewals:
// pierwsza polisa albo odnowienie certyfikatu). Klient wybrał we wniosku sumę gwarancyjną, ochronę prawną,
// podał liczbę osób i rodzaj działalności, a CRM wyliczył składkę — certyfikat z Hestii powinien się z tym
// zgadzać. Różnice są ostrzeżeniem (nie blokują zapisu): doradca sprawdza, czy to pomyłka Hestii, czy
// uzgodniona zmiana. Moduł jest czysty (bez $lib), żeby dało się go testować w node.

import type { Issue } from './map.ts';
import type { ExtractedPolicy } from './types.ts';
import type { Policy, RenewalRow } from '../types/database.ts';
import { KATEGORIE, LICZBA_OSOB, formatSuma, formatZl, kategoriaZRodzajow, ochronaPrawnaWSkladce, przesunDate } from '../renewals/program.ts';

export type WniosekDoPorownania = Pick<
	RenewalRow,
	'id' | 'rodzaj' | 'status' | 'decyzja' | 'polisa_id' | 'klient_id' | 'email' | 'suma' | 'skladka' | 'skladka_nowa' | 'okres_do' | 'apk' | 'wniosek' | 'zlozono_at'
>;

/** Kolumny crm_renewals potrzebne do porównania (strona importu wczytuje je dla wybranego klienta). */
export const WNIOSEK_KOLUMNY = 'id, rodzaj, status, decyzja, polisa_id, klient_id, email, suma, skladka, skladka_nowa, okres_do, apk, wniosek, zlozono_at';

type PolisaSkrot = Pick<Policy, 'klient_id' | 'deleted_at' | 'typ_umowy' | 'created_at' | 'renewal_of'>;

const dataKropki = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
const OCHRONA_PRAWNA = /ochron\w*\s+prawn/i;
const OSOBY_6_8 = /od\s*6\s*do\s*8/i;

/**
 * Złożony wniosek, którego dotyczy importowana polisa: przy odnowieniu — wniosek do poprzedniej polisy,
 * poza tym najnowszy złożony wniosek klienta, który nie ma jeszcze polisy (pierwsza polisa — klient nie dostał
 * polisy po złożeniu; odnowienie — certyfikat nie ma następczyni). Rezygnacje („nie”) pomijamy.
 */
export function wniosekDoPolisy(
	wnioski: WniosekDoPorownania[],
	o: { klientId: string; poprzedniaId: string | null; policies: PolisaSkrot[] }
): WniosekDoPorownania | null {
	const zlozone = wnioski
		.filter((w) => w.klient_id === o.klientId && w.status === 'zlozony' && !!w.decyzja && w.decyzja !== 'nie')
		.sort((a, b) => (b.zlozono_at ?? '').localeCompare(a.zlozono_at ?? ''));
	if (o.poprzedniaId) {
		const doPoprzedniej = zlozone.find((w) => w.polisa_id === o.poprzedniaId);
		if (doPoprzedniej) return doPoprzedniej;
	}
	const zalatwiony = (w: WniosekDoPorownania) =>
		w.rodzaj === 'nowa'
			? o.policies.some((p) => p.klient_id === w.klient_id && !p.deleted_at && p.typ_umowy !== 'generalna' && (p.created_at ?? '') >= (w.zlozono_at ?? ''))
			: o.policies.some((p) => !p.deleted_at && !!w.polisa_id && p.renewal_of === w.polisa_id);
	return zlozone.find((w) => !zalatwiony(w)) ?? null;
}

/** Ostrzeżenia o różnicach między polisą a wnioskiem albo jedna informacja o zgodności. */
export function porownajZWnioskiem(e: ExtractedPolicy, w: WniosekDoPorownania): Issue[] {
	const z = w.wniosek?.zmiany ?? null;
	const apk = w.apk;
	const nowa = w.rodzaj === 'nowa';
	const roznice: string[] = [];
	const zgodne: string[] = [];
	const tekstPolisy = [...e.ryzyka.map((r) => r.przedmiot), e.dodatkowe['Klauzule dodatkowe'] ?? '', e.przedmiot ?? ''].join(' | ');

	// Suma gwarancyjna: wybrana we wniosku, a przy odnowieniu bez zmian — z obecnego certyfikatu.
	const sumaOczekiwana = z?.wyzsza_suma ?? (w.decyzja === 'bez_zmian' ? w.suma : null);
	if (sumaOczekiwana != null) {
		if (e.suma_gwarancyjna == null) roznice.push(`nie odczytano sumy gwarancyjnej z polisy, we wniosku ${formatSuma(sumaOczekiwana)} — uzupełnij ją na karcie polisy`);
		else if (Math.round(e.suma_gwarancyjna) !== Math.round(sumaOczekiwana)) roznice.push(`suma gwarancyjna na polisie ${formatSuma(e.suma_gwarancyjna)}, we wniosku ${formatSuma(sumaOczekiwana)}`);
		else zgodne.push(`suma ${formatSuma(sumaOczekiwana)}`);
	}

	// Składka: wycena z wniosku (taryfa programu), a przy odnowieniu bez nowej wyceny — dotychczasowa.
	const skladkaOczekiwana = w.skladka_nowa ?? (nowa ? null : w.skladka);
	if (skladkaOczekiwana != null && e.skladka != null) {
		if (Math.abs(e.skladka - skladkaOczekiwana) > 0.01) roznice.push(`składka na polisie ${formatZl(e.skladka)}, we wniosku ${formatZl(skladkaOczekiwana)}`);
		else zgodne.push(`składka ${formatZl(skladkaOczekiwana)}`);
	}

	// Ochrona prawna: zaznaczona we wniosku albo już w składce obecnego certyfikatu; na polisie — klauzula.
	const opOczekiwana = !!z?.ochrona_prawna || (!nowa && ochronaPrawnaWSkladce(w.skladka, w.suma));
	const opNaPolisie = OCHRONA_PRAWNA.test(tekstPolisy);
	if (e.ryzyka.length || e.dodatkowe['Klauzule dodatkowe']) {
		if (opOczekiwana && !opNaPolisie) roznice.push('we wniosku ochrona prawna, na polisie nie ma klauzuli ochrony prawnej');
		else if (!opOczekiwana && opNaPolisie) roznice.push('na polisie klauzula ochrony prawnej, której nie było we wniosku');
		else zgodne.push(opOczekiwana ? 'ochrona prawna' : 'bez ochrony prawnej');
	}

	// Liczba osób: 6–8 to dopłata 25% i klauzula „Liczba zatrudnionych od 6 do 8” na certyfikacie.
	const osoby = apk?.osoby || z?.osoby || null;
	if (osoby && (e.ryzyka.length || e.dodatkowe['Klauzule dodatkowe'])) {
		const nazwaOsob = LICZBA_OSOB.find((o) => o.key === osoby)?.nazwa ?? osoby;
		const naPolisie68 = OSOBY_6_8.test(tekstPolisy);
		if (osoby === '6-8' && !naPolisie68) roznice.push('we wniosku 6–8 osób, na polisie nie ma klauzuli „Liczba zatrudnionych od 6 do 8”');
		else if (osoby === '1-5' && naPolisie68) roznice.push('na polisie klauzula „Liczba zatrudnionych od 6 do 8”, a we wniosku do 5 osób');
		else if (osoby === '9+') zgodne.push('powyżej 8 osób (składka indywidualna)');
		else zgodne.push(nazwaOsob);
	}

	// Rodzaj działalności → kategoria taryfy; certyfikat drukuje jej nazwę jako zakres ubezpieczenia.
	const rodzaje = z?.zmiana_dzialalnosci && z.rodzaje.length ? z.rodzaje : apk?.rodzaje.length ? apk.rodzaje : (z?.rodzaje ?? []);
	const kategoria = kategoriaZRodzajow(rodzaje);
	const zakresPolisy = e.ryzyka[0]?.przedmiot.replace(/\s*\([A-Z]\d{2}\s*-\s*\d+\)\s*$/, '') ?? null;
	if (kategoria && zakresPolisy) {
		const oczekiwany = KATEGORIE[kategoria].nazwa;
		if (norm(zakresPolisy) !== norm(oczekiwany)) roznice.push(`zakres na polisie „${zakresPolisy}”, z wniosku wynika „${oczekiwany}”`);
		else zgodne.push(`zakres „${oczekiwany}”`);
	}

	// Początek ochrony: data z wniosku o pierwszą polisę albo dzień po końcu odnawianego certyfikatu.
	const odOczekiwana = w.wniosek?.nowa?.ochrona_od ?? (!nowa && w.okres_do ? przesunDate(w.okres_do.slice(0, 10), 1) : null);
	if (odOczekiwana && e.data_od) {
		if (e.data_od !== odOczekiwana) roznice.push(`początek ochrony na polisie ${dataKropki(e.data_od)}, we wniosku ${dataKropki(odOczekiwana)}`);
		else zgodne.push(`ochrona od ${dataKropki(odOczekiwana)}`);
	}

	// Dane firmy z wniosku o pierwszą polisę (albo nowy adres przy odnowieniu) a dane na certyfikacie.
	const firma = w.wniosek?.nowa?.firma ?? null;
	if (firma?.nip && e.klient_nip && firma.nip !== e.klient_nip) roznice.push(`NIP na polisie ${e.klient_nip}, we wniosku ${firma.nip}`);
	const adres = firma ?? z?.adres ?? null;
	if (adres?.kod && e.klient_adres) {
		const naPolisie = norm(e.klient_adres);
		if (!naPolisie.includes(adres.kod) || (adres.ulica && !naPolisie.includes(norm(adres.ulica))))
			roznice.push(`adres na polisie „${e.klient_adres}”, we wniosku „${[adres.ulica, `${adres.kod} ${adres.miasto}`].filter(Boolean).join(', ')}”`);
	}

	const kiedy = w.zlozono_at ? ` z ${dataKropki(w.zlozono_at)}` : '';
	const czego = nowa ? 'wniosek o pierwszą polisę' : 'wniosek o odnowienie';
	const out: Issue[] = roznice.length
		? roznice.map((r) => ({ level: 'warn', text: `Niezgodność z wnioskiem (${czego}${kiedy}): ${r}.` }))
		: [{ level: 'info', text: `Polisa zgodna ze złożonym wnioskiem (${czego}${kiedy})${zgodne.length ? `: ${zgodne.join(', ')}` : ''}.` }];
	if (z?.zabiegi_ankieta?.length)
		out.push({
			level: 'info',
			text: `Wniosek zgłasza zabiegi wymagające ankiety (${z.zabiegi_ankieta.join('; ')}) — certyfikat z programu ich nie wymienia, sprawdź potwierdzenie Hestii.`
		});
	return out;
}
