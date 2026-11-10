<script lang="ts">
	import { wczytajPojazdy } from '$lib/kolekcje';
	// Panel zarządzania pojazdami: pełna kartoteka, historia polis na pojeździe
	// i obsługa przerejestrowania. Zakładka w Ustawieniach pokazywała tylko
	// część pól i nie dawała wglądu w to, czym pojazd był ubezpieczony.
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, todayStr } from '$lib/utils';
	import { polisaAktywna } from '$lib/statusPolisy';
	import { ochronaPojazdu, opisTechniczny } from '$lib/flota';
	import { logAudit } from '$lib/utils/audit';
	import { odmiana } from '$lib/utils';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Kopiuj from '$lib/components/Kopiuj.svelte';
	import EksportExcel from '$lib/components/EksportExcel.svelte';
	import VehicleForm from '$lib/components/VehicleForm.svelte';
	import DeregisterVehicleModal from '$lib/components/DeregisterVehicleModal.svelte';
	import { kol, type Arkusz } from '$lib/eksport';
	import { opisUzytkowania, vehicleLabel } from '$lib/hestia/pojazd';
	import { downloadCumulus, mapToCumulus } from '$lib/hestia/cumulusExport';
	import Badge from '$lib/components/Badge.svelte';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import type { Policy, Vehicle } from '$lib/types/database';
	import { Car, Plus, Search, Pencil, Trash2, ChevronRight, RefreshCw, Upload, MailX, FileSpreadsheet } from 'lucide-svelte';

	const inp =
		'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

	let szukaj = $state('');
	let filtr = $state<'wszystkie' | 'ubezpieczone' | 'bez_ochrony' | 'wyrejestrowane'>('wszystkie');
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
		return polisyPojazdu(vehicleId).find((p) => polisaAktywna(p, today)) ?? null;
	}

	const pojazdy = $derived(
		appState.vehicles
			.filter((v) => {
				const q = szukaj.trim().toLowerCase();
				if (q) {
					const stog = [v.nr_rejestracyjny, v.marka_model, v.vin, v.nr_nadwozia, v.nr_silnika, klientNazwa(v.klient_id)]
						.filter(Boolean)
						.join(' ')
						.toLowerCase();
					if (!stog.includes(q)) return false;
				}
				// Pojazd po zgłoszeniu wyrejestrowania nie liczy się jako „bez ochrony” — ma własny filtr.
				if (filtr === 'wyrejestrowane') return !!v.wyrejestrowany_at;
				if (filtr === 'ubezpieczone') return !v.wyrejestrowany_at && !!aktywnaPolisa(v.id);
				if (filtr === 'bez_ochrony') return !v.wyrejestrowany_at && !aktywnaPolisa(v.id);
				return true;
			})
			.sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b), 'pl'))
	);

	// Eksport do Excela: pojazdy z listy (po wyszukiwaniu i filtrze) i historia polis na tych pojazdach.
	const nazwaTuPolisy = (p: Policy) => p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? '';
	function arkuszePojazdow(): Arkusz[] {
		return [
			{
				nazwa: 'Pojazdy',
				kolumny: ['Nr rejestracyjny', kol.tekst('VIN'), kol.tekst('Nr nadwozia'), 'Marka i model', kol.liczba('Rok produkcji'), kol.data('Pierwsza rejestracja'),
					'Kalkulacyjny rodzaj (Cumulus)', 'Rodzaj rejestrowy', 'Rodzaj pojazdu', kol.liczba('Pojemność cm³'), kol.liczba('Moc kW'),
					kol.liczba('Ładowność kg'), kol.liczba('Liczba miejsc'), 'Użytkowanie', 'Klient', kol.tekst('Czynna polisa'), 'Towarzystwo', kol.data('Ochrona do'), kol.zl('Składka'), kol.data('Wyrejestrowany')],
				wiersze: pojazdy.map((v) => {
					const p = aktywnaPolisa(v.id);
					return [v.bez_rejestracji ? 'bez rejestracji' : v.nr_rejestracyjny, v.vin, v.nr_nadwozia ?? null, v.marka_model, v.rok_produkcji, v.data_pierwszej_rejestracji ?? null,
						v.rodzaj_kalkulacyjny ?? null, v.rodzaj_rejestrowy ?? null, v.rodzaj_pojazdu, v.pojemnosc_silnika, v.moc, v.ladownosc,
						v.liczba_miejsc ?? null, opisUzytkowania(v), klientNazwa(v.klient_id), p?.nr_polisy ?? 'brak czynnej ochrony', p ? nazwaTuPolisy(p) : '', p?.data_do ?? null, p?.skladka_przypisana ?? null, v.wyrejestrowany_at ?? null];
				})
			},
			{
				nazwa: 'Historia polis',
				kolumny: ['Pojazd', kol.tekst('Nr polisy'), 'Towarzystwo', 'Rodzaj', kol.data('Od'), kol.data('Do'), kol.zl('Składka'), 'Odnowienie'],
				wiersze: pojazdy.flatMap((v) => polisyPojazdu(v.id).map((p) => [
					vehicleLabel(v), p.nr_polisy, nazwaTuPolisy(p), p.rodzaj, p.data_od, p.data_do, p.skladka_przypisana, p.renewal_of ? 'tak' : ''
				]))
			}
		];
	}

	const bezOchrony = $derived(appState.vehicles.filter((v) => !v.wyrejestrowany_at && !aktywnaPolisa(v.id)).length);

	// Sortowanie historii polis rozwiniętego pojazdu (rozwinięty jest zawsze jeden).
	// Domyślnie jak dotąd: najnowsze (data_od) pierwsze.
	const czynnaPolisa = (p: Policy) => polisaAktywna(p, today);
	const sortHistorii = new Sortowanie<Policy>({
		nr: (p) => p.nr_polisy,
		od: (p) => p.data_od,
		do: (p) => p.data_do,
		tu: (p) => p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa,
		skladka: (p) => Number(p.skladka_przypisana ?? 0),
		// czynna, potem odnowienia, reszta
		status: (p) => (czynnaPolisa(p) ? 0 : p.renewal_of ? 1 : 2)
	}, { klucz: 'od', kierunek: 'desc' }, 'pojazd-historia-polis');
	const historiaWidok = $derived(rozwiniety ? sortHistorii.sortuj(polisyPojazdu(rozwiniety)) : []);

	// --- Formularz pojazdu --- wspólny komponent VehicleForm: identyfikacja (VIN + rejestracja,
	// albo nadwozie/silnik dla pojazdu niepodlegającego rejestracji) i zaszeregowanie Cumulus.
	let showForm = $state(false);
	let edytowany = $state<Vehicle | null>(null);
	let form = $state<ReturnType<typeof VehicleForm> | null>(null);
	let zapisywanie = $state(false);
	let blad = $state('');

	function nowy() {
		edytowany = null;
		blad = '';
		showForm = true;
	}

	function edytuj(v: Vehicle) {
		edytowany = v;
		blad = '';
		showForm = true;
	}

	async function odswiezPojazdy() {
		const { data } = await wczytajPojazdy();
		appState.vehicles = (data ?? []) as typeof appState.vehicles;
	}

	async function zapisz() {
		if (!form) return;
		const err = form.isValid();
		if (err) { blad = err; return; }

		zapisywanie = true;
		blad = '';
		const payload = form.getValues();

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
			vehicleLabel(payload)
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
			message: `${vehicleLabel(v)} — ${v.marka_model ?? 'bez nazwy'}`,
			detail: 'Operacji nie da się cofnąć.',
			confirmLabel: 'Usuń'
		});
		if (!ok) return;
		await sb.from('crm_vehicles').delete().eq('id', v.id);
		await logAudit('vehicle_deleted', 'vehicle', v.id, vehicleLabel(v));
		await odswiezPojazdy();
	}

	// --- Zgłoszenie wyrejestrowania pojazdu do TU (e-mail z dowodem, ślad przy kliencie) ---
	let deregVehicle = $state<Vehicle | null>(null);

	// --- Wykaz floty w układzie zrzutu Cumulus (Hestia): to, co widać po wyszukiwaniu i filtrze ---
	function eksportCumulus() {
		if (!pojazdy.length) return;
		const rows = pojazdy.map((v) => {
			const client = appState.clients.find((c) => c.id === v.klient_id) ?? null;
			const policy = aktywnaPolisa(v.id) ?? polisyPojazdu(v.id)[0] ?? null;
			const ug = policy?.parent_id ? (appState.policies.find((p) => p.id === policy.parent_id) ?? null) : null;
			const leasing = policy?.leasing_id ? (appState.leasings.find((l) => l.id === policy.leasing_id) ?? null) : null;
			const ubezpieczony = policy?.ubezpieczony_id ? (appState.clients.find((c) => c.id === policy.ubezpieczony_id) ?? null) : null;
			return mapToCumulus({ vehicle: v, client, policy, ug, leasing, ubezpieczony });
		});
		downloadCumulus(rows, `wykaz-floty-cumulus-${today}.xlsx`);
		void logAudit('data_exported', 'export', null, `Pojazdy (Cumulus): ${odmiana(rows.length, 'pojazd', 'pojazdy', 'pojazdów')}`, {
			zakladka: 'Pojazdy',
			format: 'xlsx',
			uklad: 'cumulus',
			wiersze: rows.length
		});
		ctxToast(`Pobrano wykaz floty w układzie Cumulus: ${odmiana(rows.length, 'pojazd', 'pojazdy', 'pojazdów')}`);
	}
