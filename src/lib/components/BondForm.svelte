<script lang="ts">
	import type { Bond, BondInsurer, BondLimitView } from '$lib/types/database';
	import { fmtPln, dateDiffDays } from '$lib/utils';
	import { BOND_RODZAJ, calcBondSkladka, effectiveStawka } from '$lib/utils/bonds';

	interface Props {
		bond?: Bond | null;
		uls: BondInsurer[];
		limitViews?: BondLimitView[];
		presetInsurerId?: string;
	}
	let { bond = null, uls, limitViews = [], presetInsurerId = '' }: Props = $props();

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	let fpInsurer = $state(bond?.bond_insurer_id ?? presetInsurerId);
	let fpNr = $state(bond?.bond_nr ?? '');
	let fpRodzaj = $state(bond?.bond_rodzaj ?? 'NWK');
	let fpKontrakt = $state(bond?.bond_kontrakt ?? '');
	let fpInwestor = $state(bond?.bond_inwestor ?? '');
	let fpBeneficjent = $state(bond?.bond_beneficjent ?? '');
	let fpOd = $state(bond?.bond_data_od ?? '');
	let fpDo = $state(bond?.bond_data_do ?? '');
	let fpSuma = $state(bond?.bond_suma?.toString() ?? '');
	let fpBezLimitu = $state(bond?.bond_bez_limitu ?? false);
	let fpOverride = $state(bond?.bond_stawka_override ?? false);
	let fpStawka = $state(bond?.bond_stawka?.toString() ?? '');

	const selectedUl = $derived(uls.find((u) => u.bond_id === fpInsurer) ?? null);
	const ulView = $derived(limitViews.find((v) => v.bond_insurer_id === fpInsurer) ?? null);

	// Stawka efektywna: własna (override) albo bazowa z UL
	const effStawka = $derived(
		effectiveStawka(fpOverride, fpStawka ? parseFloat(fpStawka) : null, selectedUl?.bond_stawka_bazowa)
	);
	const skladka = $derived(
		calcBondSkladka(parseFloat(fpSuma) || 0, effStawka, fpOd, fpDo, selectedUl?.bond_skladka_min)
	);
	const dni = $derived(fpOd && fpDo ? Math.max(0, dateDiffDays(fpOd, fpDo)) : 0);

	// Wolny limit po uwzględnieniu tej gwarancji (przy edycji odejmujemy starą sumę z zaangażowania)
	const wolnyPo = $derived.by(() => {
		if (fpBezLimitu || !ulView || ulView.bond_wolny_limit == null) return null;
		const suma = parseFloat(fpSuma) || 0;
		const staraSuma = bond && bond.bond_insurer_id === fpInsurer && !bond.bond_bez_limitu ? Number(bond.bond_suma) : 0;
		return Number(ulView.bond_wolny_limit) + staraSuma - suma;
	});

	export function getValues() {
		return {
			bond_tenant_id: selectedUl?.bond_tenant_id ?? bond?.bond_tenant_id ?? null,
			bond_insurer_id: fpInsurer || null,
			bond_nr: fpNr.trim(),
			bond_rodzaj: fpRodzaj,
			bond_kontrakt: fpKontrakt.trim() || fpNr.trim(),
			bond_inwestor: fpInwestor.trim() || null,
			bond_beneficjent: fpBeneficjent.trim() || null,
			bond_data_od: fpOd,
			bond_data_do: fpDo,
			bond_suma: parseFloat(fpSuma) || 0,
			bond_bez_limitu: fpBezLimitu,
			bond_stawka_override: fpOverride,
			bond_stawka: fpOverride && fpStawka ? parseFloat(fpStawka) : null,
			bond_skladka: skladka
		};
	}

	export function isValid(): string | null {
		if (!fpInsurer) return 'Wybierz Umowę Limitową (TU)';
		if (!fpNr.trim()) return 'Podaj numer gwarancji';
		if (!fpKontrakt.trim() && !fpNr.trim()) return 'Podaj nazwę kontraktu';
		if (!fpSuma || parseFloat(fpSuma) <= 0) return 'Podaj sumę gwarancyjną';
		if (!fpOd || !fpDo) return 'Podaj daty obowiązywania gwarancji';
		if (fpDo < fpOd) return 'Data do nie może być wcześniejsza niż data od';
		return null;
	}
</script>

