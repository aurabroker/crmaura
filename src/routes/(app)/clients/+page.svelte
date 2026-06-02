<script lang="ts">
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search } from 'lucide-svelte';

	let search = $state('');
	let showModal = $state(false);

	// Form state
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

	async function saveClient() {
		if (!fNazwa.trim()) { formError = 'Pole Nazwa jest wymagane.'; return; }
		saving = true; formError = '';
		const { error } = await sb.from('crm_clients').insert([{
			tenant_id: appState.profile!.tenant_id,
			opiekun_id: appState.profile!.id,
			nazwa: fNazwa.trim(),
			ulica: fUlica.trim() || null,
			nip: fNip.trim() || null,
			pesel: fPesel.trim() || null,
			regon: fRegon.trim() || null,
			krs: fKrs.trim() || null,
			rodo_zgoda: fRodo,
			rodo_data: fRodoData || null,
			rodo_kanal: fRodoKanal
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showModal = false;
		const { data } = await sb.from('crm_clients').select('*');
		appState.clients = (data ?? []) as typeof appState.clients;
		resetForm();
	}

	function resetForm() {
		fNazwa = ''; fUlica = ''; fNip = ''; fRegon = ''; fKrs = ''; fPesel = '';
		fRodo = false; fRodoData = ''; fRodoKanal = 'E-mail'; formError = '';
	}

	function closeModal() { showModal = false; resetForm(); }
</script>

<svelte:head><title>Klienci — AuraCRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Klienci</h1>
		<p class="text-sm text-slate-500 mt-1">Zarządzanie portfelem i statusami RODO</p>
	</div>
	<button onclick={() => showModal = true} class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
		+ Nowy Klient
	</button>
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
		<Search size={16} class="text-slate-400" />
		<input
			bind:value={search}
			placeholder="Szukaj po nazwie lub NIP..."
			class="flex-1 text-sm outline-none text-slate-700 placeholder:text-slate-400"
		/>
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
						<button
							onclick={() => goto(`/clients/${c.id}`)}
							class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors"
						>
							Profil 360°
						</button>
					</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="px-5 py-6 text-center text-slate-400">Brak klientów</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<Modal title="Nowy Klient" open={showModal} onclose={closeModal}>
	{#snippet footer()}
		<button onclick={closeModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveClient} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz Klienta'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}

	<div class="space-y-3">
		<div>
			<label class="block text-sm font-medium text-slate-700 mb-1">Nazwa firmy / Imię i Nazwisko *</label>
			<input bind:value={fNazwa} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
		</div>
		<div>
			<label class="block text-sm font-medium text-slate-700 mb-1">Ulica i miasto</label>
			<input bind:value={fUlica} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1">NIP</label>
				<input bind:value={fNip} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1">REGON</label>
				<input bind:value={fRegon} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1">KRS</label>
				<input bind:value={fKrs} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1">PESEL</label>
				<input bind:value={fPesel} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
		</div>
		<div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
			<label class="flex items-center gap-2 font-semibold text-sm cursor-pointer mb-3">
				<input type="checkbox" bind:checked={fRodo} class="rounded" />
				Zgoda RODO odebrana
			</label>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="block text-sm font-medium text-slate-700 mb-1">Data zgody</label>
					<input type="date" bind:value={fRodoData} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
				</div>
				<div>
					<label class="block text-sm font-medium text-slate-700 mb-1">Kanał</label>
					<select bind:value={fRodoKanal} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
						<option>E-mail</option>
						<option>Telefon</option>
						<option>Osobiście</option>
					</select>
				</div>
			</div>
		</div>
	</div>
</Modal>
