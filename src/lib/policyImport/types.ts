// Wspólny model danych wyciągniętych z polisy. Szablon każdego towarzystwa
// zwraca ten sam kształt, dzięki czemu mapowanie na CRM jest jedno dla wszystkich.

import type { PdfDoc } from './pdfDoc';

/** Pozycja ryzyka z tabeli "przedmiot ubezpieczenia / suma ubezpieczenia". */
export interface RiskItem {
	sekcja: string;
	przedmiot: string;
	suma: number | null;
	skladka?: number | null;
}

export interface Installment {
	data: string;
	kwota: number | null;
}

export interface ExtractedPolicy {
	nr_polisy: string | null;
	/** Numer polisy poprzedniej — Warta drukuje go przy wznowieniu. */
	wznowienie_nr: string | null;
	data_od: string | null;
	data_do: string | null;
	data_zawarcia: string | null;

	klient_nazwa: string | null;
	klient_nip: string | null;
	klient_regon: string | null;
	klient_adres: string | null;
	klient_email: string | null;

	ubezpieczony_nazwa: string | null;
	ubezpieczony_nip: string | null;

	skladka: number | null;
	ilosc_rat: number | null;
	raty: Installment[];
	konto_do_wplat: string | null;

	przedmiot: string | null;
	ryzyka: RiskItem[];
	produkt_owu: string | null;
	/** Numer Programu Ubezpieczenia / Umowy Generalnej wskazany na polisie. */
	program_ug: string | null;

	/** Pola bez odpowiednika w crm_policies — trafiają do podglądu jako informacja. */
	dodatkowe: Record<string, string>;
}

export function emptyExtraction(): ExtractedPolicy {
	return {
		nr_polisy: null,
		wznowienie_nr: null,
		data_od: null,
		data_do: null,
		data_zawarcia: null,
		klient_nazwa: null,
		klient_nip: null,
		klient_regon: null,
		klient_adres: null,
		klient_email: null,
		ubezpieczony_nazwa: null,
		ubezpieczony_nip: null,
		skladka: null,
		ilosc_rat: null,
		raty: [],
		konto_do_wplat: null,
		przedmiot: null,
		ryzyka: [],
		produkt_owu: null,
		program_ug: null,
		dodatkowe: {}
	};
}

/** Definicja produktu jednego towarzystwa. */
export interface ProductTemplate {
	id: string;
	label: string;
	/** Rodzaj polisy w CRM (wartość pola crm_policies.rodzaj). */
	rodzaj: string;
	/** Brak parsera = produkt widoczny na liście, ale import zablokowany. */
	parse?: (doc: PdfDoc) => ExtractedPolicy;
	/** Zdanie wyjaśniające, czego brakuje — pokazywane, gdy parse === undefined. */
	todo?: string;
	/** Sprawdza, czy wgrany plik to na pewno ten produkt. Zwraca komunikat błędu. */
	detect?: (doc: PdfDoc) => string | null;
}

/** Towarzystwo wraz z listą obsługiwanych produktów. */
export interface InsurerTemplate {
	/** Skrót zgodny z crm_insurers.skrot — po nim wiążemy szablon z bazą. */
	skrot: string;
	nazwa: string;
	produkty: ProductTemplate[];
}
