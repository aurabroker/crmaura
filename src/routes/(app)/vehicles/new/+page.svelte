<script lang="ts">
	// Strona „Dodaj pojazd” (np. z menu klienta ?klient=…): ten sam formularz co w panelu
	// Pojazdy i na karcie klienta — identyfikacja VIN + rejestracja i zaszeregowanie Cumulus.
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { wczytajPojazdy } from '$lib/kolekcje';
	import { logAudit } from '$lib/utils/audit';
	import { vehicleLabel } from '$lib/hestia/pojazd';
	import VehicleForm from '$lib/components/VehicleForm.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const presetKlient = $derived($page.url.searchParams.get('klient') ?? '');

	let form = $state<ReturnType<typeof VehicleForm> | null>(null);
	let saving = $state(false);
	let error = $state('');

	async function save() {
		if (!form) return;
		const err = form.isValid();
		if (err) { error = err; return; }
		saving = true; error = '';
		const payload = form.getValues();
		const { data, error: err2 } = await sb
			.from('crm_vehicles')
			.insert([{ tenant_id: appState.profile!.tenant_id, ...payload }])
			.select('id')
			.single();
		saving = false;
		if (err2) { error = err2.message; return; }
		await logAudit('vehicle_created', 'vehicle', data?.id ?? null, vehicleLabel(payload));
		const { data: all } = await wczytajPojazdy();
		appState.vehicles = (all ?? []) as typeof appState.vehicles;
		goto(payload.klient_id ? `/clients/${payload.klient_id}?tab=pojazdy` : '/vehicles');
	}
</script>

<svelte:head><title>Dodaj Pojazd — AuraCRM</title></svelte:head>

<div class="max-w-3xl">
	<button onclick={() => history.back()} class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-4 transition-colors">
		<ArrowLeft size={16} /> Wróć
	</button>
	<h1 class="text-2xl font-semibold text-slate-900 mb-1">Dodaj Pojazd</h1>
	<p class="text-sm text-slate-500 mb-6">
		Dane pojazdu do kartoteki klienta — identyfikacja, parametry i zaszeregowanie wg układu Cumulus (Hestia)
	</p>

	{#if error}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>{/if}

	<div class="bg-white border border-line rounded-xl shadow-sm p-6">
		<VehicleForm bind:this={form} presetKlient={presetKlient} showClient={true} />
		<div class="flex justify-end gap-2 pt-5 mt-5 border-t border-line">
			<button onclick={() => history.back()} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-700 hover:bg-slate-50">Anuluj</button>
			<button onclick={save} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-50">
				{saving ? 'Zapisywanie…' : 'Zapisz pojazd'}
			</button>
		</div>
	</div>
</div>
