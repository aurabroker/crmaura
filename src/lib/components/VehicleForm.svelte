<script lang="ts">
	// Jeden formularz pojazdu dla całego CRM: panel pojazdów, karta klienta,
	// strona "Dodaj pojazd". Zawiera pola klasyfikacyjne Hestii (Cumulus),
	// które decydują o zaszeregowaniu pojazdu i składce, oraz egzekwuje
	// politykę identyfikacji: VIN + rejestracja, a dla pojazdu niepodlegającego
	// rejestracji — VIN, numer nadwozia/ramy albo numer silnika.
	import { appState } from '$lib/stores/app.svelte';
	import type { Vehicle, VehicleUsage } from '$lib/types/database';
	import {
		RODZAJE_KALKULACYJNE,
		RODZAJE_REJESTROWE,
		RODZAJE_TABLIC,
		UZYTKOWANIE_FLAGI,
		validateVehicleIdentity
	} from '$lib/hestia/pojazd';
	import { Info } from 'lucide-svelte';

	interface Props {
		vehicle?: Vehicle | null;
		/** Klient narzucony z góry (karta klienta) — pole wyboru jest wtedy ukryte. */
		presetKlient?: string;
		/** Pokaż wybór klienta (panel pojazdów, strona dodawania). */
		showClient?: boolean;
	}
	let { vehicle = null, presetKlient = '', showClient = true }: Props = $props();

	const inp =
		'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	let fKlient = $state(vehicle?.klient_id ?? presetKlient ?? '');
	let fBezRej = $state(!!vehicle?.bez_rejestracji);
	let fRej = $state(vehicle?.nr_rejestracyjny ?? '');
	let fVin = $state(vehicle?.vin ?? '');
	let fNadwozie = $state(vehicle?.nr_nadwozia ?? '');
	let fSilnik = $state(vehicle?.nr_silnika ?? '');
	let fMarka = $state(vehicle?.marka_model ?? '');
	let fRok = $state(vehicle?.rok_produkcji?.toString() ?? '');
	let fPierwszaRej = $state(vehicle?.data_pierwszej_rejestracji ?? '');
	let fRodzajKalk = $state(vehicle?.rodzaj_kalkulacyjny ?? '');
	let fRodzajRej = $state(vehicle?.rodzaj_rejestrowy ?? '');
	let fTyp = $state(vehicle?.typ_pojazdu ?? '');
	let fTablice = $state(vehicle?.rodzaj_tablic ?? 'stała');
	let fRodzaj = $state(vehicle?.rodzaj_pojazdu ?? '');
	let fPojemnosc = $state(vehicle?.pojemnosc_silnika?.toString() ?? '');
	let fMoc = $state(vehicle?.moc?.toString() ?? '');
	let fLadownosc = $state(vehicle?.ladownosc?.toString() ?? '');
	let fMiejsca = $state(vehicle?.liczba_miejsc?.toString() ?? '');
	let fUzyt = $state<VehicleUsage>({ ...(vehicle?.uzytkowanie ?? {}) });

	const int = (s: string) => (s.trim() ? parseInt(s, 10) : null);
	const txt = (s: string) => s.trim() || null;

	export function isValid(): string | null {
		if (showClient && !fKlient) return 'Wybierz klienta.';
		if (!fMarka.trim()) return 'Podaj markę i model.';
		const id = validateVehicleIdentity({
			nr_rejestracyjny: fRej,
			vin: fVin,
			nr_nadwozia: fNadwozie,
			nr_silnika: fSilnik,
			bez_rejestracji: fBezRej
		});
		if (id) return id;
		if (!fRodzajKalk.trim())
			return 'Podaj kalkulacyjny rodzaj pojazdu — bez niego nie da się zaszeregować pojazdu u ubezpieczyciela.';
		const vinUp = fVin.trim().toUpperCase();
		if (vinUp) {
			const dublet = appState.vehicles.find((v) => v.vin?.toUpperCase() === vinUp && v.id !== vehicle?.id);
			if (dublet) return `Pojazd o tym VIN już istnieje w kartotece (${dublet.nr_rejestracyjny ?? 'bez rejestracji'}).`;
		}
		return null;
	}

	export function getValues() {
		return {
			klient_id: fKlient,
			bez_rejestracji: fBezRej,
			nr_rejestracyjny: fBezRej ? null : fRej.trim().toUpperCase(),
			vin: txt(fVin)?.toUpperCase() ?? null,
			nr_nadwozia: txt(fNadwozie)?.toUpperCase() ?? null,
			nr_silnika: txt(fSilnik)?.toUpperCase() ?? null,
			marka_model: fMarka.trim(),
			rok_produkcji: int(fRok),
			data_pierwszej_rejestracji: fPierwszaRej || null,
			rodzaj_kalkulacyjny: txt(fRodzajKalk),
			rodzaj_rejestrowy: txt(fRodzajRej),
			typ_pojazdu: txt(fTyp),
			rodzaj_tablic: fBezRej ? 'brak' : txt(fTablice),
			rodzaj_pojazdu: txt(fRodzaj),
			pojemnosc_silnika: int(fPojemnosc),
			moc: int(fMoc),
			ladownosc: int(fLadownosc),
			liczba_miejsc: int(fMiejsca),
			uzytkowanie: Object.fromEntries(Object.entries(fUzyt).filter(([, v]) => v === true))
		};
	}
