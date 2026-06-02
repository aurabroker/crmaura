import type { Profile, Client, Policy, PolicyAnnex, Claim, Vehicle, ApkLog, Insurer } from '$lib/types/database';

export const appState = $state({
	profile: null as Profile | null,
	clients: [] as Client[],
	policies: [] as Policy[],
	annexes: [] as PolicyAnnex[],
	claims: [] as Claim[],
	vehicles: [] as Vehicle[],
	apk: [] as ApkLog[],
	insurers: [] as Insurer[],
	brokers: [] as Profile[],
	loading: false
});

export function isAdmin(profile: Profile | null): boolean {
	if (!profile) return false;
	return ['ADMIN GOD', 'ADMIN BROKER', 'BOARD'].includes(profile.rola);
}

export function isFinance(profile: Profile | null): boolean {
	if (!profile) return false;
	return ['ADMIN GOD', 'ADMIN BROKER', 'BOARD', 'ADMINISTRACJA'].includes(profile.rola);
}
