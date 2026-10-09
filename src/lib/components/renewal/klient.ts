// Strona klienta /odnowienie/[klucz]: rozmowa z serwerem i drobne formatowanie.
// Klient nie ma sesji — jedynym uprawnieniem jest klucz z adresu, więc wszystko idzie przez
// GET/POST /api/odnowienie/[klucz] (kontrakt w $lib/renewals/api).

import { tick } from 'svelte';
import type { Dzialanie, OdpowiedzBlad, WidokOdnowienia } from '$lib/renewals/api';
import { ZALACZNIK_TYPY_MIME } from '$lib/renewals/program';

export const KONTAKT_EMAIL = 'odnowienia@auraexpert.pl';

const adres = (klucz: string) => `/api/odnowienie/${encodeURIComponent(klucz)}`;

export type WynikWidoku = { ok: true; widok: WidokOdnowienia } | { ok: false; message: string };

export async function pobierzWidok(klucz: string): Promise<WynikWidoku> {
	let res: Response;
	try {
		res = await fetch(adres(klucz), { cache: 'no-store', headers: { Accept: 'application/json' } });
	} catch {
		return { ok: false, message: 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.' };
	}
	const body = (await res.json().catch(() => null)) as { stan?: unknown; message?: unknown } | null;
	// Serwer opisuje stan linku polem `stan` — niezależnie od kodu odpowiedzi.
	if (body && typeof body.stan === 'string') return { ok: true, widok: body as WidokOdnowienia };
	if (res.status === 404) return { ok: true, widok: { stan: 'nieznany' } };
	return { ok: false, message: komunikatStatusu(res.status) };
}

export type WynikDzialania<T> = { ok: true; data: T } | { ok: false; status: number; message: string; bledy: string[] };

export async function wyslij<T = unknown>(klucz: string, dzialanie: Dzialanie): Promise<WynikDzialania<T>> {
	let res: Response;
	try {
		res = await fetch(adres(klucz), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(dzialanie)
		});
	} catch {
		return {
			ok: false,
			status: 0,
			message: 'Brak połączenia z serwerem. Twoje odpowiedzi zostały na ekranie — sprawdź internet i spróbuj ponownie.',
			bledy: []
		};
	}
	const body = await res.json().catch(() => null);
	if (res.ok) return { ok: true, data: body as T };
	const b = (body ?? {}) as Partial<OdpowiedzBlad>;
	return {
		ok: false,
		status: res.status,
		message: typeof b.message === 'string' && b.message ? b.message : komunikatStatusu(res.status),
		bledy: Array.isArray(b.bledy) ? b.bledy.filter((x): x is string => typeof x === 'string') : []
	};
}

function komunikatStatusu(status: number): string {
	if (status === 404) return 'Nie znaleziono wniosku. Sprawdź, czy link jest kompletny.';
	if (status === 409 || status === 410) return 'Stan wniosku zmienił się w międzyczasie. Odśwież stronę.';
	if (status === 413) return 'Przesłane dane są zbyt duże.';
	if (status === 429) return 'Zbyt wiele prób w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.';
	return 'Serwer nie przyjął danych. Spróbuj ponownie za chwilę — Twoje odpowiedzi zostały na ekranie.';
}

// Po zmianie kroku (albo widoku w kroku) fokus na nagłówek — czytnik ekranu zaczyna od początku,
// a na telefonie strona wraca na górę.
export async function fokusNaglowka() {
	await tick();
	const h = document.getElementById('krok-naglowek');
	h?.focus({ preventScroll: true });
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Formatowanie ----------

// „2026-10-31” → „31.10.2026”; znacznik czasu → data w czasie polskim.
export function fmtData(d: string | null | undefined): string {
	if (!d) return '—';
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
	if (m) return `${m[3]}.${m[2]}.${m[1]}`;
	const t = new Date(d);
	if (Number.isNaN(t.getTime())) return d;
	return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }).format(t);
}

export function fmtDataGodzina(d: string | null | undefined): string {
	if (!d) return '—';
	const t = new Date(d);
	if (Number.isNaN(t.getTime())) return fmtData(d);
	return new Intl.DateTimeFormat('pl-PL', {
		timeZone: 'Europe/Warsaw',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(t);
}

export function fmtRozmiar(b: number): string {
	if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
	return `${(b / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
}

// Część przeglądarek (zwłaszcza dla HEIC) podaje pusty typ pliku — wtedy decyduje rozszerzenie.
const ROZSZERZENIA: Record<string, string> = {
	pdf: 'application/pdf',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	heic: 'image/heic',
	heif: 'image/heif'
};

export function mimePliku(f: File): string {
	const t = (f.type || '').toLowerCase();
	if (ZALACZNIK_TYPY_MIME.includes(t)) return t;
	const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
	return ROZSZERZENIA[ext] ?? t;
}

// Wyszukiwanie po liście zabiegów bez względu na wielkość liter i polskie znaki.
export const bezOgonkow = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

// ---------- Wygląd (BeautyPolisa: granat + róż) ----------

export const KARTA = 'bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-7';
export const NAGLOWEK = 'text-xl sm:text-2xl font-bold text-[#2a3b69] focus:outline-none';
export const INP =
	'w-full min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 ' +
	'focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500';
export const ETYKIETA = 'block text-sm font-medium text-slate-700 mb-1.5';
export const LEGENDA = 'text-base font-semibold text-[#2a3b69] mb-3';
const BTN =
	'inline-flex items-center justify-center gap-2 min-h-12 rounded-xl px-6 py-3 text-base font-semibold transition-colors ' +
	'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-500 disabled:opacity-60 disabled:cursor-not-allowed';
export const BTN_GLOWNY = `${BTN} bg-rose-600 text-white hover:bg-rose-700`;
export const BTN_DRUGI = `${BTN} bg-white text-[#2a3b69] border border-slate-300 hover:bg-slate-50`;
export const BTN_CZERWONY = `${BTN} bg-red-700 text-white hover:bg-red-800`;
export const BTN_LINK =
	'inline-flex items-center gap-1 min-h-10 text-sm font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-800 ' +
	'focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded';
// Opcja (radio/checkbox) jako duży kafelek do stuknięcia palcem.
export const OPCJA =
	'flex items-start gap-3 min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 cursor-pointer transition-colors ' +
	'hover:border-slate-400 has-checked:border-rose-500 has-checked:bg-rose-50 has-focus-visible:ring-2 has-focus-visible:ring-rose-500';
export const ZNACZNIK = 'mt-0.5 size-5 shrink-0 accent-rose-600';
