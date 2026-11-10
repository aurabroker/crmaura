// Pobieranie plików na dysk pod czytelną nazwą — przycisk „Pobierz” przy plikach w CRM i w portalu klienta
// (komponent PobierzPlik). Otwieranie w nowej karcie zostaje osobną akcją („Otwórz”).

const ROZSZERZENIE = /\.[A-Za-z0-9]{1,8}$/;
const MAKS_NAZWA = 180;

/** Numer albo nazwa do wstawienia w nazwę pliku: ukośniki (np. w numerze polisy) zamienione na myślniki. */
export const bezUkosnikow = (tekst: string | null | undefined): string => String(tekst ?? '').replace(/\s*[\\/]+\s*/g, '-').trim();

/**
 * Nazwa do zapisania pliku: sama nazwa (bez ścieżki), bez znaków niedozwolonych w nazwach plików.
 * Gdy nazwa nie ma rozszerzenia, dostaje je ze wzorca (np. ze ścieżki pliku w magazynie albo „.pdf”).
 */
export function nazwaPliku(nazwa: string | null | undefined, wzorzec?: string | null, zapas = 'plik'): string {
	const czysta = String(nazwa ?? '')
		.split(/[\\/]/)
		.pop()!
		.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|[. ]+$/g, '');
	const baza = czysta || zapas;
	const wlasne = ROZSZERZENIE.exec(baza)?.[0] ?? '';
	const ext = wlasne || (ROZSZERZENIE.exec(String(wzorzec ?? '').split(/[?#]/)[0])?.[0] ?? '').toLowerCase();
	const rdzen = wlasne ? baza.slice(0, -wlasne.length) : baza;
	return rdzen.slice(0, MAKS_NAZWA - ext.length).trimEnd() + ext;
}

/** Zapisuje dane na dysk użytkownika pod podaną nazwą (folder Pobrane albo okno „Zapisz jako” — zależnie od przeglądarki). */
export function zapiszBlob(blob: Blob, nazwa: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nazwa;
	a.rel = 'noopener';
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Pobiera plik spod adresu (z nagłówkami sesji, gdy trzeba) i zapisuje go na dysk. Odmowa serwera — wyjątek z jego komunikatem. */
export async function pobierzZAdresu(adres: string, nazwa: string, naglowki?: Record<string, string>): Promise<void> {
	const res = await fetch(adres, naglowki ? { headers: naglowki } : undefined);
	if (!res.ok) {
		const d = (await res.json().catch(() => null)) as { message?: string } | null;
		throw new Error(d?.message ?? `Błąd ${res.status}`);
	}
	zapiszBlob(await res.blob(), nazwa);
}
