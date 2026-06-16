<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { fmtPln } from '$lib/utils';
	import type { PolicyPayment } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { Calculator } from 'lucide-svelte';

	let loading = $state(true);
	let payments = $state<PolicyPayment[]>([]);

	onMount(async () => {
		const { data } = await sb.from('crm_policy_payments')
			.select('*, crm_policies(nr_polisy)')
			.order('data_platnosci');
		payments = (data ?? []) as PolicyPayment[];
		loading = false;
	});

	const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
		'Opłacona': 'success',
		'Oczekująca': 'info',
		'Zaległa': 'error',
		'Częściowo opłacona': 'warning'
	};
</script>

<svelte:head><title>Płatności — Panel Klienta</title></svelte:head>

<h1 class="text-2xl font-bold text-slate-900 mb-6">Płatności</h1>

{#if loading}
	<div class="text-slate-400 text-sm">Ładowanie...</div>
{:else if payments.length === 0}
	<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400">
		<Calculator size={32} class="mx-auto mb-2 text-slate-300" />
		Nie masz zarejestrowanych płatności.
	</div>
{:else}
<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
	<table class="w-full text-sm">
		<thead class="bg-slate-50 text-slate-500 text-xs uppercase">
			<tr>
				<th class="text-left px-4 py-3">Polisa</th>
				<th class="text-left px-4 py-3">Rata</th>
				<th class="text-left px-4 py-3">Termin</th>
				<th class="text-right px-4 py-3">Kwota</th>
				<th class="text-left px-4 py-3">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each payments as p}
				<tr class="border-t border-slate-100">
					<td class="px-4 py-3 font-medium text-slate-900">{p.crm_policies?.nr_polisy ?? '—'}</td>
					<td class="px-4 py-3 text-slate-600">{p.nr_raty}</td>
					<td class="px-4 py-3 text-slate-600">{p.data_platnosci}</td>
					<td class="px-4 py-3 text-right text-slate-900">{fmtPln(p.kwota)} zł</td>
					<td class="px-4 py-3"><Badge variant={statusVariant[p.status] ?? 'neutral'}>{p.status}</Badge></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}
