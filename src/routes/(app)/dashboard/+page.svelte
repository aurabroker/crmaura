<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, dateDiffDays, todayStr } from '$lib/utils';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { Settings2 } from 'lucide-svelte';

	const today = todayStr();
	const thisYear = new Date().getFullYear();

	// --- Obliczenia KPI ---
	const renewals = $derived(
		appState.policies.filter((p) => {
			const d = dateDiffDays(today, p.data_do);
			return d >= 0 && d <= 30;
		})
	);

	const activeClaims = $derived(
		appState.claims.filter((c) => c.status === 'W toku' || c.status === 'Zgłoszona')
	);

	// Renewal rate: polisy wygasłe w tym roku vs ile zostało wznowionych
	const expiredThisYear = $derived(
		appState.policies.filter((p) => {
			const yr = p.data_do?.slice(0, 4);
			return yr === String(thisYear) && dateDiffDays(today, p.data_do) < 0;
		})
	);

	const renewedThisYear = $derived(
		expiredThisYear.filter((expired) =>
			appState.policies.some(
				(p) =>
					p.klient_id === expired.klient_id &&
					p.tu_id === expired.tu_id &&
					p.rodzaj === expired.rodzaj &&
					p.data_od > expired.data_do
			)
		)
	);

	const renewalRate = $derived(
		expiredThisYear.length > 0
			? Math.round((renewedThisYear.length / expiredThisYear.length) * 100)
			: null
	);

	// Płatności zaległe
	const overduePayments = $derived(
		appState.payments.filter((p) => p.status === 'Zaległa' || (p.status === 'Oczekująca' && p.data_platnosci < today))
	);

	// --- Personalizacja drag & drop ---
	const ALL_WIDGETS = [
		{ id: 'renewals', label: 'Wznowienia' },
		{ id: 'claims', label: 'Aktywne Szkody' },
		{ id: 'clients', label: 'Klienci' },
		{ id: 'renewal_rate', label: 'Skuteczność odnowień' },
		{ id: 'payments', label: 'Zaległe płatności' },
	];

	let configMode = $state(false);

	let kpiItems = $derived(
		ALL_WIDGETS
			.filter((w) => appState.dashboardWidgets.includes(w.id))
			.sort((a, b) => appState.dashboardWidgets.indexOf(a.id) - appState.dashboardWidgets.indexOf(b.id))
			.map((w) => ({ ...w }))
	);

	let draggableItems = $state<typeof kpiItems>([]);

	$effect(() => {
		draggableItems = [...kpiItems];
	});

	function handleDnd(e: CustomEvent) {
		draggableItems = e.detail.items;
	}

	async function finalizeDnd(e: CustomEvent) {
		draggableItems = e.detail.items;
		const order = draggableItems.map((i) => i.id);
		appState.dashboardWidgets = order;
		await sb.from('crm_dashboard_prefs').upsert({
			user_id: appState.profile!.id,
			widgets: order,
			updated_at: new Date().toISOString()
		});
	}

	async function toggleWidget(id: string) {
		const current = appState.dashboardWidgets;
		const next = current.includes(id) ? current.filter((w) => w !== id) : [...current, id];
		appState.dashboardWidgets = next;
		await sb.from('crm_dashboard_prefs').upsert({
			user_id: appState.profile!.id,
			widgets: next,
			updated_at: new Date().toISOString()
		});
	}

	function kpiValue(id: string): string | number {
		if (id === 'renewals') return renewals.length;
		if (id === 'claims') return activeClaims.length;
		if (id === 'clients') return appState.clients.length;
		if (id === 'renewal_rate') return renewalRate != null ? `${renewalRate}%` : '—';
		if (id === 'payments') return overduePayments.length;
		return '—';
	}

	function kpiSub(id: string): string {
		if (id === 'renewals') return 'Wymaga kontaktu z klientem';
		if (id === 'claims') return 'Oczekujące na likwidację';
		if (id === 'clients') return 'Razem w systemie';
		if (id === 'renewal_rate') return `${renewedThisYear.length} z ${expiredThisYear.length} wygasłych (${thisYear})`;
		if (id === 'payments') return 'Rat zaległych / przekroczonych';
		return '';
	}

	function kpiColor(id: string): string {
		if (id === 'renewals') return 'text-amber-500';
		if (id === 'claims') return 'text-red-500';
		if (id === 'renewal_rate') return renewalRate != null && renewalRate >= 70 ? 'text-emerald-600' : 'text-amber-500';
		if (id === 'payments') return overduePayments.length > 0 ? 'text-red-500' : 'text-emerald-600';
		return 'text-slate-900';
	}
