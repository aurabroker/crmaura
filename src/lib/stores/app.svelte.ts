import type { Profile, Client, Policy, PolicyAnnex, PolicyPayment, Claim, Vehicle, ApkLog, Insurer, PolicyBroker } from '$lib/types/database';

export const appState = $state({
	profile: null as Profile | null,
	clients: [] as Client[],
	policies: [] as Policy[],
	annexes: [] as PolicyAnnex[],
	payments: [] as PolicyPayment[],
	claims: [] as Claim[],
	vehicles: [] as Vehicle[],
	apk: [] as ApkLog[],
	insurers: [] as Insurer[],
	brokers: [] as Profile[],
	policyBrokers: [] as PolicyBroker[],
	dashboardWidgets: ['renewals','claims','clients','renewal_rate','payments'] as string[],
	tenantTyp: 'broker' as 'broker' | 'agent',
	tenantNazwa: '' as string,
	loading: false
});

export function isBroker(): boolean {
	return appState.tenantTyp === 'broker';
}

export function isAdmin(profile: Profile | null): boolean {
	if (!profile) return false;
	return ['ADMIN GOD', 'ADMIN BROKER', 'BOARD'].includes(profile.rola);
}

export function isFinance(profile: Profile | null): boolean {
	if (!profile) return false;
	return ['ADMIN GOD', 'ADMIN BROKER', 'BOARD', 'ADMINISTRACJA'].includes(profile.rola);
}
