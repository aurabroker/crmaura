// Statystyki odnowień (Statystyki → „Postęp odnowień”, kafelek na Pulpicie). Czyste funkcje na polisach z appState.
//
// Każda polisa z datą końca (poza umową generalną) jest kandydatem do odnowienia i kończy w jednym z czterech stanów:
//   odnowiona   — ma następczynię (nieusunięta polisa z renewal_of wskazującym na nią), niezależnie od TU czy rodzaju,
//   zakończona  — decyzja „nie odnawiamy” / wypowiedzenie (zakonczona_od) i brak następczyni; nie wchodzi do mianownika,
//   utracona    — koniec okresu minął ponad DNI_UTRATY dni temu, a nie ma ani następczyni, ani decyzji,
//   w toku      — wszystko inne (kończy się dopiero albo skończyła się niedawno i sprawa jeszcze żyje).
// Skuteczność = odnowione / (kończące − zakończone decyzją). Zamknięty miesiąc = każda polisa z tego miesiąca ma już stan końcowy.
import type { Policy, WniosekOdnowienia } from '$lib/types/database';
import { dateDiffDays } from '$lib/utils';
import { koniecMiesiaca, mediana, miesiace, type Okres } from '$lib/analityka';
import { plusDni, POWOD_ZAKONCZENIA_ETYKIETA } from '$lib/statusPolisy';
import { wniosekTestowy, wniosekZalatwiony } from '$lib/components/renewal/crmRenewals';

export type PolisaOdnowien = Pick<Policy, 'id' | 'klient_id' | 'tu_id' | 'rodzaj' | 'data_od' | 'data_do' | 'skladka_przypisana' | 'typ_umowy' | 'deleted_at' | 'renewal_of'> &
	Partial<Pick<Policy, 'zakonczona_od' | 'zakonczenie_powod' | 'zakonczono_at' | 'created_at'>>;

export type StanKonca = 'odnowiona' | 'w_toku' | 'zakonczona' | 'utracona';
export const STANY_KONCA: StanKonca[] = ['odnowiona', 'w_toku', 'zakonczona', 'utracona'];
export const NAZWA_STANU: Record<StanKonca, string> = { odnowiona: 'odnowione', w_toku: 'w toku', zakonczona: 'zakończone decyzją', utracona: 'utracone' };

/** Po tylu dniach od końca okresu polisa bez następczyni i bez decyzji liczy się jako utracona. */
export const DNI_UTRATY = 30;

export type Licznik = { polisy: number; skladka: number };
export const pustyLicznik = (): Licznik => ({ polisy: 0, skladka: 0 });
const skladka = (p: Pick<PolisaOdnowien, 'skladka_przypisana'>) => Number(p.skladka_przypisana ?? 0);
const dolicz = (l: Licznik, p: Pick<PolisaOdnowien, 'skladka_przypisana'>) => { l.polisy++; l.skladka += skladka(p); };

/** Polisa, którą da się odnowić: z datą końca, nieusunięta, nie umowa generalna (ramka bez własnego okresu do wznowienia). */
export const kandydatOdnowienia = (p: Pick<PolisaOdnowien, 'data_do' | 'deleted_at' | 'typ_umowy'>) => !p.deleted_at && p.typ_umowy !== 'generalna' && !!p.data_do;

/** Następczynie: id polisy → nieusunięta polisa z renewal_of na nią (przy kilku — najwcześniej dodana). */
export function nastepczynie<P extends Pick<PolisaOdnowien, 'id' | 'renewal_of' | 'deleted_at' | 'created_at'>>(polisy: P[]): Map<string, P> {
	const m = new Map<string, P>();
	for (const q of polisy) {
		if (!q.renewal_of || q.deleted_at) continue;
		const juz = m.get(q.renewal_of);
		if (!juz || (q.created_at ?? '') < (juz.created_at ?? '')) m.set(q.renewal_of, q);
	}
	return m;
}

