<script lang="ts">
	import { appState, isAdmin } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fmtPln } from '$lib/utils';
	import KpiCard from '$lib/components/KpiCard.svelte';

	onMount(() => {
		if (!isAdmin(appState.profile)) goto('/dashboard');
	});

	const yr = new Date().getFullYear();
	let dOd = $state(`${yr}-01-01`);
	let dDo = $state(`${yr}-12-31`);

	const knfPolicies = $derived(
		appState.policies.filter(
			(p) => p.rodzaj !== 'polisa_obca' && p.data_od >= dOd && p.data_od <= dDo
		)
	);

	const totals = $derived(
		knfPolicies.reduce(
			(acc, p) => ({
				sPrz: acc.sPrz + Number(p.skladka_przypisana ?? 0),
				sZai: acc.sZai + Number(p.skladka_zainkasowana ?? 0),
				pPrz: acc.pPrz + Number(p.prowizja_przypisana ?? 0),
				pZai: acc.pZai + Number(p.prowizja_zainkasowana ?? 0)
			}),
			{ sPrz: 0, sZai: 0, pPrz: 0, pZai: 0 }
		)
	);
</script>

<svelte:head><title>Raport KNF — FRANK</title></svelte:head>

<h1 class="text-2xl font-semibold text-amber-600 mb-1">Oficjalny Raport KNF</h1>
<p class="text-sm text-slate-500 mb-6">
	Raportowanie wg wytycznych nadzoru.
	<span class="text-red-600 font-semibold">UWAGA:</span> Raport pomija umowy oznaczone jako "Polisa Obca".
</p>

<div class="bg-white border border-slate-200 rounded-xl p-5 mb-6 hide-on-print">
	<div class="flex gap-4 items-end">
		<div>
			<label for="knf-od" class="block text-sm font-medium text-slate-700 mb-1">Data Od</label>
			<input id="knf-od" type="date" bind:value={dOd} class="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
		</div>
		<div>
			<label for="knf-do" class="block text-sm font-medium text-slate-700 mb-1">Data Do</label>
			<input id="knf-do" type="date" bind:value={dDo} class="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
		</div>
		<button onclick={() => window.print()} class="flex items-center gap-2 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition-colors">
			Drukuj PDF
		</button>
	</div>
</div>

<div class="grid grid-cols-5 gap-4 mb-8">
	<KpiCard label="Ilość polis" value={knfPolicies.length} sub="W wybranym okresie" />
	<KpiCard label="Składka Przypisana" value="{fmtPln(totals.sPrz)} PLN" />
	<KpiCard label="Składka Zainkasowana" value="{fmtPln(totals.sZai)} PLN" color="text-blue-600" />
	<KpiCard label="Prowizja Przypisana" value="{fmtPln(totals.pPrz)} PLN" />
	<KpiCard label="Prowizja Zainkasowana" value="{fmtPln(totals.pZai)} PLN" color="text-emerald-600" />
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-4 border-b border-slate-200">
		<h2 class="font-semibold text-slate-900">Rejestr Polis objętych raportem KNF</h2>
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3">Data Od</th>
				<th class="px-5 py-3 text-right">Składka Przyp.</th>
				<th class="px-5 py-3 text-right">Składka Zaink.</th>
				<th class="px-5 py-3 text-right">Prow. Przyp.</th>
				<th class="px-5 py-3 text-right">Prow. Zaink.</th>
			</tr>
		</thead>
		<tbody>
			{#each knfPolicies as p}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">{p.nr_polisy}</td>
					<td class="px-5 py-3">{p.crm_insurers?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">{p.data_od}</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.skladka_zainkasowana)}</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.prowizja_przypisana)}</td>
					<td class="px-5 py-3 text-right font-semibold text-emerald-600">{fmtPln(p.prowizja_zainkasowana)}</td>
				</tr>
			{:else}
				<tr><td colspan="7" class="px-5 py-6 text-center text-slate-400">Brak polis KNF w wybranym okresie</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	@media print {
		.hide-on-print { display: none !important; }
	}
</style>
