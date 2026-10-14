// Podpis klienta (palcem, rysikiem albo myszą) — część wspólna dla przeglądarki i serwera.
// Ten sam format co w aplikacji wniosków majątkowych (aurabroker/PD) i w formularzu APK (aurabroker/APK),
// żeby PDF-y i ślad dowodowy wyglądały wszędzie tak samo.
//
// Podpis to kreski: każda to lista punktów [x, y, t, nacisk], gdzie x i y są w zakresie 0..1 względem pola
// podpisu (proporcje szerokość/wysokość są stałe), t to milisekundy od pierwszego dotknięcia, nacisk 0..1
// dla rysika (0,5 dla palca i myszy). Obraz PNG 1000×400 z przezroczystym tłem trafia do PDF.

export type Punkt = [x: number, y: number, t: number, nacisk: number];
export type Podpis = { png: string; punkty: Punkt[][]; proporcje: number };

/** Proporcje pola podpisu (szerokość : wysokość) — jak linia podpisu na papierze. */
export const PROPORCJE_PODPISU = 2.5;

export const LIMITY_PODPISU = { kresek: 60, punktow: 6000, pngZnakow: 400_000 } as const;

/** Pod czym klient się podpisuje: analiza potrzeb (ze zgodami) albo wniosek o odnowienie. */
export type ZakresPodpisu = 'apk' | 'wniosek';

/**
 * Czy to podpis, a nie przypadkowa kropka: dość punktów, dość długa linia i zajęta sensowna część pola.
 * Ta sama reguła w przeglądarce i na serwerze (długość w jednostkach szerokości pola: dy dzielone przez proporcje).
 */
export function wystarczajacyPodpis(punkty: Punkt[][], proporcje = PROPORCJE_PODPISU): boolean {
	const wszystkie = punkty.flat();
	if (wszystkie.length < 10) return false;
	let dlugosc = 0;
	for (const kreska of punkty) {
		for (let i = 1; i < kreska.length; i++) {
			const dx = kreska[i][0] - kreska[i - 1][0];
			const dy = (kreska[i][1] - kreska[i - 1][1]) / proporcje;
			dlugosc += Math.hypot(dx, dy);
		}
	}
	const xs = wszystkie.map((p) => p[0]);
	const ys = wszystkie.map((p) => p[1]);
	const szer = Math.max(...xs) - Math.min(...xs);
	const wys = Math.max(...ys) - Math.min(...ys);
	return dlugosc >= 0.3 && (szer >= 0.12 || wys >= 0.25);
}

export const PODPIS_ZA_KROTKI = 'Podpis jest za krótki — podpisz się tak jak na papierze.';
export const PODPIS_BRAK_APK = 'Podpisz analizę potrzeb w polu podpisu.';
export const PODPIS_BRAK_WNIOSKU = 'Podpisz wniosek w polu podpisu.';
