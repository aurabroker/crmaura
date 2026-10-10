// Webhook Resend → status dostarczenia e-maili do klientów (crm_client_emails: ręczne z CRM, przypomnienia
// o płatnościach, odnowienia). Każda firma ma własne konto Resend, więc i własny sekret podpisu
// (crm_tenants.resend_webhook_secret — czyta tylko serwer); adres webhooka zawiera id firmy:
// /api/webhooks/resend/<tenant_id>. Wiersz e-maila zmieniamy tylko w tej firmie i tylko po dostawca_id.
// Podpis w standardzie Svix: HMAC-SHA256 z „<svix-id>.<svix-timestamp>.<treść>”, klucz = base64 po „whsec_”.
import type { SupabaseClient } from '@supabase/supabase-js';
import { base64, bezAdresow } from './mail';

/** Ile sekund może się różnić czas zdarzenia od zegara serwera (ochrona przed powtórzeniem żądania). */
export const TOLERANCJA_S = 300;
export const SEKRET_RE = /^whsec_[A-Za-z0-9+/=]{16,200}$/;

export type StatusDostawy = 'wyslany' | 'opozniony' | 'dostarczony' | 'otwarty' | 'klikniety' | 'odbity' | 'spam' | 'blad';

const ZDARZENIA: Record<string, StatusDostawy> = {
	'email.sent': 'wyslany',
	'email.delivery_delayed': 'opozniony',
	'email.delivered': 'dostarczony',
	'email.opened': 'otwarty',
	'email.clicked': 'klikniety',
	'email.bounced': 'odbity',
	'email.complained': 'spam',
	'email.failed': 'blad'
};
/** Kolejność postępu; odbicie, spam i błąd są końcowe i zastępują każdy wcześniejszy stan. */
const RANGA: Record<StatusDostawy, number> = { wyslany: 1, opozniony: 2, dostarczony: 3, otwarty: 4, klikniety: 5, odbity: 10, spam: 10, blad: 10 };
const KONCOWY = (s: StatusDostawy | null | undefined) => !!s && RANGA[s] >= 10;

function zBase64(t: string): Uint8Array<ArrayBuffer> | null {
	try {
		const bin = atob(t);
		const b = new Uint8Array(new ArrayBuffer(bin.length));
		for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
		return b;
	} catch {
		return null;
	}
}

/** Porównanie w stałym czasie (długość podpisu nie jest tajemnicą). */
function rowne(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

export async function sprawdzPodpis(
	sekret: string,
	n: { id: string | null; czas: string | null; podpis: string | null },
	tresc: string,
	teraz = Date.now()
): Promise<boolean> {
	if (!n.id || !n.czas || !n.podpis || !SEKRET_RE.test(sekret)) return false;
	const czas = Number(n.czas);
	if (!Number.isFinite(czas) || Math.abs(teraz / 1000 - czas) > TOLERANCJA_S) return false;
	const klucz = zBase64(sekret.slice('whsec_'.length));
	if (!klucz?.length) return false;
	const k = await crypto.subtle.importKey('raw', klucz, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const oczekiwany = base64(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${n.id}.${n.czas}.${tresc}`)));
	// Nagłówek może mieć kilka podpisów (rotacja sekretu): „v1,abc v1,def”.
	return n.podpis.split(' ').some((p) => {
		const [wersja, wartosc] = p.split(',');
		return wersja === 'v1' && !!wartosc && rowne(wartosc, oczekiwany);
	});
}

export type ZdarzenieResend = { type?: unknown; created_at?: unknown; data?: Record<string, unknown> | null };
type WierszEmaila = { id: string; dostawa: StatusDostawy | null; otwarto_at: string | null };

/** Nowy stan wiersza po zdarzeniu albo null, gdy zdarzenie niczego nie zmienia (np. „wysłany” po „dostarczonym”). */
export function nowyStan(w: Pick<WierszEmaila, 'dostawa' | 'otwarto_at'>, status: StatusDostawy, kiedy: string, blad: string | null) {
	const zmiany: Record<string, unknown> = {};
	if ((status === 'otwarty' || status === 'klikniety') && !w.otwarto_at) zmiany.otwarto_at = kiedy;
	const awans = KONCOWY(status) ? w.dostawa !== status : !KONCOWY(w.dostawa) && RANGA[status] > (w.dostawa ? RANGA[w.dostawa] : 0);
	if (awans) {
		zmiany.dostawa = status;
		zmiany.dostawa_at = kiedy;
		if (KONCOWY(status)) zmiany.dostawa_blad = blad;
	}
	return Object.keys(zmiany).length ? zmiany : null;
}

function opisBledu(status: StatusDostawy, d: Record<string, unknown>): string | null {
	const zagniezdzone = (k: string) => (d[k] && typeof d[k] === 'object' ? (d[k] as Record<string, unknown>) : null);
	if (status === 'odbity') {
		const b = zagniezdzone('bounce');
		const t = [b?.subType, b?.message].filter((x) => typeof x === 'string' && x).join(': ');
		return t ? bezAdresow(t) : 'Serwer odbiorcy odrzucił wiadomość.';
	}
	if (status === 'spam') return 'Odbiorca oznaczył wiadomość jako spam.';
	if (status === 'blad') {
		const f = zagniezdzone('failed');
		return typeof f?.reason === 'string' && f.reason ? bezAdresow(f.reason) : 'Resend nie wysłał wiadomości.';
	}
	return null;
}

/** Zapisuje zdarzenie w e-mailach firmy. Zwraca liczbę zmienionych wierszy (0 — nieznany e-mail albo bez zmian). */
export async function zastosujZdarzenie(admin: SupabaseClient, tenantId: string, z: ZdarzenieResend): Promise<number> {
	const status = typeof z.type === 'string' ? ZDARZENIA[z.type] : undefined;
	const d = z.data && typeof z.data === 'object' ? z.data : null;
	const emailId = typeof d?.email_id === 'string' ? d.email_id : null;
	if (!status || !d || !emailId || emailId.length > 100) return 0;
	const kiedyRaw = typeof z.created_at === 'string' ? Date.parse(z.created_at) : NaN;
	const kiedy = new Date(Number.isFinite(kiedyRaw) ? kiedyRaw : Date.now()).toISOString();

	const { data } = await admin
		.from('crm_client_emails')
		.select('id, dostawa, otwarto_at')
		.eq('tenant_id', tenantId)
		.eq('dostawca_id', emailId);
	let zmienione = 0;
	for (const w of (data ?? []) as WierszEmaila[]) {
		const zmiany = nowyStan(w, status, kiedy, opisBledu(status, d));
		if (!zmiany) continue;
		const { error } = await admin.from('crm_client_emails').update(zmiany).eq('id', w.id).eq('tenant_id', tenantId);
		if (error) console.error('webhook resend: zapis statusu:', error.message);
		else zmienione++;
	}
	return zmienione;
}
