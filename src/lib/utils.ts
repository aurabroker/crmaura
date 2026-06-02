export const fmtPln = (n: number | null | undefined): string => {
	if (n == null) return '0,00';
	return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const dateDiffDays = (a: string, b: string): number =>
	Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));

export const todayStr = (): string => new Date().toISOString().slice(0, 10);

export const policyStatus = (
	dateDo: string
): { label: string; color: string; badge: string } => {
	const days = dateDiffDays(todayStr(), dateDo);
	if (days < 0) return { label: 'Zakończona', color: 'text-red-600', badge: 'badge-error' };
	if (days <= 30) return { label: 'Wygasa', color: 'text-amber-500', badge: 'badge-warning' };
	return { label: 'Aktywna', color: 'text-emerald-600', badge: 'badge-success' };
};
