<script lang="ts">
	import Badge from '$lib/components/Badge.svelte';
	import { DECYZJA_ETYKIETA, STATUS_ODNOWIENIA_ETYKIETA } from '$lib/renewals/staffApi';
	import { wariantDecyzji, wariantStatusu } from './crmRenewals';

	interface Props {
		status: string;
		decyzja?: string | null;
	}
	let { status, decyzja = null }: Props = $props();

	// Po złożeniu ważniejsza jest odpowiedź klienta niż sam stan wniosku.
	const zDecyzja = $derived(status === 'zlozony' && !!decyzja);
</script>

{#if zDecyzja}
	<Badge variant={wariantDecyzji(decyzja)}>{DECYZJA_ETYKIETA[decyzja!] ?? decyzja}</Badge>
{:else}
	<Badge variant={wariantStatusu(status)}>{STATUS_ODNOWIENIA_ETYKIETA[status] ?? status}</Badge>
{/if}
