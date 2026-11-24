// Adres CRM firmy (crm_tenants.adres_crm), np. https://crm2.auraconsulting.pl dla Aura Consulting: linki wysyłane
// klientom (formularz APK, wniosek o pierwszą polisę i odnowienie, krótki link do SMS-a) i linki w codziennym
// podsumowaniu dla pracowników prowadzą na domenę firmy — niezależnie od adresu, pod którym pracownik się zalogował.
// Bez ustawienia — jak dotąd: portal Beauty Polisa, gdy żądanie przyszło na *.pages.dev, inaczej adres żądania.

export const PORTAL_BEAUTY = 'https://portal.beautypolisa.eu';

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Zapis z panelu SaaS: „crm2.auraconsulting.pl”, „https://crm2.auraconsulting.pl/” albo z dowolną ścieżką
 * → „https://crm2.auraconsulting.pl”. Pusty → null. Zły adres (nie https, IP, port, bez kropki) → wyjątek.
 */
export function normalizujAdresCrm(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v !== 'string') throw new Error('Adres CRM musi być tekstem.');
	const t = v.trim();
	if (!t) return null;
	let u: URL;
	try {
		u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
	} catch {
		throw new Error('Nieprawidłowy adres CRM — podaj domenę, np. crm2.auraconsulting.pl.');
	}
	if (u.protocol !== 'https:') throw new Error('Adres CRM musi zaczynać się od https://.');
	if (u.port || u.username || u.password) throw new Error('Adres CRM bez portu i danych logowania — sama domena.');
	const host = u.hostname.toLowerCase();
	if (!HOST.test(host)) throw new Error('Nieprawidłowy adres CRM — podaj domenę, np. crm2.auraconsulting.pl.');
	return `https://${host}`;
}

/** Baza linków dla klientów: adres firmy, a bez niego portal (wywołania na *.pages.dev) albo adres żądania. */
export function adresLinkow(adresFirmy: string | null | undefined, url: URL): string {
	const a = adresFirmy?.trim().replace(/\/+$/, '');
	if (a) return a;
	return url.hostname.endsWith('.pages.dev') ? PORTAL_BEAUTY : url.origin;
}
