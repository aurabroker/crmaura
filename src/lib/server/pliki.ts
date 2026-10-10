// Pliki polis (PDF) w Cloudflare R2. Opis pliku w crm_policy_files (zapisuje tylko serwer), treść w kubełku
// pod kluczem <tenant>/<polisa>/<uuid>.pdf. Każda operacja sprawdza, czy polisa i plik należą do firmy
// zalogowanego użytkownika — kubełek nie ma własnych uprawnień, pilnuje ich ten moduł.
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MAKS_PDF = 20 * 1024 * 1024; // 20 MB — polisy mają zwykle 0,3–1,5 MB
export const RODZAJE_PLIKOW = ['polisa', 'aneks', 'owu', 'inne'] as const;
export type RodzajPliku = (typeof RODZAJE_PLIKOW)[number];

export type ProfilFirmy = { id: string; tenant_id: string; email?: string | null; imie_nazwisko?: string | null };
export type PlikPolisy = {
	id: string;
	tenant_id: string;
	polisa_id: string;
	rodzaj: RodzajPliku;
	nazwa: string;
	klucz: string;
	rozmiar: number;
	typ: string;
	zrodlo: 'import_pdf' | 'recznie';
	dodal: string | null;
	created_at: string;
};

export function magazyn(platform: App.Platform | undefined): R2Kubelek {
	const k = platform?.env?.POLISY_PDF;
	if (!k) throw error(503, 'Magazyn plików nie jest skonfigurowany (Cloudflare R2: binding POLISY_PDF).');
	return k;
}

/** Plik zaczyna się od „%PDF-” (rozszerzenie i typ z przeglądarki nie wystarczą). */
export function czyPdf(b: Uint8Array): boolean {
	return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

/** Nazwa do wyświetlenia i nagłówka pobierania: bez ścieżek i znaków sterujących, z końcówką .pdf. */
export function bezpiecznaNazwa(nazwa: string | null | undefined): string {
	const n = String(nazwa ?? '')
		.split(/[\\/]/)
		.pop()!
		.replace(/[\u0000-\u001f\u007f"]+/g, '')
		.trim()
		.slice(0, 200);
	const baza = n || 'polisa.pdf';
	return /\.pdf$/i.test(baza) ? baza : `${baza}.pdf`;
}

/** Content-Disposition z nazwą w UTF-8 (polskie znaki) i bezpiecznym zamiennikiem ASCII. */
export function naglowekPobrania(nazwa: string, inline = true): string {
	const ascii = nazwa.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nazwa)}`;
}

async function audyt(admin: SupabaseClient, profil: ProfilFirmy, akcja: string, polisaId: string, etykieta: string, szczegoly: Record<string, unknown>) {
	await admin.from('crm_audit_log').insert({
		tenant_id: profil.tenant_id,
		user_id: profil.id,
		user_email: profil.email ?? null,
		user_name: profil.imie_nazwisko ?? null,
		action: akcja,
		entity_type: 'policy',
		entity_id: polisaId,
		entity_label: etykieta,
		details: szczegoly
	});
}

/** Zapisuje PDF polisy: sprawdza firmę, rozmiar i nagłówek pliku, wrzuca do R2, potem opis do bazy. */
export async function zapiszPlikPolisy(
	admin: SupabaseClient,
	kubelek: R2Kubelek,
	profil: ProfilFirmy,
	polisaId: string,
	plik: { nazwa: string; dane: Uint8Array },
	o: { rodzaj?: string | null; zrodlo?: string | null } = {}
): Promise<PlikPolisy> {
	const { data: polisa } = await admin
		.from('crm_policies')
		.select('id, tenant_id, nr_polisy')
		.eq('id', polisaId)
		.eq('tenant_id', profil.tenant_id)
		.maybeSingle();
	if (!polisa) throw error(404, 'Nie ma takiej polisy w Twojej firmie.');
	if (!plik.dane.length) throw error(400, 'Plik jest pusty.');
	if (plik.dane.length > MAKS_PDF) throw error(413, `Plik jest za duży (limit ${MAKS_PDF / 1024 / 1024} MB).`);
	if (!czyPdf(plik.dane)) throw error(415, 'To nie jest plik PDF.');

	const rodzaj = (RODZAJE_PLIKOW as readonly string[]).includes(o.rodzaj ?? '') ? (o.rodzaj as RodzajPliku) : 'polisa';
	const zrodlo = o.zrodlo === 'import_pdf' ? 'import_pdf' : 'recznie';
	const nazwa = bezpiecznaNazwa(plik.nazwa);
	const klucz = `${profil.tenant_id}/${polisaId}/${crypto.randomUUID()}.pdf`;

	await kubelek.put(klucz, plik.dane, {
		httpMetadata: { contentType: 'application/pdf' },
		customMetadata: { tenant: profil.tenant_id, polisa: polisaId }
	});
	const { data, error: e } = await admin
		.from('crm_policy_files')
		.insert({ tenant_id: profil.tenant_id, polisa_id: polisaId, rodzaj, nazwa, klucz, rozmiar: plik.dane.length, typ: 'application/pdf', zrodlo, dodal: profil.id })
		.select('*')
		.single();
	if (e || !data) {
		// Bez opisu w bazie plik byłby niewidoczny — sprzątamy kubełek.
		await kubelek.delete(klucz).catch(() => {});
		throw error(500, 'Nie udało się zapisać pliku.');
	}
	await audyt(admin, profil, 'policy_file_added', polisaId, (polisa as { nr_polisy: string }).nr_polisy, { plik: nazwa, rodzaj, zrodlo, rozmiar: plik.dane.length });
	return data as PlikPolisy;
}

/** Opis pliku — tylko z firmy użytkownika (inaczej 404, bez zdradzania, że plik istnieje). */
export async function plikFirmy(admin: SupabaseClient, profil: ProfilFirmy, plikId: string): Promise<PlikPolisy> {
	if (!/^[0-9a-f-]{36}$/i.test(plikId)) throw error(404, 'Nie ma takiego pliku.');
	const { data } = await admin.from('crm_policy_files').select('*').eq('id', plikId).eq('tenant_id', profil.tenant_id).maybeSingle();
	if (!data) throw error(404, 'Nie ma takiego pliku.');
	return data as PlikPolisy;
}

export async function pobierzPlik(admin: SupabaseClient, kubelek: R2Kubelek, profil: ProfilFirmy, plikId: string) {
	const plik = await plikFirmy(admin, profil, plikId);
	const obiekt = await kubelek.get(plik.klucz);
	if (!obiekt) throw error(410, 'Plik zniknął z magazynu.');
	return { plik, obiekt };
}

export async function usunPlik(admin: SupabaseClient, kubelek: R2Kubelek, profil: ProfilFirmy, plikId: string) {
	const plik = await plikFirmy(admin, profil, plikId);
	const { error: e } = await admin.from('crm_policy_files').delete().eq('id', plik.id).eq('tenant_id', profil.tenant_id);
	if (e) throw error(500, 'Nie udało się usunąć pliku.');
	await kubelek.delete(plik.klucz).catch(() => {});
	await audyt(admin, profil, 'policy_file_deleted', plik.polisa_id, plik.nazwa, { plik: plik.nazwa, rodzaj: plik.rodzaj });
	return plik;
}