</script>

<div class="space-y-5">
	{#if showClient}
		<div>
			<label class={lbl} for="vf-klient">Klient *</label>
			<select id="vf-klient" class={inp} bind:value={fKlient}>
				<option value="">— wybierz —</option>
				{#each appState.clients as c (c.id)}
					<option value={c.id}>{c.nazwa}</option>
				{/each}
			</select>
		</div>
	{/if}

	<!-- Identyfikacja -->
	<div class="space-y-3">
		<p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Identyfikacja</p>
		<label class="flex items-start gap-2 bg-slate-50 border border-line rounded-lg px-3 py-2 cursor-pointer">
			<input type="checkbox" bind:checked={fBezRej} class="mt-0.5" />
			<span class="text-sm text-slate-700">
				Pojazd niepodlegający rejestracji (specjalny, wolnobieżny)
				<span class="block text-xs text-slate-500">
					Zamiast tablic wystarczy VIN, numer nadwozia/ramy albo numer silnika.
				</span>
			</span>
		</label>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="vf-rej">Nr rejestracyjny {fBezRej ? '' : '*'}</label>
				<input id="vf-rej" class={inp} bind:value={fRej} disabled={fBezRej} placeholder={fBezRej ? 'nie dotyczy' : 'np. PO12345'} />
			</div>
			<div>
				<label class={lbl} for="vf-vin">VIN {fBezRej ? '' : '*'}</label>
				<input id="vf-vin" class={inp} bind:value={fVin} placeholder="17 znaków" maxlength="17" />
			</div>
		</div>
		{#if fBezRej}
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class={lbl} for="vf-nadw">Nr nadwozia / ramy</label>
					<input id="vf-nadw" class={inp} bind:value={fNadwozie} />
				</div>
				<div>
					<label class={lbl} for="vf-siln">Nr silnika</label>
					<input id="vf-siln" class={inp} bind:value={fSilnik} />
				</div>
			</div>
		{/if}
		{#if vehicle && !fBezRej && fRej.trim().toUpperCase() !== (vehicle.nr_rejestracyjny ?? '').toUpperCase()}
			<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
				Zmieniasz numer rejestracyjny z {vehicle.nr_rejestracyjny ?? '—'} na {fRej.trim().toUpperCase() || '—'}.
				Historia polis pozostaje przy tym pojeździe — wiąże go VIN, nie tablice.
			</p>
		{/if}
	</div>

	<!-- Pojazd -->
	<div class="space-y-3">
		<p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Pojazd</p>
		<div class="grid grid-cols-3 gap-3">
			<div class="col-span-2">
				<label class={lbl} for="vf-marka">Marka i model *</label>
				<input id="vf-marka" class={inp} bind:value={fMarka} placeholder="np. Peugeot Boxer" />
			</div>
			<div>
				<label class={lbl} for="vf-rok">Rok produkcji</label>
				<input id="vf-rok" class={inp} type="number" bind:value={fRok} placeholder="RRRR" />
			</div>
		</div>
		<div class="grid grid-cols-3 gap-3">
			<div>
				<label class={lbl} for="vf-pierwsza">Pierwsza rejestracja</label>
				<input id="vf-pierwsza" class={inp} type="date" bind:value={fPierwszaRej} disabled={fBezRej} />
			</div>
			<div>
				<label class={lbl} for="vf-tablice">Rodzaj tablic</label>
				<select id="vf-tablice" class={inp} bind:value={fTablice} disabled={fBezRej}>
					{#each RODZAJE_TABLIC as t}<option value={t}>{t}</option>{/each}
				</select>
			</div>
			<div>
				<label class={lbl} for="vf-miejsca">Liczba miejsc</label>
				<input id="vf-miejsca" class={inp} type="number" bind:value={fMiejsca} />
			</div>
		</div>
		<div class="grid grid-cols-3 gap-3">
			<div>
				<label class={lbl} for="vf-poj">Pojemność [cm³]</label>
				<input id="vf-poj" class={inp} type="number" bind:value={fPojemnosc} />
			</div>
			<div>
				<label class={lbl} for="vf-moc">Moc [kW]</label>
				<input id="vf-moc" class={inp} type="number" bind:value={fMoc} />
			</div>
			<div>
				<label class={lbl} for="vf-lad">Ładowność [kg]</label>
				<input id="vf-lad" class={inp} type="number" bind:value={fLadownosc} />
			</div>
		</div>
	</div>

	<!-- Zaszeregowanie (Hestia / Cumulus) -->
	<div class="space-y-3">
		<div class="flex items-start gap-2">
			<p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Zaszeregowanie</p>
			<span class="text-[11px] text-slate-400 flex items-center gap-1" title="Pola z układu Cumulus (ERGO Hestia) — wymagane do wyliczenia składki i eksportu wykazu floty">
				<Info size={11} /> wg Cumulus (Hestia)
			</span>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="vf-kalk">Kalkulacyjny rodzaj pojazdu *</label>
				<input id="vf-kalk" class={inp} bind:value={fRodzajKalk} list="vf-kalk-lista" placeholder="np. Osobowe" />
				<datalist id="vf-kalk-lista">
					{#each RODZAJE_KALKULACYJNE as r}<option value={r}></option>{/each}
				</datalist>
			</div>
			<div>
				<label class={lbl} for="vf-rejestrowy">Rodzaj rejestrowy (z dowodu)</label>
				<input id="vf-rejestrowy" class={inp} bind:value={fRodzajRej} list="vf-rej-lista" placeholder="np. SAMOCHÓD CIĘŻAROWY" />
				<datalist id="vf-rej-lista">
					{#each RODZAJE_REJESTROWE as r}<option value={r}></option>{/each}
				</datalist>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="vf-typ">Typ pojazdu</label>
				<input id="vf-typ" class={inp} bind:value={fTyp} placeholder="wg homologacji, opcjonalnie" />
			</div>
			<div>
				<label class={lbl} for="vf-rodzaj">Rodzaj (opis własny)</label>
				<input id="vf-rodzaj" class={inp} bind:value={fRodzaj} placeholder="np. Samochody osobowe" />
			</div>
		</div>
	</div>

	<!-- Pojazd wykorzystywany -->
	<div class="space-y-2">
		<p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Pojazd wykorzystywany jako</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
			{#each UZYTKOWANIE_FLAGI as f (f.key)}
				<label class="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
					<input type="checkbox" class="mt-0.5" bind:checked={fUzyt[f.key]} />
					<span>{f.label}</span>
				</label>
			{/each}
		</div>
	</div>
</div>
