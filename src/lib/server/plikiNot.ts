// Pliki not prowizyjnych i zestawień TU (XLSX, XLS, CSV, PDF) w Cloudflare R2, w tym samym kubełku co PDF
// polis, pod kluczem noty/<tenant>/<nota>/<uuid>.<rozszerzenie>. Opis pliku w crm_noty (kolumny plik_*
// zapisuje tylko serwer). Każda operacja sprawdza, czy nota należy do firmy zalogowanego użytkownika.
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfilFirmy } from './pliki';

export const MAKS_PLIK_NOTY = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rodzaj = { ext: string; typ: string };
const TYPY: Record<string, string> = {
	pdf: 'application/pdf',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xls: 'application/vnd.ms-excel',
	csv: 'text/csv'
};

/** Rodzaj pliku po zawartości (nagłówek), a nie po nazwie; rozszerzenie z nazwy tylko rozstrzyga CSV/TXT. */
export function rozpoznajPlik(b: Uint8Array, nazwa: string): Rodzaj | null {
	const zaczyna = (...bajty: number[]) => b.length >= bajty.length && bajty.every((x, i) => b[i] === x);
	if (zaczyna(0x25, 0x50, 0x44, 0x46, 0x2d)) return { ext: 'pdf', typ: TYPY.pdf };
	if (zaczyna(0x50, 0x4b, 0x03, 0x04)) return { ext: 'xlsx', typ: TYPY.xlsx };
	if (zaczyna(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return { ext: 'xls', typ: TYPY.xls };
	// Tekst (CSV z eksportu TU): bez bajtów zerowych na początku pliku i z rozszerzeniem .csv/.txt
	if (/\.(csv|txt)$/i.test(nazwa) && b.length > 0 && !b.subarray(0, 8192).includes(0)) return { ext: 'csv', typ: TYPY.csv };
	return null;
}

/** Nazwa do wyświetlenia: bez ścieżek i znaków sterujących, z rozszerzeniem zgodnym z zawartością. */
export function nazwaPlikuNoty(nazwa: string | null | undefined, ext: string): string {
	const n = String(nazwa ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]+/g, '').trim().slice(0, 200);
	const baza = n.replace(/\.[a-z0-9]{1,5}$/i, '') || 'zestawienie';
	return `${baza}.${ext}`;
}

type Nota = { id: string; tenant_id: string; numer_noty: string; plik_klucz: string | null; plik_nazwa: string | null; plik_typ: string | null };

async function notaFirmy(admin: SupabaseClient, profil: ProfilFirmy, notaId: string): Promise<Nota> {
	if (!UUID.test(notaId)) throw error(404, 'Nie ma takiej noty.');
	const { data } = await admin
		.from('crm_noty')
		.select('id, tenant_id, numer_noty, plik_klucz, plik_nazwa, plik_typ')
		.eq('id', notaId)
		.eq('tenant_id', profil.tenant_id)
		.maybeSingle();
	if (!data) throw error(404, 'Nie ma takiej noty w Twojej firmie.');
	return data as Nota;
}

/** Zapisuje (albo podmienia) plik noty: najpierw obiekt w R2, potem opis w nocie, na końcu usuwa stary obiekt. */
export async function zapiszPlikNoty(
	admin: SupabaseClient,
	kubelek: R2Kubelek,
	profil: ProfilFirmy,
	notaId: string,
	plik: { nazwa: string; dane: Uint8Array }
) {
	const nota = await notaFirmy(admin, profil, notaId);
	const poprzedni = nota.plik_klucz;
	if (!plik.dane.length) throw error(400, 'Plik jest pusty.');
	if (plik.dane.length > MAKS_PLIK_NOTY) throw error(413, `Plik jest za duży (limit ${MAKS_PLIK_NOTY / 1024 / 1024} MB).`);
	const rodzaj = rozpoznajPlik(plik.dane, plik.nazwa);
	if (!rodzaj) throw error(415, 'Dozwolone pliki: XLSX, XLS, CSV albo PDF.');

	const nazwa = nazwaPlikuNoty(plik.nazwa, rodzaj.ext);
	const klucz = `noty/${profil.tenant_id}/${nota.id}/${crypto.randomUUID()}.${rodzaj.ext}`;
	await kubelek.put(klucz, plik.dane, {
		httpMetadata: { contentType: rodzaj.typ },
		customMetadata: { tenant: profil.tenant_id, nota: nota.id }
	});
	const { error: e } = await admin
		.from('crm_noty')
		.update({ plik_klucz: klucz, plik_nazwa: nazwa, plik_rozmiar: plik.dane.length, plik_typ: rodzaj.typ })
		.eq('id', nota.id)
		.eq('tenant_id', profil.tenant_id);
	if (e) {
		await kubelek.delete(klucz).catch(() => {});
		throw error(500, 'Nie udało się zapisać pliku noty.');
	}
	if (poprzedni && poprzedni !== klucz) await kubelek.delete(poprzedni).catch(() => {});
	await admin.from('crm_audit_log').insert({
		tenant_id: profil.tenant_id,
		user_id: profil.id,
		user_email: profil.email ?? null,
		user_name: profil.imie_nazwisko ?? null,
		action: poprzedni ? 'nota_file_replaced' : 'nota_file_added',
		entity_type: 'nota',
		entity_id: nota.id,
		entity_label: nota.numer_noty,
		details: { plik: nazwa, rozmiar: plik.dane.length }
	});
	return { plik_nazwa: nazwa, plik_rozmiar: plik.dane.length, plik_typ: rodzaj.typ };
}

export async function pobierzPlikNoty(admin: SupabaseClient, kubelek: R2Kubelek, profil: ProfilFirmy, notaId: string) {
	const nota = await notaFirmy(admin, profil, notaId);
	// Klucz musi leżeć w katalogu firmy — nawet gdyby ktoś zmienił wpis w bazie, nie dostanie cudzego pliku.
	if (!nota.plik_klucz || !nota.plik_klucz.startsWith(`noty/${profil.tenant_id}/`)) throw error(404, 'Nota nie ma pliku w magazynie.');
	const obiekt = await kubelek.get(nota.plik_klucz);
	if (!obiekt) throw error(410, 'Plik noty zniknął z magazynu.');
	return { nota, obiekt };
}
