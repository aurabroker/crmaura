// Wniosek o pierwszą polisę (APK i wniosek OC beauty, crm_renewals rodzaj 'nowa') widziany z leada: czy klient
// go dostał (e-mailem albo SMS-em z CRM), co z nim zrobił i do kiedy działa link. Jedno źródło etykiet dla karty
// leada i listy leadów — lead z wysłanym wnioskiem jest wyraźnie oznaczony, także gdy etap się nie zmienił.
import type { RenewalRow } from './types/database.ts';

export type WniosekLeada = Pick<
	RenewalRow,
	'id' | 'klient_id' | 'rodzaj' | 'status' | 'decyzja' | 'email' | 'wyslano_at' | 'otwarto_at' | 'apk_at' | 'apk_odmowa' | 'zlozono_at' | 'przypomniano_at' | 'wazny_do' | 'created_at'
>;
/** SMS z linkiem wysłany z CRM (zdarzenie 'sms' w crm_renewal_events). */
export type SmsWniosku = { renewal_id: string; at: string; numer: string | null };

export type KluczStanu = 'link' | 'wyslany' | 'otwarty' | 'apk' | 'zlozony' | 'rezygnacja' | 'wygasl' | 'anulowany';
export type StanWniosku = {
	klucz: KluczStanu;
	/** Pełny opis do karty leada („Klient otworzył wniosek”). */
	etykieta: string;
	/** Krótki tekst na chip listy („Otwarty 18 lis”). */
	chip: string;
	/** Klasy chipa (te same kolory co etapy sprzedaży). */
	cls: string;
	/** Dzień, którego dotyczy stan (wysłania, otwarcia, APK, złożenia, wygaśnięcia). */
	dzien: string | null;
	/** Klient dostał link: e-mail z CRM albo SMS z CRM. */
	wyslany: boolean;
	/** Pierwsza wysyłka (e-mail albo SMS — wcześniejsza). */
	wyslanoAt: string | null;
	/** Link działa (wniosek w toku i przed końcem ważności). */
	aktywny: boolean;
	/** Klient zakończył (złożył albo zrezygnował). */
	zakonczony: boolean;
};

const MIES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const DZIEN_PL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Dzień w Polsce: „2026-11-17T23:30:00Z” → „2026-11-18”; sama data zostaje bez zmian. */
export const dzienPL = (iso: string) => (iso.length <= 10 ? iso : DZIEN_PL.format(new Date(iso)));
/** „2026-11-17T09:05:00Z” → „17 lis”. */
export function dzienKrotko(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = dzienPL(iso);
	return `${Number(d.slice(8, 10))} ${MIES[Number(d.slice(5, 7)) - 1]}`;
}

const NIEBIESKI = 'bg-accent-soft text-accent-text';
const SZARY = 'bg-surface-2 text-ink-2';
const ZOLTY = 'bg-warn-soft text-warn';
const ZIELONY = 'bg-ok-soft text-ok';
const CZERWONY = 'bg-danger-soft text-danger';
const W_TOKU = ['utworzony', 'wyslany', 'otwarty', 'apk'];

const najwczesniej = (...d: (string | null | undefined)[]) => d.filter((x): x is string => !!x).sort()[0] ?? null;

/** SMS-y danego wniosku, od najstarszego. */
export const smsyWniosku = (w: Pick<WniosekLeada, 'id'>, sms: SmsWniosku[]) => sms.filter((s) => s.renewal_id === w.id).sort((a, b) => a.at.localeCompare(b.at));

