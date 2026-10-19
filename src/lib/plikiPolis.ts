// Pliki w Cloudflare R2 po stronie przeglądarki (PDF polis, pliki not prowizyjnych): lista z bazy (RLS — tylko pliki firmy),
// wysyłka / otwieranie / usuwanie przez API serwera z tokenem sesji.
import { sb } from '$lib/supabase';

export type PlikPolisy = {
	id: string;
	polisa_id: string;
	rodzaj: 'polisa' | 'aneks' | 'owu' | 'inne';
	nazwa: string;
	rozmiar: number;
	zrodlo: 'import_pdf' | 'recznie';
	dodal: string | null;
	created_at: string;
};
export const RODZAJ_PLIKU: Record<PlikPolisy['rodzaj'], string> = { polisa: 'Polisa', aneks: 'Aneks', owu: 'OWU', inne: 'Inny dokument' };

async function naglowki(): Promise<Record<string, string>> {
	const { data: { session } } = await sb.auth.getSession();
	return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function blad(res: Response): Promise<Error> {
	const d = (await res.json().catch(() => null)) as { message?: string } | null;
	return new Error(d?.message ?? `Błąd ${res.status}`);
}

// Czy magazyn jest podpięty — raz na sesję. Zapamiętujemy tylko odpowiedź serwera; błąd sieci
// albo sesji nie może wyłączyć plików do końca dnia (import przestałby po cichu zapisywać PDF).
let stan: Promise<boolean> | null = null;
export function magazynDostepny(): Promise<boolean> {
	stan ??= (async () => {
		try {
			const res = await fetch('/api/pliki/stan', { headers: await naglowki() });
			if (!res.ok) { stan = null; return false; }
			return ((await res.json()) as { magazyn?: boolean }).magazyn === true;
		} catch {
			stan = null;
			return false;
		}
	})();
	return stan;
}

export async function wczytajPlikiPolis(polisaIds: string[]): Promise<PlikPolisy[]> {
	if (!polisaIds.length) return [];
	const { data, error } = await sb
		.from('crm_policy_files')
		.select('id, polisa_id, rodzaj, nazwa, rozmiar, zrodlo, dodal, created_at')
		.in('polisa_id', polisaIds)
		.order('created_at', { ascending: false });
	// Przed migracją tabeli (albo przy błędzie) — po prostu brak plików.
	return error ? [] : ((data ?? []) as PlikPolisy[]);
}

export async function wyslijPdfPolisy(polisaId: string, plik: File, o: { rodzaj?: PlikPolisy['rodzaj']; zrodlo?: PlikPolisy['zrodlo'] } = {}): Promise<PlikPolisy> {
	const form = new FormData();
	form.append('plik', plik);
	form.append('rodzaj', o.rodzaj ?? 'polisa');
	form.append('zrodlo', o.zrodlo ?? 'recznie');
	const res = await fetch(`/api/polisy/${polisaId}/pliki`, { method: 'POST', headers: await naglowki(), body: form });
	if (!res.ok) throw await blad(res);
	return ((await res.json()) as { plik: PlikPolisy }).plik;
}

// Kartę otwieramy od razu w obsłudze kliknięcia (po await przeglądarka zablokowałaby okno),
// a PDF wczytujemy z tokenem i podajemy jako blob.
export async function otworzPlikPolisy(id: string): Promise<void> {
	const okno = window.open('about:blank', '_blank');
	try {
		const res = await fetch(`/api/pliki/${id}`, { headers: await naglowki() });
		if (!res.ok) throw await blad(res);
		const url = URL.createObjectURL(await res.blob());
		if (okno) okno.location.href = url;
		else window.location.assign(url);
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	} catch (e) {
		okno?.close();
		throw e;
	}
}

export async function usunPlikPolisy(id: string): Promise<void> {
	const res = await fetch(`/api/pliki/${id}`, { method: 'DELETE', headers: await naglowki() });
	if (!res.ok) throw await blad(res);
}

export function rozmiar(b: number): string {
	if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
	return `${Math.max(1, Math.round(b / 1024))} KB`;
}

// ── Pliki not prowizyjnych i zestawień TU (XLSX, XLS, CSV, PDF) w tym samym magazynie R2 ──

export type PlikNoty = { plik_nazwa: string; plik_rozmiar: number; plik_typ: string };

export async function wyslijPlikNoty(notaId: string, plik: File): Promise<PlikNoty> {
	const form = new FormData();
	form.append('plik', plik);
	const res = await fetch(`/api/noty/${notaId}/plik`, { method: 'POST', headers: await naglowki(), body: form });
	if (!res.ok) throw await blad(res);
	return (await res.json()) as PlikNoty;
}

/** PDF otwiera się w nowej karcie, arkusz i CSV pobierają się pod zapisaną nazwą. */
export async function otworzPlikNoty(notaId: string, nazwa: string | null, typ: string | null): Promise<void> {
	const pdf = typ === 'application/pdf';
	const okno = pdf ? window.open('about:blank', '_blank') : null;
	try {
		const res = await fetch(`/api/noty/${notaId}/plik`, { headers: await naglowki() });
		if (!res.ok) throw await blad(res);
		const url = URL.createObjectURL(await res.blob());
		if (pdf) {
			if (okno) okno.location.href = url;
			else window.location.assign(url);
		} else {
			const a = document.createElement('a');
			a.href = url;
			a.download = nazwa ?? 'zestawienie';
			a.click();
		}
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	} catch (e) {
		okno?.close();
		throw e;
	}
}

// ── Polisa wysłana klientowi (szablon Resend programu + PDF polisy) ──

export type KontekstMailaPolisy = {
	szablon: string;
	/** Polisa spoza programu: ogólny szablon „polisa-wystawiona” z Resend firmy albo wbudowana treść CRM. */
	ogolny: boolean;
	polisa: { nr_polisy: string; data_od: string | null; data_do: string | null };
	klient: string;
	adresy: { adres: string; opis: string }[];
	/** zUmowy — OWU z Umowy Generalnej polisy. */
	pliki: { id: string; nazwa: string; rozmiar: number; rodzaj: PlikPolisy['rodzaj']; zUmowy?: boolean }[];
	domyslne: { do: string[]; powitanie: string; termin_platnosci: string | null; pliki: string[] };
	wyslane: { wyslano_at: string; adres: string; dostawa: string | null }[];
};
export type ZadanieMailaPolisy = { do: string[]; powitanie: string; termin_platnosci: string; pliki: string[] };
export type PodgladMailaPolisy = { temat: string; html: string; od: string; odpowiedz: string | null; zalaczniki: { nazwa: string; rozmiar: number }[] };

export async function kontekstMailaPolisy(polisaId: string): Promise<KontekstMailaPolisy> {
	const res = await fetch(`/api/polisy/${polisaId}/mail`, { headers: await naglowki() });
	if (!res.ok) throw await blad(res);
	return (await res.json()) as KontekstMailaPolisy;
}

export async function podgladMailaPolisy(polisaId: string, z: ZadanieMailaPolisy): Promise<PodgladMailaPolisy> {
	const res = await fetch(`/api/polisy/${polisaId}/mail`, {
		method: 'POST',
		headers: { ...(await naglowki()), 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...z, podglad: true })
	});
	if (!res.ok) throw await blad(res);
	return (await res.json()) as PodgladMailaPolisy;
}

