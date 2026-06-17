<script lang="ts">
	import { portalState } from '$lib/stores/portal.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import { FileText, CreditCard, AlertTriangle, Car } from 'lucide-svelte';

	type Tab = 'polisy' | 'platnosci' | 'szkody' | 'pojazdy';
	let tab = $state<Tab>('polisy');

	const policies = $derived(portalState.policies);
	const payments = $derived(portalState.payments);
	const claims = $derived(portalState.claims);
	const vehicles = $derived(portalState.vehicles);

	// Mapowanie polisa_id → nr_polisy (do płatności i szkód)
	const polNr = $derived(new Map(policies.map((p) => [p.id, p.nr_polisy])));

	const today = new Date().toISOString().slice(0, 10);
	function isPaid(p: { status: string; data_oplacenia: string | null }) {
		return p.status === 'Opłacona' || !!p.data_oplacenia;
	}

	const aktywne = $derived(policies.filter((p) => policyStatus(p.data_do).label === 'Aktywna').length);
	const zalegle = $derived(payments.filter((p) => !isPaid(p) && p.data_platnosci < today));
	const zalegleSuma = $derived(zalegle.reduce((s, p) => s + Number(p.kwota ?? 0), 0));

	function payCls(p: { status: string; data_oplacenia: string | null; data_platnosci: string }) {
		if (isPaid(p)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
		if (p.data_platnosci < today) return 'bg-red-50 text-red-700 border-red-200';
		return 'bg-amber-50 text-amber-700 border-amber-200';
	}
	function payLabel(p: { status: string; data_oplacenia: string | null; data_platnosci: string }) {
		if (isPaid(p)) return 'Opłacona';
		if (p.data_platnosci < today) return 'Zaległa';
		return 'Oczekuje';
	}

	const tabs: { id: Tab; label: string; icon: typeof FileText; count: number }[] = $derived([
		{ id: 'polisy', label: 'Polisy', icon: FileText, count: policies.length },
		{ id: 'platnosci', label: 'Płatności', icon: CreditCard, count: payments.length },
		{ id: 'szkody', label: 'Szkody', icon: AlertTriangle, count: claims.length },
		{ id: 'pojazdy', label: 'Pojazdy', icon: Car, count: vehicles.length }
	]);
</script>

<svelte:head><title>Panel Klienta</title></svelte:head>

<!-- KPI -->
<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
		<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><FileText size={13} /> Aktywne polisy</div>
		<div class="text-2xl font-bold text-slate-900">{aktywne}</div>
		<div class="text-xs text-slate-400">z {policies.length} łącznie</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
		<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><CreditCard size={13} /> Zaległości</div>
		<div class="text-2xl font-bold {zalegleSuma > 0 ? 'text-red-600' : 'text-slate-900'}">{fmtPln(zalegleSuma)}</div>
		<div class="text-xs text-slate-400">{zalegle.length} {zalegle.length === 1 ? 'rata' : 'rat'}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
		<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><AlertTriangle size={13} /> Szkody</div>
		<div class="text-2xl font-bold text-slate-900">{claims.length}</div>
		<div class="text-xs text-slate-400">zgłoszone łącznie</div>
	</div>
</div>

<!-- Zakładki -->
<div class="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
	{#each tabs as t}
		<button
			onclick={() => (tab = t.id)}
			class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors
				{tab === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}"
		>
			<t.icon size={15} />
			{t.label}
			<span class="text-[11px] {tab === t.id ? 'text-blue-400' : 'text-slate-400'}">{t.count}</span>
		</button>
	{/each}
</div>

{#if tab === 'polisy'}
	{#if policies.length === 0}
		<p class="text-sm text-slate-400 py-10 text-center">Brak polis.</p>
	{:else}
		<div class="space-y-3">
			{#each policies as p}
				{@const st = policyStatus(p.data_do)}
				<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2">
					<div class="min-w-[160px]">
						<div class="text-xs text-slate-400 uppercase tracking-wide">{p.rodzaj ?? '—'}</div>
						<div class="font-semibold text-slate-900">{p.nr_polisy}</div>
						{#if p.przedmiot}<div class="text-xs text-slate-500">{p.przedmiot}</div>{/if}
					</div>
					<div class="text-sm text-slate-600">
						<div class="text-[11px] text-slate-400 uppercase">Okres</div>
						{p.data_od} → {p.data_do}
					</div>
					<div class="text-sm text-slate-600">
						<div class="text-[11px] text-slate-400 uppercase">Składka</div>
						{fmtPln(p.skladka_przypisana)} PLN
					</div>
					<span class="ml-auto text-xs font-semibold {st.color}">{st.label}</span>
				</div>
			{/each}
		</div>
	{/if}
{:else if tab === 'platnosci'}
	{#if payments.length === 0}
		<p class="text-sm text-slate-400 py-10 text-center">Brak płatności.</p>
	{:else}
		<div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
					<tr>
						<th class="text-left px-4 py-2.5 font-semibold">Polisa</th>
						<th class="text-left px-4 py-2.5 font-semibold">Rata</th>
						<th class="text-left px-4 py-2.5 font-semibold">Termin</th>
						<th class="text-right px-4 py-2.5 font-semibold">Kwota</th>
						<th class="text-right px-4 py-2.5 font-semibold">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each payments as p}
						<tr class="hover:bg-slate-50">
							<td class="px-4 py-2.5 text-slate-700">{polNr.get(p.polisa_id) ?? '—'}</td>
							<td class="px-4 py-2.5 text-slate-500">{p.nr_raty ?? '—'}</td>
							<td class="px-4 py-2.5 text-slate-600">{p.data_platnosci}</td>
							<td class="px-4 py-2.5 text-right font-medium text-slate-900">{fmtPln(p.kwota)} PLN</td>
							<td class="px-4 py-2.5 text-right">
								<span class="inline-block text-[11px] font-semibold border rounded-full px-2.5 py-0.5 {payCls(p)}">{payLabel(p)}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{:else if tab === 'szkody'}
	{#if claims.length === 0}
		<p class="text-sm text-slate-400 py-10 text-center">Brak zgłoszonych szkód.</p>
	{:else}
		<div class="space-y-3">
			{#each claims as c}
				<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2">
					<div class="min-w-[140px]">
						<div class="text-[11px] text-slate-400 uppercase">Nr szkody</div>
						<div class="font-semibold text-slate-900">{c.nr_szkody ?? '—'}</div>
					</div>
					<div class="text-sm text-slate-600">
						<div class="text-[11px] text-slate-400 uppercase">Data</div>
						{c.data_szkody ?? '—'}
					</div>
					<div class="text-sm text-slate-600">
						<div class="text-[11px] text-slate-400 uppercase">Polisa</div>
						{polNr.get(c.polisa_id ?? '') ?? '—'}
					</div>
					{#if c.opis_szkody}
						<div class="text-sm text-slate-500 max-w-md">{c.opis_szkody}</div>
					{/if}
					<span class="ml-auto text-xs font-semibold text-slate-600">{c.status ?? '—'}</span>
				</div>
			{/each}
		</div>
	{/if}
{:else if tab === 'pojazdy'}
	{#if vehicles.length === 0}
		<p class="text-sm text-slate-400 py-10 text-center">Brak pojazdów.</p>
	{:else}
		<div class="grid sm:grid-cols-2 gap-3">
			{#each vehicles as v}
				<div class="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
					<div class="flex items-center gap-2 mb-1">
						<Car size={15} class="text-slate-400" />
						<span class="font-semibold text-slate-900">{v.nr_rejestracyjny ?? '—'}</span>
					</div>
					<div class="text-sm text-slate-600">{v.marka_model ?? '—'}{v.rok_produkcji ? ` • ${v.rok_produkcji}` : ''}</div>
					{#if v.vin}<div class="text-[11px] text-slate-400 mt-1">VIN: {v.vin}</div>{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}
