// Krótki link do wniosku (APK i wniosek o odnowienie albo o pierwszą polisę) i SMS z nim.
// Moduł bez importów $lib — używają go serwer (nadanie kodu, trasa /w/[kod]) i karty CRM (treść SMS-a).

// Kod krótkiego linku: 10 znaków z alfabetu bez znaków mylących (0/O, 1/l/I) — 56 znaków, ok. 58 bitów
// losowości. Kod działa tylko jako przekierowanie na pełny link z podpisem, więc wniosek wygasły albo
// anulowany pokazuje klientowi ten sam komunikat co pełny link.
export const KOD_ALFABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const KOD_DLUGOSC = 10;
export const KOD_RE = /^[a-km-np-zA-HJ-NP-Z2-9]{10}$/;

export function losowyKod(): string {
	const out: string[] = [];
	// Odrzucamy bajty ≥ 224 (4 × 56), żeby każdy znak był równie prawdopodobny.
	while (out.length < KOD_DLUGOSC) {
		for (const b of crypto.getRandomValues(new Uint8Array(KOD_DLUGOSC * 2))) {
			if (b < 224 && out.length < KOD_DLUGOSC) out.push(KOD_ALFABET[b % 56]);
		}
	}
	return out.join('');
}

// Numer do SMS-a: same cyfry z „+”; 9 cyfr to numer polski (+48). null, gdy numeru nie da się użyć.
export function numerSms(telefon: string | null | undefined): string | null {
	const t = String(telefon ?? '').trim();
	const plus = t.startsWith('+') || t.startsWith('00');
	const cyfry = t.replace(/\D/g, '').replace(/^00/, '');
	if (cyfry.length === 9 && !plus) return `+48${cyfry}`;
	if (cyfry.length === 11 && cyfry.startsWith('48')) return `+${cyfry}`;
	if (plus && cyfry.length >= 8 && cyfry.length <= 15) return `+${cyfry}`;
	return null;
}

const dataPl = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

// Treść SMS-a bez polskich znaków: zostaje w jednym SMS-ie (160 znaków), a z „ą”, „ę”… limit spada do 70.
export function trescSms(krotkiLink: string, o: { nowa: boolean; waznyDo?: string | null }): string {
	const co = o.nowa ? 'analiza potrzeb i wniosek o ubezpieczenie OC gabinetu' : 'wniosek o odnowienie ubezpieczenia OC gabinetu';
	const waznosc = o.waznyDo ? ` (wazny do ${dataPl(o.waznyDo)})` : '';
	return `Beauty Polisa: ${co}: ${krotkiLink}${waznosc}. Aura Expert`;
}

// Liczba SMS-ów: alfabet GSM (bez polskich znaków) 160 znaków w jednym, 153 w każdym przy dłuższej treści;
// z polskimi znakami 70 / 67.
export function liczbaSms(tresc: string): number {
	const gsm = /^[\x20-\x7E\n]*$/.test(tresc) && !/[[\]{}\\^~|]/.test(tresc);
	const [jeden, czesc] = gsm ? [160, 153] : [70, 67];
	return tresc.length <= jeden ? 1 : Math.ceil(tresc.length / czesc);
}

// Link otwierający aplikację SMS z numerem i treścią („?&body=” działa na Androidzie i iPhonie).
export const hrefSms = (numer: string, tresc: string) => `sms:${numer}?&body=${encodeURIComponent(tresc)}`;
