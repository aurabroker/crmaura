import type { SupabaseClient } from '@supabase/supabase-js';
import { LIMITY_PODPISU, PODPIS_ZA_KROTKI, wystarczajacyPodpis, type Podpis, type Punkt, type ZakresPodpisu } from '$lib/renewals/podpis';
import { APK_ODMOWA_TRESC } from '$lib/renewals/program';
import type { Klient, RenewalRow } from '$lib/server/renewals';

// Podpis klienta po stronie serwera: sprawdzenie, skróty SHA-256 i zapis (crm_renewal_podpisy).
//
// Obraz pochodzi z przeglądarki klienta, więc traktujemy go jak niezaufany: tylko PNG (sygnatura i wymiary
// z bloku IHDR), ograniczony rozmiar, punkty jako liczby w zakresie, ta sama reguła „to podpis, a nie kropka”
// co na stronie. Skrót treści wiąże podpis z tym, co klient widział: APK (albo odmowa) ze zgodami, a przy
// drugim podpisie — wniosek z ankietą i załącznikami. Zgodność można sprawdzić w każdej chwili tą samą funkcją.

export type PodpisSprawdzony = Podpis & { pngBase64: string; skrotPodpisu: string };

const OSWIADCZENIE_APK = 'Oświadczam, że podane informacje są zgodne z prawdą.';

function base64NaBajty(b64: string): Uint8Array | null {
	try {
		const bin = atob(b64);
		const wynik = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) wynik[i] = bin.charCodeAt(i);
		return wynik;
	} catch {
		return null;
	}
}

