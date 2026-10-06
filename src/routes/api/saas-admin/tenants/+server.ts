import { json, error } from '@sveltejs/kit';
import { requireSaasAdmin } from '$lib/server/auth';
import { createTenantWithAdmin, parseTenantPatch } from '$lib/server/tenants';
import type { RequestHandler } from './$types';

// Klucz Resend nigdy nie wraca do przeglądarki — pokazujemy tylko końcówkę. Krótki klucz
// (zapisany dawniej bez walidacji) nie jest pokazywany nawet częściowo.
function keyHint(key: unknown): string | null {
	if (typeof key !== 'string' || key.length === 0) return null;
	return key.length >= 10 ? `…${key.slice(-4)}` : '…';
}

export const GET: RequestHandler = async ({ request }) => {
	const { admin } = await requireSaasAdmin(request);

	const [tRes, pRes] = await Promise.all([
		admin.from('crm_tenants').select('*').order('created_at', { ascending: false }),
		admin.from('crm_profiles').select('id, email, imie_nazwisko, rola, tenant_id')
	]);

	const tenants = (tRes.data ?? []).map(({ resend_api_key, ...rest }) => ({
		...rest,
		features: rest.features ?? {},
		resend_key_hint: keyHint(resend_api_key)
	}));

	return json({ tenants, profiles: pRes.data ?? [] });
};

// Nowa firma z kontem administratora — tylko ADMIN GOD (publiczna rejestracja ma Turnstile).
export const POST: RequestHandler = async ({ request }) => {
	const { admin } = await requireSaasAdmin(request);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, { message: 'Nieprawidłowe dane.' });

	const input = body as Record<string, unknown>;
	// Administrator SaaS dostaje pełne komunikaty błędów (np. „e-mail już zarejestrowany”).
	const { tenantId } = await createTenantWithAdmin(admin, {
		nazwa_firmy: String(input.nazwa_firmy ?? ''),
		typ: String(input.typ ?? ''),
		email: String(input.email ?? ''),
		imie_nazwisko: String(input.imie_nazwisko ?? ''),
		password: String(input.password ?? '')
	}, { verbose: true });

	return json({ success: true, tenant_id: tenantId });
};

// Moduły firmy (features) i klucz Resend — zapis wyłącznie przez serwer po sprawdzeniu roli
// ADMIN GOD. Wcześniej panel pisał do crm_tenants z przeglądarki, a RLS dopuszczał to tylko
// dla własnej firmy, więc zmiany cudzych firm po cichu nie zapisywały się.
export const PATCH: RequestHandler = async ({ request }) => {
	const { admin } = await requireSaasAdmin(request);
	const { tenantId, patch } = parseTenantPatch(await request.json().catch(() => null));

	const { data, error: upErr } = await admin
		.from('crm_tenants')
		.update(patch)
		.eq('id', tenantId)
		.select('id, features, resend_api_key')
		.maybeSingle();

	if (upErr) throw error(500, { message: upErr.message });
	if (!data) throw error(404, { message: 'Nie znaleziono firmy.' });

	return json({ success: true, features: data.features ?? {}, resend_key_hint: keyHint(data.resend_api_key) });
};
