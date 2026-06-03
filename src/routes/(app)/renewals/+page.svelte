<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import { Search } from 'lucide-svelte';

	let search = $state('');
	let sortAsc = $state(true);

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	function daysUntil(dateStr: string): number {
		const d = new Date(dateStr);
		d.setHours(0, 0, 0, 0);
		return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
	}

	const filtered = $derived(
		appState.policies
			.filter((p) => {
				if (!search) return true;
				const s = search.toLowerCase();
				return (
					p.nr_polisy.toLowerCase().includes(s) ||
					(p.crm_clients?.nazwa ?? '').toLowerCase().includes(s)
				);
			})
			.sort((a, b) => {
				const da = new Date(a.data_do).getTime();
				const db = new Date(b.data_do).getTime();
				return sortAsc ? da - db : db - da;
			})
	);

	const expiredCount = $derived(filtered.filter((p) => daysUntil(p.data_do) < 0).length);
	const in30Count = $derived(filtered.filter((p) => { const d = daysUntil(p.data_do); return d >= 0 && d <= 30; }).length);
	const in60Count = $derived(filtered.filter((p) => { const d = daysUntil(p.data_do); return d > 30 && d <= 60; }).length);

	function rowClass(dataDoStr: string): string {
		const days = daysUntil(dataDoStr);
		if (days < 0) return 'bg-red-50';
		if (days <= 30) return 'bg-amber-50';
		if (days <= 60) return 'bg-emerald-50';
		return '';
	}

	function statusBadge(dataDoStr: string): { label: string; variant: 'error' | 'warning' | 'success' } {
		const days = daysUntil(dataDoStr);
		if (days < 0) return { label: 'Wygasła', variant: 'error' };
		if (days <= 30) return { label: 'Wygasa wkrótce', variant: 'warning' };
		return { label: 'Aktywna', variant: 'success' };
	}
</script>

<svelte:head><title>Odnowienia — FRANK67 CRM</title></svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold text-slate-900">Odnowienia</h1>

	<!-- Summary cards -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
			<p class="text-sm text-slate-500">Wygasłe</p>
			<p class="mt-1 text-3xl font-bold text-red-600">{expiredCount}</p>
		</div>
		<div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
			<p class="text-sm text-slate-500">Wygasa w 30 dni</p>
			<p class="mt-1 text-3xl font-bold text-amber-600">{in30Count}</p>
		</div>
		<div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
			<p class="text-sm text-slate-500">Wygasa w 60 dni</p>
			<p class="mt-1 text-3xl font-bold text-emerald-600">{in60Count}</p>
		</div>
	</div>

	<!-- Controls -->
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="relative">
			<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				bind:value={search}
				placeholder="Szukaj klienta lub nr polisy..."
				class="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-80"
			/>
		</div>
		<button
			onclick={() => (sortAsc = !sortAsc)}
			class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
		>
			{sortAsc ? 'Najwcześniej wygasa' : 'Najpóźniej wygasa'}
		</button>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
		<table class="min-w-full text-sm">
			<thead>
				<tr class="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
					<th class="px-4 py-3">Nr Polisy</th>
					<th class="px-4 py-3">Klient</th>
					<th class="px-4 py-3">TU</th>
					<th class="px-4 py-3">Rodzaj</th>
					<th class="px-4 py-3">Data do</th>
					<th class="px-4 py-3 text-right">Składka</th>
					<th class="px-4 py-3">Status</th>
					<th class="px-4 py-3 text-right">Dni do wygaśnięcia</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each filtered as p (p.id)}
					{@const days = daysUntil(p.data_do)}
					{@const badge = statusBadge(p.data_do)}
					<tr class="{rowClass(p.data_do)} hover:bg-slate-50/50 transition-colors">
						<td class="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{p.nr_polisy}</td>
						<td class="px-4 py-3 text-slate-700">{p.crm_clients?.nazwa ?? '—'}</td>
						<td class="px-4 py-3 text-slate-700">{p.crm_insurers?.nazwa ?? '—'}</td>
						<td class="px-4 py-3 text-slate-700">{p.rodzaj ?? '—'}</td>
						<td class="whitespace-nowrap px-4 py-3 text-slate-700">{p.data_do}</td>
						<td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">{fmtPln(p.skladka_przypisana)}</td>
						<td class="px-4 py-3">
							<Badge variant={badge.variant}>{badge.label}</Badge>
						</td>
						<td class="whitespace-nowrap px-4 py-3 text-right font-medium {days < 0 ? 'text-red-600' : days <= 30 ? 'text-amber-600' : 'text-slate-700'}">
							{days}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if filtered.length === 0}
			<div class="py-12 text-center text-sm text-slate-400">Brak polis do wyświetlenia</div>
		{/if}
	</div>
</div>
