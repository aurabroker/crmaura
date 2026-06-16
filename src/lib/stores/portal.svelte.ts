import type { Client } from '$lib/types/database';

export const portalState = $state({
	client: null as Client | null,
	tenantNazwa: '' as string
});
