<script lang="ts">
	import { appState, isFinance } from '$lib/stores/app.svelte';
	import { sb } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fmtPln } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, FileUp, CheckCircle } from 'lucide-svelte';

	onMount(() => {
		if (!isFinance(appState.profile)) goto('/dashboard');
	});

	let search = $state('');
	let filterStatus = $state<'all' | 'nierozliczona' | 'rozliczona' | 'czesciowo'>('all');

	const rows = $derived(
		appState.policies
			.filter((p) => p.prowizja_przypisana > 0 || p.prowizja_pct > 0)
			.filter((p) => filterStatus === 'all' || ((p as any).rozliczenie_status ?? 'nierozliczona') === filterStatus)
			.filter((p) =>
				!search ||
				p.nr_polisy.toLowerCase().includes(search.toLowerCase()) ||
				(p.crm_clients?.nazwa ?? '').toLowerCase().includes(search.toLowerCase())
			)
	);

	const totalPrzyp = $derived(rows.reduce((s, p) => s + (p.prowizja_przypisana ?? 0), 0));
	const totalZaink = $derived(rows.reduce((s, p) => s + (p.prowizja_zainkasowana ?? 0), 0));

	// Detail modal (view settlement info)
	let showDetail = $state(false);
	let detailPolicy = $state<typeof appState.policies[0] | null>(null);
	function openDetail(p: typeof appState.policies[0]) { detailPolicy = p; showDetail = true; }

	// Rozliczenie modal
	let showSettle = $state(false);
	let settlePolicy = $state<typeof appState.policies[0] | null>(null);
	let settleKwotaTU = $state('');
	let settleStatus = $state<'rozliczona' | 'czesciowo'>('rozliczona');
	let settling = $state(false);
	let settleError = $state('');

	function openSettle(p: typeof appState.policies[0]) {
		settlePolicy = p;
		settleKwotaTU = p.skladka_przypisana.toString();
		settleStatus = 'rozliczona';
		settleError = '';
		showSettle = true;
	}

	async function saveSettle() {
		if (!settlePolicy) return;
		settling = true; settleError = '';
		const kwotaTU = parseFloat(settleKwotaTU) || 0;
		const prowPct = settlePolicy.prowizja_pct;
		const prowKwota = (kwotaTU * prowPct) / 100;
		const isPartial = kwotaTU < settlePolicy.skladka_przypisana;
		const status = isPartial ? 'czesciowo' : settleStatus;

		const { error } = await sb.from('crm_policies').update({
			rozliczenie_status: status,
			rozliczenie_kwota_tu: kwotaTU,
			prowizja_zainkasowana: prowKwota,
			rozliczenie_data: new Date().toISOString().split('T')[0]
		}).eq('id', settlePolicy.id);

		settling = false;
		if (error) { settleError = error.message; return; }
		showSettle = false;
		const { data } = await sb.from('crm_policies').select('*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa)');
		appState.policies = (data ?? []) as typeof appState.policies;
	}

	const rozlStatusLabel: Record<string, string> = {
		nierozliczona: 'Nierozliczona',
		rozliczona: 'Rozliczona',
		czesciowo: 'Częściowo'
	};
	const rozlVariant = (s: string) => s === 'rozliczona' ? 'success' : s === 'czesciowo' ? 'warning' : 'neutral';

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Rozliczenia — FRANK67 CRM</title></svelte:head>

<h1 class="text-2xl font-semibold text-slate-900 mb-1">Rozliczenia i Prowizje</h1>
<p class="text-sm text-slate-500 mb-6">Moduł administracji ubezpieczeniowej</p>

<div class="grid grid-cols-3 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl p-4">
		<div class="text-xs text-slate-500">Prowizja przypisana</div>
		<div class="text-xl font-bold text-slate-900">{fmtPln(totalPrzyp)}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl p-4">
		<div class="text-xs text-slate-500">Prowizja zainkasowana</div>
		<div class="text-xl font-bold text-emerald-600">{fmtPln(totalZaink)}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl p-4">
		<div class="text-xs text-slate-500">Różnica</div>
		<div class="text-xl font-bold text-amber-600">{fmtPln(totalPrzyp - totalZaink)}</div>
	</div>
</div>

