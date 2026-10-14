// Zgody marketingowe i klauzula informacyjna RODO w formularzu odnowienia (strona klienta, PDF APK, karta klienta).
//
// Dwie zgody, każda osobno, dobrowolna i domyślnie odznaczona: informacje handlowe e-mailem (w tym newsletter)
// oraz kontakt telefoniczny i SMS. Klient podpisuje je razem z analizą potrzeb, a w bazie zostaje dokładne
// brzmienie z chwili zgody (rejestr crm_zgody). Wiadomości o samym ubezpieczeniu (odnowienie, polisa, składki)
// zgody nie wymagają — to obsługa umowy.
//
// Zmiana treści zgody = nowa WERSJA_ZGOD (stare zgody zachowują swoje brzmienie w rejestrze).

export type KanalZgody = 'email' | 'sms';
export type Zgody = { email: boolean; sms: boolean };

export const WERSJA_ZGOD = '2026-10';

export const ADMINISTRATOR = {
	nazwa: 'Aura Expert sp. z o.o.',
	adres: 'ul. Bolkowska 2A/28, 01-466 Warszawa',
	email: 'zarzad@auraexpert.pl',
	iod: 'iod@auraexpert.pl',
	knf: '11229690/A'
} as const;

export const ZGODY: { kanal: KanalZgody; tytul: string; tresc: string }[] = [
	{
		kanal: 'email',
		tytul: 'Informacje o ubezpieczeniach e-mailem (w tym newsletter)',
		tresc:
			`Wyrażam zgodę na otrzymywanie od ${ADMINISTRATOR.nazwa} informacji handlowych i marketingowych dotyczących ubezpieczeń ` +
			'i programu BeautyPolisa (w tym newslettera) na podany przeze mnie adres e-mail (art. 398 ustawy – Prawo komunikacji ' +
			`elektronicznej). Zgoda jest dobrowolna i mogę ją wycofać w każdej chwili, np. linkiem w stopce wiadomości albo pisząc na ${ADMINISTRATOR.email}.`
	},
	{
		kanal: 'sms',
		tytul: 'Kontakt telefoniczny i SMS',
		tresc:
			`Wyrażam zgodę na kontakt telefoniczny i SMS ze strony ${ADMINISTRATOR.nazwa} w celu przedstawiania informacji handlowych ` +
			'i marketingowych dotyczących ubezpieczeń na podany przeze mnie numer telefonu (art. 398 ustawy – Prawo komunikacji ' +
			`elektronicznej). Zgoda jest dobrowolna i mogę ją wycofać w każdej chwili, pisząc na ${ADMINISTRATOR.email}.`
	}
];

export const ZGODA_TYTUL: Record<KanalZgody, string> = { email: 'E-mail (informacje handlowe, newsletter)', sms: 'Telefon i SMS' };

/** Informacja pokazywana obok zgód: czego zgody nie dotyczą. */
export const ZGODY_UWAGA =
	'Wiadomości dotyczące Twojego ubezpieczenia (odnowienie, polisa, składki, szkody) wysyłamy niezależnie od tych zgód — są potrzebne do obsługi umowy.';

/** Pełna klauzula informacyjna (PDF): Oświadczenie Administratora Danych Osobowych. */
export const KLAUZULA_URL = 'https://pliki.auraexpert.pl/media/beautypolisa/oswiadczenie-administratora-danych.pdf';

/** Skrót klauzuli informacyjnej RODO — na starcie formularza i przy zgodach. Pełna treść pod KLAUZULA_URL. */
export const KLAUZULA_INFORMACYJNA: string[] = [
	`Administratorem Twoich danych osobowych jest ${ADMINISTRATOR.nazwa} z siedzibą w Warszawie (${ADMINISTRATOR.adres}), agent ubezpieczeniowy ` +
		`wpisany do rejestru KNF pod nr ${ADMINISTRATOR.knf}. Kontakt: ${ADMINISTRATOR.email}; inspektor ochrony danych: ${ADMINISTRATOR.iod}.`,
	'Dane przetwarzamy, aby przeprowadzić analizę wymagań i potrzeb (art. 8 ustawy o dystrybucji ubezpieczeń), przygotować i obsłużyć ' +
		'odnowienie ubezpieczenia oraz wykonać obowiązki prawne (art. 6 ust. 1 lit. b i c RODO), a po wyrażeniu zgody — także w celach ' +
		'marketingowych (art. 6 ust. 1 lit. a RODO). Odbiorcami danych są ubezpieczyciel (STU Ergo Hestia SA) oraz dostawcy usług IT ' +
		'i poczty elektronicznej działający na nasze zlecenie.',
	'Dane przechowujemy przez okres trwania umowy ubezpieczenia i przedawnienia roszczeń, a dane przetwarzane na podstawie zgody — do jej ' +
		'wycofania. Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia, sprzeciwu oraz ' +
		'wycofania zgody w dowolnym momencie (bez wpływu na zgodność z prawem wcześniejszego przetwarzania), a także skargi do Prezesa UODO. ' +
		'Podanie danych jest dobrowolne, ale konieczne do obsługi ubezpieczenia.'
];

export const pusteZgody = (): Zgody => ({ email: false, sms: false });

/** Zgody z żądania klienta: tylko wartości logiczne, brak pola = brak zgody. */
export function walidujZgody(raw: unknown): Zgody {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return { email: r.email === true, sms: r.sms === true };
}

/** Migawka zgód zapisywana przy wniosku (crm_renewals.zgody): odpowiedzi, wersja i dokładne brzmienie. */
export type MigawkaZgod = Zgody & { wersja: string; teksty: Record<KanalZgody, string>; at: string };

export function migawkaZgod(z: Zgody, at: string): MigawkaZgod {
	return {
		email: z.email,
		sms: z.sms,
		wersja: WERSJA_ZGOD,
		teksty: Object.fromEntries(ZGODY.map((x) => [x.kanal, x.tresc])) as Record<KanalZgody, string>,
		at
	};
}

export const opisZgody = (z: Pick<Zgody, KanalZgody> | null | undefined, kanal: KanalZgody) => (z ? (z[kanal] ? 'TAK' : 'NIE') : '—');
