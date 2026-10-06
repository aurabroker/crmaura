import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

export type NewTenantInput = {
	nazwa_firmy?: string;
	typ?: string;
	email?: string;
	imie_nazwisko?: string;
	password?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESERVED_FEATURE_KEYS = new Set(['constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);

export type TenantPatch ={ features?: Record<string, boolean>; resend_api_key?: string | null };

// Waliduje ciało PATCH /api/saas-admin/tenants. Zwraca identyfikator firmy i czyste pola do zapisu.
export function parseTenantPatch(body: unknown): { tenantId: string; patch: TenantPatch } {
	if (!body || typeof body !== 'object') throw error(400, { message: 'Nieprawidłowe dane.' });
	const { tenant_id, features, resend_api_key } = body as Record<string, unknown>;

	if (typeof tenant_id !== 'string' || !UUID.test(tenant_id)) {
		throw error(400, { message: 'Nieprawidłowy identyfikator firmy.' });
	}

	const patch: TenantPatch = {};

	if (features !== undefined) {
		if (!features || typeof features !== 'object' || Array.isArray(features)) {
			throw error(400, { message: 'Nieprawidłowe moduły.' });
		}
		const clean: Record<string, boolean> = {};
		for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
			// Nazwa zaczyna się od litery (odpada __proto__), a nazwy zarezerwowane obiektów są niedozwolone.
			if (!/^[a-z][a-z_]{0,39}$/.test(k) || RESERVED_FEATURE_KEYS.has(k) || typeof v !== 'boolean') {
				throw error(400, { message: 'Nieprawidłowe moduły.' });
			}
			clean[k] = v;
		}
		patch.features = clean;
	}

	if (resend_api_key !== undefined) {
		if (resend_api_key === null || resend_api_key === '') {
			patch.resend_api_key = null;
		} else if (typeof resend_api_key === 'string' && /^\S{10,200}$/.test(resend_api_key.trim())) {
			patch.resend_api_key = resend_api_key.trim();
		} else {
			throw error(400, { message: 'Nieprawidłowy klucz Resend.' });
		}
	}

	if (Object.keys(patch).length === 0) throw error(400, { message: 'Brak zmian do zapisania.' });
	return { tenantId: tenant_id, patch };
}

// Zakłada firmę razem z kontem pierwszego administratora (ADMIN BROKER).
// Wspólne dla publicznej rejestracji (/api/register, za Turnstile) i panelu SaaS
// (/api/saas-admin/tenants, za rolą ADMIN GOD). Przy błędzie cofa to, co już powstało.
export async function createTenantWithAdmin(admin: SupabaseClient, input: NewTenantInput) {
	const nazwa_firmy = (input.nazwa_firmy ?? '').trim();
	const email = (input.email ?? '').trim();
	const imie_nazwisko = (input.imie_nazwisko ?? '').trim();
	const password = input.password ?? '';
	const tenantTyp = input.typ === 'agent' ? 'agent' : 'broker';

	if (!nazwa_firmy || !email || !imie_nazwisko || !password) {
		throw error(400, { message: 'Wszystkie pola są wymagane.' });
	}
	if (password.length < 8) {
		throw error(400, { message: 'Hasło musi mieć co najmniej 8 znaków.' });
	}

	const { data: authData, error: authErr } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { imie_nazwisko, rola: 'ADMIN BROKER' }
	});

	if (authErr || !authData.user) {
		throw error(400, { message: authErr?.message ?? 'Nie można utworzyć użytkownika.' });
	}

	const userId = authData.user.id;

	const { data: tenant, error: tenantErr } = await admin
		.from('crm_tenants')
		.insert([{ nazwa: nazwa_firmy, typ: tenantTyp }])
		.select()
		.single();

	if (tenantErr || !tenant) {
		await admin.auth.admin.deleteUser(userId);
		throw error(500, { message: tenantErr?.message ?? 'Nie można utworzyć firmy.' });
	}

	const { error: profileErr } = await admin.from('crm_profiles').insert([{
		id: userId,
		email,
		imie_nazwisko,
		rola: 'ADMIN BROKER',
		tenant_id: tenant.id
	}]);

	if (profileErr) {
		await admin.auth.admin.deleteUser(userId);
		await admin.from('crm_tenants').delete().eq('id', tenant.id);
		throw error(500, { message: profileErr.message });
	}

	return { tenantId: tenant.id as string, userId };
}
