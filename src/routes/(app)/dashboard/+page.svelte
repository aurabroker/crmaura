<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, dateDiffDays, todayStr } from '$lib/utils';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { Settings2, TrendingUp, TrendingDown, Search } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { isBroker } from '$lib/stores/app.svelte';

	const today = todayStr();
	const thisYear = new Date().getFullYear();
	const thisMonth = today.slice(0, 7); // "YYYY-MM"
	const lastMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
	const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

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

	const renewalKeySet = $derived(
		new Set(appState.policies.map((p) => `${p.klient_id}|${p.tu_id}|${p.rodzaj}`))
	);
	const renewedThisYear = $derived(
		expiredThisYear.filter((expired) =>
			renewalKeySet.has(`${expired.klient_id}|${expired.tu_id}|${expired.rodzaj}`)
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

	// --- Nowe widżety ---

	// top_clients: top 5 klientów wg liczby polis
	const topClients = $derived(() => {
		const map = new Map<string, { nazwa: string; count: number; skladka: number }>();
		for (const p of appState.policies) {
			const id = p.klient_id;
			const nazwa = p.crm_clients?.nazwa ?? id;
			const existing = map.get(id);
			if (existing) {
				existing.count++;
				existing.skladka += p.skladka_przypisana ?? 0;
			} else {
				map.set(id, { nazwa, count: 1, skladka: p.skladka_przypisana ?? 0 });
			}
		}
		return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
	});

	// expiring_payments: płatności w ciągu 7 dni
	const in7days = new Date();
	in7days.setDate(in7days.getDate() + 7);
	const in7daysStr = in7days.toISOString().slice(0, 10);
	const expiringPayments = $derived(
		appState.payments.filter((p) => p.status === 'Oczekująca' && p.data_platnosci >= today && p.data_platnosci <= in7daysStr)
			.sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci))
	);

	// policies_by_insurer: top 5 TU wg liczby polis
	const policiesByInsurer = $derived(() => {
		const map = new Map<string, { nazwa: string; count: number }>();
		for (const p of appState.policies) {
			const id = p.tu_id;
			const nazwa = p.crm_insurers?.nazwa ?? id;
			const existing = map.get(id);
			if (existing) { existing.count++; }
			else { map.set(id, { nazwa, count: 1 }); }
		}
		const sorted = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
		const max = sorted[0]?.count ?? 1;
		return sorted.map((i) => ({ ...i, pct: Math.round((i.count / max) * 100) }));
	});

	// monthly_premium: składka przypisana w bieżącym miesiącu vs poprzedni
	const premiumThisMonth = $derived(
		appState.policies
			.filter((p) => p.data_od?.startsWith(thisMonth))
			.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0)
	);
	const premiumLastMonth = $derived(
		appState.policies
			.filter((p) => p.data_od?.startsWith(lastMonth))
			.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0)
	);
	const premiumTrend = $derived(premiumThisMonth >= premiumLastMonth ? 'up' : 'down');

	// policy_count: donut polis wg rodzaju
	const policiesByRodzaj = $derived(() => {
		const map = new Map<string, number>();
		for (const p of appState.policies) {
			if (p.typ_umowy === 'generalna') continue;
			const r = p.rodzaj ?? 'inne';
			map.set(r, (map.get(r) ?? 0) + 1);
		}
		const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
		const total = sorted.reduce((s, [, c]) => s + c, 0);
		const top4 = sorted.slice(0, 4);
		const rest = sorted.slice(4).reduce((s, [, c]) => s + c, 0);
		if (rest > 0) top4.push(['inne', rest]);
		return { total, items: top4.map(([r, c]) => ({ r, c, pct: total > 0 ? Math.round(c / total * 100) : 0 })) };
	});

	// global search
	let globalSearch = $state('');
	let searchOpen = $state(false);
	const SEARCH_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];

	const searchResults = $derived(() => {
		const q = globalSearch.trim().toLowerCase();
		if (q.length < 2) return { clients: [], policies: [], payments: [] };
		const clients = appState.clients.filter(c => (c.nazwa + ' ' + (c.nip ?? '') + ' ' + (c.nazwa_skrocona ?? '')).toLowerCase().includes(q)).slice(0, 4);
		const policies = appState.policies.filter(p => (p.nr_polisy + ' ' + (p.crm_clients?.nazwa ?? '')).toLowerCase().includes(q)).slice(0, 4);
		return { clients, policies };
	});

	// claims_stats: liczba szkód wg statusu
	const claimsStats = $derived(() => {
		const statuses = ['Zgłoszona', 'W toku', 'Wypłacona', 'Odmowa'];
		return statuses.map((s) => ({
			status: s,
			count: appState.claims.filter((c) => c.status === s).length,
			color: s === 'Zgłoszona' ? 'bg-blue-100 text-blue-700' :
				s === 'W toku' ? 'bg-amber-100 text-amber-700' :
				s === 'Wypłacona' ? 'bg-green-100 text-green-700' :
				'bg-red-100 text-red-700'
		}));
	});

	// --- Personalizacja drag & drop ---
	const ALL_WIDGETS = [
		{ id: 'renewals', label: 'Wznowienia' },
		{ id: 'claims', label: 'Aktywne Szkody' },
		{ id: 'clients', label: 'Klienci' },
		{ id: 'renewal_rate', label: 'Skuteczność odnowień' },
		{ id: 'payments', label: 'Zaległe płatności' },
		{ id: 'policy_count', label: 'Liczba polis' },
		{ id: 'top_clients', label: 'Top klienci' },
		{ id: 'expiring_payments', label: 'Nadchodzące raty' },
		{ id: 'policies_by_insurer', label: 'Polisy wg TU' },
		{ id: 'monthly_premium', label: 'Składka miesięczna' },
		{ id: 'claims_stats', label: 'Statystyki szkód' },
	];

	// KPI card widgets that appear in the top drag-and-drop grid
	const KPI_WIDGET_IDS = new Set(['renewals', 'claims', 'clients', 'renewal_rate', 'payments', 'policy_count']);

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

	function mergeKpiOrder(reorderedKpi: typeof kpiItems) {
		// Replace KPI slots in draggableItems with the reordered KPI list
		const nonKpi = draggableItems.filter((w) => !KPI_WIDGET_IDS.has(w.id));
		draggableItems = [...reorderedKpi, ...nonKpi];
	}

	function handleDnd(e: CustomEvent) {
		mergeKpiOrder(e.detail.items);
	}

	async function finalizeDnd(e: CustomEvent) {
		mergeKpiOrder(e.detail.items);
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
		if (id === 'policy_count') return policiesByRodzaj().total;
		return '—';
	}

	function kpiSub(id: string): string {
		if (id === 'renewals') return 'Wymaga kontaktu z klientem';
		if (id === 'claims') return 'Oczekujące na likwidację';
		if (id === 'clients') return 'Razem w systemie';
		if (id === 'renewal_rate') return `${renewedThisYear.length} z ${expiredThisYear.length} wygasłych (${thisYear})`;
		if (id === 'payments') return 'Rat zaległych / przekroczonych';
		if (id === 'policy_count') return `${policiesByRodzaj().items[0]?.r ?? ''} · ${policiesByRodzaj().items[1]?.r ?? ''}`;
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

<svelte:head><title>Pulpit — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Pulpit Brokera</h1>
		<p class="text-sm text-slate-500 mt-1">Przegląd kluczowych wskaźników</p>
	</div>
	<div class="flex items-center gap-3">
		<!-- Globalna wyszukiwarka -->
		<div class="relative">
			<Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
			<input
				bind:value={globalSearch}
				oninput={() => searchOpen = globalSearch.trim().length >= 2}
				onfocus={() => { if (globalSearch.trim().length >= 2) searchOpen = true; }}
				onblur={() => setTimeout(() => searchOpen = false, 150)}
				placeholder="Szukaj klienta, polisy..."
				class="pl-9 pr-4 py-2 w-64 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
			/>
			{#if searchOpen}
			{@const res = searchResults()}
			{#if res.clients.length > 0 || res.policies.length > 0}
			<div class="absolute right-0 top-full mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
				{#if res.clients.length > 0}
					<p class="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Klienci</p>
					{#each res.clients as c}
						<button onclick={() => { goto(`/clients/${c.id}`); searchOpen = false; globalSearch = ''; }}
							class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2">
							<span class="font-medium">{c.nazwa_skrocona ?? c.nazwa}</span>
							{#if c.nip}<span class="text-xs text-slate-400">NIP: {c.nip}</span>{/if}
						</button>
					{/each}
				{/if}
				{#if res.policies.length > 0}
					<p class="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-t border-slate-100">Polisy</p>
					{#each res.policies as p}
						<button onclick={() => { goto(`/policies/${p.id}`); searchOpen = false; globalSearch = ''; }}
							class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2">
							<span class="font-mono font-semibold text-blue-700">{p.nr_polisy}</span>
							<span class="text-slate-500 truncate">{p.crm_clients?.nazwa}</span>
						</button>
					{/each}
				{/if}
			</div>
			{/if}
			{/if}
		</div>
		<button
			onclick={() => configMode = !configMode}
			class="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
		>
			<Settings2 size={15} />
			{configMode ? 'Gotowe' : 'Dostosuj pulpit'}
		</button>
	</div>
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

<!-- KPI Grid — drag & drop (tylko kpi widgety) -->
{#if draggableItems.some((w) => KPI_WIDGET_IDS.has(w.id))}
{@const kpiOnly = draggableItems.filter((w) => KPI_WIDGET_IDS.has(w.id))}
<div
	class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8"
	use:dndzone={{ items: kpiOnly, flipDurationMs: 200 }}
	onconsider={handleDnd}
	onfinalize={finalizeDnd}
>
	{#each kpiOnly as widget (widget.id)}
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
{/if}

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

<!-- Zaległe + Nadchodzące raty — 2 kolumny, każda max 50% -->
{#if appState.dashboardWidgets.includes('payments') || appState.dashboardWidgets.includes('expiring_payments')}
<div class="grid grid-cols-2 gap-6 mb-6">
	<!-- Zaległe płatności -->
	{#if appState.dashboardWidgets.includes('payments') && overduePayments.length > 0}
	<div class="bg-white border border-red-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-4 py-3 border-b border-red-200 flex items-center justify-between">
			<h2 class="font-semibold text-red-700 text-sm">Zaległe płatności</h2>
			<a href="/payments" class="text-xs text-red-500 hover:underline">Wszystkie →</a>
		</div>
		<table class="w-full text-left text-xs">
			<tbody>
				{#each overduePayments.slice(0, 5) as pay}
					<tr class="border-t border-red-100 hover:bg-red-50">
						<td class="px-4 py-2 font-medium text-blue-700"><a href="/policies/{pay.polisa_id}" class="hover:underline">{pay.crm_policies?.nr_polisy ?? '—'}</a></td>
						<td class="px-4 py-2 text-slate-600 truncate max-w-[120px]">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</td>
						<td class="px-4 py-2 text-red-600 font-medium">{pay.data_platnosci}</td>
						<td class="px-4 py-2 text-right font-semibold">{fmtPln(pay.kwota)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{:else if appState.dashboardWidgets.includes('payments')}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex items-center justify-center text-slate-400 text-sm">
		Brak zaległych płatności ✓
	</div>
	{/if}

	<!-- Nadchodzące raty (7 dni) -->
	{#if appState.dashboardWidgets.includes('expiring_payments')}
	<div class="bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-4 py-3 border-b border-amber-200 flex items-center justify-between">
			<h2 class="font-semibold text-amber-700 text-sm">Raty — 7 dni</h2>
			<span class="text-xs text-amber-500">{expiringPayments.length} rat</span>
		</div>
		{#if expiringPayments.length === 0}
			<p class="px-4 py-4 text-center text-slate-400 text-sm">Brak rat w ciągu 7 dni</p>
		{:else}
			<table class="w-full text-left text-xs">
				<tbody>
					{#each expiringPayments.slice(0, 5) as pay}
						<tr class="border-t border-amber-100 hover:bg-amber-50">
							<td class="px-4 py-2 font-medium text-blue-700"><a href="/policies/{pay.polisa_id}" class="hover:underline">{pay.crm_policies?.nr_polisy ?? '—'}</a></td>
							<td class="px-4 py-2 text-slate-600 truncate max-w-[120px]">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</td>
							<td class="px-4 py-2 text-amber-600 font-medium">{pay.data_platnosci}</td>
							<td class="px-4 py-2 text-right font-semibold">{fmtPln(pay.kwota)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
	{/if}
</div>
{/if}

<!-- Top klienci -->
{#if appState.dashboardWidgets.includes('top_clients')}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
	<div class="px-5 py-4 border-b border-slate-200">
		<h2 class="font-semibold text-slate-900">Top 5 klientów wg liczby polis</h2>
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3 text-right">Liczba polis</th>
				<th class="px-5 py-3 text-right">Łączna składka</th>
			</tr>
		</thead>
		<tbody>
			{#each topClients() as c, i}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">
						<span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-xs text-slate-500 mr-2">{i + 1}</span>
						{c.nazwa}
					</td>
					<td class="px-5 py-3 text-right font-semibold text-slate-700">{c.count}</td>
					<td class="px-5 py-3 text-right text-slate-600">{fmtPln(c.skladka)} PLN</td>
				</tr>
			{:else}
				<tr><td colspan="3" class="px-5 py-6 text-center text-slate-400">Brak danych</td></tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}

<!-- Liczba polis — donut -->
{#if appState.dashboardWidgets.includes('policy_count')}
{@const pd = policiesByRodzaj()}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
	<h2 class="font-semibold text-slate-900 mb-4">Liczba polis wg rodzaju</h2>
	{#if pd.total === 0}
		<p class="text-center text-slate-400 text-sm py-4">Brak polis</p>
	{:else}
		{@const stops = (() => {
			let acc = 0;
			return pd.items.map((item, i) => {
				const from = acc;
				acc += item.pct;
				return `${SEARCH_COLORS[i % SEARCH_COLORS.length]} ${from}% ${acc}%`;
			}).join(', ');
		})()}
	<div class="flex items-center gap-8">
		<div class="relative shrink-0 w-24 h-24 rounded-full" style="background: conic-gradient({stops})">
			<div class="absolute inset-3 bg-white rounded-full flex items-center justify-center">
				<span class="text-xs font-bold text-slate-700">{pd.total}</span>
			</div>
		</div>
		<!-- Legenda -->
		<div class="flex-1 space-y-1.5">
			{#each pd.items as item, i}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-3 h-3 rounded-full shrink-0" style="background:{SEARCH_COLORS[i % SEARCH_COLORS.length]}"></span>
					<span class="text-slate-600 truncate flex-1">{item.r}</span>
					<span class="font-semibold text-slate-800">{item.c}</span>
					<span class="text-slate-400 text-xs w-8 text-right">{item.pct}%</span>
				</div>
			{/each}
		</div>
	</div>
	{/if}
</div>
{/if}

<!-- Polisy wg TU — wykres słupkowy CSS -->
{#if appState.dashboardWidgets.includes('policies_by_insurer')}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
	<h2 class="font-semibold text-slate-900 mb-4">Polisy wg TU (top 5)</h2>
	{#if policiesByInsurer().length === 0}
		<p class="text-center text-slate-400 text-sm py-4">Brak danych</p>
	{:else}
		<div class="space-y-3">
			{#each policiesByInsurer() as item}
				<div class="flex items-center gap-3">
					<span class="text-sm text-slate-600 w-32 truncate shrink-0">{item.nazwa}</span>
					<div class="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
						<div class="h-4 bg-blue-500 rounded-full transition-all" style="width: {item.pct}%"></div>
					</div>
					<span class="text-sm font-semibold text-slate-700 w-8 text-right shrink-0">{item.count}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
{/if}

<!-- Składka miesięczna -->
{#if appState.dashboardWidgets.includes('monthly_premium')}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
	<h2 class="font-semibold text-slate-900 mb-1">Składka przypisana — bieżący miesiąc</h2>
	<p class="text-xs text-slate-400 mb-4">{thisMonth.replace('-', '.')}</p>
	<div class="flex items-end gap-4">
		<div>
			<div class="text-3xl font-bold text-slate-900">{fmtPln(premiumThisMonth)} <span class="text-sm font-normal text-slate-400">PLN</span></div>
			<div class="flex items-center gap-1 mt-1 text-sm">
				{#if premiumTrend === 'up'}
					<TrendingUp size={16} class="text-emerald-500" />
					<span class="text-emerald-600">Wzrost vs poprzedni miesiąc</span>
				{:else}
					<TrendingDown size={16} class="text-red-500" />
					<span class="text-red-600">Spadek vs poprzedni miesiąc</span>
				{/if}
			</div>
		</div>
		<div class="ml-auto text-right">
			<div class="text-sm text-slate-400">Poprzedni miesiąc</div>
			<div class="text-lg font-semibold text-slate-500">{fmtPln(premiumLastMonth)} PLN</div>
		</div>
	</div>
</div>
{/if}

<!-- Statystyki szkód (tylko broker) -->
{#if appState.dashboardWidgets.includes('claims_stats') && isBroker()}
<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
	<h2 class="font-semibold text-slate-900 mb-4">Statystyki szkód</h2>
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
		{#each claimsStats() as stat}
			<div class="rounded-xl p-3 {stat.color}">
				<div class="text-2xl font-bold">{stat.count}</div>
				<div class="text-xs font-medium mt-0.5">{stat.status}</div>
			</div>
		{/each}
	</div>
</div>
{/if}
