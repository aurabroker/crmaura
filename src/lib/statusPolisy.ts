// Status polisy do chipów na listach (Polisy, Panel 360°, karta polisy). Jedno źródło reguł, żeby ekrany się nie rozjeżdżały.
//
// Koniec ochrony liczy się z dat polisy i z decyzji o zakończeniu (zakonczona_od = pierwszy dzień bez ochrony):
//   Wygasła      — data_do minęła, a nikt nie podjął decyzji (odnowić? zakończyć?) — wymaga działania,
//   Zakończona   — decyzja zapadła (wypowiedzenie od dnia albo brak odnowienia na koniec okresu) i dzień zakończenia minął,
//   Do zakończenia — decyzja zapadła, ochrona jeszcze trwa (polisa nie trafia do odnowień).
import type { Client, Policy } from '$lib/types/database';
import { dateDiffDays, fmtDzien } from '$lib/utils';

export type KluczStatusu = 'wznowiona' | 'zalegla' | 'oczekujaca' | 'zakonczona' | 'wygasla' | 'do_zakonczenia' | 'wygasa' | 'aktywna';
export type StatusPolisy = { klucz: KluczStatusu; tekst: string; cls: string };

export type TrybZakonczenia = 'od_dnia' | 'koniec_okresu';

export const POWODY_ZAKONCZENIA: { val: string; label: string }[] = [
	{ val: 'brak_odnowienia', label: 'Brak odnowienia — klient nie przedłuża' },
	{ val: 'wypowiedzenie_klienta', label: 'Wypowiedzenie przez klienta' },
	{ val: 'wypowiedzenie_tu', label: 'Wypowiedzenie przez towarzystwo' },
	{ val: 'sprzedaz_przedmiotu', label: 'Sprzedaż / zbycie przedmiotu ubezpieczenia' },
	{ val: 'zakonczenie_dzialalnosci', label: 'Zakończenie działalności klienta' },
	{ val: 'zmiana_brokera', label: 'Zmiana brokera / agenta' },
	{ val: 'inne', label: 'Inne' }
];
export const POWOD_ZAKONCZENIA_ETYKIETA: Record<string, string> = Object.fromEntries(POWODY_ZAKONCZENIA.map((p) => [p.val, p.label]));

export const POWODY_NIEAKTYWNOSCI: { val: string; label: string }[] = [
	{ val: 'zakonczenie_dzialalnosci', label: 'Zakończenie działalności' },
	{ val: 'zawieszenie_dzialalnosci', label: 'Zawieszenie działalności' },
	{ val: 'rezygnacja', label: 'Rezygnacja z naszych usług' },
	{ val: 'inne', label: 'Inne' }
];
export const POWOD_NIEAKTYWNOSCI_ETYKIETA: Record<string, string> = Object.fromEntries(POWODY_NIEAKTYWNOSCI.map((p) => [p.val, p.label]));

