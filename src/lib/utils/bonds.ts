import { dateDiffDays } from '$lib/utils';

// Typy gwarancji (zgodne z CHECK na bond_bonds.bond_rodzaj)
export const BOND_RODZAJ: [string, string][] = [
	['WADIUM', 'Wadialna'],
	['NWK', 'Należytego wykonania'],
	['UWU', 'Usunięcia wad i usterek'],
	['ZAL', 'Zwrotu zaliczki']
];

export const bondRodzajLabel: Record<string, string> = Object.fromEntries(BOND_RODZAJ);

export const bondRodzajColor: Record<string, string> = {
	WADIUM: 'bg-amber-100 text-amber-800',
	NWK: 'bg-violet-100 text-violet-800',
	UWU: 'bg-blue-100 text-blue-800',
	ZAL: 'bg-emerald-100 text-emerald-800'
};

export function bondRodzajCls(code: string): string {
	return bondRodzajColor[code] ?? 'bg-slate-100 text-slate-700';
}

/**
 * Składka gwarancji: suma × (stawka/100) × (dni/365); podłoga = skladkaMin.
 * Zwraca null jeśli brak stawki lub dat.
 */
export function calcBondSkladka(
	suma: number | null | undefined,
	stawkaPct: number | null | undefined,
	dataOd: string | null | undefined,
	dataDo: string | null | undefined,
	skladkaMin: number | null | undefined
): number | null {
	const s = Number(suma) || 0;
	const stawka = Number(stawkaPct) || 0;
	if (!dataOd || !dataDo || s <= 0 || stawka <= 0) return null;
	const dni = Math.max(0, dateDiffDays(dataOd, dataDo));
	let sk = s * (stawka / 100) * (dni / 365);
	const min = skladkaMin != null ? Number(skladkaMin) : null;
	if (min != null && sk < min) sk = min;
	return Math.round(sk * 100) / 100;
}

// Efektywna stawka: własna (override) albo bazowa z UL
export function effectiveStawka(
	override: boolean | null | undefined,
	stawkaWlasna: number | null | undefined,
	stawkaBazowa: number | null | undefined
): number | null {
	if (override && stawkaWlasna != null) return Number(stawkaWlasna);
	return stawkaBazowa != null ? Number(stawkaBazowa) : null;
}