export function stanWniosku(w: WniosekLeada, sms: SmsWniosku[] = [], teraz = new Date().toISOString()): StanWniosku {
	const smsy = smsyWniosku(w, sms);
	const wyslanoAt = najwczesniej(w.wyslano_at, smsy[0]?.at);
	const wyslany = !!wyslanoAt;
	const aktywny = W_TOKU.includes(w.status) && w.wazny_do > teraz;
	const s = (klucz: KluczStanu, etykieta: string, chip: string, cls: string, dzien: string | null): StanWniosku => ({
		klucz, etykieta, chip, cls, dzien, wyslany, wyslanoAt, aktywny, zakonczony: klucz === 'zlozony' || klucz === 'rezygnacja'
	});
	// Link po terminie, którego cron jeszcze nie oznaczył — wygasł tak samo.
	if (W_TOKU.includes(w.status) && !aktywny) return s('wygasl', 'Link wygasł — klient nie złożył wniosku', 'Link wygasł', SZARY, w.wazny_do);
	switch (w.status) {
		case 'zlozony':
			return w.decyzja === 'nie'
				? s('rezygnacja', 'Klient zrezygnował z ubezpieczenia', 'Rezygnacja', CZERWONY, w.zlozono_at)
				: s('zlozony', 'Klient złożył wniosek', `Złożony ${dzienKrotko(w.zlozono_at)}`, ZIELONY, w.zlozono_at);
		case 'apk':
			return s('apk', w.apk_odmowa ? 'Klient odmówił APK, wniosek w toku' : 'Klient wypełnił APK, wniosek w toku', `APK ${dzienKrotko(w.apk_at)}`, ZOLTY, w.apk_at);
		case 'otwarty':
			return s('otwarty', 'Klient otworzył wniosek', `Otwarty ${dzienKrotko(w.otwarto_at)}`, ZOLTY, w.otwarto_at);
		case 'wyslany':
			return s('wyslany', 'Wysłano — klient jeszcze nie otworzył', `Wysłany ${dzienKrotko(wyslanoAt)}`, NIEBIESKI, wyslanoAt);
		case 'utworzony':
			return wyslany
				? s('wyslany', 'Wysłano SMS-em — klient jeszcze nie otworzył', `Wysłany ${dzienKrotko(wyslanoAt)}`, NIEBIESKI, wyslanoAt)
				: s('link', 'Link utworzony, ale nie wysłany z CRM', 'Link utworzony', SZARY, w.created_at);
		case 'wygasl':
			return s('wygasl', 'Link wygasł — klient nie złożył wniosku', 'Link wygasł', SZARY, w.wazny_do);
		default:
			return s('anulowany', 'Wniosek anulowany', 'Anulowany', SZARY, null);
	}
}

/** Najnowszy wniosek o pierwszą polisę dla każdego klienta. */
export function ostatnieWnioskiKlientow<T extends Pick<WniosekLeada, 'klient_id' | 'rodzaj' | 'created_at'>>(lista: T[]): Map<string, T> {
	const m = new Map<string, T>();
	for (const w of lista) {
		if (w.rodzaj !== 'nowa' || !w.klient_id) continue;
		const byl = m.get(w.klient_id);
		if (!byl || w.created_at > byl.created_at) m.set(w.klient_id, w);
	}
	return m;
}

/** Grupy filtra na liście leadów. */
export type GrupaWniosku = 'nie_wyslano' | 'czeka' | 'zlozony' | 'wygasl';
export const GRUPY_WNIOSKU: [GrupaWniosku, string][] = [
	['nie_wyslano', 'nie wysłano'],
	['czeka', 'wysłany — czeka na klienta'],
	['zlozony', 'złożony albo rezygnacja'],
	['wygasl', 'link wygasł']
];
export function grupaWniosku(st: StanWniosku | null): GrupaWniosku {
	if (!st || st.klucz === 'anulowany' || st.klucz === 'link') return 'nie_wyslano';
	if (st.zakonczony) return 'zlozony';
	if (st.klucz === 'wygasl') return 'wygasl';
	return 'czeka';
}

export type KrokWniosku = { etykieta: string; at: string | null; opis?: string };
/** Kroki do paska postępu na karcie leada: wysłano → otwarto → APK → złożono. */
export function krokiWniosku(w: WniosekLeada, sms: SmsWniosku[] = []): KrokWniosku[] {
	const st = stanWniosku(w, sms);
	return [
		{ etykieta: 'Wysłano', at: st.wyslanoAt },
		{ etykieta: 'Otwarto', at: w.otwarto_at },
		{ etykieta: w.apk_odmowa ? 'APK — odmowa' : 'APK', at: w.apk_at },
		{ etykieta: w.decyzja === 'nie' ? 'Rezygnacja' : 'Złożono', at: w.zlozono_at }
	];
}
