// Pliki polis (PDF w Cloudflare R2) po stronie przeglądarki: lista z bazy (RLS — tylko pliki firmy),
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

// Czy magazyn jest podpięty — raz na sesję.
let stan: Promise<boolean> | null = null;
export function magazynDostepny(): Promise<boolean> {
	stan ??= (async () => {
		try {
			const res = await fetch('/api/pliki/stan', { headers: await naglowki() });
			return res.ok && ((await res.json()) as { magazyn?: boolean }).magazyn === true;
		} catch {
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
