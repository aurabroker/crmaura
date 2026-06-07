import type { Profile, Client, ClientContact, Policy, PolicyAnnex, PolicyPayment, Claim, Vehicle, ApkLog, Insurer, InsurerBranch, InsurerContact, PolicyBroker, ApkForm, CrmAlert, CrmTask } from '$lib/types/database';

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
	insurerBranches: [] as InsurerBranch[],
	insurerContacts: [] as InsurerContact[],
	alerts: [] as CrmAlert[],
	brokers: [] as Profile[],
	policyBrokers: [] as PolicyBroker[],
	clientContacts: [] as ClientContact[],
	dashboardWidgets: ['renewals','claims','clients','renewal_rate','payments'] as string[],
	tenantTyp: 'broker' as 'broker' | 'agent',
	tenantNazwa: '' as string,
	tenantFeatures: {} as Record<string, boolean>,
	tasks: [] as CrmTask[],
	loading: false,
	apkForms: [] as ApkForm[]
});

export function isBroker(): boolean {
	return appState.tenantTyp === 'broker';
}

export function roleLabel(): string {
	return appState.tenantTyp === 'agent' ? 'Agent' : 'Broker';
}

export function teamLabel(): string {
	return appState.tenantTyp === 'agent' ? 'Agenci' : 'Brokerzy';
}

export function isAdmin(profile: Profile | null): boolean {
	if (!profile) return false;
	return ['ADMIN GOD', 'ADMIN BROKER', 'BOARD'].includes(profile.rola);
}

export function isFinance(profile: Profile | null): boolean {
	if (!profile) return false;
	return ['ADMIN GOD', 'ADMIN BROKER', 'BOARD', 'ADMINISTRACJA'].includes(profile.rola);
}