/** „2026-10-31” + 1 → „2026-11-01” (bez stref czasowych). */
export function plusDni(iso: string, n: number): string {
	const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

type PolisaKoniec = Pick<Policy, 'data_do' | 'zakonczona_od'>;

/** Decyzja „nie odnawiamy” (zakończenie od dnia albo na koniec okresu) — polisa nie trafia do odnowień. */
export const nieOdnawiana = (p: Pick<Policy, 'zakonczona_od'>) => !!p.zakonczona_od;

/** Ostatni dzień ochrony: data_do albo dzień przed zakończeniem decyzją, gdy wcześniejszy; null = bezterminowo. */
export function koniecOchrony(p: PolisaKoniec): string | null {
	const zDecyzji = p.zakonczona_od ? plusDni(p.zakonczona_od, -1) : null;
	if (zDecyzji && (!p.data_do || zDecyzji < p.data_do)) return zDecyzji;
	return p.data_do ?? null;
}

/** Polisa chroni dziś (koniec ochrony dziś albo później, bezterminowa też). */
export function polisaAktywna(p: PolisaKoniec, dzis: string): boolean {
	const k = koniecOchrony(p);
	return !k || k >= dzis;
}

/** Zakończona decyzją i dzień zakończenia już minął. */
export const polisaZakonczona = (p: PolisaKoniec, dzis: string) => !!p.zakonczona_od && p.zakonczona_od <= dzis;

/** Po końcu okresu bez żadnej decyzji (ani odnowienia, ani zakończenia). */
export const polisaWygasla = (p: PolisaKoniec, dzis: string) => !p.zakonczona_od && !!p.data_do && p.data_do < dzis;

/** Id polis, które mają już następczynię (nieusuniętą polisę z renewal_of). */
export function odnowionePolisy(policies: Pick<Policy, 'renewal_of' | 'deleted_at'>[]): Set<string> {
	return new Set(policies.filter((p) => p.renewal_of && !p.deleted_at).map((p) => p.renewal_of as string));
}

export function statusPolisy(
	p: Pick<Policy, 'id' | 'data_od' | 'data_do' | 'renewal_of'> & Partial<Pick<Policy, 'zakonczona_od'>>,
	ctx: { dzis: string; odnowione: Set<string>; zZaleglaRata?: Set<string> }
): StatusPolisy {
	if (ctx.odnowione.has(p.id)) return { klucz: 'wznowiona', tekst: 'Wznowiona', cls: 'bg-surface-2 text-ink-2' };
	if (ctx.zZaleglaRata?.has(p.id)) return { klucz: 'zalegla', tekst: 'Rata po terminie', cls: 'bg-danger-soft text-danger' };
	if (p.renewal_of && p.data_od > ctx.dzis) return { klucz: 'oczekujaca', tekst: 'Oczekująca', cls: 'bg-accent-soft text-accent-text' };
	if (polisaZakonczona(p, ctx.dzis)) return { klucz: 'zakonczona', tekst: 'Zakończona', cls: 'bg-surface-2 text-ink-2' };
	if (polisaWygasla(p, ctx.dzis)) return { klucz: 'wygasla', tekst: 'Wygasła', cls: 'bg-warn-soft text-warn' };
	if (p.zakonczona_od) return { klucz: 'do_zakonczenia', tekst: `Do zakończenia ${fmtDzien(p.zakonczona_od)}`, cls: 'bg-surface-2 text-ink-2' };
	if (p.data_do && dateDiffDays(ctx.dzis, p.data_do) <= 30) return { klucz: 'wygasa', tekst: 'Wygasa', cls: 'bg-warn-soft text-warn' };
	return { klucz: 'aktywna', tekst: 'Aktywna', cls: 'bg-ok-soft text-ok' };
}

/** „Zakończona od 15 paź 2026 · wypowiedzenie przez klienta” / „Nie odnawiamy — koniec okresu 31 gru 2026 · brak odnowienia”. */
export function opisZakonczenia(p: Pick<Policy, 'data_do' | 'zakonczona_od' | 'zakonczenie_tryb' | 'zakonczenie_powod'>, dzis: string): string {
	if (!p.zakonczona_od) return '';
	const powod = p.zakonczenie_powod ? POWOD_ZAKONCZENIA_ETYKIETA[p.zakonczenie_powod] ?? p.zakonczenie_powod : '';
	const minelo = p.zakonczona_od <= dzis;
	const kiedy = p.zakonczenie_tryb === 'koniec_okresu'
		? `${minelo ? 'zakończona z końcem okresu' : 'nie odnawiamy — koniec okresu'} ${fmtDzien(koniecOchrony(p) ?? p.zakonczona_od, true)}`
		: `${minelo ? 'zakończona' : 'kończy się'} od ${fmtDzien(p.zakonczona_od, true)}`;
	const tekst = kiedy.charAt(0).toUpperCase() + kiedy.slice(1);
	return powod ? `${tekst} · ${powod.toLowerCase()}` : tekst;
}

/** Klient nieaktywny (zakończył działalność, zrezygnował). Brak kolumny (stare wiersze) = aktywny. */
export const klientNieaktywny = (c: Pick<Client, 'aktywny'> | null | undefined) => !!c && c.aktywny === false;

export function opisNieaktywnosci(c: Pick<Client, 'nieaktywny_od' | 'nieaktywny_powod'>): string {
	const powod = c.nieaktywny_powod ? POWOD_NIEAKTYWNOSCI_ETYKIETA[c.nieaktywny_powod] ?? c.nieaktywny_powod : '';
	return ['Nieaktywny', c.nieaktywny_od ? `od ${fmtDzien(c.nieaktywny_od, true)}` : '', powod ? `· ${powod.toLowerCase()}` : ''].filter(Boolean).join(' ');
}

/** Rodzaj do wyświetlenia: „grupowe_życie” → „grupowe życie”. */
export const nazwaRodzaju = (r: string | null | undefined): string => (r ?? '').replace(/_/g, ' ');

/** Skrót towarzystwa (albo pełna nazwa, gdy skrótu brak). */
export const nazwaTu = (p: Pick<Policy, 'crm_insurers'>): string => p.crm_insurers?.skrot || p.crm_insurers?.nazwa || '—';
