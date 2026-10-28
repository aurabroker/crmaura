import { sb } from '$lib/supabase';
import { ADRES_TESTOWY } from '$lib/renewals/staffApi';
import type { CrmTask, Policy, RenewalEvent, WniosekOdnowienia } from '$lib/types/database';
import { dateDiffDays } from '$lib/utils';
import { OPEN_LINK_TTL, signedStorageUrl } from '$lib/utils/storageLink';

// Wspólne dla karty polisy i listy odnowień w CRM: rozpoznanie certyfikatu z programu OC beauty,
// stany wniosku i wywołania /api/renewals (kontrakt: $lib/renewals/staffApi).

// Certyfikat należy do programu, gdy jego umowa generalna to UG podtypu oc_beauty.
export function wProgramieOcBeauty(p: Pick<Policy, 'parent_id'> | null | undefined, policies: Policy[]): boolean {
	if (!p?.parent_id) return false;
	const ug = policies.find((q) => q.id === p.parent_id);
	return !!ug && ug.typ_umowy === 'generalna' && ug.ug_podtyp === 'oc_beauty';
}

/** Firma prowadzi program OC beauty (ma umowę generalną podtypu oc_beauty) — bez niego nie ma wniosków o pierwszą polisę. */
export function programOcBeauty(policies: Pick<Policy, 'typ_umowy' | 'ug_podtyp' | 'deleted_at'>[]): boolean {
	return policies.some((p) => p.typ_umowy === 'generalna' && p.ug_podtyp === 'oc_beauty' && !p.deleted_at);
}

/**
 * Klient albo lead z branży beauty — tylko dla niego ma sens „APK i wniosek o pierwszą polisę OC beauty”:
 * import z BEAUTY (beauty_id), oznaczenie ręczne w CRM (segment_beauty), certyfikat z programu OC beauty
 * albo lead z formularza BEAUTY (zrodlo 'beauty').
 */
export function klientBeauty(
	k: { beautyId?: number | string | null; segmentBeauty?: boolean | null; klientId?: string | null; zrodloLeada?: string | null },
	policies: Policy[]
): boolean {
	if (k.beautyId != null) return true;
	if (k.segmentBeauty) return true;
	if (k.zrodloLeada === 'beauty') return true;
	return !!k.klientId && policies.some((p) => p.klient_id === k.klientId && !p.deleted_at && wProgramieOcBeauty(p, policies));
}

// Link działa tylko w tych stanach; „zlozony” blokuje nowy wniosek, ale linku już nie ma.
export const STATUSY_Z_LINKIEM = ['utworzony', 'wyslany', 'otwarty', 'apk'];
export const czyLinkDziala = (status: string) => STATUSY_Z_LINKIEM.includes(status);
// Aktywny = każdy poza wygasłym i anulowanym (jak indeks crm_renewals_one_active).
export const czyAktywny = (status: string) => status !== 'wygasl' && status !== 'anulowany';

/** Wniosek z trybu testowego: e-mail poszedł na adres testowy, nie do klienta. */
export const wniosekTestowy = (w: { email: string | null }) => !!w.email && w.email.trim().toLowerCase() === ADRES_TESTOWY;

// Etap wniosku z punktu widzenia pracownika — na kim stoi sprawa:
//   czeka     link u klienta, APK jeszcze nie ma (utworzony / wysłany / otwarty),
//   apk       APK wypełniona albo świadomie odrzucona, wniosek jeszcze nie złożony,
//   zlozony   klient złożył wniosek (teraz ruch po stronie brokera),
//   nieaktywny  link wygasł albo wniosek anulowano.
export type EtapWniosku = 'czeka' | 'apk' | 'zlozony' | 'nieaktywny';
export function etapWniosku(w: Pick<WniosekOdnowienia, 'status' | 'apk_at'>): EtapWniosku {
	if (!czyAktywny(w.status)) return 'nieaktywny';
	if (w.status === 'zlozony') return 'zlozony';
	return w.apk_at ? 'apk' : 'czeka';
}

/** Bieżący cykl odnowień: certyfikat kończy się dopiero albo skończył się najwyżej tyle dni temu. */
export const CYKL_DNI_WSTECZ = 60;
export const wBiezacymCyklu = (w: Pick<WniosekOdnowienia, 'okres_do' | 'created_at'>, dzis: string) =>
	w.okres_do ? dateDiffDays(dzis, w.okres_do) >= -CYKL_DNI_WSTECZ : dateDiffDays(w.created_at.slice(0, 10), dzis) <= 120;

