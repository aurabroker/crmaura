<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { PolicyPayment } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { fmtPln, todayStr } from '$lib/utils';
	import { Plus, Check, Search } from 'lucide-svelte';

	const today = todayStr();
	const currentMonth = $state(today.slice(0, 7)); // YYYY-MM

	let filterMonth = $state(currentMonth);
	let filterStatus = $state('all');
	let search = $state('');
	let showModal = $state(false);
	let saving = $state(false);
	let formError = $state('');

	// Add payment form
	let fPolisa = $state('');
	let fNrRaty = $state('1');
	let fData = $state('');
	let fKwota = $state('');
	let fNotatka = $state('');

	// Auto-fill kwota from policy
	$effect(() => {
		if (fPolisa) {
			const pol = appState.policies.find((p) => p.id === fPolisa);
			if (pol) {
				const raty = parseInt(pol.ilosc_rat) || 1;
				fKwota = (pol.skladka_przypisana / raty).toFixed(2);
			}
		}
	});

	const filtered = $derived(
		appState.payments
			.filter((p) => filterMonth === 'all' || p.data_platnosci.startsWith(filterMonth))
			.filter((p) => filterStatus === 'all' || p.status === filterStatus)
			.filter((p) => {
				if (!search) return true;
				const klient = p.crm_policies?.crm_clients?.nazwa ?? '';
				const nr = p.crm_policies?.nr_polisy ?? '';
				return klient.toLowerCase().includes(search.toLowerCase()) || nr.toLowerCase().includes(search.toLowerCase());
			})
			.sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci))
	);

	// Grupowanie po dniu miesiąca
	const byDay = $derived(() => {
		const map = new Map<string, typeof filtered>();
		for (const p of filtered) {
			const day = p.data_platnosci;
			if (!map.has(day)) map.set(day, []);
			map.get(day)!.push(p);
		}
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	});

	async function markPaid(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({
			status: 'Opłacona',
			data_oplacenia: today
		}).eq('id', pay.id);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function markOverdue(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Zaległa' }).eq('id', pay.id);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function addPayment() {
		if (!fPolisa || !fData || !fKwota) { formError = 'Wypełnij wymagane pola.'; return; }
		saving = true; formError = '';
		const { error } = await sb.from('crm_policy_payments').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: fPolisa,
			nr_raty: parseInt(fNrRaty) || 1,
			data_platnosci: fData,
			kwota: parseFloat(fKwota),
			notatka: fNotatka || null,
			status: 'Oczekująca'
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showModal = false;
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	const statusVariant = (s: string) =>
		s === 'Opłacona' ? 'success' : s === 'Zaległa' ? 'error' : 'warning';

	// Miesiące do filtra
	const months = $derived(() => {
		const set = new Set<string>();
		for (const p of appState.payments) set.add(p.data_platnosci.slice(0, 7));
		return [...set].sort();
	});

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	const totalFiltered = $derived(filtered.reduce((s, p) => s + Number(p.kwota), 0));
	const totalPaid = $derived(filtered.filter((p) => p.status === 'Opłacona').reduce((s, p) => s + Number(p.kwota), 0));
	const totalPending = $derived(filtered.filter((p) => p.status !== 'Opłacona').reduce((s, p) => s + Number(p.kwota), 0));
</script>

<svelte:head><title>Płatności — FRANK</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Płatności Składek</h1>
		<p class="text-sm text-slate-500 mt-1">Kalendarz rat i kontrola płatności klientów</p>
	</div>
	<button onclick={() => showModal = true} class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
		<Plus size={15} /> Dodaj Ratę
	</button>
</div>

<!-- Filtry -->
<div class="flex gap-3 mb-4 flex-wrap">
	<div class="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj klienta / polisy..." class="text-sm outline-none placeholder:text-slate-400 w-48" />
	</div>
	<select bind:value={filterMonth} class="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-700">
		<option value="all">Wszystkie miesiące</option>
		{#each months() as m}
			<option value={m}>{m}</option>
		{/each}
	</select>
	{#each [['all','Wszystkie'],['Oczekująca','Oczekujące'],['Opłacona','Opłacone'],['Zaległa','Zaległe']] as [val, label]}
		<button
			onclick={() => filterStatus = val}
			class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
				{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
		>{label}</button>
	{/each}
</div>

<!-- Podsumowanie -->
<div class="grid grid-cols-3 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-slate-500 mb-1">Łącznie rat</p>
		<p class="text-xl font-semibold text-slate-900">{fmtPln(totalFiltered)} PLN</p>
	</div>
	<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-emerald-600 mb-1">Opłacone</p>
		<p class="text-xl font-semibold text-emerald-700">{fmtPln(totalPaid)} PLN</p>
	</div>
	<div class="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-red-500 mb-1">Do zapłaty / Zaległe</p>
		<p class="text-xl font-semibold text-red-600">{fmtPln(totalPending)} PLN</p>
	</div>
</div>

<!-- Kalendarz rat (grupowany po dniu) -->
{#each byDay() as [day, pays]}
	<div class="mb-4">
		<div class="flex items-center gap-3 mb-2">
			<div class="text-sm font-semibold text-slate-700">{day}</div>
			<div class="flex-1 h-px bg-slate-200"></div>
			<div class="text-xs text-slate-400">{pays.length} rat — {fmtPln(pays.reduce((s,p) => s+Number(p.kwota),0))} PLN</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm">
				<tbody>
					{#each pays as pay}
						<tr class="border-t first:border-t-0 border-slate-100 hover:bg-slate-50 {pay.status === 'Zaległa' ? 'bg-red-50/40' : ''}">
							<td class="px-5 py-3 font-medium">{pay.crm_policies?.nr_polisy ?? '—'}</td>
							<td class="px-5 py-3">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</td>
							<td class="px-5 py-3 text-slate-500 text-xs">Rata {pay.nr_raty}</td>
							<td class="px-5 py-3 text-right font-semibold text-slate-900">{fmtPln(pay.kwota)} PLN</td>
							<td class="px-5 py-3">
								<Badge variant={statusVariant(pay.status)}>{pay.status}</Badge>
							</td>
							<td class="px-5 py-3 text-xs text-slate-400">{pay.data_oplacenia ? `Zapł. ${pay.data_oplacenia}` : ''}{pay.notatka ? ` · ${pay.notatka}` : ''}</td>
							<td class="px-5 py-3">
								{#if pay.status === 'Oczekująca'}
									<div class="flex gap-1">
										<button onclick={() => markPaid(pay)} title="Oznacz jako opłaconą" class="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
											<Check size={12} /> Opłacona
										</button>
										<button onclick={() => markOverdue(pay)} title="Oznacz jako zaległą" class="px-2 py-1 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
											Zaległa
										</button>
									</div>
								{:else if pay.status === 'Zaległa'}
									<button onclick={() => markPaid(pay)} class="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
										<Check size={12} /> Opłacona
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
		Brak rat płatności w wybranym filtrze
	</div>
{/each}

<!-- Modal: Dodaj Ratę -->
<Modal title="Dodaj Ratę Płatności" open={showModal} onclose={() => { showModal = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={addPayment} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Dodaj Ratę'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Polisa *</label>
			<select bind:value={fPolisa} class={inputCls}>
				<option value="">— wybierz polisę —</option>
				{#each appState.policies as p}
					<option value={p.id}>{p.nr_polisy} — {p.crm_clients?.nazwa}</option>
				{/each}
			</select>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Nr Raty</label>
				<input type="number" bind:value={fNrRaty} min="1" class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Termin płatności *</label>
				<input type="date" bind:value={fData} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Kwota raty (PLN) *</label>
				<input type="number" step="0.01" bind:value={fKwota} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Notatka</label>
				<input bind:value={fNotatka} class={inputCls} />
			</div>
		</div>
	</div>
</Modal>