</script>

<svelte:head><title>Pulpit — AuraCRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Pulpit Brokera</h1>
		<p class="text-sm text-slate-500 mt-1">Przegląd kluczowych wskaźników</p>
	</div>
	<button
		onclick={() => configMode = !configMode}
		class="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
	>
		<Settings2 size={15} />
		{configMode ? 'Gotowe' : 'Dostosuj pulpit'}
	</button>
</div>

{#if configMode}
	<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
		<p class="text-sm font-medium text-blue-700 mb-3">Wybierz widżety i przeciągnij aby zmienić kolejność</p>
		<div class="flex flex-wrap gap-2 mb-4">
			{#each ALL_WIDGETS as w}
				<button
					onclick={() => toggleWidget(w.id)}
					class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
						{appState.dashboardWidgets.includes(w.id)
							? 'bg-blue-600 text-white border-blue-600'
							: 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
				>
					{w.label}
				</button>
			{/each}
		</div>
		<p class="text-xs text-blue-500">Przeciągnij kafelki poniżej aby zmienić kolejność</p>
	</div>
{/if}

<!-- KPI Grid — drag & drop -->
<div
	class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8"
	use:dndzone={{ items: draggableItems, flipDurationMs: 200 }}
	onconsider={handleDnd}
	onfinalize={finalizeDnd}
>
	{#each draggableItems as widget (widget.id)}
		<div class={configMode ? 'cursor-grab active:cursor-grabbing' : ''}>
			<KpiCard
				label={ALL_WIDGETS.find((w) => w.id === widget.id)?.label ?? widget.id}
				value={kpiValue(widget.id)}
				sub={kpiSub(widget.id)}
				color={kpiColor(widget.id)}
			/>
		</div>
	{/each}
</div>

<!-- Tabela wznowień -->
{#if appState.dashboardWidgets.includes('renewals')}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
	<div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
		<h2 class="font-semibold text-slate-900">Wznowienia (≤30 dni)</h2>
		<span class="text-xs text-slate-400">{renewals.length} polis</span>
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
{/if}

<!-- Zaległe płatności mini-lista -->
{#if appState.dashboardWidgets.includes('payments') && overduePayments.length > 0}
<div class="bg-white border border-red-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-4 border-b border-red-200 flex items-center justify-between">
		<h2 class="font-semibold text-red-700">Zaległe płatności</h2>
		<a href="/payments" class="text-xs text-red-500 hover:underline">Zobacz wszystkie →</a>
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-red-50 text-[11px] font-semibold text-red-400 uppercase tracking-wide">
				<th class="px-5 py-3">Polisa</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">Rata</th>
				<th class="px-5 py-3">Termin</th>
				<th class="px-5 py-3 text-right">Kwota</th>
			</tr>
		</thead>
		<tbody>
			{#each overduePayments.slice(0, 5) as pay}
				<tr class="border-t border-red-100 hover:bg-red-50">
					<td class="px-5 py-3 font-medium">{pay.crm_policies?.nr_polisy ?? '—'}</td>
					<td class="px-5 py-3">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">Rata {pay.nr_raty}</td>
					<td class="px-5 py-3 text-red-600 font-medium">{pay.data_platnosci}</td>
					<td class="px-5 py-3 text-right font-semibold">{fmtPln(pay.kwota)} PLN</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}