export type PodsumowanieWnioskow = {
	/** Link u klienta, bez APK. */
	czeka: number;
	/** APK wypełniona (także we wnioskach już złożonych). */
	apk: number;
	/** Świadome odmowy wypełnienia APK. */
	odmowy: number;
	/** Wnioski złożone przez klienta. */
	zlozone: number;
	/** Złożone (poza rezygnacją), których certyfikat nie ma jeszcze nowej polisy w CRM. */
	doWystawienia: number;
	nieaktywne: number;
	razem: number;
};

/** Wniosek o pierwszą polisę (klient bez certyfikatu) — bez polisy w CRM do chwili wystawienia. */
export const wniosekNowy = (w: Pick<WniosekOdnowienia, 'rodzaj' | 'polisa_id'>) => w.rodzaj === 'nowa' || !w.polisa_id;

/** Polisy klientów (klient_id → daty utworzenia) — do sprawdzenia, czy po złożonym wniosku o pierwszą polisę powstała już polisa. */
export function polisyKlientow(policies: Pick<Policy, 'klient_id' | 'created_at' | 'deleted_at'>[]): Map<string, string[]> {
	const m = new Map<string, string[]>();
	for (const p of policies) if (!p.deleted_at && p.created_at) m.set(p.klient_id, [...(m.get(p.klient_id) ?? []), p.created_at]);
	return m;
}

/**
 * Czy złożony wniosek jest załatwiony: odnowienie — certyfikat ma następczynię (renewal_of);
 * pierwsza polisa — klient dostał polisę po złożeniu wniosku.
 */
export function wniosekZalatwiony(w: Pick<WniosekOdnowienia, 'rodzaj' | 'polisa_id' | 'klient_id' | 'zlozono_at'>, odnowione: ReadonlySet<string>, polisyKl: ReadonlyMap<string, string[]> = new Map()): boolean {
	if (!wniosekNowy(w)) return !!w.polisa_id && odnowione.has(w.polisa_id);
	const od = w.zlozono_at ?? '';
	return (polisyKl.get(w.klient_id) ?? []).some((c) => c >= od);
}

/**
 * Wnioski załatwione ręcznie: zadanie z wniosku (crm_tasks.renewal_id) zamknięte — zakończone albo anulowane —
 * choć polisa nie powstała w CRM (np. klient zrezygnował przez telefon). Otwarte zadanie do tego samego wniosku
 * ma pierwszeństwo: wniosek wciąż czeka.
 */
export function wnioskiZalatwioneZadaniem(tasks: Pick<CrmTask, 'renewal_id' | 'status'>[]): Set<string> {
	const otwarte = new Set<string>();
	const zamkniete = new Set<string>();
	for (const t of tasks) {
		if (!t.renewal_id) continue;
		if (t.status === 'otwarte' || t.status === 'w_toku') otwarte.add(t.renewal_id);
		else zamkniete.add(t.renewal_id);
	}
	return new Set([...zamkniete].filter((id) => !otwarte.has(id)));
}

/** Czy złożony wniosek (poza rezygnacją) wciąż czeka na polisę: ani polisa w CRM, ani zamknięte zadanie z wniosku. */
export const wniosekCzekaNaPolise = (
	w: Pick<WniosekOdnowienia, 'status' | 'decyzja' | 'rodzaj' | 'polisa_id' | 'klient_id' | 'zlozono_at' | 'id'>,
	odnowione: ReadonlySet<string>,
	polisyKl: ReadonlyMap<string, string[]> = new Map(),
	zalatwione: ReadonlySet<string> = new Set()
) => w.status === 'zlozony' && w.decyzja !== 'nie' && !zalatwione.has(w.id) && !wniosekZalatwiony(w, odnowione, polisyKl);

type WniosekDoRangi = Pick<WniosekOdnowienia, 'id' | 'status' | 'decyzja' | 'rodzaj' | 'polisa_id' | 'klient_id' | 'zlozono_at' | 'apk_at' | 'email' | 'wyslano_at' | 'created_at'> &
	Partial<Pick<WniosekOdnowienia, 'okres_do'>>;

/** Wniosek zamknięty: złożony i załatwiony (nowa polisa w CRM albo zadanie „Załatwione”) lub rezygnacja klienta. */
export const wniosekZamkniety = (w: WniosekDoRangi, odnowione: ReadonlySet<string>, polisyKl: ReadonlyMap<string, string[]> = new Map(), zalatwione: ReadonlySet<string> = new Set()) =>
	w.status === 'zlozony' && (w.decyzja === 'nie' || zalatwione.has(w.id) || wniosekZalatwiony(w, odnowione, polisyKl));

