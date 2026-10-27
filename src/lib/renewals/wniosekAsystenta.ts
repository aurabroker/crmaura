// Decyzje wysyłki wniosku online na prośbę asystenta AI (konsultacja-agent) — czyste funkcje, bez bazy.
// Serwer ($lib/server/wniosekAsystenta) czyta kartotekę, a te funkcje mówią, co zrobić:
//  - sciezkaWniosku: pierwsza polisa czy odnowienie certyfikatu programu (te same reguły co automat odnowień),
//  - decyzjaWniosku: co zrobić z istniejącym wnioskiem tego rodzaju (nowy, ponowna wysyłka, przypomnienie…).
import { przesunDate } from './program.ts';

export type WynikWnioskuAsystenta =
	| 'wyslany'
	| 'wyslany_ponownie'
	| 'juz_wyslany'
	| 'zlozony'
	| 'za_wczesnie'
	| 'do_agenta'
	| 'brak_adresu'
	| 'klient_nieaktywny'
	| 'brak_klienta'
	| 'blad_wysylki';

export type Decyzja = 'nowy' | 'zastap' | 'wyslij' | 'przypomnij' | 'juz_wyslany' | 'zlozony' | 'rezygnacja';

export type IstniejacyWniosek = {
	status: string;
	wyslano_at: string | null;
	przypomniano_at: string | null;
	wazny_do: string;
	testowy: boolean;
	// Złożony z decyzją „nie odnawiam” — klient zmienił zdanie, sprawa dla agenta (nie „wniosek złożony”).
	rezygnacja: boolean;
};

// Drugi mail z tym samym linkiem najwcześniej po dobie od ostatniej wysyłki albo przypomnienia.
export const ODSTEP_WYSYLKI_MS = 24 * 3_600_000;

// Kolejność reguł jest częścią specyfikacji (plan: „Decyzja”).
export function decyzjaWniosku(w: IstniejacyWniosek | null, o: { teraz: number; trybTestowy: boolean }): Decyzja {
	if (!w) return 'nowy';
	if (w.status === 'zlozony') return w.rezygnacja ? 'rezygnacja' : 'zlozony';
	if (w.testowy && !o.trybTestowy) return 'zastap';
	if (Date.parse(w.wazny_do) <= o.teraz) return 'zastap';
	if (w.status === 'utworzony') return 'wyslij';
	const ostatnia = Math.max(w.wyslano_at ? Date.parse(w.wyslano_at) : 0, w.przypomniano_at ? Date.parse(w.przypomniano_at) : 0);
	if (ostatnia && o.teraz - ostatnia < ODSTEP_WYSYLKI_MS) return 'juz_wyslany';
	return 'przypomnij';
}

// Certyfikat klienta z programu OC beauty, jak widzi go asystent.
export type CertyfikatKlienta = {
	id: string;
	data_do: string;
	// Decyzja „zakończ polisę” (wypowiedzenie albo brak odnowienia).
	zakonczona: boolean;
	// Ma następcę w CRM (renewal_of) — ten okres jest już odnowiony.
	odnowiona: boolean;
	// Był prawdziwy (nie testowy) wniosek o odnowienie, anulowany albo wygasły — ponowne zaproszenie to decyzja doradcy.
	byl_wniosek: boolean;
	// Ma aktywny wniosek o odnowienie (np. wysłany przez biuro przed oknem automatu albo już złożony).
	aktywny_wniosek: boolean;
};

export type Sciezka =
	| { rodzaj: 'nowa' }
	| { rodzaj: 'odnowienie'; polisa_id: string; ochrona_do: string }
	| { rodzaj: 'za_wczesnie' | 'do_agenta'; polisa_id: string; ochrona_do: string };

const najpozniejszy = (c: CertyfikatKlienta[]) => c.reduce((a, b) => (b.data_do > a.data_do ? b : a));

// dzis i data_do to daty kalendarzowe RRRR-MM-DD (czas polski) — porównujemy je jako tekst.
// automat: firma ma włączony automat odnowień — tylko wtedy „link przyjdzie sam 45 dni przed końcem” jest prawdą.
export function sciezkaWniosku(certyfikaty: CertyfikatKlienta[], o: { dzis: string; dniPrzedKoncem: number; automat: boolean }): Sciezka {
	if (!certyfikaty.length) return { rodzaj: 'nowa' };
	const nieodnowione = certyfikaty.filter((c) => !c.odnowiona);
	if (!nieodnowione.length) {
		const c = najpozniejszy(certyfikaty);
		return { rodzaj: 'do_agenta', polisa_id: c.id, ochrona_do: c.data_do };
	}
	const c = najpozniejszy(nieodnowione);
	const cel = { polisa_id: c.id, ochrona_do: c.data_do };
	if (c.zakonczona || c.data_do < o.dzis || c.byl_wniosek) return { rodzaj: 'do_agenta', ...cel };
	// Istniejący wniosek decyduje także przed oknem automatu (automat pomija certyfikaty z wnioskiem).
	if (c.aktywny_wniosek) return { rodzaj: 'odnowienie', ...cel };
	if (c.data_do > przesunDate(o.dzis, o.dniPrzedKoncem)) return { rodzaj: o.automat ? 'za_wczesnie' : 'do_agenta', ...cel };
	return { rodzaj: 'odnowienie', ...cel };
}

// Linki w mailu zawsze na portal: wywołania z serwera (worker asystenta, pg_cron) idą przez *.pages.dev,
// bo domena portalu ma ochronę przed botami — tak samo podmienia adres zadanie odnowień (api/cron/renewals).
export const PORTAL = 'https://portal.beautypolisa.eu';
export const originLinkow = (url: URL): string => (url.hostname.endsWith('.pages.dev') ? PORTAL : url.origin);

// Link do wniosku z maila HUB (klient klika sam, bez maila od AuraCRM): co zrobić z istniejącym wnioskiem.
// Wysłany albo w trakcie — ten sam wniosek (bez kolejnego maila i bez przypomnienia), po terminie — nowy.
/** Jak zadanieOtwarte w $lib/zadania (kalendarz): „w toku” też jest otwarte — klient z maila nie dostaje drugiego zadania. */
export const jestOtwarteZadanie = (t: { status: string | null }) => t.status === 'otwarte' || t.status === 'w_toku';

export type DecyzjaLinku = 'utworz' | 'zastap' | 'uzyj' | 'zlozony' | 'do_agenta';
export function decyzjaLinku(d: Decyzja): DecyzjaLinku {
	switch (d) {
		case 'nowy':
			return 'utworz';
		case 'zastap':
			return 'zastap';
		case 'wyslij':
		case 'przypomnij':
		case 'juz_wyslany':
			return 'uzyj';
		case 'zlozony':
			return 'zlozony';
		case 'rezygnacja':
			return 'do_agenta';
	}
}
