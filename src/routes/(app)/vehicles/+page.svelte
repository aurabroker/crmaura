<script lang="ts">
	// Panel zarządzania pojazdami: pełna kartoteka, historia polis na pojeździe
	// i obsługa przerejestrowania. Zakładka w Ustawieniach pokazywała tylko
	// część pól i nie dawała wglądu w to, czym pojazd był ubezpieczony.
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus, todayStr } from '$lib/utils';
	import { logAudit } from '$lib/utils/audit';
	import Modal from '$lib/components/Modal.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import type { Vehicle } from '$lib/types/database';
	import { Car, Plus, Search, Pencil, Trash2, ChevronRight, RefreshCw, Upload } from 'lucide-svelte';

	const inp =
		'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	let szukaj = $state('');
	let filtr = $state<'wszystkie' | 'ubezpieczone' | 'bez_ochrony'>('wszystkie');
	let rozwiniety = $state<string | null>(null);
	const today = todayStr();

	function klientNazwa(id: string): string {
		return appState.clients.find((c) => c.id === id)?.nazwa ?? '—';
	}

	/** Polisy na pojeździe, najnowsze pierwsze — historia ochrony. */
	function polisyPojazdu(vehicleId: string) {
		return appState.policies
			.filter((p) => p.pojazd_id === vehicleId && !p.deleted_at)
			.sort((a, b) => (b.data_od ?? '').localeCompare(a.data_od ?? ''));
	}

	function aktywnaPolisa(vehicleId: string) {
		return polisyPojazdu(vehicleId).find((p) => p.data_od <= today && p.data_do >= today) ?? null;
	}

	const pojazdy = $derived(
		appState.vehicles
			.filter((v) => {
				const q = szukaj.trim().toLowerCase();
				if (q) {
					const stog = [v.nr_rejestracyjny, v.marka_model, v.vin, klientNazwa(v.klient_id)]
						.filter(Boolean)
						.join(' ')
						.toLowerCase();
					if (!stog.includes(q)) return false;
				}
				if (filtr === 'ubezpieczone') return !!aktywnaPolisa(v.id);
				if (filtr === 'bez_ochrony') return !aktywnaPolisa(v.id);
				return true;
			})
			.sort((a, b) => (a.nr_rejestracyjny ?? '').localeCompare(b.nr_rejestracyjny ?? '', 'pl'))
	);

	const bezOchrony = $derived(appState.vehicles.filter((v) => !aktywnaPolisa(v.id)).length);

	// --- Formularz pojazdu ---
	let showForm = $state(false);
	let edytowany = $state<Vehicle | null>(null);
	let fKlient = $state('');
	let fRej = $state('');
	let fMarka = $state('');
	let fVin = $state('');
	let fRok = $state('');
	let fRodzaj = $state('');
	let fPojemnosc = $state('');
	let fMoc = $state('');
	let fLadownosc = $state('');
	let zapisywanie = $state(false);
	let blad = $state('');

	function nowy() {
		edytowany = null;
		fKlient = appState.clients[0]?.id ?? '';
		fRej = ''; fMarka = ''; fVin = ''; fRok = '';
		fRodzaj = ''; fPojemnosc = ''; fMoc = ''; fLadownosc = '';
		blad = '';
		showForm = true;
	}

	function edytuj(v: Vehicle) {
		edytowany = v;
		fKlient = v.klient_id;
		fRej = v.nr_rejestracyjny ?? '';
		fMarka = v.marka_model ?? '';
		fVin = v.vin ?? '';
		fRok = v.rok_produkcji?.toString() ?? '';
		fRodzaj = v.rodzaj_pojazdu ?? '';
		fPojemnosc = v.pojemnosc_silnika?.toString() ?? '';
		fMoc = v.moc?.toString() ?? '';
		fLadownosc = v.ladownosc?.toString() ?? '';
		blad = '';
		showForm = true;
	}

	async function odswiezPojazdy() {
		const { data } = await sb.from('crm_vehicles').select('*');
		appState.vehicles = (data ?? []) as typeof appState.vehicles;
	}

	async function zapisz() {
		if (!fKlient) { blad = 'Wybierz klienta.'; return; }
		if (!fRej.trim()) { blad = 'Numer rejestracyjny jest wymagany.'; return; }

		const vin = fVin.trim().toUpperCase() || null;
		// VIN jest stały i unikalny — dublet oznacza ten sam pojazd wpisany dwa razy.
		const dublet = vin
			? appState.vehicles.find((v) => v.vin?.toUpperCase() === vin && v.id !== edytowany?.id)
			: null;
		if (dublet) {
			blad = `Pojazd o tym VIN już istnieje w kartotece (${dublet.nr_rejestracyjny}).`;
			return;
		}

		zapisywanie = true;
		blad = '';
		const payload = {
			klient_id: fKlient,
			nr_rejestracyjny: fRej.trim().toUpperCase(),
			marka_model: fMarka.trim() || null,
			vin,
			rok_produkcji: fRok ? parseInt(fRok, 10) : null,
			rodzaj_pojazdu: fRodzaj.trim() || null,
			pojemnosc_silnika: fPojemnosc ? parseInt(fPojemnosc, 10) : null,
			moc: fMoc ? parseInt(fMoc, 10) : null,
			ladownosc: fLadownosc ? parseInt(fLadownosc, 10) : null
		};

		const { error } = edytowany
			? await sb.from('crm_vehicles').update(payload).eq('id', edytowany.id)
			: await sb
					.from('crm_vehicles')
					.insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]);

		zapisywanie = false;
		if (error) { blad = error.message; return; }

		await logAudit(
			edytowany ? 'vehicle_updated' : 'vehicle_created',
			'vehicle',
			edytowany?.id ?? null,
			payload.nr_rejestracyjny
		);
		showForm = false;
		await odswiezPojazdy();
	}

	async function usun(v: Vehicle) {
		const polisy = polisyPojazdu(v.id);
		if (polisy.length) {
			blad = `Nie można usunąć — pojazd ma ${polisy.length} ${polisy.length === 1 ? 'polisę' : 'polis'} w historii.`;
			return;
		}
		const ok = await askConfirm({
			title: 'Usunąć pojazd?',
			message: `${v.nr_rejestracyjny} — ${v.marka_model ?? 'bez nazwy'}`,
			detail: 'Operacji nie da się cofnąć.',
			confirmLabel: 'Usuń'
		});
		if (!ok) return;
		await sb.from('crm_vehicles').delete().eq('id', v.id);
		await logAudit('vehicle_deleted', 'vehicle', v.id, v.nr_rejestracyjny);
		await odswiezPojazdy();
	}
