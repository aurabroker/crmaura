// Zgłoszenia z formularza (arkusz Google → Apps Script → /api/leady/zgloszenia) i klucze integracji.
// Klucz jest pokazywany administratorowi raz; w bazie zostaje tylko skrót SHA-256 i prefiks do rozpoznania.
// Całą logikę przyjęcia (dopasowanie klienta, lead, komunikat, zadanie) robi funkcja w bazie
// crm_przyjmij_zgloszenia — jedno wywołanie na paczkę, bo Cloudflare ogranicza zapytania wychodzące.
import type { SupabaseClient } from '@supabase/supabase-js';

import { powodSpamu } from '../spamZgloszen.ts';

export const MAKS_WIERSZY = 200;
export const PREFIKS_KLUCZA = 'crmzg_';
// Klucz asystenta AI (konsultacja-agent) ma osobny zakres: nie wyłącza klucza arkusza i nie przyjmuje zgłoszeń.
export const PREFIKS_KLUCZA_AI = 'crmai_';
export type ZakresKlucza = 'zgloszenia' | 'asystent_ai';
export const zakresZ = (v: unknown): ZakresKlucza => (v === 'asystent_ai' ? 'asystent_ai' : 'zgloszenia');
export const czyKluczZgloszen = (klucz: string): boolean => klucz.trim().startsWith(PREFIKS_KLUCZA);

export type WierszZgloszenia = {
	company?: string;
	contact?: string;
	email?: string;
	phone?: string;
	nip?: string;
	ubezpieczenie?: string;
	przychod?: string;
	ref?: string;
	data?: string;
	historyczne?: boolean;
	/** Formularz BeautyPolisa wprost (klient od razu „Beauty”); bez pola decyduje arkusz „Zgloszenia_Polisa…” w ref. */
	beauty?: boolean;
};

export type WynikPrzyjecia = {
	nowe: number;
	ponowne: number;
	historyczne: number;
	duplikaty: number;
	pominiete: number;
	wyniki: { ref: string | null; status: string; klient_id?: string | null }[];
};

export async function skrotKlucza(klucz: string): Promise<string> {
	const bajty = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(klucz.trim()));
	return [...new Uint8Array(bajty)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowyKlucz(zakres: ZakresKlucza = 'zgloszenia'): string {
	const losowe = new Uint8Array(32);
	crypto.getRandomValues(losowe);
	const b64 = btoa(String.fromCharCode(...losowe)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return (zakres === 'asystent_ai' ? PREFIKS_KLUCZA_AI : PREFIKS_KLUCZA) + b64;
}

/** Wiersze z treści żądania: pojedynczy obiekt albo tablica (do MAKS_WIERSZY). Null — zła treść. */
export function wierszeZTresci(tresc: unknown): WierszZgloszenia[] | null {
	const lista = Array.isArray(tresc) ? tresc : tresc && typeof tresc === 'object' ? [tresc] : null;
	if (!lista || lista.length > MAKS_WIERSZY) return null;
	if (!lista.every((w) => w && typeof w === 'object' && !Array.isArray(w))) return null;
	const tekst = (v: unknown) => (v == null ? undefined : String(v));
	return lista.map((w: Record<string, unknown>) => ({
		company: tekst(w.company),
		contact: tekst(w.contact),
		email: tekst(w.email),
		phone: tekst(w.phone),
		nip: tekst(w.nip),
		ubezpieczenie: tekst(w.ubezpieczenie),
		przychod: tekst(w.przychod),
		ref: tekst(w.ref),
		data: tekst(w.data),
		historyczne: w.historyczne === true || w.historyczne === 'true',
		...(w.beauty == null || w.beauty === '' ? {} : { beauty: w.beauty === true || ['true', '1', 'tak'].includes(String(w.beauty).trim().toLowerCase()) })
	}));
}

export class ZlyKlucz extends Error {}

/** Wiersze wypełnione przez bota ($lib/spamZgloszen) — nie trafiają do bazy. */
export function podzielSpam(wiersze: WierszZgloszenia[]): { dobre: WierszZgloszenia[]; spam: { ref: string | null; powod: string }[] } {
	const dobre: WierszZgloszenia[] = [];
	const spam: { ref: string | null; powod: string }[] = [];
	for (const w of wiersze) {
		const powod = powodSpamu({ firma: w.company, kontakt: w.contact, nip: w.nip, telefon: w.phone });
		if (powod) spam.push({ ref: w.ref ?? null, powod });
		else dobre.push(w);
	}
	return { dobre, spam };
}

export async function przyjmijZgloszenia(admin: SupabaseClient, klucz: string, wiersze: WierszZgloszenia[]): Promise<WynikPrzyjecia> {
	// Spam odpada przed bazą; klucz sprawdza baza zawsze (także gdy cała paczka to spam).
	const { dobre, spam } = podzielSpam(wiersze);
	const { data, error } = await admin.rpc('crm_przyjmij_zgloszenia', { p_hash: await skrotKlucza(klucz), p_wiersze: dobre });
	if (error) {
		if (error.code === '28000' || /zly_klucz/.test(error.message)) throw new ZlyKlucz('Nieprawidłowy klucz integracji');
		throw new Error(error.message);
	}
	const wynik = data as WynikPrzyjecia;
	if (spam.length) {
		console.warn(`Zgłoszenia: odrzucono ${spam.length} jako spam:`, spam.map((x) => `${x.ref ?? '—'} (${x.powod})`).join('; '));
		wynik.pominiete = (wynik.pominiete ?? 0) + spam.length;
		wynik.wyniki = [...(wynik.wyniki ?? []), ...spam.map((x) => ({ ref: x.ref, status: 'spam' }))];
	}
	return wynik;
}
