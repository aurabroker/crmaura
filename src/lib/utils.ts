export const fmtPln = (n: number | null | undefined): string => {
	if (n == null) return '0,00';
	return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const dateDiffDays = (a: string, b: string): number =>
	Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

// Color classes for policy rodzaj badges (bg + text)
export const rodzajColor: Record<string, string> = {
	majątkowa:        'bg-blue-100 text-blue-800',
	życie:            'bg-emerald-100 text-emerald-800',
	grupowe_medyczne: 'bg-purple-100 text-purple-800',
	grupowe_życie:    'bg-pink-100 text-pink-800',
	utrata_dochodu:   'bg-amber-100 text-amber-800',
	komunikacja:      'bg-cyan-100 text-cyan-800',
	flota:            'bg-indigo-100 text-indigo-800',
	finansowa:        'bg-violet-100 text-violet-800',
	OC:               'bg-orange-100 text-orange-800',
	techniczna:       'bg-slate-200 text-slate-700',
	karno_skarbowa:   'bg-red-100 text-red-800',
	polisa_obca:      'bg-gray-100 text-gray-600',
};
// Color classes for UG podtyp badges
export const ugPodtypColor: Record<string, string> = {
	flota:      'bg-indigo-100 text-indigo-800',
	gwarancje:  'bg-violet-100 text-violet-800',
	cpm:        'bg-cyan-100 text-cyan-800',
	car_ear:    'bg-blue-100 text-blue-800',
	oc_beauty:  'bg-pink-100 text-pink-800',
	beauty_tax: 'bg-red-100 text-red-800',
};
export function rodzajCls(rodzaj: string): string {
	return rodzajColor[rodzaj] ?? 'bg-slate-100 text-slate-700';
}
export function ugPodtypCls(podtyp: string): string {
	return ugPodtypColor[podtyp] ?? 'bg-slate-100 text-slate-700';
}

export const policyStatus = (
	dateDo: string
): { label: string; color: string; badge: string } => {
	const days = dateDiffDays(todayStr(), dateDo);
	if (days < 0) return { label: 'Zakończona', color: 'text-red-600', badge: 'badge-error' };
	if (days <= 30) return { label: 'Wygasa', color: 'text-amber-500', badge: 'badge-warning' };
	return { label: 'Aktywna', color: 'text-emerald-600', badge: 'badge-success' };
};
