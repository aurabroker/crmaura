<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, dateDiffDays, todayStr } from '$lib/utils';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Badge from '$lib/components/Badge.svelte';

	const today = todayStr();

	const renewals = $derived(
		appState.policies.filter((p) => {
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 30;
		})
	);
	const activeClaims = $derived(
		appState.claims.filter((c) => c.status === 'W toku' || c.status === 'Zgłoszona')
	);
</script>

<svelte:head><title>Pulpit — AuraCRM</title></svelte:head>

<h1 class="text-2xl font-semibold text-slate-900">Pulpit Brokera</h1>
<p class="text-sm text-slate-500 mt-1 mb-6">Przegląd kluczowych wskaźników i pilnych operacji</p>

<div class="grid grid-cols-3 gap-4 mb-8">
	<KpiCard label="Polisy do wznowienia (≤30 dni)" value={renewals.length} sub="Wymaga kontaktu z klientem" color="text-amber-500" />
	<KpiCard label="Aktywne Szkody (W toku)" value={activeClaims.length} sub="Oczekujące na likwidację" color="text-red-500" />
	<KpiCard label="Klienci w portfelu" value={appState.clients.length} sub="Razem w systemie" />
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-4 border-b border-slate-200">
		<h2 class="font-semibold text-slate-900">Wznowienia (Polisy)</h2>
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3">Rodzaj</th>
				<th class="px-5 py-3">Koniec ochrony</th>
			</tr>
		</thead>
		<tbody>
			{#each renewals as p}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">{p.nr_polisy}</td>
					<td class="px-5 py-3">{p.crm_clients?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">{p.crm_insurers?.nazwa ?? '—'}</td>
					<td class="px-5 py-3"><Badge variant="neutral">{p.rodzaj}</Badge></td>
					<td class="px-5 py-3 font-semibold text-amber-600">{p.data_do}</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="px-5 py-6 text-center text-slate-400">Brak polis do wznowienia</td></tr>
			{/each}
		</tbody>
	</table>
</div>
