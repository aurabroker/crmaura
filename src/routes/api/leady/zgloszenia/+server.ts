import { error, json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { przyjmijZgloszenia, wierszeZTresci, ZlyKlucz } from '$lib/server/zgloszenia';
import type { RequestHandler } from './$types';

// Zgłoszenia z formularza wysyłane przez Apps Script arkusza (nagłówek x-api-key = klucz z Ustawień → System).
// Treść: obiekt albo tablica (do 200) { company, contact, email, phone, nip, ubezpieczenie, przychod, ref, data, historyczne }.
// Odpowiedź: liczniki i wynik każdego wiersza (nowe / ponowne / historyczne / duplikat / pominiete).
const MAKS_BAJTOW = 512 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const klucz = request.headers.get('x-api-key')?.trim();
	if (!klucz) throw error(401, 'Brak klucza integracji (nagłówek x-api-key)');
	const surowe = await request.text();
	if (surowe.length > MAKS_BAJTOW) throw error(413, 'Za duża paczka — wysyłaj do 200 wierszy naraz');
	let tresc: unknown;
	try {
		tresc = JSON.parse(surowe);
	} catch {
		throw error(400, 'Treść nie jest poprawnym JSON');
	}
	const wiersze = wierszeZTresci(tresc);
	if (!wiersze) throw error(400, 'Oczekiwany obiekt zgłoszenia albo tablica do 200 zgłoszeń');

	try {
		const wynik = await przyjmijZgloszenia(getAdminClient(), klucz, wiersze);
		return json({ success: true, ...wynik });
	} catch (e) {
		if (e instanceof ZlyKlucz) throw error(401, e.message);
		console.error('Przyjęcie zgłoszeń:', (e as Error).message);
		throw error(500, 'Nie udało się zapisać zgłoszeń');
	}
};
