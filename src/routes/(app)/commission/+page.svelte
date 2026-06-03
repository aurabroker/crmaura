<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, todayStr } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Download, CheckCircle } from 'lucide-svelte';

	const today = todayStr();
	const currentMonth = today.slice(0, 7); // "2026-06"
	const currentDay = parseInt(today.slice(8, 10));
	const canSettle = currentDay >= 15 && currentDay <= 25;

	const isAdmin = $derived(
		['ADMINISTRACJA', 'BOARD', 'ADMIN BROKER', 'ADMIN GOD'].includes(appState.profile?.rola ?? '')
	);

	// --- State ---
	let settlements = $state<any[]>([]);
	let currentSettlement = $state<any | null>(null);
	let policies = $state<any[]>([]);
	let settling = $state(false);
	let showConfirmModal = $state(false);
	let search = $state('');

	// --- Summary ---
	const prowizjaPrzypisana = $derived(
		policies.reduce((s, p) => s + Number(p.prowizja_przypisana ?? 0), 0)
	);
	const prowizjaRozliczona = $derived(
		policies.reduce((s, p) => s + Number(p.prowizja_zainkasowana ?? 0), 0)
	);
	const doWyplaty = $derived(prowizjaPrzypisana - prowizjaRozliczona);

	// --- Filtered policies for current month settlement ---
	const filteredPolicies = $derived(
		policies.filter((p) => {
			if (!search) return true;
			const nr = p.nr_polisy ?? '';
			const klient = p.crm_clients?.nazwa ?? '';
			return (
				nr.toLowerCase().includes(search.toLowerCase()) ||
				klient.toLowerCase().includes(search.toLowerCase())
			);
		})
	);

	// --- Load data on mount ---
	$effect(() => {
		loadData();
	});

	async function loadData() {
		await Promise.all([loadPolicies(), loadSettlements()]);
	}

	async function loadPolicies() {
		const { data } = await sb
			.from('crm_policies')
			.select('id, nr_polisy, skladka_przypisana, prowizja_przypisana, prowizja_zainkasowana, crm_clients(nazwa)')
			.order('nr_polisy');
		policies = data ?? [];
	}

	async function loadSettlements() {
		const query = sb
			.from('crm_commission_settlements')
			.select('*')
			.order('miesiac', { ascending: false });

		const { data } = await query;
		settlements = data ?? [];

		// Check if current month is already settled
		currentSettlement = settlements.find((s) => s.miesiac === currentMonth) ?? null;
	}

	async function settleCommission() {
		settling = true;
		try {
			// Create settlement record
			const { data: settlement, error: settErr } = await sb
				.from('crm_commission_settlements')
				.insert({
					tenant_id: appState.profile!.tenant_id,
					broker_id: appState.profile!.id,
					miesiac: currentMonth,
					kwota_przypisana: prowizjaPrzypisana,
					kwota_rozliczona: prowizjaRozliczona,
					status: 'zamkniety',
					zamkniete_at: new Date().toISOString()
				})
				.select()
				.single();

			if (settErr) throw settErr;

			// Create items for each policy
			const items = policies
				.filter((p) => Number(p.prowizja_przypisana ?? 0) > 0)
				.map((p) => ({
					tenant_id: appState.profile!.tenant_id,
					settlement_id: settlement.id,
					policy_id: p.id,
					skladka: Number(p.skladka_przypisana ?? 0),
					prowizja_pct: Number(p.skladka_przypisana) > 0
						? (Number(p.prowizja_przypisana) / Number(p.skladka_przypisana)) * 100
						: 0,
					prowizja_kwota: Number(p.prowizja_przypisana ?? 0)
				}));

			if (items.length > 0) {
				const { error: itemErr } = await sb.from('crm_commission_items').insert(items);
				if (itemErr) throw itemErr;
			}

			showConfirmModal = false;
			await loadSettlements();
		} catch (e: any) {
			console.error('Settlement error:', e);
		} finally {
			settling = false;
		}
	}

	const statusVariant = (s: string) => (s === 'zamkniety' ? 'success' : 'warning');
	const statusLabel = (s: string) => (s === 'zamkniety' ? 'Rozliczony' : 'Otwarty');
</script>

<svelte:head><title>Twoja Prowizja — FRANK67 CRM</title></svelte:head>

<div class="mb-6">
	<h1 class="text-2xl font-semibold text-slate-900">Twoja Prowizja</h1>
	<p class="text-sm text-slate-500 mt-1">Przegląd prowizji i rozliczenia miesięczne</p>
</div>

<!-- Summary cards -->
<div class="grid grid-cols-3 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-slate-500 mb-1">Prowizja przypisana</p>
		<p class="text-xl font-semibold text-slate-900">{fmtPln(prowizjaPrzypisana)} PLN</p>
	</div>
	<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-emerald-600 mb-1">Prowizja rozliczona</p>
		<p class="text-xl font-semibold text-emerald-700">{fmtPln(prowizjaRozliczona)} PLN</p>
	</div>
	<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-blue-600 mb-1">Do wypłaty</p>
		<p class="text-xl font-semibold text-blue-700">{fmtPln(doWyplaty)} PLN</p>
	</div>
