import type { SupabaseClient } from '@supabase/supabase-js';
import { WERSJA_ZGOD, ZGODY, type Zgody } from '$lib/renewals/zgody';
import type { Klient, RenewalRow } from '$lib/server/renewals';

// Rejestr zgód marketingowych (crm_zgody) i stan bieżący na kliencie (crm_clients.zgoda_*).
// Każde podpisanie APK zapisuje odpowiedź na każdą zgodę (także „nie”) z dokładnym brzmieniem, IP i przeglądarką;
// odznaczona zgoda, która wcześniej była udzielona, to jej wycofanie — stan na kliencie zawsze odzwierciedla
// ostatnią odpowiedź. Błąd zapisu nie przerywa obsługi APK (trafia do dziennika serwera).

export async function zapiszZgody(admin: SupabaseClient, r: Pick<RenewalRow, 'id' | 'tenant_id' | 'klient_id'>, zgody: Zgody, kto: Klient, at: string) {
	const { error: e1 } = await admin.from('crm_zgody').insert(
		ZGODY.map((z) => ({
			tenant_id: r.tenant_id,
			klient_id: r.klient_id,
			kanal: z.kanal,
			zgoda: zgody[z.kanal],
			tresc: z.tresc,
			wersja: WERSJA_ZGOD,
			zrodlo: 'odnowienie',
			renewal_id: r.id,
			podpisany: true,
			ip: kto.ip,
			user_agent: kto.ua?.slice(0, 400) ?? null,
			at
		}))
	);
	if (e1) console.error('renewals: rejestr zgód:', e1.message);
	const { error: e2 } = await admin
		.from('crm_clients')
		.update({ zgoda_email: zgody.email, zgoda_email_at: at, zgoda_sms: zgody.sms, zgoda_sms_at: at })
		.eq('id', r.klient_id)
		.eq('tenant_id', r.tenant_id);
	if (e2) console.error('renewals: zgody na kliencie:', e2.message);
}
