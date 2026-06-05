<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { PolicyPayment } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { fmtPln, todayStr } from '$lib/utils';
	import { Plus, Check, Search, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-svelte';
	const today = todayStr();
	const currentMonth = $state(today.slice(0, 7));

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

	// ERGO settlement
	let showErgo = $state(false);
	let ergoFile = $state<File | null>(null);
	let ergoLoading = $state(false);
	let ergoError = $state('');
	let ergoPreview = $state<ErgoRow[]>([]);
	let ergoNumerNoty = $state('');
	let ergoDataZest = $state('');
	let ergoRazemSkladka = $state(0);
	let ergoRazemProwizja = $state(0);
	let ergoSaving = $state(false);
	let ergoDone = $state(false);
	let ergoSummary = $state('');

	interface ErgoRow {
		ubezpieczajacy: string;
		nr_polisy: string;
		umowa_gen: string;
		data_wystawienia: string;
		skladka_nota: number;
		prowizja_nota: number;
		// resolved
		payment_id: string | null;
		policy_id: string | null;
		prowizja_crm: number | null;
		new_status: 'Opłacona' | 'Częściowo opłacona' | null;
		not_found: boolean;
		already_settled: boolean;
	}

	async function parseErgoXlsx(file: File): Promise<void> {
		const XLSX = await import('xlsx');
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const data = new Uint8Array(e.target!.result as ArrayBuffer);
					const wb = XLSX.read(data, { type: 'array' });
					const ws = wb.Sheets[wb.SheetNames[0]];
					const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

					// Header info
					ergoNumerNoty = '';
					ergoDataZest = '';
					ergoRazemSkladka = 0;
					ergoRazemProwizja = 0;

					for (const row of rows) {
						const label = String(row[5] ?? '').trim();
						if (label === 'Numer zestawienia') ergoNumerNoty = String(row[7] ?? '').trim();
						if (label === 'Data sporządzenia zestawienia') ergoDataZest = String(row[7] ?? '').trim();
					}

					// Find header row (contains "Nr polisy")
					let dataStart = -1;
					for (let i = 0; i < rows.length; i++) {
						if (String(rows[i][1] ?? '').includes('Nr polisy')) { dataStart = i + 1; break; }
					}
					if (dataStart < 0) throw new Error('Nie znaleziono nagłówka tabeli w pliku');

					const parsed: ErgoRow[] = [];
					for (let i = dataStart; i < rows.length; i++) {
						const r = rows[i];
						const nr = String(r[1] ?? '').trim();
						if (!nr || nr === 'Razem') continue;
						const skladka = parseFloat(String(r[7]).replace(',', '.')) || 0;
						const prowizja = parseFloat(String(r[8]).replace(',', '.')) || 0;
						parsed.push({
							ubezpieczajacy: String(r[0] ?? '').trim(),
							nr_polisy: nr,
							umowa_gen: String(r[2] ?? '').trim(),
							data_wystawienia: String(r[4] ?? '').trim(),
							skladka_nota: skladka,
							prowizja_nota: prowizja,
							payment_id: null,
							policy_id: null,
							prowizja_crm: null,
							new_status: null,
							not_found: false,
							already_settled: false
						});
						ergoRazemSkladka += skladka;
						ergoRazemProwizja += prowizja;
					}

					// Match against CRM — only unresolved payments
					const settledStatuses = ['Opłacona', 'Częściowo opłacona'];
					for (const row of parsed) {
						const policy = appState.policies.find(p => p.nr_polisy === row.nr_polisy);
						if (!policy) { row.not_found = true; continue; }
						row.policy_id = policy.id;
						row.prowizja_crm = parseFloat(String(policy.prowizja_przypisana)) || 0;

						// Find first unresolved payment for this policy
						const payment = appState.payments.find(
							p => p.polisa_id === policy.id && !settledStatuses.includes(p.status)
						);
						if (payment) {
							row.payment_id = payment.id;
							const prowizjaMatch = Math.abs((row.prowizja_crm ?? 0) - row.prowizja_nota) < 0.05;
							row.new_status = prowizjaMatch ? 'Opłacona' : 'Częściowo opłacona';
						} else {
							// Check if already settled
							const anyPay = appState.payments.find(p => p.polisa_id === policy.id);
							if (anyPay && settledStatuses.includes(anyPay.status)) {
								row.already_settled = true;
							} else {
								row.not_found = false;
								row.payment_id = null;
							}
						}
					}

					ergoPreview = parsed;
					resolve();
				} catch (err: any) {
					reject(err);
				}
			};
			reader.onerror = () => reject(new Error('Błąd odczytu pliku'));
			reader.readAsArrayBuffer(file);
		});
	}

	async function onErgoFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		ergoFile = file;
		ergoLoading = true;
		ergoError = '';
		ergoPreview = [];
		try {
			await parseErgoXlsx(file);
		} catch (err: any) {
			ergoError = err.message ?? 'Błąd parsowania pliku';
		} finally {
			ergoLoading = false;
		}
	}

	async function saveErgo() {
		if (!ergoNumerNoty) { ergoError = 'Brak numeru zestawienia w pliku'; return; }
		ergoSaving = true; ergoError = '';

		// Insert nota
		const { data: nota, error: notaErr } = await sb.from('crm_noty').insert([{
			tenant_id: appState.profile!.tenant_id,
			numer_noty: ergoNumerNoty,
			tu_skrot: 'ERGO',
			data_zestawienia: ergoDataZest || null,
			razem_skladka: ergoRazemSkladka,
			razem_prowizja: ergoRazemProwizja,
			pozycji_count: ergoPreview.filter(r => !r.not_found && !r.already_settled && r.payment_id).length
		}]).select('id').single();

		if (notaErr) { ergoSaving = false; ergoError = notaErr.message; return; }
		const notaId = nota!.id;

		// Update payments
		const toUpdate = ergoPreview.filter(r => r.payment_id && r.new_status);
		let updated = 0;
		for (const row of toUpdate) {
			await sb.from('crm_policy_payments').update({
				status: row.new_status,
				kwota: row.skladka_nota,
				prowizja_z_noty: row.prowizja_nota,
				nota_id: notaId,
				data_oplacenia: today
			}).eq('id', row.payment_id!);
			updated++;
		}

		// Refresh payments
		const { data } = await sb.from('crm_policy_payments')
			.select('*, crm_policies(nr_polisy, crm_clients(nazwa))')
			.order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;

		const notFound = ergoPreview.filter(r => r.not_found).map(r => r.nr_polisy);
		ergoSaving = false;
		ergoDone = true;
		ergoSummary = `Rozliczono ${updated} rat. Nota ${ergoNumerNoty} zapisana.${notFound.length ? `\n\nPolisy nieznalezione w bazie: ${notFound.join(', ')}` : ''}`;
	}

	function closeErgo() {
		showErgo = false;
		ergoFile = null;
		ergoPreview = [];
		ergoNumerNoty = '';
		ergoError = '';
		ergoDone = false;
		ergoSummary = '';
	}

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
		await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today }).eq('id', pay.id);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function markOverdue(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Zaległa' }).eq('id', pay.id);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function revertPayment(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({
			status: 'Oczekująca',
			data_oplacenia: null,
			nota_id: null,
			prowizja_z_noty: null
		}).eq('id', pay.id);
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
		s === 'Opłacona' ? 'success' : s === 'Zaległa' ? 'error' : s === 'Częściowo opłacona' ? 'warning' : 'neutral';

	function isOverdue(pay: PolicyPayment): boolean {
		return pay.status === 'Oczekująca' && pay.data_platnosci < today;
	}

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

	const ergoToProcess = $derived(ergoPreview.filter(r => r.payment_id && r.new_status));
	const ergoNotFound = $derived(ergoPreview.filter(r => r.not_found));
	const ergoAlreadySettled = $derived(ergoPreview.filter(r => r.already_settled));

	// Checkbox selection
	let selected = $state(new Set<string>());
	function toggleSelect(id: string) {
		const s = new Set(selected);
		s.has(id) ? s.delete(id) : s.add(id);
		selected = s;
	}
	function toggleDay(ids: string[]) {
		const s = new Set(selected);
		const allIn = ids.every(id => s.has(id));
		ids.forEach(id => allIn ? s.delete(id) : s.add(id));
		selected = s;
	}

	const selectedPays = $derived(filtered.filter(p => selected.has(p.id)));
	const canMarkPaid = $derived(selectedPays.some(p => p.status === 'Oczekująca' || p.status === 'Zaległa'));
	const canMarkOverdue = $derived(selectedPays.some(p => p.status === 'Oczekująca'));
	const canRevert = $derived(selectedPays.some(p => p.status === 'Opłacona' || p.status === 'Częściowo opłacona'));

	async function bulkMarkPaid() {
		const ids = selectedPays.filter(p => p.status === 'Oczekująca' || p.status === 'Zaległa').map(p => p.id);
		await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today }).in('id', ids);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
		selected = new Set();
	}
	async function bulkMarkOverdue() {
		const ids = selectedPays.filter(p => p.status === 'Oczekująca').map(p => p.id);
		await sb.from('crm_policy_payments').update({ status: 'Zaległa' }).in('id', ids);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
		selected = new Set();
	}
	async function bulkRevert() {
		const ids = selectedPays.filter(p => p.status === 'Opłacona' || p.status === 'Częściowo opłacona').map(p => p.id);
		await sb.from('crm_policy_payments').update({ status: 'Oczekująca', data_oplacenia: null, nota_id: null, prowizja_z_noty: null }).in('id', ids);
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
		selected = new Set();
	}
