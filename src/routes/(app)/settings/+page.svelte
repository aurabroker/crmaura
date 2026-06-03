<svelte:head><title>Ustawienia — FRANK67 CRM</title></svelte:head>

<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Vehicle } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { Search, Pencil, Plus, Car, User } from 'lucide-svelte';

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	// --- Tabs ---
	let activeTab = $state<'vehicles' | 'profile'>('vehicles');

	// --- Profile ---
	let imie_nazwisko = $state(appState.profile?.imie_nazwisko ?? '');
	let stanowisko = $state(appState.profile?.stanowisko ?? '');
	let profileMsg = $state('');
	let profileError = $state('');
	let profileLoading = $state(false);

	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordMsg = $state('');
	let passwordError = $state('');
	let passwordLoading = $state(false);

	$effect(() => {
		if (appState.profile) {
			imie_nazwisko = appState.profile.imie_nazwisko ?? '';
			stanowisko = (appState.profile as any).stanowisko ?? '';
		}
	});

	async function saveProfile() {
		profileMsg = '';
		profileError = '';
		profileLoading = true;
		const { error } = await sb
			.from('crm_profiles')
			.update({ imie_nazwisko, stanowisko })
			.eq('id', appState.profile!.id);
		profileLoading = false;
		if (error) {
			profileError = error.message;
		} else {
			if (appState.profile) {
				appState.profile.imie_nazwisko = imie_nazwisko;
				(appState.profile as any).stanowisko = stanowisko;
			}
			profileMsg = 'Dane zostały zapisane.';
		}
	}

	async function savePassword() {
		passwordMsg = '';
		passwordError = '';
		if (newPassword.length < 8) {
			passwordError = 'Hasło musi mieć co najmniej 8 znaków.';
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordError = 'Hasła nie są zgodne.';
			return;
		}
		passwordLoading = true;
		const { error } = await sb.auth.updateUser({ password: newPassword });
		passwordLoading = false;
		if (error) {
			passwordError = error.message;
		} else {
			newPassword = '';
			confirmPassword = '';
			passwordMsg = 'Hasło zostało zmienione.';
		}
	}

	// --- Vehicles ---
	let vehicleSearch = $state('');
	let showVehicleModal = $state(false);
	let editingVehicle = $state<Vehicle | null>(null);
	let vKlientId = $state('');
	let vNrRej = $state('');
	let vMarkaModel = $state('');
	let vVin = $state('');
	let vRokProdukcji = $state('');
	let vehicleSaving = $state(false);
	let vehicleError = $state('');

	const filteredVehicles = $derived(
		appState.vehicles.filter(
			(v) =>
				!vehicleSearch ||
				v.nr_rejestracyjny.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
				v.marka_model.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
				(v.vin ?? '').toLowerCase().includes(vehicleSearch.toLowerCase())
		)
	);

	function clientName(klientId: string): string {
		const c = appState.clients.find((cl) => cl.id === klientId);
		return c?.nazwa ?? '—';
	}

	function openNewVehicle() {
		editingVehicle = null;
		vKlientId = appState.clients[0]?.id ?? '';
		vNrRej = '';
		vMarkaModel = '';
		vVin = '';
		vRokProdukcji = '';
		vehicleError = '';
		showVehicleModal = true;
	}

	function openEditVehicle(v: Vehicle) {
		editingVehicle = v;
		vKlientId = v.klient_id;
		vNrRej = v.nr_rejestracyjny;
		vMarkaModel = v.marka_model;
		vVin = v.vin ?? '';
		vRokProdukcji = v.rok_produkcji?.toString() ?? '';
		vehicleError = '';
		showVehicleModal = true;
	}

	function closeVehicleModal() {
		showVehicleModal = false;
		editingVehicle = null;
		vehicleError = '';
	}

	async function saveVehicle() {
		if (!vNrRej.trim()) { vehicleError = 'Nr rejestracyjny jest wymagany.'; return; }
		if (!vMarkaModel.trim()) { vehicleError = 'Marka/Model jest wymagane.'; return; }
		if (!vKlientId) { vehicleError = 'Wybierz klienta.'; return; }

		vehicleSaving = true;
		vehicleError = '';

		const payload = {
			klient_id: vKlientId,
			nr_rejestracyjny: vNrRej.trim().toUpperCase(),
			marka_model: vMarkaModel.trim(),
			vin: vVin.trim().toUpperCase() || null,
			rok_produkcji: vRokProdukcji ? parseInt(vRokProdukcji) : null
		};

		let error;
		if (editingVehicle) {
			({ error } = await sb.from('crm_vehicles').update(payload).eq('id', editingVehicle.id));
		} else {
			({ error } = await sb.from('crm_vehicles').insert([{
				tenant_id: appState.profile!.tenant_id,
				...payload
			}]));
		}

		if (error) {
			vehicleError = error.message;
			vehicleSaving = false;
			return;
		}

		// Reload vehicles
		const { data } = await sb
			.from('crm_vehicles')
			.select('*')
			.eq('tenant_id', appState.profile!.tenant_id)
			.order('nr_rejestracyjny');
		if (data) appState.vehicles = data;

		vehicleSaving = false;
		closeVehicleModal();
	}
