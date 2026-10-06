import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PortalAccountCheck = 'ok' | 'missing';

const DENIED = 'To konto nie jest kontem portalu tego klienta.';

// Konto Auth jest wspólne dla wielu aplikacji, a crm_clients.auth_user_id może zapisać każdy
// użytkownik firmy. Zanim więc zmienimy hasło/e-mail albo usuniemy konto wskazane tą kolumną,
// sprawdzamy, że to naprawdę konto portalu TEGO klienta i nie konto pracownika.
// Bez tego wpisanie cudzego UUID w auth_user_id pozwalałoby przejąć lub skasować dowolne konto.
//
// Podstawą zaufania jest znacznik app_metadata.portal_klient_id — app_metadata zapisuje wyłącznie
// serwer (service_role), a user_metadata właściciel konta może zmienić sam, więc sam w sobie
// nie dowodzi niczego. Konta założone przed wprowadzeniem znacznika rozpoznajemy jednorazowo po
// user_metadata (rola=KLIENT i zgodny klient_id) i od razu oznaczamy znacznikiem.
//
// Zwraca 'missing', gdy konto już nie istnieje (wtedy wołający odpina klienta).
export async function assertOwnClientAccount(
	admin: SupabaseClient,
	authUserId: string,
	klientId: string
): Promise<PortalAccountCheck> {
	const { data, error: gErr } = await admin.auth.admin.getUserById(authUserId);
	if (gErr) {
		const e = gErr as { status?: number; code?: string };
		if (e.status === 404 || e.code === 'user_not_found') return 'missing';
		console.error('portal: nie udało się pobrać konta Auth', gErr.message);
		throw error(502, 'Nie udało się sprawdzić konta klienta. Spróbuj ponownie.');
	}
	const user = data?.user;
	if (!user) return 'missing';

	// Konto pracownika nigdy nie jest kontem portalu.
	const { data: staff, error: sErr } = await admin
		.from('crm_profiles')
		.select('id')
		.eq('id', authUserId)
		.maybeSingle();
	if (sErr) {
		console.error('portal: nie udało się sprawdzić profilu pracownika', sErr.message);
		throw error(502, 'Nie udało się sprawdzić konta klienta. Spróbuj ponownie.');
	}
	if (staff) throw error(403, DENIED);

	const app = (user.app_metadata ?? {}) as Record<string, unknown>;
	if (app.portal_klient_id === klientId) return 'ok';

	const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
	if (meta.rola === 'KLIENT' && meta.klient_id === klientId) {
		const { error: uErr } = await admin.auth.admin.updateUserById(authUserId, {
			app_metadata: { ...app, portal_klient_id: klientId }
		});
		if (uErr) console.error('portal: nie udało się oznaczyć konta znacznikiem', uErr.message);
		return 'ok';
	}

	throw error(403, DENIED);
}

type PortalProfile = { tenant_id: string | null };

async function loadOwnTenantClient(admin: SupabaseClient, profile: PortalProfile, klientId: string) {
	const { data: client, error: cErr } = await admin
		.from('crm_clients')
		.select('id, tenant_id, auth_user_id')
		.eq('id', klientId)
		.single();
	if (cErr || !client) throw error(404, 'Nie znaleziono klienta');
	// Klient musi należeć do firmy zalogowanego pracownika
	if (client.tenant_id !== profile.tenant_id) throw error(403, 'Klient spoza Twojej organizacji');
	return client as { id: string; tenant_id: string; auth_user_id: string | null };
}

// Tworzy konto klienta w portalu albo ustawia nowe hasło/e-mail istniejącemu kontu TEGO klienta.
export async function grantPortalAccess(
	admin: SupabaseClient,
	profile: PortalProfile,
	input: { klient_id?: string; email?: string; password?: string }
): Promise<{ mode: 'created' | 'updated'; userId?: string }> {
	const { klient_id, email, password } = input;
	if (!klient_id || !email || !password) throw error(400, 'Podaj klienta, e-mail i hasło');
	if (password.length < 8) throw error(400, 'Hasło musi mieć co najmniej 8 znaków');

	const client = await loadOwnTenantClient(admin, profile, klient_id);
	let authUserId = client.auth_user_id;

	// Istniejące konto → tylko zmiana hasła / e-maila (po sprawdzeniu, że jest kontem tego klienta)
	if (authUserId) {
		const check = await assertOwnClientAccount(admin, authUserId, klient_id);
		if (check === 'missing') {
			// Konto zostało usunięte poza CRM — odpinamy martwe powiązanie i zakładamy nowe konto.
			const { error: unlinkErr } = await admin.from('crm_clients').update({ auth_user_id: null }).eq('id', klient_id);
			if (unlinkErr) throw error(500, unlinkErr.message);
			authUserId = null;
		}
	}

	if (authUserId) {
		const { error: upErr } = await admin.auth.admin.updateUserById(authUserId, {
			email,
			password,
			email_confirm: true
		});
		if (upErr) throw error(400, upErr.message);
		await admin.from('crm_clients').update({ email }).eq('id', klient_id);
		return { mode: 'updated' };
	}

	// Nowe konto, od razu ze znacznikiem rozpoznawanym przez assertOwnClientAccount
	const { data: userData, error: createErr } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { rola: 'KLIENT', klient_id },
		app_metadata: { portal_klient_id: klient_id }
	});
	if (createErr || !userData?.user) throw error(400, createErr?.message ?? 'Nie udało się utworzyć konta');

	const { error: linkErr } = await admin
		.from('crm_clients')
		.update({ auth_user_id: userData.user.id, email })
		.eq('id', klient_id);
	if (linkErr) {
		// rollback konta, gdy nie udało się powiązać
		const { error: delErr } = await admin.auth.admin.deleteUser(userData.user.id);
		if (delErr) console.error(`portal: ROLLBACK nieudany — usuń ręcznie konto Auth ${userData.user.id}: ${delErr.message}`);
		throw error(500, linkErr.message);
	}

	return { mode: 'created', userId: userData.user.id };
}

// Odbiera dostęp: odpina konto od klienta i usuwa je — ale tylko jeśli to konto portalu tego klienta.
export async function revokePortalAccess(
	admin: SupabaseClient,
	profile: PortalProfile,
	klientId: string | undefined
): Promise<{ mode: 'noop' | 'revoked' }> {
	if (!klientId) throw error(400, 'Podaj klienta');

	const client = await loadOwnTenantClient(admin, profile, klientId);
	if (!client.auth_user_id) return { mode: 'noop' };

	const check = await assertOwnClientAccount(admin, client.auth_user_id, klientId);

	// Najpierw konto: gdy jego usunięcie się nie powiedzie, powiązanie zostaje i można ponowić
	// (inaczej zostałoby konto-sierota, którego kolejne kliknięcie już by nie znalazło).
	// Gdy konta już nie ma, wystarczy odpięcie powiązania.
	if (check === 'ok') {
		const { error: delErr } = await admin.auth.admin.deleteUser(client.auth_user_id);
		if (delErr) {
			console.error(`portal: nie udało się usunąć konta Auth ${client.auth_user_id}: ${delErr.message}`);
			throw error(502, 'Nie udało się usunąć konta logowania klienta. Spróbuj ponownie.');
		}
	}

	// Klucz obcy auth_user_id ma ON DELETE SET NULL, ale odpinamy jawnie — także gdy konta nie było.
	const { error: unlinkErr } = await admin.from('crm_clients').update({ auth_user_id: null }).eq('id', klientId);
	if (unlinkErr) throw error(500, unlinkErr.message);

	return { mode: 'revoked' };
}