export function stanKonca(p: Pick<PolisaOdnowien, 'id' | 'data_do' | 'zakonczona_od'>, dzis: string, nast: ReadonlyMap<string, unknown>): StanKonca {
	if (nast.has(p.id)) return 'odnowiona';
	if (p.zakonczona_od) return 'zakonczona';
	if (p.data_do && dateDiffDays(p.data_do, dzis) > DNI_UTRATY) return 'utracona';
	return 'w_toku';
}

export type PodsumowanieOdnowien = Record<StanKonca, Licznik> & {
	konczace: Licznik;
	/** Odnowione / (kończące − zakończone decyzją) w %; null, gdy nie ma czego liczyć. */
	procent: number | null;
	/** To samo liczone składką przypisaną. */
	procentSkladki: number | null;
};

export const procentOdnowien = (odnowione: number, konczace: number, zakonczone: number): number | null => {
	const mianownik = konczace - zakonczone;
	return mianownik > 0 ? (odnowione / mianownik) * 100 : null;
};

export function podsumujOdnowienia(lista: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>): PodsumowanieOdnowien {
	const w = { odnowiona: pustyLicznik(), w_toku: pustyLicznik(), zakonczona: pustyLicznik(), utracona: pustyLicznik(), konczace: pustyLicznik() };
	for (const p of lista) {
		if (!kandydatOdnowienia(p)) continue;
		dolicz(w[stanKonca(p, dzis, nast)], p);
		dolicz(w.konczace, p);
	}
	return {
		...w,
		procent: procentOdnowien(w.odnowiona.polisy, w.konczace.polisy, w.zakonczona.polisy),
		procentSkladki: procentOdnowien(w.odnowiona.skladka, w.konczace.skladka, w.zakonczona.skladka)
	};
}

