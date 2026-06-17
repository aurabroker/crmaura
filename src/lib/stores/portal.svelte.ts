import type { Client, Policy, PolicyPayment, Claim, Vehicle } from '$lib/types/database';

// Stan Panelu Klienta — odseparowany od appState (CRM wewnętrzny).
// Dane ogranicza RLS po stronie bazy (auth_user_id = auth.uid()).
export const portalState = $state({
	client: null as Client | null,
	policies: [] as Policy[],
	payments: [] as PolicyPayment[],
	claims: [] as Claim[],
	vehicles: [] as Vehicle[]
});