</script>

<svelte:head><title>Pojazdy — AuraCRM</title></svelte:head>

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
		<div class="flex flex-wrap gap-2">
			<EksportExcel plik="pojazdy" zakladka="Pojazdy" ile={pojazdy.length} arkusze={arkuszePojazdow} />
			<button
				type="button"
				onclick={eksportCumulus}
				disabled={!pojazdy.length}
				title="Wykaz pojazdów w układzie zrzutu Cumulus (STU ERGO Hestia) — 151 kolumn, do przesłania do towarzystwa"
				data-testid="eksport-cumulus"
				class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-50"
			>
				<FileSpreadsheet size={16} class="text-sky-700" /> Wykaz Cumulus
			</button>
			<button
				onclick={nowy}
				class="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover"
			>
				<Plus size={15} /> Dodaj pojazd
			</button>
		</div>
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
			{#each [['wszystkie', 'Wszystkie'], ['ubezpieczone', 'Z ochroną'], ['bez_ochrony', 'Bez ochrony'], ['wyrejestrowane', 'Wyrejestrowane']] as [id, label]}
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
				<thead class="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
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
						{@const ochrona = ochronaPojazdu(v.id, appState.policies, today)}
						{@const tech = opisTechniczny(v)}
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
							<td class="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
								{vehicleLabel(v)} {#if v.nr_rejestracyjny}<Kopiuj tekst={v.nr_rejestracyjny} opis="nr rejestracyjny" />{/if}
								{#if v.wyrejestrowany_at}
									<div class="text-[11px] font-semibold text-slate-500" title="Zgłoszono wyrejestrowanie do TU">wyrejestrowany {v.wyrejestrowany_at}</div>
								{/if}
							</td>
							<td class="px-4 py-3 text-slate-700">
								{v.marka_model ?? '—'}
								<!-- Zaszeregowanie (Cumulus) decyduje o składce — widać je w każdym widoku pojazdu. -->
								<div class="text-xs {v.rodzaj_kalkulacyjny ? 'text-slate-500' : 'text-amber-700'}">{v.rodzaj_kalkulacyjny ?? 'brak zaszeregowania'}</div>
								{#if tech}<div class="text-xs text-slate-400">{tech}</div>{/if}
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{v.vin ?? '—'} <Kopiuj tekst={v.vin} opis="VIN" /></td>
							<td class="px-4 py-3 text-slate-500">{v.rok_produkcji ?? '—'}</td>
							<td class="px-4 py-3 text-slate-700"><a href="/clients/{v.klient_id}" class="hover:text-accent-text hover:underline">{klientNazwa(v.klient_id)}</a></td>
							<td class="px-4 py-3">
								<span class="inline-block h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold {ochrona.cls}">{ochrona.tekst}</span>
								{#if czynna}<div class="text-xs text-slate-400 mt-0.5">{czynna.crm_insurers?.skrot ?? czynna.crm_insurers?.nazwa ?? ''} {czynna.nr_polisy}</div>{/if}
							</td>
							<td class="px-4 py-3 text-right text-slate-500">{historia.length}</td>
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-1">
									<button onclick={() => (deregVehicle = v)} data-testid="pojazd-wyrejestruj" class="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50" title={v.wyrejestrowany_at ? `Wyrejestrowanie zgłoszono ${v.wyrejestrowany_at} — zgłoś ponownie` : 'Zgłoś wyrejestrowanie pojazdu do TU (e-mail z dowodem)'}>
										<MailX size={14} />
									</button>
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
									<!-- Zaszeregowanie wg układu Cumulus (Hestia): pola potrzebne do wyliczenia składki. -->
									<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Zaszeregowanie (Cumulus)</p>
									<div class="mb-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs text-slate-700">
										<div><div class="text-slate-400">Kalkulacyjny rodzaj pojazdu</div>{v.rodzaj_kalkulacyjny ?? '—'}</div>
										<div><div class="text-slate-400">Rodzaj rejestrowy</div>{v.rodzaj_rejestrowy ?? '—'}</div>
										<div><div class="text-slate-400">Typ / tablice</div>{[v.typ_pojazdu, v.bez_rejestracji ? 'bez rejestracji' : v.rodzaj_tablic].filter(Boolean).join(' · ') || '—'}</div>
										<div><div class="text-slate-400">Pierwsza rejestracja</div>{v.data_pierwszej_rejestracji ?? '—'}</div>
										<div><div class="text-slate-400">Nr nadwozia / silnika</div>{[v.nr_nadwozia, v.nr_silnika].filter(Boolean).join(' · ') || '—'}</div>
										<div><div class="text-slate-400">Liczba miejsc</div>{v.liczba_miejsc ?? '—'}</div>
										<div class="col-span-2"><div class="text-slate-400">Pojazd wykorzystywany jako</div>{opisUzytkowania(v) || 'standardowo'}</div>
									</div>
									{#if historia.length}
										<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
											Historia ochrony
										</p>
										<div class="bg-white border border-line rounded-lg overflow-x-auto">
											<table class="w-full text-left text-sm">
												<thead class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
													<tr>
														<SortTh s={sortHistorii} k="nr" class="px-3 py-2">Nr polisy</SortTh>
														<SortTh s={sortHistorii} k="od" class="px-3 py-2">Od</SortTh>
														<SortTh s={sortHistorii} k="do" class="px-3 py-2">Do</SortTh>
														<SortTh s={sortHistorii} k="tu" class="px-3 py-2">TU</SortTh>
														<SortTh s={sortHistorii} k="skladka" class="px-3 py-2 text-right" align="right">Składka</SortTh>
														<SortTh s={sortHistorii} k="status" class="px-3 py-2">Status</SortTh>
													</tr>
												</thead>
												<tbody>
													{#each historiaWidok as p (p.id)}
														<tr class="border-t border-line-soft">
															<td class="px-3 py-2">
																<a href="/policies/{p.id}" class="text-sm font-medium text-blue-600 hover:underline">
																	{p.nr_polisy}
																</a>
																<Kopiuj tekst={p.nr_polisy} opis="nr polisy" />
															</td>
															<td class="px-3 py-2 text-xs text-slate-500">{p.data_od}</td>
															<td class="px-3 py-2 text-xs text-slate-500">{p.data_do}</td>
															<td class="px-3 py-2 text-xs text-slate-500">{p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? ''}</td>
															<td class="px-3 py-2 text-xs text-slate-700 text-right">{fmtPln(p.skladka_przypisana)} zł</td>
															<td class="px-3 py-2">
																<div class="flex flex-wrap items-center gap-3">
																	{#if p.renewal_of}
																		<span class="text-xs text-slate-400 flex items-center gap-1">
																			<RefreshCw size={11} /> odnowienie
																		</span>
																	{/if}
																	{#if czynnaPolisa(p)}
																		<Badge variant="success">czynna</Badge>
																	{/if}
																</div>
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
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
	<Modal open={showForm} title={edytowany ? `Edytuj pojazd ${vehicleLabel(edytowany)}` : 'Nowy pojazd'} onclose={() => (showForm = false)}>
		{#snippet footer()}
			<button onclick={() => (showForm = false)} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-700 hover:bg-slate-50">
				Anuluj
			</button>
			<button
				onclick={zapisz}
				disabled={zapisywanie}
				data-testid="pojazd-zapisz"
				class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-50"
			>
				{zapisywanie ? 'Zapisywanie…' : 'Zapisz'}
			</button>
		{/snippet}
		{#if blad}<p class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{blad}</p>{/if}
		{#key edytowany?.id ?? 'nowy'}
			<VehicleForm bind:this={form} vehicle={edytowany} showClient={true} />
		{/key}
	</Modal>
{/if}

{#if deregVehicle}
	<DeregisterVehicleModal
		open={!!deregVehicle}
		vehicle={deregVehicle}
		onclose={() => (deregVehicle = null)}
		onsent={() => { ctxToast('Zgłoszenie wyrejestrowania wysłane do towarzystwa — ślad przy kliencie.'); void odswiezPojazdy(); }}
	/>
{/if}
