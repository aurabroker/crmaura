<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Bond } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { fmtPln } from '$lib/utils';
	import { Search, Landmark } from 'lucide-svelte';

	let loading = $state(true);
	let search = $state('');
	let filterRodzaj = $state('all');

	const today = new Date().toISOString().slice(0, 10);

	const RODZAJE = ['Należyte wykonanie', 'Usunięcie wad', 'Przetargowa', 'Zaliczkowa', 'Rękojmia'];

	async function loadBonds() {
		loading = true;
		const { data } = await sb
			.from('bond_bonds')
			.select('*, bond_tenants(bond_nazwa, crm_client_id), bond_insurers(bond_nazwa)')
			.order('bond_data_do', { ascending: true });
		appState.bonds = (data ?? []) as Bond[];
		loading = false;
	}

	onMount(loadBonds);

	const filtered = $derived(
		appState.bonds
			.filter((b) => filterRodzaj === 'all' || b.bond_rodzaj === filterRodzaj)
			.filter((b) =>
				!search ||
				b.bond_nr.toLowerCase().includes(search.toLowerCase()) ||
				(b.bond_tenants?.bond_nazwa ?? '').toLowerCase().includes(search.toLowerCase()) ||
				(b.bond_kontrakt ?? '').toLowerCase().includes(search.toLowerCase())
			)
	);

	const sumaSumy = $derived(filtered.reduce((s, b) => s + (b.bond_suma ?? 0), 0));
	const sumaSkladki = $derived(filtered.reduce((s, b) => s + (b.bond_skladka ?? 0), 0));

	function statusBond(b: Bond): { label: string; variant: 'success' | 'error' | 'warning' } {
		if (b.bond_data_do < today) return { label: 'Wygasła', variant: 'error' };
		const days = Math.ceil((new Date(b.bond_data_do).getTime() - Date.now()) / 86400000);
		if (days <= 30) return { label: `Wygasa za ${days}d`, variant: 'warning' };
		return { label: 'Aktywna', variant: 'success' };
	}
</script>

<svelte:head><title>Bonds — FRANK67 CRM</title></svelte:head>

{#if !appState.bondModuleEnabled}
	<div class="flex flex-col items-center justify-center py-32 text-center">
		<Landmark size={48} class="text-slate-300 mb-4" />
		<h2 class="text-xl font-semibold text-slate-700 mb-2">Moduł Bonds niedostępny</h2>
		<p class="text-sm text-slate-400">Skontaktuj się z administratorem, aby aktywować moduł zarządzania gwarancjami.</p>
	</div>
{:else}
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Gwarancje</h1>
			<p class="text-sm text-slate-500 mt-1">Portfel gwarancji kontraktowych</p>
		</div>
	</div>

	<!-- KPI -->
	<div class="grid grid-cols-3 gap-4 mb-6">
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
			<div class="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-1">Liczba gwarancji</div>
			<div class="text-2xl font-bold text-slate-900">{filtered.length}</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
			<div class="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-1">Łączna suma gwarancyjna</div>
			<div class="text-2xl font-bold text-slate-900">{fmtPln(sumaSumy)} PLN</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
			<div class="text-xs text-slate-400 uppercase font-semibold tracking-wide mb-1">Łączna składka</div>
			<div class="text-2xl font-bold text-slate-900">{fmtPln(sumaSkladki)} PLN</div>
		</div>
	</div>

	<!-- Filtry -->
	<div class="flex gap-3 mb-4">
		<div class="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2">
			<Search size={15} class="text-slate-400" />
			<input bind:value={search} placeholder="Szukaj po nr, kliencie lub kontrakcie..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
		</div>
		<button
			onclick={() => filterRodzaj = 'all'}
			class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap
				{filterRodzaj === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
		>Wszystkie</button>
		{#each RODZAJE as r}
			<button
				onclick={() => filterRodzaj = r}
				class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap
					{filterRodzaj === r ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
			>{r}</button>
		{/each}
	</div>

	<!-- Tabela -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		{#if loading}
			<div class="py-16 text-center text-slate-400 text-sm">Ładowanie...</div>
		{:else}
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-3">Nr gwarancji</th>
					<th class="px-5 py-3">Klient</th>
					<th class="px-5 py-3">Rodzaj</th>
					<th class="px-5 py-3">TU</th>
					<th class="px-5 py-3">Kontrakt</th>
					<th class="px-5 py-3 text-right">Suma gwarancyjna</th>
					<th class="px-5 py-3 text-right">Składka</th>
					<th class="px-5 py-3">Ważność do</th>
					<th class="px-5 py-3">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as b}
					{@const st = statusBond(b)}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-3 font-medium font-mono text-xs">{b.bond_nr}</td>
						<td class="px-5 py-3">
							{#if b.bond_tenants?.crm_client_id}
								<a href="/clients/{b.bond_tenants.crm_client_id}" class="text-blue-600 hover:underline font-medium">
									{b.bond_tenants.bond_nazwa}
								</a>
							{:else}
								{b.bond_tenants?.bond_nazwa ?? '—'}
							{/if}
						</td>
						<td class="px-5 py-3 text-slate-600">{b.bond_rodzaj}</td>
						<td class="px-5 py-3 text-slate-600">{b.bond_insurers?.bond_nazwa ?? '—'}</td>
						<td class="px-5 py-3 text-xs text-slate-500 max-w-[180px] truncate" title={b.bond_kontrakt ?? ''}>{b.bond_kontrakt ?? '—'}</td>
						<td class="px-5 py-3 text-right font-medium">{fmtPln(b.bond_suma)} PLN</td>
						<td class="px-5 py-3 text-right">{fmtPln(b.bond_skladka)} PLN</td>
						<td class="px-5 py-3 text-slate-600">{b.bond_data_do}</td>
						<td class="px-5 py-3"><Badge variant={st.variant}>{st.label}</Badge></td>
					</tr>
				{:else}
					<tr><td colspan="9" class="px-5 py-8 text-center text-slate-400">Brak gwarancji</td></tr>
				{/each}
			</tbody>
		</table>
		{/if}
	</div>
{/if}
