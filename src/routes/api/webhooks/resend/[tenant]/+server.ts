import { json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { sprawdzPodpis, zastosujZdarzenie, type ZdarzenieResend } from '$lib/server/resendWebhook';
import type { RequestHandler } from './$types';

// Webhook Resend firmy (adres i sekret podpisu wpisuje się w Resend → Webhooks, sekret w SAAS Admin).
// Bez ważnego podpisu nic nie zapisujemy. Na nieznany e-mail odpowiadamy 200 — Resend nie ponawia.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAKS_TRESCI = 256 * 1024;

export const POST: RequestHandler = async ({ request, params }) => {
	if (!UUID.test(params.tenant)) return new Response('nieznana firma', { status: 404 });
	if (Number(request.headers.get('content-length') ?? 0) > MAKS_TRESCI) return new Response('za duże', { status: 413 });
	const tresc = await request.text();
	if (tresc.length > MAKS_TRESCI) return new Response('za duże', { status: 413 });

	const admin = getAdminClient();
	const { data: firma } = await admin.from('crm_tenants').select('resend_webhook_secret').eq('id', params.tenant).maybeSingle();
	const sekret = (firma as { resend_webhook_secret: string | null } | null)?.resend_webhook_secret;
	// Brak firmy i brak sekretu dają tę samą odpowiedź co zły podpis.
	const ok = !!sekret && (await sprawdzPodpis(sekret, {
		id: request.headers.get('svix-id'),
		czas: request.headers.get('svix-timestamp'),
		podpis: request.headers.get('svix-signature')
	}, tresc));
	if (!ok) return new Response('zły podpis', { status: 401 });

	let zdarzenie: ZdarzenieResend;
	try {
		zdarzenie = JSON.parse(tresc) as ZdarzenieResend;
	} catch {
		return new Response('zły JSON', { status: 400 });
	}
	const zmienione = await zastosujZdarzenie(admin, params.tenant, zdarzenie);
	return json({ ok: true, zmienione });
};
