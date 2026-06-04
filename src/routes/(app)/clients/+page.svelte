<script lang="ts">
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Client } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Pencil, Building2, User } from 'lucide-svelte';
	import { page } from '$app/stores';

	let search = $state('');
	let showModal = $state(false);
	let editingClient = $state<Client | null>(null);
	let modalTyp = $state<'firma' | 'osoba'>('firma');

	let fNazwa = $state('');
	let fNazwaSkrocona = $state('');
	let fUlica = $state('');
	let fNip = $state('');
	let fRegon = $state('');
	let fKrs = $state('');
	let fPesel = $state('');
	let fRodo = $state(false);
	let fRodoData = $state('');
	let fRodoKanal = $state('E-mail');
	let saving = $state(false);
	let formError = $state('');

	const filtered = $derived(
		appState.clients.filter(
			(c) =>
				!search ||
				c.nazwa.toLowerCase().includes(search.toLowerCase()) ||
				(c.nazwa_skrocona ?? '').toLowerCase().includes(search.toLowerCase()) ||
				(c.nip ?? '').includes(search)
		)
	);

	function openNew(typ: 'firma' | 'osoba') {
		editingClient = null; modalTyp = typ;
		fNazwa = ''; fNazwaSkrocona = ''; fUlica = ''; fNip = ''; fRegon = ''; fKrs = ''; fPesel = '';
		fRodo = false; fRodoData = ''; fRodoKanal = 'E-mail'; formError = '';
		showModal = true;
	}

	function openEdit(c: Client) {
		editingClient = c; modalTyp = c.typ ?? 'firma';
		fNazwa = c.nazwa; fNazwaSkrocona = c.nazwa_skrocona ?? ''; fUlica = c.ulica ?? '';
		fNip = c.nip ?? ''; fRegon = c.regon ?? ''; fKrs = c.krs ?? ''; fPesel = c.pesel ?? '';
		fRodo = c.rodo_zgoda; fRodoData = c.rodo_data ?? '';
		fRodoKanal = c.rodo_kanal ?? 'E-mail'; formError = '';
		showModal = true;
	}

	function closeModal() { showModal = false; editingClient = null; formError = ''; }

	async function save() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			typ: modalTyp,
			nazwa: fNazwa.trim(),
			nazwa_skrocona: fNazwaSkrocona.trim() || null,
			ulica: fUlica.trim() || null,
			nip: modalTyp === 'firma' ? (fNip.trim() || null) : null,
			pesel: modalTyp === 'osoba' ? (fPesel.trim() || null) : null,
			regon: modalTyp === 'firma' ? (fRegon.trim() || null) : null,
			krs: modalTyp === 'firma' ? (fKrs.trim() || null) : null,
			rodo_zgoda: fRodo,
			rodo_data: fRodoData || null,
			rodo_kanal: fRodoKanal
		};

		let error;
		if (editingClient) {
			({ error } = await sb.from('crm_clients').update(payload).eq('id', editingClient.id));
		} else {
			({ error } = await sb.from('crm_clients').insert([{
				tenant_id: appState.profile!.tenant_id,
				opiekun_id: appState.profile!.id,
				...payload
			}]));
		}
		saving = false;
		if (error) { formError = error.message; return; }
		closeModal();
		const { data } = await sb.from('crm_clients').select('*').order('created_at', { ascending: false });
		appState.clients = (data ?? []) as typeof appState.clients;
	}

	$effect(() => {
		const params = $page.url.searchParams;
		if (params.get('new') === '1') openNew('firma');
	});

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	const modalTitle = $derived(
		editingClient
			? `Edytuj — ${editingClient.nazwa}`
			: modalTyp === 'firma' ? 'Nowa Firma' : 'Nowa Osoba'
	);
</script>

