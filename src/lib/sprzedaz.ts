// Sprzedaż: etapy leada, zainteresowania z formularza i maile kampanii — wspólne etykiety dla Leadów,
// karty leada, Panelu 360° i komunikatu o ponownym zgłoszeniu.

export const ZAINTERESOWANIA = ['oc', 'tax', 'utrata_dochodu', 'zdrowie', 'grupowe', 'konsultacja', 'inne'] as const;
export type Zainteresowanie = (typeof ZAINTERESOWANIA)[number];

export const ETYKIETA_ZAINTERESOWANIA: Record<string, string> = {
	oc: 'OC',
	tax: 'TAX',
	utrata_dochodu: 'Utrata dochodu',
	zdrowie: 'Zdrowie',
	grupowe: 'Grupowe',
	konsultacja: 'Konsultacja',
	inne: 'Inne'
};

/** Pełna nazwa do podpowiedzi (title) i filtrów. */
export const OPIS_ZAINTERESOWANIA: Record<string, string> = {
	oc: 'Ubezpieczenie OC',
	tax: 'Ochrona karno-skarbowa (TAX)',
	utrata_dochodu: 'Ubezpieczenie utraty dochodu',
	zdrowie: 'Pakiety zdrowotne',
	grupowe: 'Ubezpieczenia grupowe',
	konsultacja: 'Nie wie — prosi o konsultację',
	inne: 'Inne'
};

export function posortujZainteresowania(kody: string[] | null | undefined): string[] {
	const kolejnosc = (k: string) => {
		const i = (ZAINTERESOWANIA as readonly string[]).indexOf(k);
		return i < 0 ? 99 : i;
	};
	return [...(kody ?? [])].sort((a, b) => kolejnosc(a) - kolejnosc(b));
}

export const ETAPY = [
	{ key: 'nowy', label: 'Nowy' },
	{ key: 'w_kontakcie', label: 'W kontakcie' },
	{ key: 'oferta_wyslana', label: 'Oferta wysłana' },
	{ key: 'wygrany', label: 'Wygrany' },
	{ key: 'przegrany', label: 'Przegrany' }
] as const;

export const ETYKIETA_ETAPU: Record<string, string> = Object.fromEntries(ETAPY.map((e) => [e.key, e.label]));

export const KLASA_ETAPU: Record<string, string> = {
	nowy: 'bg-accent-soft text-accent-text',
	w_kontakcie: 'bg-surface-2 text-ink-2',
	oferta_wyslana: 'bg-warn-soft text-warn',
	wygrany: 'bg-ok-soft text-ok',
	przegrany: 'bg-danger-soft text-danger'
};

export const ZRODLO_LEADA: Record<string, string> = {
	beauty: 'formularz (BEAUTY)',
	formularz: 'formularz',
	import: 'import z bazy klientów',
	kartoteka: 'kartoteka CRM',
	recznie: 'dodany ręcznie'
};

/** Kampanie z BEAUTY mają nazwy techniczne (np. „NewsletterUD_11-10-2026”) — czytelniejsza wersja. */
export function nazwaKampanii(nazwa: string | null | undefined): string {
	if (!nazwa) return 'kampania';
	return nazwa.replace(/_/g, ' ').replace(/(\d{2})-(\d{2})-(\d{4})/, '$1.$2.$3').replace(/^NewsletterUD/, 'Newsletter Utrata dochodu');
}

export type PodsumowanieMaili = {
	klient_id: string;
	maile: number;
	otwarte: number;
	klikniete: number;
	odbite: number;
	ostatni_at: string | null;
	ostatnia_kampania: string | null;
	ostatni_klik_at: string | null;
	ostatni_klik_kampania: string | null;
};

export type MailKampanii = {
	id: string;
	kampania: string | null;
	kod: string | null;
	temat: string | null;
	adres: string | null;
	status: string | null;
	wyslano_at: string | null;
	dostarczono_at: string | null;
	otwarto_at: string | null;
	kliknieto_at: string | null;
	odbito_at: string | null;
};

/** Stan maila kampanii w jednym słowie: kliknięty > otwarty > dostarczony > odbity > wysłany. */
export function stanMaila(m: Pick<MailKampanii, 'kliknieto_at' | 'otwarto_at' | 'dostarczono_at' | 'odbito_at'>): { tekst: string; cls: string } {
	if (m.kliknieto_at) return { tekst: 'kliknięty', cls: 'bg-accent-soft text-accent-text' };
	if (m.otwarto_at) return { tekst: 'otwarty', cls: 'bg-ok-soft text-ok' };
	if (m.odbito_at) return { tekst: 'odbity', cls: 'bg-danger-soft text-danger' };
	if (m.dostarczono_at) return { tekst: 'dostarczony', cls: 'bg-surface-2 text-ink-2' };
	return { tekst: 'wysłany', cls: 'bg-surface-2 text-ink-2' };
}

export type Zgloszenie = {
	id: string;
	klient_id: string | null;
	prospect_id: string | null;
	zgloszono_at: string;
	firma: string | null;
	kontakt: string | null;
	email: string | null;
	telefon: string | null;
	produkt: string | null;
	zainteresowania: string[];
	przychod: string | null;
	ponowne: boolean;
	poprzednie_at: string | null;
	poprzednie_typ: 'zgloszenie' | 'kartoteka' | null;
	historyczne: boolean;
	odczytane_at: string | null;
};
