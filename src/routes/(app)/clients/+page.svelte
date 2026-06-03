<script lang="ts">
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Client } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Pencil } from 'lucide-svelte';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let search = $state('');
	let showModal = $state(false);
	let editingClient = $state<Client | null>(null);

	// Shared form state
	let fNazwa = $state('');
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
				(c.nip ?? '').includes(search)
		)
	);

	function openNew() {
		editingClient = null;
		fNazwa = ''; fUlica = ''; fNip = ''; fRegon = ''; fKrs = ''; fPesel = '';
		fRodo = false; fRodoData = ''; fRodoKanal = 'E-mail'; formError = '';
		showModal = true;
	}

	function openEdit(c: Client) {
		editingClient = c;
		fNazwa = c.nazwa; fUlica = c.ulica ?? ''; fNip = c.nip ?? '';
		fRegon = c.regon ?? ''; fKrs = c.krs ?? ''; fPesel = c.pesel ?? '';
		fRodo = c.rodo_zgoda; fRodoData = c.rodo_data ?? '';
		fRodoKanal = c.rodo_kanal ?? 'E-mail'; formError = '';
		showModal = true;
	}

	function closeModal() { showModal = false; editingClient = null; formError = ''; }

	async function save() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const payload = {
			nazwa: fNazwa.trim(),
			ulica: fUlica.trim() || null,
			nip: fNip.trim() || null,
			pesel: fPesel.trim() || null,
			regon: fRegon.trim() || null,
			krs: fKrs.trim() || null,
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

	// --- Dodaj pojazd (z wyborem klienta) ---
	let showVehicle = $state(false);
	let vKlient = $state('');
	let vMarka = $state(''); let vModel = $state(''); let vRej = $state('');
	let vVin = $state(''); let vRok = $state(''); let vUwagi = $state('');
	let savingV = $state(false); let vehicleError = $state('');

	function openNewVehicle() {
		vKlient = ''; vMarka = ''; vModel = ''; vRej = ''; vVin = ''; vRok = ''; vUwagi = '';
		vehicleError = ''; showVehicle = true;
	}

	async function saveVehicle() {
		if (!vKlient || !vRej) { vehicleError = 'Wybierz klienta i podaj nr rejestracyjny.'; return; }
		savingV = true; vehicleError = '';
		const markaModel = [vMarka.trim(), vModel.trim()].filter(Boolean).join(' ') || 'Nieznany';
		const { error } = await sb.from('crm_vehicles').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: vKlient,
			nr_rejestracyjny: vRej.trim(),
			marka_model: markaModel,
			rok_produkcji: vRok ? parseInt(vRok) : null,
			vin: vVin.trim() || null
		}]);
		savingV = false;
		if (error) { vehicleError = error.message; return; }
		showVehicle = false;
		const { data } = await sb.from('crm_vehicles').select('*');
		appState.vehicles = (data ?? []) as typeof appState.vehicles;
	}

	$effect(() => {
		const params = $page.url.searchParams;
		if (params.get('newvehicle') === '1') openNewVehicle();
		if (params.get('new') === '1') openNew();
	});

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Klienci — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Klienci <span class="text-slate-400 text-lg font-normal">({appState.clients.length})</span></h1>
		<p class="text-sm text-slate-500 mt-1">Zarządzanie portfelem i statusami RODO</p>
	</div>
	<button onclick={openNew} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
		+ Nowy Klient
	</button>
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
				<th class="px-5 py-3">NIP / KRS</th>
				<th class="px-5 py-3">RODO</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as c}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3">
						<div class="font-medium text-slate-900">{c.nazwa}</div>
						{#if c.ulica}<div class="text-xs text-slate-400">{c.ulica}</div>{/if}
					</td>
					<td class="px-5 py-3 text-xs text-slate-500">
						{#if c.nip}NIP: {c.nip}<br/>{/if}
						{#if c.krs}KRS: {c.krs}{/if}
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

<Modal title={editingClient ? `Edytuj — ${editingClient.nazwa}` : 'Nowy Klient'} open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : editingClient ? 'Zapisz zmiany' : 'Zapisz Klienta'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Nazwa firmy / Imię i Nazwisko *</label>
			<input bind:value={fNazwa} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Ulica i miasto</label>
			<input bind:value={fUlica} class={inputCls} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
			<div><label class={labelCls}>REGON</label><input bind:value={fRegon} class={inputCls} /></div>
			<div><label class={labelCls}>KRS</label><input bind:value={fKrs} class={inputCls} /></div>
			<div><label class={labelCls}>PESEL</label><input bind:value={fPesel} class={inputCls} /></div>
		</div>
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

<!-- Modal: Dodaj Pojazd -->
<Modal title="Dodaj Pojazd" open={showVehicle} onclose={() => { showVehicle = false; vehicleError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showVehicle = false; vehicleError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveVehicle} disabled={savingV} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingV ? 'Zapisywanie...' : 'Dodaj pojazd'}
		</button>
	{/snippet}
	{#if vehicleError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{vehicleError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Klient *</label>
			<select bind:value={vKlient} class={inputCls}>
				<option value="">— wybierz klienta —</option>
				{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
			</select>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Nr rejestracyjny *</label><input bind:value={vRej} class={inputCls} placeholder="WA 12345" /></div>
			<div><label class={labelCls}>VIN</label><input bind:value={vVin} class={inputCls} /></div>
			<div><label class={labelCls}>Marka</label><input bind:value={vMarka} class={inputCls} placeholder="Toyota" /></div>
			<div><label class={labelCls}>Model</label><input bind:value={vModel} class={inputCls} placeholder="Corolla" /></div>
			<div><label class={labelCls}>Rok produkcji</label><input type="number" bind:value={vRok} class={inputCls} placeholder="2022" /></div>
		</div>
	</div>
</Modal>
