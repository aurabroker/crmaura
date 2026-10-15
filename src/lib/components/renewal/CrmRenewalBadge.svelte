<script lang="ts">
	import Badge from '$lib/components/Badge.svelte';
	import { STATUS_ODNOWIENIA_ETYKIETA, etykietaDecyzji } from '$lib/renewals/staffApi';
	import { wariantDecyzji, wariantStatusu } from './crmRenewals';

	interface Props {
		status: string;
		decyzja?: string | null;
		/** odnowienie (domyślnie) albo nowa — pierwsza polisa: „nie” znaczy rezygnację z ubezpieczenia. */
		rodzaj?: string | null;
	}
	let { status, decyzja = null, rodzaj = 'odnowienie' }: Props = $props();

	// Po złożeniu ważniejsza jest odpowiedź klienta niż sam stan wniosku.
	const zDecyzja = $derived(status === 'zlozony' && !!decyzja);
</script>

{#if zDecyzja}
	<Badge variant={wariantDecyzji(decyzja)}>{etykietaDecyzji(decyzja, rodzaj)}</Badge>
{:else}
	<Badge variant={wariantStatusu(status)}>{STATUS_ODNOWIENIA_ETYKIETA[status] ?? status}</Badge>
{/if}
