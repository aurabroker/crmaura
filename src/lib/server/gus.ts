// Rejestr REGON (GUS, usługa BIR 1.1): logowanie kluczem z GUS_API_KEY i wyszukanie podmiotu po NIP albo REGON.
// Wspólne dla szukania przy dodawaniu klienta (/api/regon/lookup) i zbiorowego uzupełniania danych klientów.

const BIR_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const NS = 'xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07" xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract"';

export type PodmiotGus = {
	nazwa: string;
	nip: string | null;
	regon: string | null;
	/** P — osoba prawna albo jednostka organizacyjna, F — osoba fizyczna prowadząca działalność */
	typ: string | null;
	wojewodztwo: string | null;
	powiat: string | null;
	gmina: string | null;
	miejscowosc: string | null;
	kod: string | null;
	ulica: string | null;
	nr: string | null;
	lokal: string | null;
	miejscowoscPoczty: string | null;
	/** Data zakończenia działalności (firma wykreślona) — pusta, gdy działa. */
	dataZakonczenia: string | null;
	statusNip: string | null;
	adres: string | null;
};

async function soap(action: string, body: string, sid?: string): Promise<string> {
	const res = await fetch(BIR_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', ...(sid ? { sid } : {}) },
		body: `<soap:Envelope ${NS}><soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${BIR_URL}</wsa:To><wsa:Action>${action}</wsa:Action></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`
	});
	if (!res.ok) throw new Error(`GUS HTTP ${res.status}`);
	return res.text();
}

export function wyciagnij(xml: string, tag: string): string | null {
	const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	const v = m ? m[1].trim() : null;
	return v ? v : null;
}

const odkoduj = (t: string) => t.replace(/&#x[dD];/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export const czystyNip = (raw: string | null | undefined) => String(raw ?? '').replace(/[^0-9]/g, '');

export function poprawnyNip(raw: string | null | undefined): boolean {
	const nip = czystyNip(raw);
	if (nip.length !== 10) return false;
	const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
	const suma = wagi.reduce((s, w, i) => s + w * Number(nip[i]), 0);
	return suma % 11 === Number(nip[9]);
}

export function poprawnyRegon(raw: string | null | undefined): boolean {
	const r = String(raw ?? '').replace(/[^0-9]/g, '');
	return r.length === 9 || r.length === 14;
}

/** Adres w formacie CRM: „ul. Długa 5/2, 99-300 Kutno” (bez ulicy: „Wola 12, 05-620 Błędów”). */
export function adresZGus(p: Pick<PodmiotGus, 'ulica' | 'nr' | 'lokal' | 'miejscowosc' | 'kod' | 'miejscowoscPoczty'>): string | null {
	const numer = [p.nr, p.lokal ? `/${p.lokal}` : ''].filter(Boolean).join('');
	const poczta = p.miejscowoscPoczty || p.miejscowosc;
	const pierwsza = p.ulica ? [p.ulica, numer].filter(Boolean).join(' ') : [p.miejscowosc !== poczta ? p.miejscowosc : '', numer].filter(Boolean).join(' ');
	const druga = [p.kod, poczta].filter(Boolean).join(' ');
	const adres = [pierwsza, druga].filter(Boolean).join(', ').trim();
	return adres || null;
}

/** Pierwszy podmiot z odpowiedzi DaneSzukajPodmioty (XML zakodowany w XML) albo null, gdy GUS go nie zna. */
export function podmiotZOdpowiedzi(xml: string): PodmiotGus | null {
	const surowe = wyciagnij(xml, 'DaneSzukajPodmiotyResult');
	if (!surowe) return null;
	const dane = odkoduj(surowe);
	const pierwszy = wyciagnij(dane, 'dane') ?? dane;
	const nazwa = wyciagnij(pierwszy, 'Nazwa');
	if (!nazwa) return null;
	const p: PodmiotGus = {
		nazwa: odkoduj(nazwa),
		nip: wyciagnij(pierwszy, 'Nip'),
		regon: wyciagnij(pierwszy, 'Regon'),
		typ: wyciagnij(pierwszy, 'Typ'),
		wojewodztwo: wyciagnij(pierwszy, 'Wojewodztwo'),
		powiat: wyciagnij(pierwszy, 'Powiat'),
		gmina: wyciagnij(pierwszy, 'Gmina'),
		miejscowosc: wyciagnij(pierwszy, 'Miejscowosc'),
		kod: wyciagnij(pierwszy, 'KodPocztowy'),
		ulica: wyciagnij(pierwszy, 'Ulica'),
		nr: wyciagnij(pierwszy, 'NrNieruchomosci'),
		lokal: wyciagnij(pierwszy, 'NrLokalu'),
		miejscowoscPoczty: wyciagnij(pierwszy, 'MiejscowoscPoczty'),
		dataZakonczenia: wyciagnij(pierwszy, 'DataZakonczeniaDzialalnosci'),
		statusNip: wyciagnij(pierwszy, 'StatusNip'),
		adres: null
	};
	p.adres = adresZGus(p);
	return p;
}

/** Sesja BIR (ważna ok. 60 min). Null — GUS odrzucił klucz albo nie odpowiedział sensownie. */
export async function zalogujGus(klucz: string): Promise<string | null> {
	const xml = await soap(
		'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj',
		`<ns:Zaloguj><ns:pKluczUzytkownika>${klucz}</ns:pKluczUzytkownika></ns:Zaloguj>`
	);
	return wyciagnij(xml, 'ZalogujResult');
}

export type SzukajGus = (k: { nip?: string; regon?: string }) => Promise<PodmiotGus | null>;

/** Funkcja wyszukiwania w ramach jednej sesji. Błąd sieci albo GUS — wyjątek (wywołujący decyduje, co dalej). */
export function szukajWGus(sid: string): SzukajGus {
	return async (k) => {
		const parametr = k.nip ? `<dat:Nip>${czystyNip(k.nip)}</dat:Nip>` : `<dat:Regon>${String(k.regon ?? '').replace(/[^0-9]/g, '')}</dat:Regon>`;
		const xml = await soap(
			'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty',
			`<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania>${parametr}</ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
			sid
		);
		return podmiotZOdpowiedzi(xml);
	};
}
