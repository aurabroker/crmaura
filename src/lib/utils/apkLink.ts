// Publiczny formularz APK to trasa /form tej aplikacji (portal.beautypolisa.eu).
// Adres można nadpisać zmienną VITE_APK_FORM_URL, np. na środowisku testowym.
const fromEnv = (import.meta.env.VITE_APK_FORM_URL as string | undefined)?.trim().replace(/\/$/, '');

export const APK_FORM_URL: string = fromEnv || 'https://portal.beautypolisa.eu/form';

// Zapytanie o formularze APK razem z kartą klienta i tokenami. Jedno miejsce, bo każde
// odświeżenie listy, które pominie tokeny, odbiera przyciskom „Otwórz” i „Link” podstawę.
export const APK_FORMS_SELECT =
	'*, crm_clients(nazwa, nazwa_skrocona), apk_tokens(token, status, used_at, expires_at)';

type TokenRow = { token?: string; status: string; expires_at?: string | null };
type FormWithTokens = { apk_tokens?: TokenRow[] | null };

// Token otwiera klientowi formularz APK z jego danymi, więc musi być nie do odgadnięcia:
// 12 znaków A–Z0–9 z kryptograficznego generatora (bez przesunięcia rozkładu).
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function newApkToken(length = 12): string {
	const out: string[] = [];
	const buf = new Uint8Array(32);
	while (out.length < length) {
		crypto.getRandomValues(buf);
		for (const b of buf) {
			if (b < 252 && out.length < length) out.push(TOKEN_ALPHABET[b % 36]);
		}
	}
	return out.join('');
}

export function apkTokenLink(token: string): string {
	return `${APK_FORM_URL}?token=${encodeURIComponent(token)}`;
}

function isLive(t: TokenRow): boolean {
	if (!t.token || t.status === 'used') return false;
	return !t.expires_at || new Date(t.expires_at) > new Date();
}

// Link do otwarcia formularza istnieje tylko dla tokenu, który nie jest użyty ani wygasły.
// Formularz bez takiego tokenu (odmowa klienta, już złożony) oglądamy jako PDF.
export function apkOpenLink(f: FormWithTokens): string | null {
	const t = f.apk_tokens?.find(isLive);
	return t?.token ? apkTokenLink(t.token) : null;
}

// Link do skopiowania: preferuje token, który jeszcze działa, a gdy takiego nie ma,
// pokazuje pierwszy znany (strona formularza wyjaśni wtedy klientowi, co się stało).
export function apkCopyLink(f: FormWithTokens): string | null {
	const t = f.apk_tokens?.find(isLive) ?? f.apk_tokens?.find((x) => x.token);
	return t?.token ? apkTokenLink(t.token) : null;
}