// ── Okna czasowe ────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-10 + 3 → 2027-01, 2026-10 − 12 → 2025-10. */
export function przesunMiesiac(ym: string, n: number): string {
	const idx = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
	return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Okno kończące się w dniu `doo`: od dnia po tej samej dacie `miesiecy` miesięcy wcześniej (np. 24 wrz 2025 – 23 wrz 2026). */
export function oknoWstecz(doo: string, miesiecy = 12, etykieta = `ostatnie ${miesiecy} mies.`): Okres {
	const d = Number(doo.slice(8, 10));
	const ym = przesunMiesiac(doo.slice(0, 7), -miesiecy);
	const ostatni = Number(koniecMiesiaca(`${ym}-01`).slice(8, 10));
	return { od: plusDni(`${ym}-${pad(Math.min(d, ostatni))}`, 1), do: doo, etykieta };
}

/** Okno polis o już rozstrzygniętym końcu: data_do co najmniej DNI_UTRATY+1 dni temu, 12 miesięcy wstecz od tego dnia. */
export const oknoZamkniete = (dzis: string, miesiecy = 12) => oknoWstecz(plusDni(dzis, -(DNI_UTRATY + 1)), miesiecy, `zamknięte ${miesiecy} mies.`);

/** Miesiąc, którego wszystkie polisy mają już stan końcowy. */
export const miesiacZamkniety = (ym: string, dzis: string) => koniecMiesiaca(`${ym}-01`) <= plusDni(dzis, -(DNI_UTRATY + 1));

export const wDatach = (d: string | null | undefined, o: Okres) => !!d && d >= o.od && d <= o.do;

// ── Postęp miesiąc po miesiącu ──────────────────────────────────────────────────
export type PostepMiesiaca = PodsumowanieOdnowien & { ym: string; zamkniety: boolean };

/** Polisy według miesiąca końca ochrony w oknie wokół dziś (domyślnie 3 miesiące wstecz i 3 naprzód). */
export function postepOdnowien(polisy: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>, opcje: { wstecz?: number; naprzod?: number } = {}): PostepMiesiaca[] {
	const { wstecz = 3, naprzod = 3 } = opcje;
	const biezacy = dzis.slice(0, 7);
	const lista = miesiace({ od: `${przesunMiesiac(biezacy, -wstecz)}-01`, do: `${przesunMiesiac(biezacy, naprzod)}-01`, etykieta: '' });
	const wg = new Map<string, PolisaOdnowien[]>(lista.map((ym) => [ym, []]));
	for (const p of polisy) {
		if (!kandydatOdnowienia(p)) continue;
		wg.get(p.data_do.slice(0, 7))?.push(p);
	}
	return lista.map((ym) => ({ ym, zamkniety: miesiacZamkniety(ym, dzis), ...podsumujOdnowienia(wg.get(ym) ?? [], dzis, nast) }));
}

// ── Skuteczność w zamkniętym oknie, trend, rozbicia ─────────────────────────────
export type Skutecznosc = PodsumowanieOdnowien & { okno: Okres };

export function skutecznoscOdnowien(polisy: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>, okno: Okres = oknoZamkniete(dzis)): Skutecznosc {
	return { okno, ...podsumujOdnowienia(polisy.filter((p) => kandydatOdnowienia(p) && wDatach(p.data_do, okno)), dzis, nast) };
}

export type TrendSkutecznosci = { ostatni: { ym: string; procent: number | null; konczace: number }; poprzedni: { ym: string; procent: number | null; konczace: number }; zmianaPkt: number | null };

/** Ostatni zamknięty miesiąc a miesiąc przed nim (zmiana w punktach procentowych). */
export function trendSkutecznosci(polisy: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>): TrendSkutecznosci {
	let ym = dzis.slice(0, 7);
	while (!miesiacZamkniety(ym, dzis)) ym = przesunMiesiac(ym, -1);
	const m = (klucz: string) => {
		const s = podsumujOdnowienia(polisy.filter((p) => kandydatOdnowienia(p) && p.data_do.slice(0, 7) === klucz), dzis, nast);
		return { ym: klucz, procent: s.procent, konczace: s.konczace.polisy };
	};
	const ostatni = m(ym);
	const poprzedni = m(przesunMiesiac(ym, -1));
	return { ostatni, poprzedni, zmianaPkt: ostatni.procent != null && poprzedni.procent != null ? ostatni.procent - poprzedni.procent : null };
}

/** To samo okno rok wcześniej — porównanie r/r; null, gdy rok temu nic się nie kończyło. */
export function skutecznoscRokWczesniej(polisy: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>, okno: Okres): Skutecznosc | null {
	const rok = (d: string) => {
		const ym = przesunMiesiac(d.slice(0, 7), -12);
		return `${ym}-${pad(Math.min(Number(d.slice(8, 10)), Number(koniecMiesiaca(`${ym}-01`).slice(8, 10))))}`;
	};
	const s = skutecznoscOdnowien(polisy, dzis, nast, { od: rok(okno.od), do: rok(okno.do), etykieta: 'rok wcześniej' });
	return s.konczace.polisy ? s : null;
}

export type Rozbicie<K extends string> = PodsumowanieOdnowien & { klucz: K };

/** Skuteczność w oknie według klucza (TU, rodzaj, opiekun klienta); najwięcej kończących się polis na górze. */
export function rozbicieOdnowien<P extends PolisaOdnowien, K extends string>(polisy: P[], dzis: string, nast: ReadonlyMap<string, unknown>, okno: Okres, klucz: (p: P) => K | null | undefined): Rozbicie<K>[] {
	const wg = new Map<K, P[]>();
	for (const p of polisy) {
		if (!kandydatOdnowienia(p) || !wDatach(p.data_do, okno)) continue;
		const k = klucz(p);
		if (k == null) continue;
		wg.set(k, [...(wg.get(k) ?? []), p]);
	}
	return [...wg]
		.map(([k, lista]) => ({ klucz: k, ...podsumujOdnowienia(lista, dzis, nast) }))
		.sort((a, b) => b.konczace.polisy - a.konczace.polisy || b.konczace.skladka - a.konczace.skladka);
}

// ── Terminowość ─────────────────────────────────────────────────────────────────
export type Terminowosc = {
	/** Odnowienia z datą dodania następczyni. */
	n: number;
	/** Mediana dni przed końcem starej polisy, w których powstała następczyni (ujemna = po końcu). */
	medianaDni: number | null;
	/** Następczyni dodana po końcu okresu starej polisy. */
	poTerminie: number;
	procPoTerminie: number | null;
	/** Następczyni zaczyna się później niż dzień po końcu starej — przerwa w ochronie. */
	zLuka: number;
};

/** Kiedy względem końca starej polisy powstaje odnowienie (po dacie dodania następczyni do CRM), dla polis kończących się w oknie. */
export function terminowoscOdnowien<P extends PolisaOdnowien>(polisy: P[], nast: ReadonlyMap<string, P>, okno: Okres): Terminowosc {
	const dni: number[] = [];
	let zLuka = 0;
	for (const p of polisy) {
		if (!kandydatOdnowienia(p) || !wDatach(p.data_do, okno)) continue;
		const n = nast.get(p.id);
		if (!n) continue;
		if (n.data_od && n.data_od > plusDni(p.data_do, 1)) zLuka++;
		if (n.created_at) dni.push(dateDiffDays(n.created_at.slice(0, 10), p.data_do));
	}
	const poTerminie = dni.filter((d) => d < 0).length;
	return { n: dni.length, medianaDni: dni.length ? mediana(dni) : null, poTerminie, procPoTerminie: dni.length ? (poTerminie / dni.length) * 100 : null, zLuka };
}

// ── Do zrobienia ────────────────────────────────────────────────────────────────
export type DoZrobienia = { d30: Licznik; d90: Licznik; poKoncu: Licznik };

/** Bez następczyni i bez decyzji: kończące się w 30 / 90 dni oraz te, którym koniec minął, ale jeszcze nie są utracone. */
export function doZrobienia(polisy: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>): DoZrobienia {
	const w = { d30: pustyLicznik(), d90: pustyLicznik(), poKoncu: pustyLicznik() };
	for (const p of polisy) {
		if (!kandydatOdnowienia(p) || stanKonca(p, dzis, nast) !== 'w_toku') continue;
		const d = dateDiffDays(dzis, p.data_do);
		if (d < 0) dolicz(w.poKoncu, p);
		else if (d <= 90) {
			dolicz(w.d90, p);
			if (d <= 30) dolicz(w.d30, p);
		}
	}
	return w;
}

// ── Lejek wniosków online ───────────────────────────────────────────────────────
export type LejekWnioskow = { wyslane: number; otwarte: number; apk: number; zlozone: number; wystawione: number; rezygnacje: number };

/**
 * Wnioski (bez testowych) utworzone w oknie: wysłane → otwarte → APK → złożone → wystawione (polisa w CRM albo zadanie
 * „Załatwione”); rezygnacje osobno. Każdy etap zawiera następne (lejek), więc liczby maleją.
 */
export function lejekWnioskow(
	wnioski: Pick<WniosekOdnowienia, 'id' | 'rodzaj' | 'polisa_id' | 'klient_id' | 'status' | 'decyzja' | 'email' | 'created_at' | 'wyslano_at' | 'otwarto_at' | 'apk_at' | 'zlozono_at'>[],
	okno: Okres,
	odnowione: ReadonlySet<string>,
	polisyKl: ReadonlyMap<string, string[]> = new Map(),
	zalatwione: ReadonlySet<string> = new Set()
): LejekWnioskow {
	const l: LejekWnioskow = { wyslane: 0, otwarte: 0, apk: 0, zlozone: 0, wystawione: 0, rezygnacje: 0 };
	for (const w of wnioski) {
		if (wniosekTestowy(w) || !wDatach(w.created_at.slice(0, 10), okno)) continue;
		if (!w.wyslano_at && w.status === 'utworzony') continue;
		l.wyslane++;
		if (w.otwarto_at || w.apk_at || w.zlozono_at) l.otwarte++;
		if (w.apk_at) l.apk++;
		if (w.zlozono_at || w.status === 'zlozony') {
			l.zlozone++;
			if (w.decyzja === 'nie') l.rezygnacje++;
			else if (zalatwione.has(w.id) || wniosekZalatwiony(w, odnowione, polisyKl)) l.wystawione++;
		}
	}
	return l;
}

// ── Utracona składka ────────────────────────────────────────────────────────────
export type PowodUtraty = Licznik & { powod: string | null; etykieta: string; przyszle: number };
export type UtraconaSkladka = {
	powody: PowodUtraty[];
	zakonczone: Licznik;
	utracone: Licznik;
	razem: Licznik;
	/** Decyzje o zakończeniu, które dopiero wejdą w życie (ochrona jeszcze trwa). */
	przyszle: number;
};

export const etykietaPowodu = (powod: string | null | undefined) => (powod ? POWOD_ZAKONCZENIA_ETYKIETA[powod] ?? powod : 'bez podanego powodu');

/**
 * Składka, która nie wróci: polisy zakończone decyzją od początku okna (także decyzje na przyszłość — strata już przesądzona),
 * z podziałem na powody, oraz utracone bez decyzji, którym koniec minął w oknie.
 */
export function utraconaSkladka(polisy: PolisaOdnowien[], dzis: string, nast: ReadonlyMap<string, unknown>, okno: Okres): UtraconaSkladka {
	const wg = new Map<string | null, Licznik & { przyszle: number }>();
	const zakonczone = pustyLicznik();
	const utracone = pustyLicznik();
	let przyszle = 0;
	for (const p of polisy) {
		if (!kandydatOdnowienia(p)) continue;
		const stan = stanKonca(p, dzis, nast);
		if (stan === 'zakonczona') {
			if (!p.zakonczona_od || p.zakonczona_od < okno.od) continue;
			const k = p.zakonczenie_powod ?? null;
			let l = wg.get(k);
			if (!l) { l = { ...pustyLicznik(), przyszle: 0 }; wg.set(k, l); }
			dolicz(l, p);
			dolicz(zakonczone, p);
			if (p.zakonczona_od > dzis) { l.przyszle++; przyszle++; }
		} else if (stan === 'utracona' && wDatach(plusDni(p.data_do, 1), okno)) {
			dolicz(utracone, p);
		}
	}
	const powody: PowodUtraty[] = [...wg].map(([powod, l]) => ({ powod, etykieta: etykietaPowodu(powod), ...l })).sort((a, b) => b.skladka - a.skladka || b.polisy - a.polisy);
	return { powody, zakonczone, utracone, razem: { polisy: zakonczone.polisy + utracone.polisy, skladka: zakonczone.skladka + utracone.skladka }, przyszle };
}

// ── Nowa sprzedaż a odnowienia ──────────────────────────────────────────────────
export type PrzypisWgZrodla = { ym: string; nowa: Licznik; odnowienie: Licznik };

/** Przypis według miesiąca początku ochrony, osobno polisy z renewal_of (odnowienia) i pozostałe (nowa sprzedaż). */
export function przypisWgZrodla(polisy: PolisaOdnowien[], okres: Okres): { miesiace: PrzypisWgZrodla[]; nowa: Licznik; odnowienie: Licznik } {
	const wg = new Map<string, PrzypisWgZrodla>(miesiace(okres).map((ym) => [ym, { ym, nowa: pustyLicznik(), odnowienie: pustyLicznik() }]));
	const nowa = pustyLicznik();
	const odnowienie = pustyLicznik();
	for (const p of polisy) {
		if (p.deleted_at || p.typ_umowy === 'generalna' || !wDatach(p.data_od, okres)) continue;
		const m = wg.get(p.data_od.slice(0, 7));
		if (!m) continue;
		if (p.renewal_of) { dolicz(m.odnowienie, p); dolicz(odnowienie, p); }
		else { dolicz(m.nowa, p); dolicz(nowa, p); }
	}
	return { miesiace: [...wg.values()], nowa, odnowienie };
}
