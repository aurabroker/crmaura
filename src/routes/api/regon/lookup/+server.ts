import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { env } from '$env/dynamic/private';
const GUS_API_KEY = env.GUS_API_KEY ?? '';
import type { RequestHandler } from './$types';

const BIR_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const NS = 'xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07" xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract"';

async function soap(action: string, body: string, sid?: string): Promise<string> {
	const res = await fetch(BIR_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/soap+xml; charset=utf-8',
			...(sid ? { sid } : {})
		},
		body: `<soap:Envelope ${NS}><soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${BIR_URL}</wsa:To><wsa:Action>${action}</wsa:Action></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`
	});
	return res.text();
}

function extract(xml: string, tag: string): string | null {
	const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	return m ? m[1].trim() : null;
}

function cleanNip(raw: string): string {
	return raw.replace(/[^0-9]/g, '');
}

function isValidNip(raw: string): boolean {
	const nip = cleanNip(raw);
	if (nip.length !== 10) return false;
	const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
	const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
	return sum % 11 === Number(nip[9]);
}

function isValidRegon(raw: string): boolean {
	const r = raw.replace(/[^0-9]/g, '');
	return r.length === 9 || r.length === 14;
}

export const GET: RequestHandler = async ({ request, url }) => {
	await requireAuth(request);

	if (!GUS_API_KEY) {
		return json({ available: false, reason: 'no_key' });
	}

	const nipRaw = url.searchParams.get('nip') ?? '';
	const regonRaw = url.searchParams.get('regon') ?? '';

	let searchParam: string;
	if (nipRaw) {
		const nip = cleanNip(nipRaw);
		if (!isValidNip(nipRaw)) throw error(400, { message: 'Nieprawidłowy NIP' });
		searchParam = `<dat:Nip>${nip}</dat:Nip>`;
	} else if (regonRaw) {
		const regon = regonRaw.replace(/[^0-9]/g, '');
		if (!isValidRegon(regonRaw)) throw error(400, { message: 'Nieprawidłowy REGON' });
		searchParam = `<dat:Regon>${regon}</dat:Regon>`;
	} else {
		throw error(400, { message: 'Podaj NIP lub REGON' });
	}

	try {
		const loginXml = await soap(
			'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj',
			`<ns:Zaloguj><ns:pKluczUzytkownika>${GUS_API_KEY}</ns:pKluczUzytkownika></ns:Zaloguj>`
		);
		const sid = extract(loginXml, 'ZalogujResult');
		if (!sid) return json({ found: false });

		const searchXml = await soap(
			'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty',
			`<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania>${searchParam}</ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
			sid
		);

		const raw = extract(searchXml, 'DaneSzukajPodmiotyResult');
		if (!raw) return json({ found: false });

		const decoded = raw
			.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

		const nazwa = extract(decoded, 'Nazwa');
		if (!nazwa) return json({ found: false });

		const regon = extract(decoded, 'Regon');
		const nip = extract(decoded, 'Nip');
		const ulica = extract(decoded, 'Ulica') ?? '';
		const nrNieruchomosci = extract(decoded, 'NrNieruchomosci') ?? '';
		const nrLokalu = extract(decoded, 'NrLokalu') ?? '';
		const miejscowosc = extract(decoded, 'Miejscowosc') ?? '';
		const kod = extract(decoded, 'KodPocztowy') ?? '';
		const dataZawieszenia = extract(decoded, 'DataZawieszeniaDzialalnosci');

		const numerStr = [nrNieruchomosci, nrLokalu ? `/${nrLokalu}` : ''].filter(Boolean).join('');
		const adres = [ulica, numerStr].filter(Boolean).join(' ') +
			(miejscowosc ? `, ${kod} ${miejscowosc}` : '');

		return json({
			found: true,
			nazwa,
			nip: nip || null,
			regon: regon || null,
			adres: adres.trim() || null,
			data_zawieszenia: dataZawieszenia || null
		});
	} catch (err) {
		console.error('GUS API error:', err);
		return json({ found: false, error: 'gus_error' });
	}
};
