<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import { assignedPolicyFor } from '$lib/utils';
	import type { Vehicle, Policy } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { Car } from 'lucide-svelte';

	let loading = $state(true);
	let vehicles = $state<Vehicle[]>([]);
	let policies = $state<Pick<Policy, 'id' | 'pojazd_id' | 'deleted_at' | 'nr_polisy'>[]>([]);

	onMount(async () => {
		const klientId = portalState.client?.id;
		if (!klientId) return;
		const [rV, rP] = await Promise.all([
			sb.from('crm_vehicles').select('*').eq('klient_id', klientId),
			sb.from('crm_policies').select('id, pojazd_id, deleted_at, nr_polisy').eq('klient_id', klientId)
		]);
		vehicles = (rV.data ?? []) as Vehicle[];
		policies = rP.data ?? [];
		loading = false;
	});
</script>

<svelte:head><title>Pojazdy — Panel Klienta</title></svelte:head>

<h1 class="text-2xl font-bold text-slate-900 mb-6">Pojazdy</h1>

{#if loading}
	<div class="text-slate-400 text-sm">Ładowanie...</div>
{:else if vehicles.length === 0}
	<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400">
		<Car size={32} class="mx-auto mb-2 text-slate-300" />
		Nie masz zarejestrowanych pojazdów.
	</div>
{:else}
<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
	<table class="w-full text-sm">
		<thead class="bg-slate-50 text-slate-500 text-xs uppercase">
			<tr>
				<th class="text-left px-4 py-3">Nr rejestracyjny</th>
				<th class="text-left px-4 py-3">Marka / model</th>
				<th class="text-left px-4 py-3">VIN</th>
				<th class="text-left px-4 py-3">Polisa</th>
			</tr>
		</thead>
		<tbody>
			{#each vehicles as v}
				{@const assigned = assignedPolicyFor(v.id, policies)}
				<tr class="border-t border-slate-100">
					<td class="px-4 py-3 font-medium text-slate-900">{v.nr_rejestracyjny}</td>
					<td class="px-4 py-3 text-slate-600">{v.marka_model}</td>
					<td class="px-4 py-3 text-slate-600">{v.vin ?? '—'}</td>
					<td class="px-4 py-3">
						{#if assigned}
							<Badge variant="success">{assigned.nr_polisy}</Badge>
						{:else}
							<Badge variant="neutral">Brak polisy</Badge>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}