</div>

<!-- Current month settlement -->
<div class="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
	<div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
		<div class="flex items-center gap-3">
			<h2 class="text-lg font-semibold text-slate-900">Rozliczenie: {currentMonth}</h2>
			{#if currentSettlement}
				<Badge variant="success"><CheckCircle size={12} class="mr-1 inline" /> Rozliczone</Badge>
			{/if}
		</div>
		<div class="flex items-center gap-3">
			{#if !currentSettlement}
				{#if canSettle}
					<button
						onclick={() => (showConfirmModal = true)}
						class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors"
					>
						<CheckCircle size={15} /> Rozlicz prowizję
					</button>
				{:else if currentDay < 15}
					<span class="text-xs text-slate-400">Rozliczenie dostępne od 15. dnia miesiąca</span>
				{:else}
					<span class="text-xs text-amber-600">Termin minął — system zamknie rozliczenie automatycznie 26.</span>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Search -->
	<div class="px-5 py-3 border-b border-slate-100">
		<div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 w-72">
			<Search size={15} class="text-slate-400" />
			<input
				bind:value={search}
				placeholder="Szukaj polisy / klienta..."
				class="text-sm outline-none bg-transparent placeholder:text-slate-400 w-full"
			/>
		</div>
	</div>

	<!-- Policy table -->
	{#if filteredPolicies.length === 0}
		<div class="px-5 py-8 text-center text-sm text-slate-400">Brak polis do rozliczenia</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-slate-100 text-xs text-slate-500 uppercase">
						<th class="px-5 py-3 font-medium">Nr polisy</th>
						<th class="px-5 py-3 font-medium">Klient</th>
						<th class="px-5 py-3 font-medium text-right">Składka</th>
						<th class="px-5 py-3 font-medium text-right">Prowizja przypisana</th>
						<th class="px-5 py-3 font-medium text-right">Prowizja zainkasowana</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredPolicies as pol}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium text-slate-900">{pol.nr_polisy ?? '—'}</td>
							<td class="px-5 py-3 text-slate-600">{pol.crm_clients?.nazwa ?? '—'}</td>
							<td class="px-5 py-3 text-right text-slate-700">{fmtPln(pol.skladka_przypisana)} PLN</td>
							<td class="px-5 py-3 text-right font-semibold text-slate-900">{fmtPln(pol.prowizja_przypisana)} PLN</td>
							<td class="px-5 py-3 text-right text-emerald-700">{fmtPln(pol.prowizja_zainkasowana)} PLN</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- History -->
<div class="bg-white border border-slate-200 rounded-xl shadow-sm">
	<div class="px-5 py-4 border-b border-slate-100">
		<h2 class="text-lg font-semibold text-slate-900">Historia rozliczeń</h2>
	</div>

	{#if settlements.length === 0}
		<div class="px-5 py-8 text-center text-sm text-slate-400">Brak wcześniejszych rozliczeń</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-slate-100 text-xs text-slate-500 uppercase">
						<th class="px-5 py-3 font-medium">Miesiąc</th>
						<th class="px-5 py-3 font-medium text-right">Przypisana</th>
						<th class="px-5 py-3 font-medium text-right">Rozliczona</th>
						<th class="px-5 py-3 font-medium">Status</th>
						<th class="px-5 py-3 font-medium">Zamknięto</th>
					</tr>
				</thead>
				<tbody>
					{#each settlements as s}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium text-slate-900">{s.miesiac}</td>
							<td class="px-5 py-3 text-right text-slate-700">{fmtPln(s.kwota_przypisana)} PLN</td>
							<td class="px-5 py-3 text-right text-slate-700">{fmtPln(s.kwota_rozliczona)} PLN</td>
							<td class="px-5 py-3">
								<Badge variant={statusVariant(s.status)}>{statusLabel(s.status)}</Badge>
							</td>
							<td class="px-5 py-3 text-slate-500 text-xs">{s.zamkniete_at ? new Date(s.zamkniete_at).toLocaleDateString('pl-PL') : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Confirm settlement modal -->
<Modal bind:show={showConfirmModal}>
	<div class="p-6">
		<h3 class="text-lg font-semibold text-slate-900 mb-2">Potwierdź rozliczenie</h3>
		<p class="text-sm text-slate-600 mb-4">
			Zamkniesz rozliczenie za miesiąc <strong>{currentMonth}</strong>.
			Prowizja przypisana: <strong>{fmtPln(prowizjaPrzypisana)} PLN</strong>,
			rozliczona: <strong>{fmtPln(prowizjaRozliczona)} PLN</strong>.
		</p>
		<div class="flex justify-end gap-3">
			<button
				onclick={() => (showConfirmModal = false)}
				class="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
			>
				Anuluj
			</button>
			<button
				onclick={settleCommission}
				disabled={settling}
				class="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-700 disabled:opacity-50"
			>
				{settling ? 'Rozliczam...' : 'Rozlicz'}
			</button>
		</div>
	</div>
</Modal>
