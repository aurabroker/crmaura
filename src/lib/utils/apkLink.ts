// Publiczny formularz APK to trasa /form tej aplikacji (portal.beautypolisa.eu).
// Adres można nadpisać zmienną VITE_APK_FORM_URL, np. na środowisku testowym.
const fromEnv = (import.meta.env.VITE_APK_FORM_URL as string | undefined)?.trim().replace(/\/$/, '');

export const APK_FORM_URL: string = fromEnv || 'https://portal.beautypolisa.eu/form';

export function apkTokenLink(token: string): string {
	return `${APK_FORM_URL}?token=${encodeURIComponent(token)}`;
}

// Link do otwarcia formularza istnieje tylko dla tokenu, który nie został jeszcze użyty.
// Formularz bez tokenu (odmowa klienta) albo już złożony oglądamy jako PDF.
export function apkOpenLink(f: { apk_tokens?: { token?: string; status: string }[] | null }): string | null {
	const t = f.apk_tokens?.find((x) => x.token && x.status !== 'used');
	return t?.token ? apkTokenLink(t.token) : null;
}
