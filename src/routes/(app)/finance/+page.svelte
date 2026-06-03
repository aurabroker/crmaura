<script lang="ts">
	import { appState, isFinance } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fmtPln } from '$lib/utils';

	onMount(() => {
		if (!isFinance(appState.profile)) goto('/dashboard');
	});

	const rows = $derived(appState.policies.filter((p) => p.prowizja_przypisana > 0 || p.prowizja_pct > 0));
</script>

<svelte:head><title>Rozliczenia — FRANK</title></svelte:head>

<h1 class="text-2xl font-semibold text-slate-900 mb-1">Rozliczenia i Prowizje</h1>
<p class="text-sm text-slate-500 mb-6">Moduł administracji ubezpieczeniowej</p>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3 text-right">Składka Przyp.</th>
				<th class="px-5 py-3 text-right">Składka Zaink.</th>
				<th class="px-5 py-3 text-right">% Prow.</th>
				<th class="px-5 py-3 text-right">Prow. Przyp.</th>
				<th class="px-5 py-3 text-right text-emerald-600">Prow. Zaink.</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as p}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">{p.nr_polisy}</td>
					<td class="px-5 py-3">{p.crm_insurers?.nazwa ?? '—'}</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.skladka_zainkasowana)}</td>
					<td class="px-5 py-3 text-right">{Number(p.prowizja_pct).toFixed(2)}%</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.prowizja_przypisana)}</td>
					<td class="px-5 py-3 text-right font-semibold text-emerald-600">{fmtPln(p.prowizja_zainkasowana)}</td>
				</tr>
			{:else}
				<tr><td colspan="7" class="px-5 py-6 text-center text-slate-400">Brak naliczonych prowizji</td></tr>
			{/each}
		</tbody>
	</table>
</div>
