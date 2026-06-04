<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const presetKlient = $derived($page.url.searchParams.get('klient') ?? '');

	let vKlient = $state(presetKlient);
	let vMarka = $state('');
	let vModel = $state('');
	let vRej = $state('');
	let vVin = $state('');
	let vRok = $state('');
	let vRodzaj = $state('osobowy');
	let vMoc = $state('');
	let vPojemnosc = $state('');
	let vLadownosc = $state('');
	let saving = $state(false);
	let error = $state('');

	let clientSearch = $state('');
	const filteredClients = $derived(
		clientSearch.trim()
			? appState.clients.filter(c => c.nazwa.toLowerCase().includes(clientSearch.toLowerCase()))
			: appState.clients
	);
	let clientDropOpen = $state(false);
	const selectedClientName = $derived(appState.clients.find(c => c.id === vKlient)?.nazwa ?? '');

	async function save() {
		if (!vKlient || !vRej.trim()) { error = 'Wybierz klienta i podaj nr rejestracyjny.'; return; }
		saving = true; error = '';
		const markaModel = [vMarka.trim(), vModel.trim()].filter(Boolean).join(' ') || 'Nieznany';
		const { error: err } = await sb.from('crm_vehicles').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: vKlient,
			nr_rejestracyjny: vRej.trim().toUpperCase(),
			marka_model: markaModel,
			rok_produkcji: vRok ? parseInt(vRok) : null,
			vin: vVin.trim() || null,
			rodzaj_pojazdu: vRodzaj,
			moc: vMoc ? parseInt(vMoc) : null,
			pojemnosc_silnika: vPojemnosc ? parseInt(vPojemnosc) : null,
			ladownosc: vLadownosc ? parseInt(vLadownosc) : null
		}]);
		saving = false;
		if (err) { error = err.message; return; }
		const { data } = await sb.from('crm_vehicles').select('*');
		appState.vehicles = (data ?? []) as typeof appState.vehicles;
		if (presetKlient) goto(`/clients/${presetKlient}`);
		else goto('/clients');
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	const TYPY = ['osobowy','ciężarowy','ciągnik siodłowy','przyczepka','naczepa','autobus'];
</script>

<svelte:head><title>Dodaj Pojazd — FRANK67 CRM</title></svelte:head>

<div class="max-w-2xl">
	<button onclick={() => history.back()} class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4 transition-colors">
		<ArrowLeft size={16} /> Wróć
	</button>
	<h1 class="text-2xl font-semibold text-slate-900 mb-1">Dodaj Pojazd</h1>
	<p class="text-sm text-slate-500 mb-6">Dane pojazdu do portfela klienta</p>

	{#if error}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>{/if}

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">

		<!-- Klient -->
		<div>
			<label class={labelCls}>Klient *</label>
			<div class="relative">
				<input type="text"
					placeholder={selectedClientName || '— wyszukaj klienta —'}
					value={clientSearch || selectedClientName}
					oninput={(e) => { clientSearch = (e.target as HTMLInputElement).value; clientDropOpen = true; }}
					onfocus={() => { clientSearch = ''; clientDropOpen = true; }}
					onblur={() => setTimeout(() => clientDropOpen = false, 150)}
					class={inputCls}
				/>
				{#if clientDropOpen && filteredClients.length > 0}
					<div class="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
						{#each filteredClients as c}
							<button type="button" class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
								onmousedown={() => { vKlient = c.id; clientSearch = ''; clientDropOpen = false; }}>
								{c.nazwa_skrocona ?? c.nazwa}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Rodzaj -->
		<div>
			<label class={labelCls}>Rodzaj pojazdu *</label>
			<select bind:value={vRodzaj} class={inputCls}>
				{#each TYPY as t}<option value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>{/each}
			</select>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class={labelCls}>Nr rejestracyjny *</label>
				<input bind:value={vRej} class={inputCls} placeholder="WA 12345" />
			</div>
			<div>
				<label class={labelCls}>VIN</label>
				<input bind:value={vVin} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Marka</label>
				<input bind:value={vMarka} class={inputCls} placeholder="Toyota" />
			</div>
			<div>
				<label class={labelCls}>Model</label>
				<input bind:value={vModel} class={inputCls} placeholder="Corolla" />
			</div>
			<div>
				<label class={labelCls}>Rok produkcji</label>
				<input type="number" bind:value={vRok} class={inputCls} placeholder="2022" min="1900" max="2099" />
			</div>
			<div>
				<label class={labelCls}>Moc (KM)</label>
				<input type="number" bind:value={vMoc} class={inputCls} placeholder="150" />
			</div>
			<div>
				<label class={labelCls}>Pojemność silnika (cm³)</label>
				<input type="number" bind:value={vPojemnosc} class={inputCls} placeholder="1998" />
			</div>
			<div>
				<label class={labelCls}>Ładowność (kg)</label>
				<input type="number" bind:value={vLadownosc} class={inputCls} placeholder="1000" />
			</div>
		</div>

		<div class="flex justify-end gap-3 pt-2">
			<button onclick={() => history.back()} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
				Anuluj
			</button>
			<button onclick={save} disabled={saving} class="px-5 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
				{saving ? 'Zapisywanie...' : 'Dodaj Pojazd'}
			</button>
		</div>
	</div>
</div>