/** „Do wystawienia”: prawdziwy (nie testowy) wniosek złożony przez klienta, na który nie ma jeszcze polisy w CRM. */
export const wniosekDoWystawienia = (w: WniosekDoRangi, odnowione: ReadonlySet<string>, polisyKl: ReadonlyMap<string, string[]> = new Map(), zalatwione: ReadonlySet<string> = new Set()) =>
	!wniosekTestowy(w) && wniosekCzekaNaPolise(w, odnowione, polisyKl, zalatwione);

/**
 * Kolejność listy wniosków (APK → Wnioski klientów): 0 do wystawienia (na górze, wyróżnione), 1 w toku (link u klienta,
 * APK wypełniona), 2 nieaktywne (link wygasł, anulowany, testowy), 3 zamknięte (polisa wystawiona, rezygnacja) — na dole.
 */
export function rangaWniosku(w: WniosekDoRangi, odnowione: ReadonlySet<string>, polisyKl: ReadonlyMap<string, string[]> = new Map(), zalatwione: ReadonlySet<string> = new Set()): 0 | 1 | 2 | 3 {
	if (wniosekDoWystawienia(w, odnowione, polisyKl, zalatwione)) return 0;
	if (wniosekZamkniety(w, odnowione, polisyKl, zalatwione)) return 3;
	if (wniosekTestowy(w) || etapWniosku(w) === 'nieaktywny') return 2;
	return 1;
}

/** Certyfikat kończy się w ciągu tylu dni (albo już się skończył) — wiersz wniosku w toku jest na pomarańczowo. */
export const DNI_KONCA_WKROTCE = 7;

/** Dni do końca ochrony certyfikatu (ujemne — już po końcu); null — wniosek o pierwszą polisę, bez certyfikatu. */
export const dniDoKoncaOchrony = (w: Partial<Pick<WniosekOdnowienia, 'okres_do'>>, dzis: string): number | null =>
	w.okres_do ? dateDiffDays(dzis, w.okres_do.slice(0, 10)) : null;

/** Certyfikat kończy się w najbliższych DNI_KONCA_WKROTCE dniach (dziś włącznie) albo już się skończył. */
export const koniecOchronyWkrotce = (w: Partial<Pick<WniosekOdnowienia, 'okres_do'>>, dzis: string, dni = DNI_KONCA_WKROTCE) => {
	const d = dniDoKoncaOchrony(w, dzis);
	return d != null && d <= dni;
};

/**
 * Sortowanie listy: wg rangi; do wystawienia — najdłużej czekające pierwsze; w toku — chronologicznie wg końca ochrony
 * certyfikatu (najbliższy koniec na górze, wnioski o pierwszą polisę bez certyfikatu za nimi, najnowsze pierwsze);
 * nieaktywne i zamknięte — najnowsze pierwsze.
 */
export function sortujWnioski<T extends WniosekDoRangi>(lista: T[], odnowione: ReadonlySet<string>, polisyKl: ReadonlyMap<string, string[]> = new Map(), zalatwione: ReadonlySet<string> = new Set()): T[] {
	const data = (w: T) => w.wyslano_at ?? w.created_at ?? '';
	const koniec = (w: T) => w.okres_do?.slice(0, 10) ?? '9999-12-31';
	return [...lista].sort((a, b) => {
		const ra = rangaWniosku(a, odnowione, polisyKl, zalatwione);
		const rb = rangaWniosku(b, odnowione, polisyKl, zalatwione);
		if (ra !== rb) return ra - rb;
		if (ra === 0) return (a.zlozono_at ?? '').localeCompare(b.zlozono_at ?? '');
		if (ra === 1) return koniec(a).localeCompare(koniec(b)) || data(b).localeCompare(data(a));
		return data(b).localeCompare(data(a));
	});
}

