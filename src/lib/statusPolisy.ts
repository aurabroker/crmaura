// Status polisy do chipów na listach (Polisy, Panel 360°). Jedno źródło reguł, żeby ekrany się nie rozjeżdżały.
import type { Policy } from '$lib/types/database';
import { dateDiffDays } from '$lib/utils';

export type KluczStatusu = 'wznowiona' | 'zalegla' | 'oczekujaca' | 'zakonczona' | 'wygasa' | 'aktywna';
export type StatusPolisy = { klucz: KluczStatusu; tekst: string; cls: string };

/** Id polis, które mają już następczynię (nieusuniętą polisę z renewal_of). */
export function odnowionePolisy(policies: Pick<Policy, 'renewal_of' | 'deleted_at'>[]): Set<string> {
	return new Set(policies.filter((p) => p.renewal_of && !p.deleted_at).map((p) => p.renewal_of as string));
}

export function statusPolisy(
	p: Pick<Policy, 'id' | 'data_od' | 'data_do' | 'renewal_of'>,
	ctx: { dzis: string; odnowione: Set<string>; zZaleglaRata?: Set<string> }
): StatusPolisy {
	if (ctx.odnowione.has(p.id)) return { klucz: 'wznowiona', tekst: 'Wznowiona', cls: 'bg-surface-2 text-ink-2' };
	if (ctx.zZaleglaRata?.has(p.id)) return { klucz: 'zalegla', tekst: 'Rata po terminie', cls: 'bg-danger-soft text-danger' };
	if (p.renewal_of && p.data_od > ctx.dzis) return { klucz: 'oczekujaca', tekst: 'Oczekująca', cls: 'bg-accent-soft text-accent-text' };
	if (p.data_do && p.data_do < ctx.dzis) return { klucz: 'zakonczona', tekst: 'Zakończona', cls: 'bg-surface-2 text-ink-2' };
	if (p.data_do && dateDiffDays(ctx.dzis, p.data_do) <= 30) return { klucz: 'wygasa', tekst: 'Wygasa', cls: 'bg-warn-soft text-warn' };
	return { klucz: 'aktywna', tekst: 'Aktywna', cls: 'bg-ok-soft text-ok' };
}

/** Rodzaj do wyświetlenia: „grupowe_życie” → „grupowe życie”. */
export const nazwaRodzaju = (r: string | null | undefined): string => (r ?? '').replace(/_/g, ' ');

/** Skrót towarzystwa (albo pełna nazwa, gdy skrótu brak). */
export const nazwaTu = (p: Pick<Policy, 'crm_insurers'>): string => p.crm_insurers?.skrot || p.crm_insurers?.nazwa || '—';