export async function wyslijMailPolisy(polisaId: string, z: ZadanieMailaPolisy): Promise<{ id: string | null; adresy: string[] }> {
	const res = await fetch(`/api/polisy/${polisaId}/mail`, {
		method: 'POST',
		headers: { ...(await naglowki()), 'Content-Type': 'application/json' },
		body: JSON.stringify(z)
	});
	if (!res.ok) throw await blad(res);
	return (await res.json()) as { id: string | null; adresy: string[] };
}

// ── Pliki publiczne z maili (pliki.auraexpert.pl/media/…) ──

export type PlikPubliczny = { sciezka: string; adres: string; opis: string; typ: string; w_magazynie: boolean; rozmiar: number | null; wgrano: string | null; ze_zrodla: boolean };

export async function wczytajPlikiPubliczne(): Promise<{ pliki: PlikPubliczny[]; moze_zmieniac: boolean }> {
	const res = await fetch('/api/pliki-publiczne', { headers: await naglowki() });
	if (!res.ok) throw await blad(res);
	return (await res.json()) as { pliki: PlikPubliczny[]; moze_zmieniac: boolean };
}

export async function podmienPlikPubliczny(sciezka: string, plik: File): Promise<PlikPubliczny> {
	const form = new FormData();
	form.append('sciezka', sciezka);
	form.append('plik', plik);
	const res = await fetch('/api/pliki-publiczne', { method: 'POST', headers: await naglowki(), body: form });
	if (!res.ok) throw await blad(res);
	return ((await res.json()) as { plik: PlikPubliczny }).plik;
}
