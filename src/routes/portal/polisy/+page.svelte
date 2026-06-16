<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Policy } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { FileText } from 'lucide-svelte';

	let loading = $state(true);
	let policies = $state<Policy[]>([]);

	onMount(async () => {
		const klientId = portalState.client?.id;
		if (!klientId) return;
		const { data } = await sb.from('crm_policies')
			.select('*, crm_insurers(nazwa, skrot)')
			.eq('klient_id', klientId)
			.is('deleted_at', null)
			.order('data_do', { ascending: false });
		policies = (data ?? []) as Policy[];
		loading = false;
	});

	const statusVariant: Record<string, 'success' | 'warning' | 'error'> = {
		'Aktywna': 'success',
		'Wygasa': 'warning',
		'Zakończona': 'error'
	};
</script>

<svelte:head><title>Polisy — Panel Klienta</title></svelte:head>

<h1 class="text-2xl font-bold text-slate-900 mb-6">Polisy</h1>

{#if loading}
	<div class="text-slate-400 text-sm">Ładowanie...</div>
{:else if policies.length === 0}
	<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400">
		<FileText size={32} class="mx-auto mb-2 text-slate-300" />
		Nie masz jeszcze żadnych polis.
	</div>
{:else}
<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
	<table class="w-full text-sm">
		<thead class="bg-slate-50 text-slate-500 text-xs uppercase">
			<tr>
				<th class="text-left px-4 py-3">Nr polisy</th>
				<th class="text-left px-4 py-3">Rodzaj</th>
				<th class="text-left px-4 py-3">TU</th>
				<th class="text-left px-4 py-3">Okres</th>
				<th class="text-right px-4 py-3">Składka</th>
				<th class="text-left px-4 py-3">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each policies as p}
				{@const st = policyStatus(p.data_do)}
				<tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onclick={() => window.location.assign(`/portal/polisy/${p.id}`)}>
					<td class="px-4 py-3 font-medium text-slate-900">{p.nr_polisy}</td>
					<td class="px-4 py-3 text-slate-600">{p.rodzaj}</td>
					<td class="px-4 py-3 text-slate-600">{p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? '—'}</td>
					<td class="px-4 py-3 text-slate-600">{p.data_od} – {p.data_do}</td>
					<td class="px-4 py-3 text-right text-slate-900">{fmtPln(p.skladka_przypisana)} zł</td>
					<td class="px-4 py-3"><Badge variant={statusVariant[st.label] ?? 'neutral'}>{st.label}</Badge></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}