</script>

<div class="max-w-5xl mx-auto py-8 space-y-6">
	<h1 class="text-2xl font-bold text-slate-900">Ustawienia</h1>

	<!-- Tabs -->
	<div class="flex gap-1 border-b border-slate-200">
		<button
			onclick={() => activeTab = 'vehicles'}
			class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {activeTab === 'vehicles' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}"
		>
			<Car size={16} />
			Pojazdy
		</button>
		<button
			onclick={() => activeTab = 'profile'}
			class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {activeTab === 'profile' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}"
		>
			<User size={16} />
			Mój profil
		</button>
	</div>

	<!-- Pojazdy Tab -->
	{#if activeTab === 'vehicles'}
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
			<div class="flex items-center justify-between mb-5">
				<h2 class="text-lg font-semibold text-slate-800">Pojazdy</h2>
				<button onclick={openNewVehicle} class="flex items-center gap-1.5 px-3 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">
					<Plus size={16} />
					Dodaj pojazd
				</button>
			</div>

			<!-- Search -->
			<div class="relative mb-4">
				<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					placeholder="Szukaj po nr rej., marce, VIN..."
					bind:value={vehicleSearch}
					class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			<!-- Table -->
			{#if filteredVehicles.length === 0}
				<p class="text-sm text-slate-500 text-center py-8">Brak pojazdów do wyświetlenia.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-slate-200 text-left text-slate-500">
								<th class="pb-2 font-medium">Nr rej.</th>
								<th class="pb-2 font-medium">Marka / Model</th>
								<th class="pb-2 font-medium">VIN</th>
								<th class="pb-2 font-medium">Rok</th>
								<th class="pb-2 font-medium">Klient</th>
								<th class="pb-2 font-medium w-10"></th>
							</tr>
						</thead>
						<tbody>
							{#each filteredVehicles as v (v.id)}
								<tr class="border-b border-slate-100 hover:bg-slate-50">
									<td class="py-2.5 font-medium text-slate-900">{v.nr_rejestracyjny}</td>
									<td class="py-2.5 text-slate-700">{v.marka_model}</td>
									<td class="py-2.5 text-slate-500 font-mono text-xs">{v.vin ?? '—'}</td>
									<td class="py-2.5 text-slate-500">{v.rok_produkcji ?? '—'}</td>
									<td class="py-2.5 text-slate-700">{clientName(v.klient_id)}</td>
									<td class="py-2.5">
										<button onclick={() => openEditVehicle(v)} class="p-1 text-slate-400 hover:text-slate-700 rounded" title="Edytuj">
											<Pencil size={15} />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<!-- Vehicle Modal -->
		{#if showVehicleModal}
			<Modal onclose={closeVehicleModal}>
				<h3 class="text-lg font-semibold text-slate-900 mb-4">{editingVehicle ? 'Edytuj pojazd' : 'Nowy pojazd'}</h3>
				<div class="space-y-4">
					<div>
						<label class={labelCls} for="vKlientId">Klient</label>
						<select id="vKlientId" class={inputCls} bind:value={vKlientId}>
							{#each appState.clients as c (c.id)}
								<option value={c.id}>{c.nazwa}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class={labelCls} for="vNrRej">Nr rejestracyjny</label>
						<input id="vNrRej" class={inputCls} type="text" bind:value={vNrRej} placeholder="np. WA12345" />
					</div>
					<div>
						<label class={labelCls} for="vMarkaModel">Marka / Model</label>
						<input id="vMarkaModel" class={inputCls} type="text" bind:value={vMarkaModel} placeholder="np. Toyota Corolla" />
					</div>
					<div>
						<label class={labelCls} for="vVin">VIN</label>
						<input id="vVin" class={inputCls} type="text" bind:value={vVin} placeholder="opcjonalnie" />
					</div>
					<div>
						<label class={labelCls} for="vRokProdukcji">Rok produkcji</label>
						<input id="vRokProdukcji" class={inputCls} type="number" bind:value={vRokProdukcji} placeholder="np. 2020" />
					</div>
					{#if vehicleError}
						<p class="text-sm text-red-600">{vehicleError}</p>
					{/if}
					<div class="flex justify-end gap-2 pt-2">
						<button onclick={closeVehicleModal} class="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">Anuluj</button>
						<button onclick={saveVehicle} disabled={vehicleSaving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50">
							{vehicleSaving ? 'Zapisywanie...' : 'Zapisz'}
						</button>
					</div>
				</div>
			</Modal>
		{/if}
	{/if}

	<!-- Profile Tab -->
	{#if activeTab === 'profile'}
		<!-- Read-only info -->
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
			<h2 class="text-lg font-semibold text-slate-800 mb-5">Informacje o koncie</h2>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
				<div>
					<span class="text-slate-500">Imię i nazwisko</span>
					<p class="font-medium text-slate-900 mt-0.5">{appState.profile?.imie_nazwisko ?? '—'}</p>
				</div>
				<div>
					<span class="text-slate-500">E-mail</span>
					<p class="font-medium text-slate-900 mt-0.5">{appState.profile?.email ?? '—'}</p>
				</div>
				<div>
					<span class="text-slate-500">Rola</span>
					<p class="mt-0.5"><Badge text={appState.profile?.rola ?? '—'} /></p>
				</div>
			</div>
		</div>

		<!-- Edit profile -->
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
			<h2 class="text-lg font-semibold text-slate-800 mb-5">Dane profilu</h2>
			<div class="space-y-4">
				<div>
					<label class={labelCls} for="imie_nazwisko">Imię i Nazwisko</label>
					<input id="imie_nazwisko" class={inputCls} type="text" bind:value={imie_nazwisko} />
				</div>
				<div>
					<label class={labelCls} for="stanowisko">Stanowisko</label>
					<input id="stanowisko" class={inputCls} type="text" bind:value={stanowisko} />
				</div>
				{#if profileMsg}
					<p class="text-sm text-green-600">{profileMsg}</p>
				{/if}
				{#if profileError}
					<p class="text-sm text-red-600">{profileError}</p>
				{/if}
				<button
					onclick={saveProfile}
					disabled={profileLoading}
					class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50"
				>
					{profileLoading ? 'Zapisywanie...' : 'Zapisz dane'}
				</button>
			</div>
		</div>

		<!-- Change password -->
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
			<h2 class="text-lg font-semibold text-slate-800 mb-5">Zmiana hasła</h2>
			<div class="space-y-4">
				<div>
					<label class={labelCls} for="newPassword">Nowe hasło</label>
					<input id="newPassword" class={inputCls} type="password" bind:value={newPassword} placeholder="min. 8 znaków" />
				</div>
				<div>
					<label class={labelCls} for="confirmPassword">Potwierdź hasło</label>
					<input id="confirmPassword" class={inputCls} type="password" bind:value={confirmPassword} />
				</div>
				{#if passwordMsg}
					<p class="text-sm text-green-600">{passwordMsg}</p>
				{/if}
				{#if passwordError}
					<p class="text-sm text-red-600">{passwordError}</p>
				{/if}
				<button
					onclick={savePassword}
					disabled={passwordLoading}
					class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50"
				>
					{passwordLoading ? 'Zapisywanie...' : 'Zmień hasło'}
				</button>
			</div>
		</div>
	{/if}
</div>