// Liczby do kafelka na pulpicie i zakładki APK: tylko bieżący cykl, bez wniosków testowych.
// odnowione: polisy, które mają już następczynię (renewal_of) — ich wnioski są załatwione.
// polisyKl: polisy klientów (pierwsza polisa jest załatwiona, gdy klient dostał polisę po złożeniu wniosku).
// zalatwione: wnioski zamknięte zadaniem (wnioskiZalatwioneZadaniem).
export function podsumujWnioski(
	lista: WniosekOdnowienia[],
	odnowione: ReadonlySet<string>,
	dzis: string,
	polisyKl: ReadonlyMap<string, string[]> = new Map(),
	zalatwione: ReadonlySet<string> = new Set()
): PodsumowanieWnioskow {
	const p: PodsumowanieWnioskow = { czeka: 0, apk: 0, odmowy: 0, zlozone: 0, doWystawienia: 0, nieaktywne: 0, razem: 0 };
	for (const w of lista) {
		if (wniosekTestowy(w) || !wBiezacymCyklu(w, dzis)) continue;
		p.razem++;
		const e = etapWniosku(w);
		if (e === 'nieaktywny') {
			p.nieaktywne++;
			continue;
		}
		if (e === 'czeka') p.czeka++;
		if (w.apk_at && !w.apk_odmowa) p.apk++;
		if (w.apk_odmowa) p.odmowy++;
		if (e === 'zlozony') {
			p.zlozone++;
			if (wniosekCzekaNaPolise(w, odnowione, polisyKl, zalatwione)) p.doWystawienia++;
		}
	}
	return p;
}

/**
 * Alert na pulpicie: wnioski, na które klient czeka — złożone online (poza rezygnacją) w bieżącym cyklu,
 * bez wniosków testowych, jeszcze bez polisy w CRM i bez zamkniętego zadania z wniosku. Najnowsze na górze.
 */
export function wnioskiDoObslugi(
	lista: WniosekOdnowienia[],
	odnowione: ReadonlySet<string>,
	dzis: string,
	polisyKl: ReadonlyMap<string, string[]> = new Map(),
	zalatwione: ReadonlySet<string> = new Set()
): WniosekOdnowienia[] {
	return lista
		.filter((w) => !wniosekTestowy(w) && wBiezacymCyklu(w, dzis) && wniosekCzekaNaPolise(w, odnowione, polisyKl, zalatwione))
		.sort((a, b) => (b.zlozono_at ?? '').localeCompare(a.zlozono_at ?? ''));
}

/** Dokąd prowadzi wniosek w CRM: karta polisy (odnowienie) albo karta klienta → APK (pierwsza polisa). */
export const adresWniosku = (w: Pick<WniosekOdnowienia, 'rodzaj' | 'polisa_id' | 'klient_id'>) =>
	wniosekNowy(w) ? `/clients/${w.klient_id}?tab=apk` : `/policies/${w.polisa_id}`;

export type Wariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function wariantStatusu(status: string): Wariant {
	if (status === 'zlozony') return 'success';
	if (status === 'otwarty' || status === 'apk') return 'warning';
	if (status === 'wyslany' || status === 'utworzony') return 'info';
	return 'neutral';
}

export function wariantDecyzji(decyzja: string | null): Wariant {
	if (decyzja === 'bez_zmian') return 'success';
	if (decyzja === 'zmiany') return 'info';
	if (decyzja === 'nie') return 'error';
	return 'neutral';
}

export type WynikApi<T> = { ok: true; data: T } | { ok: false; status: number; message: string; aktywny: boolean };

// Żądanie do /api/renewals* z sesją pracownika. Nie rzuca — błąd sieci to status 0 z komunikatem.
export async function wywolajApi<T>(method: 'POST' | 'DELETE', url: string, body: unknown): Promise<WynikApi<T>> {
	try {
		const { data: { session } } = await sb.auth.getSession();
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
			body: JSON.stringify(body)
		});
		const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		if (res.ok) return { ok: true, data: d as T };
		const bledy = Array.isArray(d.bledy) ? (d.bledy as string[]).join(' ') : '';
		const message = [typeof d.message === 'string' ? d.message : '', bledy].filter(Boolean).join(' ');
		return { ok: false, status: res.status, message: message || `Błąd serwera (${res.status}).`, aktywny: d.aktywny === true };
	} catch {
		return { ok: false, status: 0, message: 'Brak połączenia z serwerem. Spróbuj ponownie.', aktywny: false };
	}
}

export const fmtData = (iso: string | null | undefined) =>
	iso ? new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const fmtDataCzas = (iso: string | null | undefined) =>
	iso
		? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
		: '—';