<div class="flex gap-3 mb-4">
	<div class="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nr polisy lub kliencie..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	{#each [['all','Wszystkie'],['nierozliczona','Nierozliczone'],['czesciowo','Częściowe'],['rozliczona','Rozliczone']] as [val, label]}
		<button
			onclick={() => filterStatus = val as typeof filterStatus}
			class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap
				{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
		>{label}</button>
	{/each}
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3 text-right">Składka Przyp.</th>
				<th class="px-5 py-3 text-right">% Prow.</th>
				<th class="px-5 py-3 text-right">Prow. Przyp.</th>
				<th class="px-5 py-3 text-right">Prow. Zaink.</th>
				<th class="px-5 py-3">Rozliczenie</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as p}
				{@const rs = (p as any).rozliczenie_status ?? 'nierozliczona'}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">{p.nr_polisy}</td>
					<td class="px-5 py-3">{p.crm_clients?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">{p.crm_insurers?.nazwa ?? '—'}</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3 text-right">{Number(p.prowizja_pct).toFixed(2)}%</td>
					<td class="px-5 py-3 text-right">{fmtPln(p.prowizja_przypisana)}</td>
					<td class="px-5 py-3 text-right font-semibold text-emerald-600">{fmtPln(p.prowizja_zainkasowana)}</td>
					<td class="px-5 py-3">
						{#if rs !== 'nierozliczona'}
							<button onclick={() => openDetail(p)} class="hover:opacity-80 transition-opacity">
								<Badge variant={rozlVariant(rs)}>{rozlStatusLabel[rs] ?? rs} ↗</Badge>
							</button>
						{:else}
							<Badge variant={rozlVariant(rs)}>{rozlStatusLabel[rs] ?? rs}</Badge>
						{/if}
					</td>
					<td class="px-5 py-3">
						<button onclick={() => openSettle(p)} class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
							<CheckCircle size={13} />
							Rozlicz
						</button>
					</td>
				</tr>
			{:else}
				<tr><td colspan="9" class="px-5 py-6 text-center text-slate-400">Brak naliczonych prowizji</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<Modal title="Szczegóły rozliczenia — {detailPolicy?.nr_polisy ?? ''}" open={showDetail} onclose={() => showDetail = false}>
	{#snippet footer()}
		<button onclick={() => showDetail = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>
		<button onclick={() => { showDetail = false; openSettle(detailPolicy!); }} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">
			Edytuj rozliczenie
		</button>
	{/snippet}
	{#if detailPolicy}
	<div class="space-y-3">
		<div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2 text-sm">
			<div class="flex justify-between"><span class="text-slate-600">Status:</span> <strong class="text-emerald-700">{rozlStatusLabel[(detailPolicy as any).rozliczenie_status] ?? (detailPolicy as any).rozliczenie_status}</strong></div>
			<div class="flex justify-between"><span class="text-slate-600">Składka wg TU:</span> <strong>{fmtPln((detailPolicy as any).rozliczenie_kwota_tu ?? 0)}</strong></div>
			<div class="flex justify-between"><span class="text-slate-600">Prowizja zainkasowana:</span> <strong class="text-emerald-700">{fmtPln(detailPolicy.prowizja_zainkasowana)}</strong></div>
			{#if (detailPolicy as any).rozliczenie_data}
				<div class="flex justify-between"><span class="text-slate-600">Data rozliczenia:</span> <strong>{(detailPolicy as any).rozliczenie_data}</strong></div>
			{/if}
			{#if detailPolicy.rozliczenie_plik}
				<div class="flex justify-between items-center"><span class="text-slate-600">Dokument:</span> <a href={detailPolicy.rozliczenie_plik} target="_blank" class="text-blue-600 hover:underline text-xs">📎 Pobierz plik</a></div>
			{:else}
				<div class="flex justify-between"><span class="text-slate-600">Dokument:</span> <span class="text-slate-400 text-xs">brak załączonego pliku</span></div>
			{/if}
		</div>
		<div class="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
			<div>Składka przypisana: <strong>{fmtPln(detailPolicy.skladka_przypisana)}</strong></div>
			<div>% Prowizji: <strong>{detailPolicy.prowizja_pct}%</strong></div>
			<div>Prowizja przypisana: <strong>{fmtPln(detailPolicy.prowizja_przypisana)}</strong></div>
		</div>
	</div>
	{/if}
</Modal>

<Modal title="Rozlicz polisę — {settlePolicy?.nr_polisy ?? ''}" open={showSettle} onclose={() => { showSettle = false; settleError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showSettle = false; settleError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveSettle} disabled={settling} class="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-60">
			{settling ? 'Zapisywanie...' : 'Rozlicz'}
		</button>
	{/snippet}
	{#if settleError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{settleError}</div>{/if}
	{#if settlePolicy}
	<div class="space-y-4">
		<div class="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
			<div>Składka przypisana: <strong>{fmtPln(settlePolicy.skladka_przypisana)}</strong></div>
			<div>% Prowizji: <strong>{settlePolicy.prowizja_pct}%</strong></div>
			<div>Prowizja przypisana: <strong>{fmtPln(settlePolicy.prowizja_przypisana)}</strong></div>
		</div>
		<div>
			<label class={labelCls}>Kwota składki wg noty TU (od której liczona prowizja)</label>
			<input type="number" step="0.01" bind:value={settleKwotaTU} class={inputCls} />
			<p class="text-xs text-slate-400 mt-1">Jeśli mniejsza od przypisanej — polisa rozliczona częściowo</p>
		</div>
		<div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
			Prowizja do zainkasowania: <strong class="text-emerald-700">{fmtPln(((parseFloat(settleKwotaTU) || 0) * settlePolicy.prowizja_pct) / 100)}</strong>
		</div>
	</div>
	{/if}
</Modal>
