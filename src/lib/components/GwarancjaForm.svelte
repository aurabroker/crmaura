<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import type { Policy } from '$lib/types/database';

	interface Props {
		parentUg: Policy;
	}
	let { parentUg }: Props = $props();

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	const TYPY = [
		['wadialna', 'Gwarancja wadialna'],
		['nalezytego_wykonania', 'Gwarancja należytego wykonania'],
		['usuniecia_wad', 'Gwarancja usunięcia wad i usterek'],
		['zwrotu_zaliczki', 'Gwarancja zwrotu zaliczki']
	];

	let fpTyp = $state('wadialna');
	let fpStawkaPct = $state('');
	let fpNr = $state('');
	let fpSuma = $state('');
	let fpOd = $state('');
	let fpDo = $state('');
	let fpKontrakt = $state('');
	let fpBenNazwa = $state('');
	let fpBenNip = $state('');
	let regonLoading = $state(false);
	let regonError = $state('');

	// Auto data_do from data_od (1 year)
	$effect(() => {
		if (fpOd && !fpDo) {
			const parts = fpOd.split('-');
			if (parts.length !== 3) return;
			const y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
			if (!y || !m || !d) return;
			let ey = y + 1, em = m, ed = d - 1;
			if (ed === 0) { em--; if (em === 0) { em = 12; ey--; } ed = new Date(ey, em, 0).getDate(); }
			fpDo = `${ey}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;
		}
	});

	async function lookupBeneficjent() {
		if (!fpBenNip.trim()) { regonError = 'Podaj NIP beneficjenta'; return; }
		regonLoading = true; regonError = '';
		try {
			const res = await fetch(`/api/regon/lookup?nip=${encodeURIComponent(fpBenNip.trim())}`);
			const data = await res.json();
			if (data.found) {
				fpBenNazwa = data.nazwa ?? '';
				if (!fpBenNip && data.nip) fpBenNip = data.nip;
			} else {
				regonError = 'Nie znaleziono podmiotu';
			}
		} catch {
			regonError = 'Błąd połączenia z GUS';
		} finally {
			regonLoading = false;
		}
	}

	export function getValues() {
		const suma = parseFloat(fpSuma) || 0;
		const stawkaPct = parseFloat(fpStawkaPct) || 0;
		return {
			klient_id: parentUg.klient_id,
			tu_id: parentUg.tu_id,
			nr_polisy: fpNr.trim(),
			typ_umowy: 'jednostkowa' as const,
			rodzaj: 'finansowa',
			ug_podtyp: null,
			ug_default_prowizja_pct: null,
			ug_limit: null,
			parent_id: parentUg.id,
			gwarancja_typ: fpTyp,
			gwarancja_stawka_pct: stawkaPct || null,
			gwarancja_beneficjent_nazwa: fpBenNazwa.trim() || null,
			gwarancja_beneficjent_nip: fpBenNip.trim() || null,
			gwarancja_kontrakt: fpKontrakt.trim() || null,
			przedmiot: fpKontrakt.trim() || null,
			pojazd_id: null,
			ubezpieczony_id: null,
			leasing_id: null,
			nr_umowy_leasingowej: null,
			data_od: fpOd,
			data_do: fpDo,
			data_zawarcia: fpOd || null,
			ilosc_rat: '1',
			daty_rat: null,
			kwoty_rat: null,
			skladka_przypisana: suma,
			skladka_zainkasowana: 0,
			skladka_zaliczkowa: 0,
			prowizja_pct: parentUg.ug_default_prowizja_pct ?? 0,
			prowizja_przypisana: suma * ((parentUg.ug_default_prowizja_pct ?? 0) / 100),
			prowizja_zainkasowana: 0,
			rozliczaj_platnosci: null,
			renewal_of: null,
			deleted_at: null,
			deletion_reason: null,
			tu_contact_id: null
		};
	}

	export function isValid(): string | null {
		if (!fpNr.trim()) return 'Podaj numer certyfikatu/gwarancji';
		if (!fpSuma || parseFloat(fpSuma) <= 0) return 'Podaj sumę gwarancyjną';
		if (!fpOd || !fpDo) return 'Podaj daty obowiązywania gwarancji';
		return null;
	}

	const daysTotal = $derived(() => {
		if (!fpOd || !fpDo) return 0;
		return Math.max(0, Math.round((new Date(fpDo).getTime() - new Date(fpOd).getTime()) / 86400000));
	});
</script>

<div class="space-y-4">

	<!-- Typ gwarancji -->
	<div>
		<label class={lbl}>Typ gwarancji *</label>
		<div class="grid grid-cols-2 gap-2">
			{#each TYPY as [val, label]}
				<button type="button" onclick={() => fpTyp = val}
					class="py-2 px-3 rounded-lg text-sm border text-left transition-colors
						{fpTyp === val ? 'bg-violet-50 text-violet-700 border-violet-400 font-semibold' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
					{label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Nr certyfikatu | Stawka % -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Nr certyfikatu/gwarancji *</label>
			<input bind:value={fpNr} class={inp} placeholder="np. G/2026/001" />
			<p class="text-[11px] text-slate-400 mt-1">TU: {parentUg.crm_insurers?.skrot ?? parentUg.tu_id}</p>
		</div>
		<div>
			<label class={lbl}>Stawka (%)</label>
			<input type="number" step="0.001" bind:value={fpStawkaPct} class={inp} placeholder="np. 0.5" />
		</div>
	</div>

	<!-- Suma gwarancyjna | Kontrakt -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Suma gwarancyjna (PLN) *</label>
			<input type="number" step="0.01" bind:value={fpSuma} class={inp} placeholder="np. 500000" />
		</div>
		<div>
			<label class={lbl}>Nazwa kontraktu</label>
			<input bind:value={fpKontrakt} class={inp} placeholder="np. Budowa drogi XYZ" />
		</div>
	</div>

	<!-- Daty -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Data od *</label>
			<input type="date" bind:value={fpOd} min="2024-01-01" class={inp} />
		</div>
		<div>
			<label class={lbl}>Data do *</label>
			<input type="date" bind:value={fpDo} min="2024-01-01" class={inp} />
			{#if daysTotal() > 0}
				<p class="text-[11px] text-slate-400 mt-1">Okres: {daysTotal()} dni</p>
			{/if}
		</div>
	</div>

	<!-- Beneficjent -->
	<div class="border border-slate-200 rounded-xl p-4 bg-slate-50">
		<p class="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Beneficjent gwarancji</p>
		<div class="grid grid-cols-[1fr_auto] gap-2 mb-3">
			<div>
				<label class={lbl}>NIP beneficjenta</label>
				<input bind:value={fpBenNip} class={inp} placeholder="np. 1234567890" />
			</div>
			<div class="flex items-end">
				<button type="button" onclick={lookupBeneficjent} disabled={regonLoading}
					class="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
					{regonLoading ? 'Szukam...' : 'Szukaj GUS'}
				</button>
			</div>
		</div>
		{#if regonError}
			<p class="text-xs text-red-600 mb-2">{regonError}</p>
		{/if}
		<div>
			<label class={lbl}>Nazwa beneficjenta</label>
			<input bind:value={fpBenNazwa} class={inp} placeholder="Pełna nazwa podmiotu" />
		</div>
	</div>

</div>