<div class="space-y-4">
	<!-- UL (TU) -->
	<div>
		<label class={lbl}>Umowa Limitowa (TU) *</label>
		<select bind:value={fpInsurer} class={inp}>
			<option value="">— wybierz UL —</option>
			{#each uls as u}
				<option value={u.bond_id}>
					{u.bond_nazwa}{u.bond_ul_nr ? ` — ${u.bond_ul_nr}` : ''}
				</option>
			{/each}
		</select>
		{#if selectedUl}
			<p class="text-[11px] text-slate-400 mt-1">
				Stawka bazowa: {selectedUl.bond_stawka_bazowa ?? '—'}% • Min. składka: {selectedUl.bond_skladka_min != null ? `${fmtPln(selectedUl.bond_skladka_min)} PLN` : '—'}
				{#if ulView && ulView.bond_wolny_limit != null}
					• Wolny limit: <span class="font-semibold {Number(ulView.bond_wolny_limit) > 0 ? 'text-emerald-600' : 'text-red-600'}">{fmtPln(ulView.bond_wolny_limit)} PLN</span>
				{/if}
			</p>
		{/if}
	</div>

	<!-- Typ gwarancji -->
	<div>
		<label class={lbl}>Typ gwarancji *</label>
		<div class="grid grid-cols-4 gap-2">
			{#each BOND_RODZAJ as [val, label]}
				<button type="button" onclick={() => (fpRodzaj = val)}
					class="py-2 px-2 rounded-lg text-sm border text-center transition-colors
						{fpRodzaj === val ? 'bg-violet-50 text-violet-700 border-violet-400 font-semibold' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
					{label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Nr | Suma -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Numer gwarancji *</label>
			<input bind:value={fpNr} class={inp} placeholder="np. 998056159012" />
		</div>
		<div>
			<label class={lbl}>Suma gwarancyjna (PLN) *</label>
			<input type="number" step="0.01" bind:value={fpSuma} class={inp} placeholder="np. 500000" />
		</div>
	</div>

	<!-- Kontrakt -->
	<div>
		<label class={lbl}>Nazwa kontraktu</label>
		<input bind:value={fpKontrakt} class={inp} placeholder="np. Budowa drogi S7 odc. X" />
	</div>

	<!-- Beneficjent | Inwestor -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Beneficjent</label>
			<input bind:value={fpBeneficjent} class={inp} placeholder="Na rzecz kogo" />
		</div>
		<div>
			<label class={lbl}>Inwestor / zlecający</label>
			<input bind:value={fpInwestor} class={inp} placeholder="opcjonalnie" />
		</div>
	</div>

	<!-- Daty -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Data od *</label>
			<input type="date" bind:value={fpOd} class={inp} />
		</div>
		<div>
			<label class={lbl}>Data do *</label>
			<input type="date" bind:value={fpDo} class={inp} />
			{#if dni > 0}<p class="text-[11px] text-slate-400 mt-1">Okres: {dni} dni</p>{/if}
		</div>
	</div>

	<!-- Opcje -->
	<div class="border-t border-slate-100 pt-3 space-y-2">
		<label class="flex items-center gap-3 cursor-pointer">
			<input type="checkbox" bind:checked={fpBezLimitu} class="w-4 h-4 rounded accent-violet-600" />
			<span class="text-sm text-slate-700">Poza limitem (nie obciąża Umowy Limitowej)</span>
		</label>
		<label class="flex items-center gap-3 cursor-pointer">
			<input type="checkbox" bind:checked={fpOverride} class="w-4 h-4 rounded accent-violet-600" />
			<span class="text-sm text-slate-700">Stawka indywidualna (zamiast bazowej z UL)</span>
		</label>
		{#if fpOverride}
			<div class="pl-7">
				<label class={lbl}>Stawka indywidualna (%)</label>
				<input type="number" step="0.0001" bind:value={fpStawka} class="{inp} max-w-[200px]" placeholder="np. 0.9" />
			</div>
		{/if}
	</div>

	<!-- Podsumowanie składki / limitu -->
	<div class="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1">
		<div>
			<span class="text-xs text-slate-500">Składka (wyliczona): </span>
			<span class="text-base font-bold text-violet-900">{skladka != null ? `${fmtPln(skladka)} PLN` : '—'}</span>
		</div>
		<div class="text-[11px] text-slate-400">
			{effStawka != null ? `${effStawka}% × ${dni} dni / 365` : 'uzupełnij UL, sumę i daty'}
		</div>
		{#if wolnyPo != null}
			<div class="ml-auto text-xs {wolnyPo >= 0 ? 'text-emerald-700' : 'text-red-600 font-semibold'}">
				Wolny limit po zapisie: {fmtPln(wolnyPo)} PLN {wolnyPo < 0 ? '⚠️ przekroczenie' : ''}
			</div>
		{/if}
	</div>
</div>