export async function sha256(dane: string | Uint8Array): Promise<string> {
	const bajty = typeof dane === 'string' ? new TextEncoder().encode(dane) : dane;
	const skrot = await crypto.subtle.digest('SHA-256', new Uint8Array(bajty));
	return [...new Uint8Array(skrot)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON z kluczami w stałej kolejności — ta sama treść z bazy daje ten sam skrót. */
export function kanon(v: unknown): string {
	return JSON.stringify(uporzadkuj(v));
}
function uporzadkuj(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(uporzadkuj);
	if (v && typeof v === 'object') {
		return Object.fromEntries(
			Object.keys(v as Record<string, unknown>)
				.sort()
				.filter((k) => (v as Record<string, unknown>)[k] !== undefined)
				.map((k) => [k, uporzadkuj((v as Record<string, unknown>)[k])])
		);
	}
	return v;
}

const liczba = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const punktOk = (p: unknown): p is Punkt =>
	Array.isArray(p) && p.length === 4 && p.every(liczba) && p[0] >= -0.05 && p[0] <= 1.05 && p[1] >= -0.05 && p[1] <= 1.05 && p[2] >= 0 && p[3] >= 0 && p[3] <= 1;

/** Sprawdza podpis z żądania klienta. Komunikat błędu jest dla klienta (po polsku). */
export async function sprawdzPodpis(dane: unknown, brakTekst: string): Promise<{ ok: true; podpis: PodpisSprawdzony } | { ok: false; blad: string }> {
	const brak = { ok: false as const, blad: brakTekst };
	if (!dane || typeof dane !== 'object') return brak;
	const { png, punkty, proporcje } = dane as Record<string, unknown>;
	if (typeof png !== 'string' || png.length > LIMITY_PODPISU.pngZnakow + 30) return brak;
	if (!liczba(proporcje) || proporcje <= 0.5 || proporcje >= 10) return brak;
	if (!Array.isArray(punkty) || !punkty.length || punkty.length > LIMITY_PODPISU.kresek) return brak;
	if (!punkty.every((k) => Array.isArray(k) && k.length > 0 && k.every(punktOk))) return brak;
	const kreski = punkty as Punkt[][];
	if (kreski.flat().length > LIMITY_PODPISU.punktow) return { ok: false, blad: 'Podpis jest zbyt złożony — podpisz się jeszcze raz.' };
	if (!wystarczajacyPodpis(kreski, proporcje)) return { ok: false, blad: PODPIS_ZA_KROTKI };

	const pngBase64 = png.replace(/^data:image\/png;base64,/, '').replace(/\s/g, '');
	const bajty = base64NaBajty(pngBase64);
	// PNG: sygnatura 8 bajtów, potem blok IHDR z szerokością i wysokością.
	const sygnatura = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (!bajty || bajty.length < 33 || sygnatura.some((b, i) => bajty[i] !== b)) return brak;
	const dv = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength);
	const szer = dv.getUint32(16);
	const wys = dv.getUint32(20);
	if (szer < 50 || wys < 20 || szer > 2400 || wys > 1200) return brak;

	return { ok: true, podpis: { png, punkty: kreski, proporcje, pngBase64, skrotPodpisu: await sha256(bajty) } };
}

// ---------- Treść do skrótu: to, co klient widział w chwili podpisu ----------

type DoApk = Pick<RenewalRow, 'id' | 'klient_nazwa' | 'nr_polisy' | 'apk' | 'apk_odmowa' | 'zgody'>;
type DoWniosku = Pick<RenewalRow, 'id' | 'klient_nazwa' | 'nr_polisy' | 'decyzja' | 'wniosek' | 'ankieta' | 'zalaczniki' | 'skladka_nowa'>;

export function trescApk(r: DoApk): string {
	return kanon({
		zakres: 'apk',
		wniosek: r.id,
		klient: r.klient_nazwa,
		certyfikat: r.nr_polisy,
		apk: r.apk_odmowa ? null : r.apk,
		apk_odmowa: r.apk_odmowa,
		odmowa_tresc: r.apk_odmowa ? APK_ODMOWA_TRESC : null,
		oswiadczenie: r.apk_odmowa ? null : OSWIADCZENIE_APK,
		zgody: r.zgody ?? null
	});
}

export function trescWniosku(r: DoWniosku): string {
	return kanon({
		zakres: 'wniosek',
		wniosek: r.id,
		klient: r.klient_nazwa,
		certyfikat: r.nr_polisy,
		decyzja: r.decyzja,
		tresc: r.wniosek,
		ankieta: r.ankieta,
		zalaczniki: (r.zalaczniki ?? []).map((z) => ({ id: z.id, typ: z.typ, nazwa: z.nazwa, rozmiar: Number(z.rozmiar) || 0 })),
		skladka_nowa: r.skladka_nowa == null ? null : Number(r.skladka_nowa)
	});
}

export const skrotApk = (r: DoApk) => sha256(trescApk(r));
export const skrotWniosku = (r: DoWniosku) => sha256(trescWniosku(r));

// ---------- Zapis i odczyt ----------

export type PodpisZBazy = {
	zakres: ZakresPodpisu;
	png: string; // base64 bez przedrostka data:
	punkty: Punkt[][];
	proporcje: number;
	podpisano_at: string;
	ip: string | null;
	user_agent: string | null;
	skrot_tresci: string;
	skrot_podpisu: string;
};

/** Jeden podpis na zakres i wniosek (poprawiona APK = nowy podpis nadpisuje poprzedni). Rzuca przy błędzie zapisu. */
export async function zapiszPodpis(
	admin: SupabaseClient,
	r: Pick<RenewalRow, 'id' | 'tenant_id'>,
	zakres: ZakresPodpisu,
	podpis: PodpisSprawdzony,
	skrotTresci: string,
	kto: Klient,
	podpisanoAt: string
) {
	const { error } = await admin.from('crm_renewal_podpisy').upsert(
		{
			renewal_id: r.id,
			tenant_id: r.tenant_id,
			zakres,
			png: podpis.pngBase64,
			punkty: podpis.punkty,
			proporcje: podpis.proporcje,
			podpisano_at: podpisanoAt,
			ip: kto.ip,
			user_agent: kto.ua?.slice(0, 400) ?? null,
			skrot_tresci: skrotTresci,
			skrot_podpisu: podpis.skrotPodpisu
		},
		{ onConflict: 'renewal_id,zakres' }
	);
	if (error) throw new Error(`Nie udało się zapisać podpisu: ${error.message}`);
}

export async function pobierzPodpisy(admin: SupabaseClient, renewalId: string): Promise<PodpisZBazy[]> {
	const { data, error } = await admin
		.from('crm_renewal_podpisy')
		.select('zakres, png, punkty, proporcje, podpisano_at, ip, user_agent, skrot_tresci, skrot_podpisu')
		.eq('renewal_id', renewalId);
	if (error) {
		console.error('renewals: odczyt podpisów:', error.message);
		return [];
	}
	return (data ?? []) as PodpisZBazy[];
}

export async function pobierzPodpis(admin: SupabaseClient, renewalId: string, zakres: ZakresPodpisu): Promise<PodpisZBazy | null> {
	return (await pobierzPodpisy(admin, renewalId)).find((p) => p.zakres === zakres) ?? null;
}

/** Do PDF: obraz jako data URL, data i skrót. */
export const podpisDoPdf = (p: PodpisZBazy | null) => (p ? { png: `data:image/png;base64,${p.png}`, podpisano_at: p.podpisano_at, skrot_tresci: p.skrot_tresci } : null);
export type PodpisPdf = ReturnType<typeof podpisDoPdf>;
