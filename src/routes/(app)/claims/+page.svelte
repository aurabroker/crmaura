<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Claim } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Pencil } from 'lucide-svelte';
	import { fmtPln } from '$lib/utils';

	let search = $state('');
	let filterStatus = $state('all');
	let showModal = $state(false);
	let editingClaim = $state<Claim | null>(null);

	// Form
	let fKlient = $state('');
	let fPolisa = $state('');
	let fNr = $state('');
	let fData = $state('');
	let fOpis = $state('');
	let fWartosc = $state('');
	let fStatus = $state('Zgłoszona');
	let saving = $state(false);
	let formError = $state('');

	const STATUSES = ['Zgłoszona', 'W toku', 'Wypłacona', 'Zakończona', 'Odmowa'];

	const filtered = $derived(
		appState.claims
			.filter((c) => filterStatus === 'all' || c.status === filterStatus)
			.filter((c) =>
				!search ||
				(c.crm_clients?.nazwa ?? '').toLowerCase().includes(search.toLowerCase()) ||
				(c.nr_szkody ?? '').toLowerCase().includes(search.toLowerCase())
			)
	);

	function openNew() {
		editingClaim = null;
		fKlient = ''; fPolisa = ''; fNr = ''; fData = ''; fOpis = ''; fWartosc = ''; fStatus = 'Zgłoszona';
		formError = ''; showModal = true;
	}

	function openEdit(c: Claim) {
		editingClaim = c;
		fKlient = c.klient_id; fPolisa = c.polisa_id ?? ''; fNr = c.nr_szkody ?? '';
		fData = c.data_szkody; fOpis = c.opis_szkody ?? '';
		fWartosc = c.wartosc_roszczenia?.toString() ?? ''; fStatus = c.status;
		formError = ''; showModal = true;
	}

	async function save() {
		if (!fKlient || !fData) { formError = 'Wybierz klienta i datę.'; return; }
		saving = true; formError = '';
		const pol = fPolisa ? appState.policies.find((p) => p.id === fPolisa) : null;
		const payload = {
			klient_id: fKlient, polisa_id: fPolisa || null, tu_id: pol?.tu_id ?? null,
			nr_szkody: fNr || null, data_szkody: fData, opis_szkody: fOpis || null,
			wartosc_roszczenia: fWartosc ? parseFloat(fWartosc) : null, status: fStatus
		};
		let error;
		if (editingClaim) {
			({ error } = await sb.from('crm_claims').update(payload).eq('id', editingClaim.id));
		} else {
			({ error } = await sb.from('crm_claims').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		}
		saving = false;
		if (error) { formError = error.message; return; }
		showModal = false;
		const { data } = await sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)');
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	const statusVariant = (s: string) =>
		s === 'Wypłacona' || s === 'Zakończona' ? 'success' :
		s === 'Odmowa' ? 'error' : 'warning';

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Szkody — FRANK</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Rejestr Szkód</h1>
		<p class="text-sm text-slate-500 mt-1">Wszystkie zgłoszenia w portfelu</p>
	</div>
	<button onclick={openNew} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
		+ Zgłoś Szkodę
	</button>
</div>

<div class="flex gap-3 mb-4">
	<div class="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po kliencie lub nr szkody..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	{#each [['all','Wszystkie'],['Zgłoszona','Zgłoszone'],['W toku','W toku'],['Wypłacona','Wypłacone'],['Zakończona','Zakończone'],['Odmowa','Odmowa']] as [val, label]}
		<button
			onclick={() => filterStatus = val}
			class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap
				{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
		>{label}</button>
	{/each}
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Szkody</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">Z polisy</th>
				<th class="px-5 py-3">Data szkody</th>
				<th class="px-5 py-3">Opis</th>
				<th class="px-5 py-3 text-right">Wartość</th>
				<th class="px-5 py-3">Status</th>
				<th class="px-5 py-3"></th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as c}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">{c.nr_szkody ?? 'Zgłoszenie'}</td>
					<td class="px-5 py-3">{c.crm_clients?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">{c.crm_policies?.nr_polisy ?? '—'}</td>
					<td class="px-5 py-3">{c.data_szkody}</td>
					<td class="px-5 py-3 text-xs text-slate-500 max-w-[200px] truncate">{c.opis_szkody ?? '—'}</td>
					<td class="px-5 py-3 text-right">{fmtPln(c.wartosc_roszczenia)} PLN</td>
					<td class="px-5 py-3"><Badge variant={statusVariant(c.status)}>{c.status}</Badge></td>
					<td class="px-5 py-3">
						<button onclick={() => openEdit(c)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
							<Pencil size={14} />
						</button>
					</td>
				</tr>
			{:else}
				<tr><td colspan="8" class="px-5 py-8 text-center text-slate-400">Brak szkód</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<Modal title={editingClaim ? 'Edytuj Szkodę' : 'Nowa Szkoda'} open={showModal} onclose={() => { showModal = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : editingClaim ? 'Zapisz zmiany' : 'Zgłoś Szkodę'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Klient *</label>
				<select bind:value={fKlient} class={inputCls}>
					<option value="">— wybierz —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Z polisy</label>
				<select bind:value={fPolisa} class={inputCls}>
					<option value="">— opcjonalnie —</option>
					{#each appState.policies as p}<option value={p.id}>{p.nr_polisy}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Nr Szkody w TU</label>
				<input bind:value={fNr} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Data szkody *</label>
				<input type="date" bind:value={fData} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Wartość roszczenia (PLN)</label>
				<input type="number" step="0.01" bind:value={fWartosc} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Status</label>
				<select bind:value={fStatus} class={inputCls}>
					{#each STATUSES as s}<option>{s}</option>{/each}
				</select>
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zdarzenia</label>
			<input bind:value={fOpis} class={inputCls} placeholder="Krótki opis..." />
		</div>
	</div>
</Modal>
