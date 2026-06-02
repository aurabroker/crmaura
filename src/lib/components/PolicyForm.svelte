<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import type { Policy } from '$lib/types/database';

	interface Props {
		policy?: Policy | null;
		onchange?: (field: string, value: unknown) => void;
	}
	let { policy = null, onchange }: Props = $props();

	// Controlled form state — init from policy if editing
	let fpKlient = $state(policy?.klient_id ?? '');
	let fpTu = $state(policy?.tu_id ?? '');
	let fpNr = $state(policy?.nr_polisy ?? '');
	let fpRodzaj = $state(policy?.rodzaj ?? 'majątkowa');
	let fpTypUmowy = $state(policy?.typ_umowy ?? 'jednostkowa');
	let fpUgPodtyp = $state(policy?.ug_podtyp ?? '');
	let fpParentId = $state(policy?.parent_id ?? '');
	let fpPrzedmiot = $state(policy?.przedmiot ?? '');
	let fpOd = $state(policy?.data_od ?? '');
	let fpDo = $state(policy?.data_do ?? '');
	let fpRaty = $state(policy?.ilosc_rat ?? '1');
	let fpDatyRat = $state(policy?.daty_rat ?? '');
	let fpSklPrzyp = $state(policy?.skladka_przypisana?.toString() ?? '');
	let fpSklZaink = $state(policy?.skladka_zainkasowana?.toString() ?? '0');
	let fpSklZaliczkowa = $state(policy?.skladka_zaliczkowa?.toString() ?? '0');
	let fpProwPct = $state(policy?.prowizja_pct?.toString() ?? '');
	let fpProwPrzyp = $state(policy?.prowizja_przypisana?.toString() ?? '');
	let fpProwZaink = $state(policy?.prowizja_zainkasowana?.toString() ?? '0');

	export function getValues() {
		const sklPrzyp = parseFloat(fpSklPrzyp) || 0;
		const prowPct = parseFloat(fpProwPct) || 0;
		let prowPrzyp = parseFloat(fpProwPrzyp);
		if (isNaN(prowPrzyp) && prowPct > 0) prowPrzyp = (sklPrzyp * prowPct) / 100;
		else if (isNaN(prowPrzyp)) prowPrzyp = 0;

		return {
			klient_id: fpKlient, tu_id: fpTu, nr_polisy: fpNr,
			rodzaj: fpTypUmowy === 'generalna' ? `umowa_generalna_${fpUgPodtyp}` : fpRodzaj,
			typ_umowy: fpTypUmowy,
			ug_podtyp: fpTypUmowy === 'generalna' ? fpUgPodtyp || null : null,
			parent_id: fpParentId || null,
			przedmiot: fpPrzedmiot || null,
			data_od: fpOd, data_do: fpDo,
			ilosc_rat: fpRaty, daty_rat: fpDatyRat || null,
			skladka_przypisana: sklPrzyp,
			skladka_zainkasowana: parseFloat(fpSklZaink) || 0,
			skladka_zaliczkowa: parseFloat(fpSklZaliczkowa) || 0,
			prowizja_pct: prowPct,
			prowizja_przypisana: prowPrzyp,
			prowizja_zainkasowana: parseFloat(fpProwZaink) || 0
		};
	}

	export function isValid(): string | null {
		if (!fpKlient) return 'Wybierz klienta';
		if (!fpTu) return 'Wybierz Towarzystwo';
		if (!fpNr.trim()) return 'Podaj numer polisy';
		if (!fpOd || !fpDo) return 'Podaj daty obowiązywania';
		if (fpTypUmowy === 'generalna' && !fpUgPodtyp) return 'Wybierz podtyp Umowy Generalnej';
		return null;
	}

	const generalPolicies = $derived(
		appState.policies.filter((p) => p.typ_umowy === 'generalna')
	);

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<div class="space-y-4">
	<!-- Typ umowy toggle -->
	<div class="flex gap-3">
		{#each [['jednostkowa', 'Polisa jednostkowa'], ['generalna', 'Umowa Generalna']] as [val, label]}
			<button
				type="button"
				onclick={() => fpTypUmowy = val}
				class="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors
					{fpTypUmowy === val
						? 'bg-slate-900 text-white border-slate-900'
						: 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}"
			>
				{label}
			</button>
		{/each}
	</div>

	{#if fpTypUmowy === 'generalna'}
		<div>
			<label class={labelCls}>Podtyp Umowy Generalnej *</label>
			<div class="grid grid-cols-2 gap-2">
				{#each [['flota','Flota (pojazdy)'],['gwarancje','Gwarancje ubezpieczeniowe'],['cpm','Maszyny budowlane (CPM)'],['car_ear','Budowy-Montaż (CAR/EAR)']] as [val, label]}
					<button
						type="button"
						onclick={() => fpUgPodtyp = val}
						class="py-2 px-3 rounded-lg text-sm border text-left transition-colors
							{fpUgPodtyp === val
								? 'bg-blue-50 text-blue-700 border-blue-400'
								: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}"
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<!-- Powiązanie z Umową Generalną (opcjonalne) -->
		{#if generalPolicies.length > 0}
			<div>
				<label class={labelCls}>Powiąż z Umową Generalną (opcjonalnie)</label>
				<select bind:value={fpParentId} class={inputCls}>
					<option value="">— polisa jednostkowa bez UG —</option>
					{#each generalPolicies as ug}
						<option value={ug.id}>{ug.nr_polisy} ({ug.ug_podtyp}) — {ug.crm_clients?.nazwa}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div>
			<label class={labelCls}>Rodzaj polisy *</label>
			<select bind:value={fpRodzaj} class={inputCls}>
				<option value="majątkowa">Majątkowa</option>
				<option value="życie">Życie</option>
				<option value="komunikacja">Komunikacja</option>
				<option value="flota">Flota</option>
				<option value="finansowa">Finansowa (Gwarancje)</option>
				<option value="OC">OC (Zawodowe / Działalności)</option>
				<option value="techniczna">Techniczna</option>
				<option value="polisa_obca">Polisa Obca (poza KNF)</option>
			</select>
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label class={labelCls}>Klient *</label>
			<select bind:value={fpKlient} class={inputCls}>
				<option value="">— wybierz klienta —</option>
				{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
			</select>
		</div>
		<div>
			<label class={labelCls}>Towarzystwo (TU) *</label>
			<select bind:value={fpTu} class={inputCls}>
				<option value="">— wybierz TU —</option>
				{#each appState.insurers as t}<option value={t.id}>{t.nazwa}</option>{/each}
			</select>
		</div>
		<div>
			<label class={labelCls}>Nr Polisy / UG *</label>
			<input bind:value={fpNr} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Przedmiot ubezpieczenia</label>
			<input bind:value={fpPrzedmiot} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Data od *</label>
			<input type="date" bind:value={fpOd} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Data do *</label>
			<input type="date" bind:value={fpDo} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Raty</label>
			<select bind:value={fpRaty} class={inputCls}>
				<option value="1">1 rata</option>
				<option value="2">2 raty</option>
				<option value="4">4 raty</option>
				<option value="12">12 rat</option>
			</select>
		</div>
		<div>
			<label class={labelCls}>Daty rat</label>
			<input bind:value={fpDatyRat} placeholder="np. 01.01, 01.06" class={inputCls} />
		</div>
	</div>

	<hr class="border-slate-200" />
	<p class="text-sm font-semibold text-blue-600">Dane Finansowe</p>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label class={labelCls}>Składka Przypisana (PLN) *</label>
			<input type="number" step="0.01" bind:value={fpSklPrzyp} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Składka Zainkasowana</label>
			<input type="number" step="0.01" bind:value={fpSklZaink} class={inputCls} />
		</div>
		{#if fpTypUmowy === 'generalna'}
			<div>
				<label class={labelCls}>Składka Zaliczkowa</label>
				<input type="number" step="0.01" bind:value={fpSklZaliczkowa} class={inputCls} />
			</div>
		{/if}
		<div>
			<label class={labelCls}>% Prowizji</label>
			<input type="number" step="0.01" bind:value={fpProwPct} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Prowizja Przypisana</label>
			<input type="number" step="0.01" bind:value={fpProwPrzyp} placeholder="Auto z %" class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Prowizja Zainkasowana</label>
			<input type="number" step="0.01" bind:value={fpProwZaink} class={inputCls} />
		</div>
	</div>
</div>
