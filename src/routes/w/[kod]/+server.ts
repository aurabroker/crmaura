import { getAdminClient } from '$lib/server/auth';
import { kluczDla } from '$lib/server/renewals';
import { KOD_RE } from '$lib/renewals/sms';
import type { RequestHandler } from './$types';

// Krótki link z SMS-a: /w/<kod> → pełny link do wniosku (/odnowienie/<id>.<podpis>) w tej samej domenie.
// Stan wniosku (aktywny, złożony, wygasły, anulowany) pokazuje już strona wniosku — tu tylko przekierowanie.
// Nieznany kod dostaje krótką stronę z kontaktem, bez zdradzania, czy taki wniosek kiedykolwiek był.
const NAGLOWKI = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' };

const nieznany = () =>
	new Response(
		`<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link nieaktualny</title></head>` +
			`<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f6f8;color:#334155;">` +
			`<main style="max-width:480px;margin:48px auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">` +
			`<h1 style="margin:0 0 12px;font-size:20px;color:#2a3b69;">Ten link jest nieprawidłowy</h1>` +
			`<p style="margin:0 0 8px;line-height:1.6;">Sprawdź, czy adres z wiadomości został przepisany w całości. Jeśli link wygasł, napisz do nas — przygotujemy nowy.</p>` +
			`<p style="margin:0;"><a href="mailto:odnowienia@auraexpert.pl" style="color:#e11d48;font-weight:600;">odnowienia@auraexpert.pl</a></p>` +
			`</main></body></html>`,
		{ status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...NAGLOWKI } }
	);

export const GET: RequestHandler = async ({ params }) => {
	const kod = params.kod ?? '';
	if (!KOD_RE.test(kod)) return nieznany();
	const { data } = await getAdminClient().from('crm_renewals').select('id').eq('kod_krotki', kod).maybeSingle();
	if (!data) return nieznany();
	return new Response(null, { status: 302, headers: { location: `/odnowienie/${await kluczDla(data.id)}`, ...NAGLOWKI } });
};
