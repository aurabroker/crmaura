import { sb } from '$lib/supabase';
import type { Policy, RenewalEvent } from '$lib/types/database';

// Wspólne dla karty polisy i listy odnowień w CRM: rozpoznanie certyfikatu z programu OC beauty,
// stany wniosku i wywołania /api/renewals (kontrakt: $lib/renewals/staffApi).

// Certyfikat należy do programu, gdy jego umowa generalna to UG podtypu oc_beauty.
export function wProgramieOcBeauty(p: Pick<Policy, 'parent_id'> | null | undefined, policies: Policy[]): boolean {
	if (!p?.parent_id) return false;
	const ug = policies.find((q) => q.id === p.parent_id);
	return !!ug && ug.typ_umowy === 'generalna' && ug.ug_podtyp === 'oc_beauty';
}

// Link działa tylko w tych stanach; „zlozony” blokuje nowy wniosek, ale linku już nie ma.
export const STATUSY_Z_LINKIEM = ['utworzony', 'wyslany', 'otwarty', 'apk'];
export const czyLinkDziala = (status: string) => STATUSY_Z_LINKIEM.includes(status);
// Aktywny = każdy poza wygasłym i anulowanym (jak indeks crm_renewals_one_active).
export const czyAktywny = (status: string) => status !== 'wygasl' && status !== 'anulowany';

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
	apk: 'Klient wypełnił APK',
	apk_odmowa: 'Klient odmówił wypełnienia APK',
	zalacznik: 'Klient dodał załącznik',
	zalacznik_usun: 'Klient usunął załącznik',
	zlozenie: 'Klient złożył wniosek',
	przypomnienie: 'Wysłano przypomnienie',
	anulowanie: 'Anulowano wniosek',
	wygasniecie: 'Link wygasł'
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