</script>

<svelte:head><title>Pojazdy — FRANK67 CRM</title></svelte:head>

<div class="max-w-6xl">
	<div class="flex flex-wrap items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Pojazdy</h1>
			<p class="text-sm text-slate-500 mt-0.5">
				{appState.vehicles.length}
				{appState.vehicles.length === 1 ? 'pojazd' : 'pojazdów'} w kartotece
				{#if bezOchrony > 0}· <span class="text-amber-700">{bezOchrony} bez czynnej ochrony</span>{/if}
			</p>
		</div>
		<button
			onclick={nowy}
			class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700"
		>
			<Plus size={15} /> Dodaj pojazd
		</button>
	</div>

	<div class="flex flex-wrap gap-3 mb-4">
		<div class="relative flex-1 min-w-[240px]">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				bind:value={szukaj}
				placeholder="Szukaj po rejestracji, VIN, marce lub kliencie…"
				class="{inp} pl-9"
			/>
		</div>
		<div class="flex gap-1">
			{#each [['wszystkie', 'Wszystkie'], ['ubezpieczone', 'Z ochroną'], ['bez_ochrony', 'Bez ochrony']] as [id, label]}
				<button
					onclick={() => (filtr = id as typeof filtr)}
					class="px-3 py-2 rounded-lg text-sm font-medium border transition-colors
						{filtr === id
							? 'bg-slate-900 text-white border-slate-900'
							: 'bg-white text-slate-600 border-line hover:bg-slate-50'}"
				>
					{label}
				</button>
			{/each}
		</div>
	</div>

	{#if blad && !showForm}
		<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 mb-4">{blad}</div>
	{/if}

	<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-sm min-w-[860px]">
				<thead class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<tr>
						<th class="px-4 py-3 text-left w-8"></th>
						<th class="px-4 py-3 text-left">Nr rej.</th>
						<th class="px-4 py-3 text-left">Marka / model</th>
						<th class="px-4 py-3 text-left">VIN</th>
						<th class="px-4 py-3 text-left">Rok</th>
						<th class="px-4 py-3 text-left">Klient</th>
						<th class="px-4 py-3 text-left">Ochrona</th>
						<th class="px-4 py-3 text-right">Polis</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each pojazdy as v (v.id)}
						{@const historia = polisyPojazdu(v.id)}
						{@const czynna = aktywnaPolisa(v.id)}
						<tr class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-4 py-3">
								<button
									onclick={() => (rozwiniety = rozwiniety === v.id ? null : v.id)}
									class="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
									title="Historia polis"
								>
									<ChevronRight size={15} class="transition-transform {rozwiniety === v.id ? 'rotate-90' : ''}" />
								</button>
							</td>
							<td class="px-4 py-3 font-semibold text-slate-900">{v.nr_rejestracyjny}</td>
							<td class="px-4 py-3 text-slate-700">{v.marka_model ?? '—'}</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-500">{v.vin ?? '—'}</td>
							<td class="px-4 py-3 text-slate-500">{v.rok_produkcji ?? '—'}</td>
							<td class="px-4 py-3 text-slate-700">{klientNazwa(v.klient_id)}</td>
							<td class="px-4 py-3">
								{#if czynna}
									{@const s = policyStatus(czynna.data_do)}
									<Badge variant={s.badge === 'badge-error' ? 'error' : s.badge === 'badge-warning' ? 'warning' : 'success'}>
										do {czynna.data_do}
									</Badge>
								{:else}
									<span class="text-xs text-amber-700">brak czynnej</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-right text-slate-500">{historia.length}</td>
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-1">
									<button onclick={() => edytuj(v)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Edytuj">
										<Pencil size={14} />
									</button>
									<button onclick={() => usun(v)} class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title="Usuń">
										<Trash2 size={14} />
									</button>
								</div>
							</td>
						</tr>

						{#if rozwiniety === v.id}
							<tr class="bg-slate-50/60">
								<td colspan="9" class="px-4 py-4">
									{#if historia.length}
										<p class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
											Historia ochrony
										</p>
										<div class="space-y-1">
											{#each historia as p}
												<div class="flex flex-wrap items-center gap-3 bg-white border border-line rounded-lg px-3 py-2">
													<a href="/policies/{p.id}" class="text-sm font-medium text-blue-600 hover:underline">
														{p.nr_polisy}
													</a>
													<span class="text-xs text-slate-500">{p.data_od} — {p.data_do}</span>
													<span class="text-xs text-slate-500">{p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? ''}</span>
													<span class="text-xs text-slate-700">{fmtPln(p.skladka_przypisana)} zł</span>
													{#if p.renewal_of}
														<span class="text-[11px] text-slate-400 flex items-center gap-1">
															<RefreshCw size={11} /> odnowienie
														</span>
													{/if}
													{#if p.data_od <= today && p.data_do >= today}
														<Badge variant="success">czynna</Badge>
													{/if}
												</div>
											{/each}
										</div>
										{@const ostatnia = historia[0]}
										{#if !czynna}
											<a
												href="/policies/import?renewal_of={ostatnia.id}"
												class="inline-flex items-center gap-1.5 mt-3 text-sm border border-amber-300 bg-amber-50 text-amber-700 rounded-lg px-3 py-2 hover:bg-amber-100"
											>
												<Upload size={14} /> Wgraj odnowienie {ostatnia.nr_polisy}
											</a>
										{/if}
									{:else}
										<p class="text-sm text-slate-400">
											Ten pojazd nie ma jeszcze żadnej polisy w CRM.
										</p>
									{/if}
								</td>
							</tr>
						{/if}
					{:else}
						<tr>
							<td colspan="9" class="px-4 py-10 text-center text-slate-400 text-sm">
								<Car size={22} class="mx-auto mb-2 opacity-40" />
								Brak pojazdów spełniających kryteria
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

{#if showForm}
	<Modal open={showForm} title={edytowany ? 'Edytuj pojazd' : 'Nowy pojazd'} onclose={() => (showForm = false)}>
		<div class="space-y-4">
			<div>
				<label class={lbl} for="v-klient">Klient *</label>
				<select id="v-klient" class={inp} bind:value={fKlient}>
					{#each appState.clients as c (c.id)}
						<option value={c.id}>{c.nazwa}</option>
					{/each}
				</select>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class={lbl} for="v-rej">Nr rejestracyjny *</label>
					<input id="v-rej" class={inp} bind:value={fRej} placeholder="np. PO12345" />
				</div>
				<div>
					<label class={lbl} for="v-vin">VIN</label>
					<input id="v-vin" class={inp} bind:value={fVin} placeholder="17 znaków" />
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class={lbl} for="v-marka">Marka i model</label>
					<input id="v-marka" class={inp} bind:value={fMarka} placeholder="np. Peugeot Boxer" />
				</div>
				<div>
					<label class={lbl} for="v-rok">Rok produkcji</label>
					<input id="v-rok" class={inp} type="number" bind:value={fRok} placeholder="np. 2019" />
				</div>
			</div>

			<div>
				<label class={lbl} for="v-rodzaj">Rodzaj pojazdu</label>
				<input id="v-rodzaj" class={inp} bind:value={fRodzaj} placeholder="np. Samochody osobowe" />
			</div>

			<div class="grid grid-cols-3 gap-3">
				<div>
					<label class={lbl} for="v-poj">Pojemność [ccm]</label>
					<input id="v-poj" class={inp} type="number" bind:value={fPojemnosc} />
				</div>
				<div>
					<label class={lbl} for="v-moc">Moc [kW]</label>
					<input id="v-moc" class={inp} type="number" bind:value={fMoc} />
				</div>
				<div>
					<label class={lbl} for="v-lad">Ładowność [kg]</label>
					<input id="v-lad" class={inp} type="number" bind:value={fLadownosc} />
				</div>
			</div>

			{#if edytowany && fRej.trim().toUpperCase() !== (edytowany.nr_rejestracyjny ?? '')}
				<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
					Zmieniasz numer rejestracyjny z {edytowany.nr_rejestracyjny} na {fRej.trim().toUpperCase()}.
					Historia polis pozostaje przy tym pojeździe — wiąże go VIN, nie tablice.
				</p>
			{/if}

			{#if blad}<p class="text-sm text-red-600">{blad}</p>{/if}

			<div class="flex justify-end gap-2 pt-1">
				<button onclick={() => (showForm = false)} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-700 hover:bg-slate-50">
					Anuluj
				</button>
				<button
					onclick={zapisz}
					disabled={zapisywanie}
					class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50"
				>
					{zapisywanie ? 'Zapisywanie…' : 'Zapisz'}
				</button>
			</div>
		</div>
	</Modal>
{/if}
