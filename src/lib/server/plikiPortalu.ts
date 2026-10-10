// Dokumenty polis w panelu klienta (/portal): klient widzi i pobiera PDF swoich polis z magazynu R2.
// Konto portalu rozpoznajemy po app_metadata.portal_klient_id (zapisuje je tylko serwer) i powiązaniu
// crm_clients.auth_user_id — tak jak przy nadawaniu dostępu ($lib/server/portal.ts).
// Klient dostaje tylko polisy, w których jest ubezpieczającym (jak lista polis w portalu), i tylko
// dokumenty dla niego przeznaczone: polisę, aneksy i OWU (bez „Inny dokument” — to notatki biura).
import { error } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export const RODZAJE_DLA_KLIENTA = ['polisa', 'aneks', 'owu'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KlientPortalu = { id: string; tenant_id: string; nazwa: string; email: string | null };
export type PlikDlaKlienta = { id: string; polisa_id: string; rodzaj: string; nazwa: string; rozmiar: number; created_at: string };

export async function klientPortalu(admin: SupabaseClient, user: User | null): Promise<KlientPortalu> {
	const klientId = (user?.app_metadata as Record<string, unknown> | undefined)?.portal_klient_id;
	if (!user || typeof klientId !== 'string' || !UUID.test(klientId)) throw error(403, 'To konto nie ma dostępu do panelu klienta.');
	const { data } = await admin
		.from('crm_clients')
		.select('id, tenant_id, nazwa, email')
		.eq('id', klientId)
		.eq('auth_user_id', user.id)
		.maybeSingle();
	if (!data) throw error(403, 'To konto nie ma dostępu do panelu klienta.');
	return data as KlientPortalu;
}

async function polisyKlienta(admin: SupabaseClient, k: KlientPortalu): Promise<Set<string>> {
	const { data } = await admin
		.from('crm_policies')
		.select('id')
		.eq('tenant_id', k.tenant_id)
		.eq('klient_id', k.id)
		.is('deleted_at', null);
	return new Set(((data ?? []) as { id: string }[]).map((p) => p.id));
}

export async function plikiKlienta(admin: SupabaseClient, k: KlientPortalu): Promise<PlikDlaKlienta[]> {
	const ids = [...(await polisyKlienta(admin, k))];
	if (!ids.length) return [];
	const { data } = await admin
		.from('crm_policy_files')
		.select('id, polisa_id, rodzaj, nazwa, rozmiar, created_at')
		.eq('tenant_id', k.tenant_id)
		.in('polisa_id', ids)
		.in('rodzaj', [...RODZAJE_DLA_KLIENTA])
		.order('created_at', { ascending: false });
	return (data ?? []) as PlikDlaKlienta[];
}

/** Plik dla klienta — z jego firmy, z jego polisy i rodzaju przeznaczonego dla klienta; inaczej 404. */
export async function plikKlienta(admin: SupabaseClient, k: KlientPortalu, plikId: string) {
	if (!UUID.test(plikId)) throw error(404, 'Nie ma takiego dokumentu.');
	const { data } = await admin
		.from('crm_policy_files')
		.select('id, polisa_id, rodzaj, nazwa, klucz')
		.eq('id', plikId)
		.eq('tenant_id', k.tenant_id)
		.maybeSingle();
	const plik = data as { id: string; polisa_id: string; rodzaj: string; nazwa: string; klucz: string } | null;
	if (!plik || !(RODZAJE_DLA_KLIENTA as readonly string[]).includes(plik.rodzaj)) throw error(404, 'Nie ma takiego dokumentu.');
	if (!(await polisyKlienta(admin, k)).has(plik.polisa_id)) throw error(404, 'Nie ma takiego dokumentu.');
	return plik;
}

/** Ślad w historii polisy: doradca widzi, że klient pobrał dokument. */
export async function zapiszPobranie(admin: SupabaseClient, k: KlientPortalu, user: User, plik: { polisa_id: string; nazwa: string }) {
	await admin.from('crm_audit_log').insert({
		tenant_id: k.tenant_id,
		user_id: null,
		user_email: user.email ?? k.email,
		user_name: `${k.nazwa} (panel klienta)`,
		action: 'portal_file_downloaded',
		entity_type: 'policy',
		entity_id: plik.polisa_id,
		entity_label: plik.nazwa,
		details: { plik: plik.nazwa }
	});
}
