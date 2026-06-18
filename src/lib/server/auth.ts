import { error } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SB_URL } from '$lib/supabase';
import { env } from '$env/dynamic/private';

export function getAdminClient() {
	const key = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!key) throw error(500, 'Service role key not configured');
	return createClient(SB_URL, key, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

function extractToken(request: Request): string {
	const header = request.headers.get('Authorization');
	if (!header?.startsWith('Bearer ')) throw error(401, 'Brak autoryzacji');
	return header.slice(7);
}

export async function requireAuth(request: Request) {
	const token = extractToken(request);
	const admin = getAdminClient();
	const { data: { user }, error: authErr } = await admin.auth.getUser(token);
	if (authErr || !user) throw error(401, 'Nieprawidłowy token');

	const { data: profile } = await admin.from('crm_profiles').select('*').eq('id', user.id).single();
	if (!profile) throw error(403, 'Brak profilu użytkownika');

	return { user, profile, admin };
}

export async function requireAdmin(request: Request) {
	const ctx = await requireAuth(request);
	const adminRoles = ['ADMIN GOD', 'ADMIN BROKER', 'BOARD'];
	if (!adminRoles.includes(ctx.profile.rola)) throw error(403, 'Brak uprawnień administratora');
	return ctx;
}

export async function requireSaasAdmin(request: Request) {
	const ctx = await requireAuth(request);
	if (ctx.profile.rola !== 'ADMIN GOD') throw error(403, 'Brak uprawnień SAAS Admin');
	return ctx;
}

// Role nadawane w obrębie tenanta przez administratora firmy (bez super-admina SaaS).
export const TENANT_ASSIGNABLE_ROLES = ['BROKER', 'ADMINISTRACJA', 'BOARD', 'ADMIN BROKER'] as const;
// Pełny zbiór dozwolonych ról. 'ADMIN GOD' = super-admin całego SaaS.
export const ALL_ROLES = [...TENANT_ASSIGNABLE_ROLES, 'ADMIN GOD'] as const;

/**
 * Waliduje rolę przed jej nadaniem. Zapobiega eskalacji uprawnień:
 * administrator tenanta (ADMIN BROKER / BOARD) NIE może wykreować roli 'ADMIN GOD' —
 * tylko istniejący 'ADMIN GOD' może nadać tę rolę.
 */
export function assertAssignableRole(requestedRole: string, actorRole: string) {
	if (!ALL_ROLES.includes(requestedRole as (typeof ALL_ROLES)[number])) {
		throw error(400, 'Nieprawidłowa rola');
	}
	if (requestedRole === 'ADMIN GOD' && actorRole !== 'ADMIN GOD') {
		throw error(403, 'Brak uprawnień do nadania roli ADMIN GOD');
	}
}
