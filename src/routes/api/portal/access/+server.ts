import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { grantPortalAccess, revokePortalAccess } from '$lib/server/portal';
import type { RequestHandler } from './$types';

// Konta klienckie powstają w Supabase Auth i są wiązane z crm_clients.auth_user_id.
// Dostęp do polis/płatności/szkód ogranicza RLS (polityki *_client_select).
// Konto dostaje znacznik app_metadata.portal_klient_id (zapisuje go tylko serwer), po którym
// assertOwnClientAccount rozpoznaje, że to konto portalu tego klienta. Cała logika jest w
// $lib/server/portal.ts, żeby dało się ją przetestować bez prawdziwego Supabase.

// POST: utwórz konto klienta lub ustaw nowe hasło istniejącemu kontu.
export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as { klient_id?: string; email?: string; password?: string } | null;
	const r = await grantPortalAccess(admin, profile, body ?? {});
	return json({ success: true, ...r });
};

// DELETE: odbierz dostęp (usuń konto auth i odepnij od klienta).
export const DELETE: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as { klient_id?: string } | null;
	const r = await revokePortalAccess(admin, profile, body?.klient_id);
	return json({ success: true, ...r });
};