<svelte:head><title>Klienci — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Klienci <span class="text-slate-400 text-lg font-normal">({appState.clients.length})</span></h1>
		<p class="text-sm text-slate-500 mt-1">Zarządzanie portfelem i statusami RODO</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => openNew('firma')} class="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
			<Building2 size={15} /> Dodaj Firmę
		</button>
		<button onclick={() => openNew('osoba')} class="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors">
			<User size={15} /> Dodaj Osobę
		</button>
	</div>
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
		<Search size={16} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nazwie lub NIP..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nazwa / Adres</th>
				<th class="px-5 py-3">NIP / PESEL</th>
				<th class="px-5 py-3">RODO</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as c}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3">
						<div class="flex items-center gap-2">
							{#if c.typ === 'osoba'}
								<User size={13} class="text-slate-400 shrink-0" />
							{:else}
								<Building2 size={13} class="text-slate-400 shrink-0" />
							{/if}
							<div>
								<div class="font-medium text-slate-900">{c.nazwa_skrocona ?? c.nazwa}</div>
								{#if c.nazwa_skrocona}<div class="text-xs text-slate-400">{c.nazwa}</div>{/if}
								{#if c.ulica}<div class="text-xs text-slate-400">{c.ulica}</div>{/if}
							</div>
						</div>
					</td>
					<td class="px-5 py-3 text-xs text-slate-500">
						{#if c.nip}NIP: {c.nip}<br/>{/if}
						{#if c.pesel}PESEL: {c.pesel}{/if}
						{#if c.krs}<br/>KRS: {c.krs}{/if}
					</td>
					<td class="px-5 py-3">
						{#if c.rodo_zgoda}
							<Badge variant="success">OK</Badge>
						{:else}
							<Badge variant="error">Brak zgody</Badge>
						{/if}
					</td>
					<td class="px-5 py-3">
						<div class="flex items-center gap-1">
							<button onclick={() => goto(`/clients/${c.id}`)} class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors">
								Profil 360°
							</button>
							<button onclick={() => openEdit(c)} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
								<Pencil size={14} />
							</button>
						</div>
					</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="px-5 py-6 text-center text-slate-400">Brak klientów</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<Modal title={modalTitle} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : editingClient ? 'Zapisz zmiany' : (modalTyp === 'firma' ? 'Zapisz Firmę' : 'Zapisz Osobę')}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>{modalTyp === 'firma' ? 'Nazwa firmy *' : 'Imię i Nazwisko *'}</label>
			<input bind:value={fNazwa} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Nazwa skrócona (wyświetlana domyślnie)</label>
			<input bind:value={fNazwaSkrocona} class={inputCls} placeholder={modalTyp === 'firma' ? 'np. Kowalski sp. z o.o.' : ''} />
		</div>
		<div>
			<label class={labelCls}>Ulica i miasto</label>
			<input bind:value={fUlica} class={inputCls} />
		</div>
		{#if modalTyp === 'firma'}
			<div class="grid grid-cols-2 gap-3">
				<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
				<div><label class={labelCls}>REGON</label><input bind:value={fRegon} class={inputCls} /></div>
				<div class="col-span-2"><label class={labelCls}>KRS</label><input bind:value={fKrs} class={inputCls} /></div>
			</div>
		{:else}
			<div>
				<label class={labelCls}>PESEL</label>
				<input bind:value={fPesel} class={inputCls} />
			</div>
		{/if}
		<div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
			<label class="flex items-center gap-2 font-semibold text-sm cursor-pointer mb-3">
				<input type="checkbox" bind:checked={fRodo} class="rounded" /> Zgoda RODO odebrana
			</label>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class={labelCls}>Data zgody</label>
					<input type="date" bind:value={fRodoData} class={inputCls} />
				</div>
				<div>
					<label class={labelCls}>Kanał</label>
					<select bind:value={fRodoKanal} class={inputCls}>
						<option>E-mail</option><option>Telefon</option><option>Osobiście</option>
					</select>
				</div>
			</div>
		</div>
	</div>
</Modal>
