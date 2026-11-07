// Wysyłka SMS-ów przez SMSAPI (api.smsapi.pl) tokenem firmy (crm_tenants.smsapi_token — czyta go tylko serwer).
// Dokumentacja: https://www.smsapi.pl/docs — POST /sms.do, autoryzacja nagłówkiem Bearer, odpowiedź JSON.

export type WynikSms = { ok: true; id: string | null; punkty: number | null } | { ok: false; status: number; blad: string };

// Kody błędów SMSAPI, które pracownik może sam naprawić (reszta: komunikat z SMSAPI).
const BLEDY: Record<number, string> = {
	13: 'Nieprawidłowy numer telefonu odbiorcy.',
	14: 'Pole nadawcy nie jest zarejestrowane w SMSAPI — popraw je w SAAS Admin albo zostaw puste.',
	101: 'Nieprawidłowy token SMSAPI — wpisz nowy w SAAS Admin.',
	102: 'Nieprawidłowy token SMSAPI — wpisz nowy w SAAS Admin.',
	103: 'Brak środków na koncie SMSAPI.',
	105: 'Adres serwera nie jest dopuszczony w ustawieniach SMSAPI (filtr IP).',
	123: 'Token SMSAPI nie ma uprawnienia do wysyłki SMS-ów.'
};

export async function wyslijSms(token: string, o: { numer: string; tresc: string; nadawca?: string | null }): Promise<WynikSms> {
	const body = new URLSearchParams({ to: o.numer.replace(/^\+/, ''), message: o.tresc, format: 'json', encoding: 'utf-8' });
	if (o.nadawca) body.set('from', o.nadawca);
	let res: Response;
	try {
		res = await fetch('https://api.smsapi.pl/sms.do', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
			body
		});
	} catch {
		return { ok: false, status: 0, blad: 'Brak połączenia z SMSAPI. Spróbuj ponownie.' };
	}
	const d = (await res.json().catch(() => null)) as {
		error?: number;
		message?: string;
		list?: { id?: string; points?: number }[];
	} | null;
	if (!res.ok || !d || d.error) {
		const kod = Number(d?.error ?? 0);
		const blad = BLEDY[kod] ?? `SMSAPI odrzuciło wysyłkę${kod ? ` (kod ${kod})` : ` (HTTP ${res.status})`}${d?.message ? `: ${String(d.message).slice(0, 200)}` : ''}.`;
		return { ok: false, status: kod === 101 || kod === 102 || kod === 123 ? 401 : kod === 103 ? 402 : res.ok ? 422 : res.status, blad };
	}
	const pierwszy = d.list?.[0];
	return { ok: true, id: pierwszy?.id ?? null, punkty: typeof pierwszy?.points === 'number' ? pierwszy.points : null };
}