</script>

<svelte:head><title>Płatności — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Płatności Składek</h1>
		<p class="text-sm text-slate-500 mt-1">Kalendarz rat i kontrola płatności klientów</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => showErgo = true} class="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
			<FileSpreadsheet size={15} /> Rozlicz ERGO
		</button>
		<button onclick={() => showModal = true} class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
			<Plus size={15} /> Dodaj Ratę
		</button>
	</div>
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
	{#each [['all','Wszystkie'],['Oczekująca','Oczekujące'],['Opłacona','Opłacone'],['Częściowo opłacona','Częściowo'],['Zaległa','Zaległe']] as [val, label]}
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

<!-- Floating action bar (gdy coś zaznaczone) -->
{#if selected.size > 0}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
		<span class="text-sm font-medium">{selected.size} zaznaczone</span>
		<div class="w-px h-5 bg-slate-600"></div>
		{#if canMarkPaid}
			<button onclick={bulkMarkPaid} class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-500 hover:bg-emerald-400 rounded-xl font-semibold transition-colors">
				<Check size={13} /> Opłacona
			</button>
		{/if}
		{#if canMarkOverdue}
			<button onclick={bulkMarkOverdue} class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 hover:bg-red-400 rounded-xl font-semibold transition-colors">
				Zaległa
			</button>
		{/if}
		{#if canRevert}
			<button onclick={bulkRevert} class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-600 hover:bg-slate-500 rounded-xl font-semibold transition-colors">
				↩ Cofnij
			</button>
		{/if}
		<button onclick={() => selected = new Set()} class="text-slate-400 hover:text-white text-xs ml-1">✕</button>
	</div>
{/if}

<!-- Tabela rat -->
{#each byDay() as [day, pays]}
	{@const dayIds = pays.map(p => p.id)}
	{@const allChecked = dayIds.every(id => selected.has(id))}
	<div class="mb-5">
		<div class="flex items-center gap-3 mb-1.5">
			<input type="checkbox" checked={allChecked} onchange={() => toggleDay(dayIds)}
				class="w-3.5 h-3.5 rounded accent-slate-700 cursor-pointer" />
			<div class="text-sm font-bold text-slate-700">{day}</div>
			<div class="flex-1 h-px bg-slate-200"></div>
			<div class="text-xs text-slate-400">{pays.length} rat · {fmtPln(pays.reduce((s,p) => s+Number(p.kwota),0))} PLN</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm border-collapse table-fixed">
				<thead class="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<tr>
						<th class="px-4 py-2 w-10"></th>
						<th class="px-4 py-2 w-[14%]">Polisa</th>
						<th class="px-4 py-2 w-[22%]">Klient</th>
						<th class="px-4 py-2 w-[7%] text-center">Rata</th>
						<th class="px-4 py-2 w-[12%] text-right">Kwota</th>
						<th class="px-4 py-2 w-[12%] text-right">Prowizja</th>
						<th class="px-4 py-2 w-[14%]">Status</th>
						<th class="px-4 py-2">Info</th>
					</tr>
				</thead>
				<tbody>
					{#each pays as pay}
						{@const checked = selected.has(pay.id)}
						<tr onclick={() => toggleSelect(pay.id)}
							class="border-t border-slate-200 cursor-pointer transition-colors
								{checked ? 'bg-blue-50' : pay.status === 'Zaległa' || isOverdue(pay) ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-slate-50'}">
							<td class="px-4 py-2.5 text-center" onclick={(e) => e.stopPropagation()}>
								<input type="checkbox" {checked} onchange={() => toggleSelect(pay.id)}
									class="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer" />
							</td>
							<td class="px-4 py-2.5 font-mono text-xs font-semibold text-blue-700 border-l border-slate-200">
								<a href="/policies/{pay.polisa_id}" onclick={(e) => e.stopPropagation()} class="hover:underline">{pay.crm_policies?.nr_polisy ?? '—'}</a>
							</td>
							<td class="px-4 py-2.5 border-l border-slate-200">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</td>
							<td class="px-4 py-2.5 text-center text-slate-500 border-l border-slate-200">{pay.nr_raty}</td>
							<td class="px-4 py-2.5 text-right font-semibold border-l border-slate-200">{fmtPln(pay.kwota)}</td>
							<td class="px-4 py-2.5 text-right text-xs border-l border-slate-200">
								{#if pay.prowizja_z_noty}<span class="text-blue-600 font-medium">{fmtPln(pay.prowizja_z_noty)}</span>{:else}<span class="text-slate-300">—</span>{/if}
							</td>
							<td class="px-4 py-2.5 border-l border-slate-200">
								<Badge variant={statusVariant(pay.status)}>{pay.status}</Badge>
							</td>
							<td class="px-4 py-2.5 text-xs text-slate-400 border-l border-slate-200">
								{pay.data_oplacenia ? `Zapł. ${pay.data_oplacenia}` : ''}{pay.notatka ? ` · ${pay.notatka}` : ''}
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

<!-- Modal: Rozlicz ERGO -->
<Modal title="Rozlicz ERGO — Import zestawienia prowizyjnego" open={showErgo} onclose={closeErgo}>
	{#snippet footer()}
		{#if ergoDone}
			<button onclick={closeErgo} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">Zamknij</button>
		{:else}
			<button onclick={closeErgo} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
			{#if ergoToProcess.length > 0 && !ergoLoading}
				<button onclick={saveErgo} disabled={ergoSaving} class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-60">
					{ergoSaving ? 'Rozliczanie...' : `Rozlicz ${ergoToProcess.length} rat`}
				</button>
			{/if}
		{/if}
	{/snippet}

	{#if ergoDone}
		<!-- Wynik -->
		<div class="flex flex-col items-center gap-4 py-4">
			<CheckCircle2 size={48} class="text-emerald-500" />
			<div class="text-center whitespace-pre-line text-sm text-slate-700">{ergoSummary}</div>
		</div>
	{:else}
		<div class="space-y-4">
			<!-- Upload -->
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-2">Wybierz plik zestawienia prowizyjnego ERGO (.xlsx)</label>
				<input type="file" accept=".xlsx" onchange={onErgoFile}
					class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
			</div>

			{#if ergoLoading}
				<div class="text-sm text-slate-500 text-center py-4">Parsowanie pliku...</div>
			{/if}

			{#if ergoError}
				<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{ergoError}</div>
			{/if}

			{#if ergoPreview.length > 0}
				<!-- Info noty -->
				<div class="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
					<div class="font-semibold text-blue-800 mb-1">Numer zestawienia: {ergoNumerNoty}</div>
					<div class="text-blue-700">Data: {ergoDataZest} &nbsp;·&nbsp; Razem składka: {fmtPln(ergoRazemSkladka)} PLN &nbsp;·&nbsp; Razem prowizja: {fmtPln(ergoRazemProwizja)} PLN</div>
				</div>

				<!-- Ostrzeżenia -->
				{#if ergoNotFound.length > 0}
					<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
						<div class="flex items-center gap-2 font-semibold text-red-700 mb-2"><AlertTriangle size={15} /> Polisy nieznalezione w bazie ({ergoNotFound.length}):</div>
						{#each ergoNotFound as r}
							<div class="text-sm text-red-600 font-mono">{r.nr_polisy} — {r.ubezpieczajacy}</div>
						{/each}
					</div>
				{/if}
				{#if ergoAlreadySettled.length > 0}
					<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
						<div class="flex items-center gap-2 font-semibold text-amber-700 mb-1"><AlertTriangle size={15} /> Już rozliczone — pominięte ({ergoAlreadySettled.length}):</div>
						{#each ergoAlreadySettled as r}
							<div class="text-sm text-amber-700 font-mono">{r.nr_polisy}</div>
						{/each}
					</div>
				{/if}

				<!-- Tabela podglądu -->
				{#if ergoToProcess.length > 0}
					<div class="border border-slate-200 rounded-lg overflow-hidden">
						<table class="w-full text-xs">
							<thead class="bg-slate-50 border-b border-slate-200">
								<tr>
									<th class="px-3 py-2 text-left font-semibold text-slate-600">Nr polisy</th>
									<th class="px-3 py-2 text-left font-semibold text-slate-600">Ubezpieczający</th>
									<th class="px-3 py-2 text-right font-semibold text-slate-600">Składka</th>
									<th class="px-3 py-2 text-right font-semibold text-slate-600">Prow. nota</th>
									<th class="px-3 py-2 text-right font-semibold text-slate-600">Prow. CRM</th>
									<th class="px-3 py-2 text-left font-semibold text-slate-600">Nowy status</th>
								</tr>
							</thead>
							<tbody>
								{#each ergoToProcess as r}
									<tr class="border-t border-slate-100">
										<td class="px-3 py-2 font-mono">{r.nr_polisy}</td>
										<td class="px-3 py-2 text-slate-600 truncate max-w-[140px]">{r.ubezpieczajacy}</td>
										<td class="px-3 py-2 text-right">{fmtPln(r.skladka_nota)}</td>
										<td class="px-3 py-2 text-right">{fmtPln(r.prowizja_nota)}</td>
										<td class="px-3 py-2 text-right {Math.abs((r.prowizja_crm ?? 0) - r.prowizja_nota) >= 0.05 ? 'text-amber-600 font-semibold' : ''}">{fmtPln(r.prowizja_crm ?? 0)}</td>
										<td class="px-3 py-2">
											<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold {r.new_status === 'Opłacona' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
												{r.new_status}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</Modal>
