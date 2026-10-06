import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

// Konto Auth jest wspólne dla wielu aplikacji, a crm_clients.auth_user_id może zapisać każdy
// użytkownik firmy. Zanim więc zmienimy hasło/e-mail albo usuniemy konto wskazane tą kolumną,
// sprawdzamy, że to naprawdę konto portalu TEGO klienta: założone przez /api/portal/access
// (metadane rola=KLIENT i klient_id) i niebędące kontem pracownika.
// Bez tego wpisanie cudzego UUID w auth_user_id pozwalałoby przejąć lub skasować dowolne konto.
export async function assertOwnClientAccount(admin: SupabaseClient, authUserId: string, klientId: string) {
	const { data, error: gErr } = await admin.auth.admin.getUserById(authUserId);
	if (gErr || !data?.user) {
		throw error(409, 'Konto powiązane z klientem nie istnieje. Odpięcie wymaga interwencji administratora.');
	}

	const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
	if (meta.rola !== 'KLIENT' || meta.klient_id !== klientId) {
		throw error(403, 'To konto nie jest kontem portalu tego klienta.');
	}

	const { data: staff } = await admin.from('crm_profiles').select('id').eq('id', authUserId).maybeSingle();
	if (staff) throw error(403, 'To konto nie jest kontem portalu tego klienta.');
}