// Dziennik wniosku (crm_renewal_events) — te same opisy na karcie polisy i na karcie klienta.
export const ZDARZENIA: Record<string, string> = {
	utworzenie: 'Utworzono wniosek',
	wyslanie: 'Wysłano e-mail do klienta',
	otwarcie: 'Klient otworzył link',
	link_z_maila: 'Klient poprosił o wniosek przyciskiem w mailu (HUB)',
	apk: 'Klient wypełnił APK',
	apk_odmowa: 'Klient odmówił wypełnienia APK',
	zalacznik: 'Klient dodał załącznik',
	zalacznik_usun: 'Klient usunął załącznik',
	zlozenie: 'Klient złożył wniosek',
	blad_pdf: 'PDF wniosku nie powstał',
	blad_pdf_apk: 'PDF APK nie powstał',
	blad_pdf_ankiety: 'PDF ankiety nie powstał — wyślij klientowi ankietę ręcznie',
	pdf_apk_utworzony: 'Utworzono PDF APK z zapisanych odpowiedzi (na żądanie w CRM)',
	przypomnienie: 'Wysłano przypomnienie',
	anulowanie: 'Anulowano wniosek',
	wygasniecie: 'Link wygasł',
	tryb_testowy: 'Wniosek testowy (e-maile na adres testowy)',
	blad_leada: 'Nie udało się zapisać wniosku w leadzie (Sprzedaż)'
};

export const opisZdarzenia = (e: Pick<RenewalEvent, 'zdarzenie' | 'szczegoly'>) => {
	const powod = typeof e.szczegoly?.powod === 'string' ? ` (${e.szczegoly.powod})` : '';
	return (ZDARZENIA[e.zdarzenie] ?? e.zdarzenie) + powod;
};

// Krótki opis przeglądarki z nagłówka User-Agent (pełny tekst zostaje w podpowiedzi).
export function opisPrzegladarki(ua: string | null | undefined): string {
	if (!ua) return '';
	const wersja = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0] ?? '';
	const nazwa = /Edg(?:e|A|iOS)?\//.test(ua) ? `Edge ${wersja(/Edg(?:e|A|iOS)?\/([\d.]+)/)}`
		: /OPR\//.test(ua) ? `Opera ${wersja(/OPR\/([\d.]+)/)}`
		: /SamsungBrowser\//.test(ua) ? `Samsung Internet ${wersja(/SamsungBrowser\/([\d.]+)/)}`
		: /(?:Firefox|FxiOS)\//.test(ua) ? `Firefox ${wersja(/(?:Firefox|FxiOS)\/([\d.]+)/)}`
		: /(?:Chrome|CriOS)\//.test(ua) ? `Chrome ${wersja(/(?:Chrome|CriOS)\/([\d.]+)/)}`
		: /Safari\//.test(ua) ? `Safari ${wersja(/Version\/([\d.]+)/)}`
		: '';
	const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
		: /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
	const opis = [nazwa.trim(), system].filter(Boolean).join(', ');
	return opis || (ua.length > 60 ? `${ua.slice(0, 57)}…` : ua);
}

// Pliki wniosku w buckecie renewal-files: <tenant_id>/<id wniosku>/… — PDF wniosku, PDF APK
// (apk.pdf; starsze wnioski go nie mają), PDF ankiety Ergo Hestii (ankieta.pdf, przy zabiegach
// wymagających ankiety) i załączniki od klienta.
export const BUCKET_ODNOWIEN = 'renewal-files';
export const APK_PDF = 'apk.pdf';
export const ANKIETA_PDF = 'ankieta.pdf';
export const folderWniosku = (r: { tenant_id: string; id: string }) => `${r.tenant_id}/${r.id}`;

export const rozmiarPliku = (b: number | null | undefined) =>
	b == null ? '' : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

// PDF APK wniosku: serwer zwraca ścieżkę, a gdy pliku brak (wniosek sprzed osobnego PDF APK albo błąd przy APK),
// najpierw go tworzy. Kartę otwieramy od razu w obsłudze kliknięcia — po await przeglądarka by ją zablokowała.
// Zwraca '' albo treść błędu do pokazania.
export async function otworzPdfApk(id: string): Promise<string> {
	const okno = window.open('about:blank', '_blank');
	const w = await wywolajApi<{ path: string }>('POST', '/api/renewals/pdf-apk', { id });
	try {
		if (!w.ok) throw new Error(w.message);
		const url = await signedStorageUrl(BUCKET_ODNOWIEN, w.data.path, OPEN_LINK_TTL);
		if (okno) {
			okno.opener = null;
			okno.location.href = url;
		} else window.location.assign(url);
		return '';
	} catch (e) {
		okno?.close();
		return `Nie udało się otworzyć PDF APK. ${(e as Error)?.message ?? ''}`.trim();
	}
}
