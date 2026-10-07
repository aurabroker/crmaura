// Wysyłka e-maili przez Resend kluczem firmy (crm_tenants.resend_api_key — czyta go tylko serwer).

export type Zalacznik = { filename: string; content: string /* base64 */ };

export type Wiadomosc = {
	from: string;
	to: string[];
	replyTo?: string;
	subject: string;
	html: string;
	text: string;
	attachments?: Zalacznik[];
};

export type WynikWysylki = { ok: true } | { ok: false; status: number; blad: string };

export function esc(v: unknown): string {
	return String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// Odpowiedź dostawcy do logów: bez adresów e-mail.
export const bezAdresow = (t: string) => t.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, '[adres]').slice(0, 300);

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"']+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/i;

export async function wyslijEmail(apiKey: string, w: Wiadomosc): Promise<WynikWysylki> {
	try {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				from: w.from,
				to: w.to,
				...(w.replyTo ? { reply_to: w.replyTo } : {}),
				subject: w.subject,
				html: w.html,
				text: w.text,
				...(w.attachments?.length ? { attachments: w.attachments } : {})
			})
		});
		if (res.ok) return { ok: true };
		return { ok: false, status: res.status, blad: bezAdresow(await res.text()) };
	} catch (e) {
		return { ok: false, status: 0, blad: bezAdresow(String(e)) };
	}
}

export function base64(bytes: ArrayBuffer | Uint8Array): string {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let bin = '';
	for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
	return btoa(bin);
}
