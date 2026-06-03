<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import type { Policy } from '$lib/types/database';

	interface Props {
		policy?: Policy | null;
		onchange?: (field: string, value: unknown) => void;
	}
	let { policy = null, onchange }: Props = $props();

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
	let fpZawarcia = $state((policy as any)?.data_zawarcia ?? '');
	let fpRaty = $state(policy?.ilosc_rat ?? '1');

	// Parse existing daty_rat (comma-separated ISO dates) into array
	function parseDatyRat(raw: string | null | undefined, count: number): string[] {
		const parts = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
		const arr = Array.from({ length: count }, (_, i) => parts[i] ?? '');
		return arr;
	}

	let fpDatyRatArr = $state<string[]>(parseDatyRat(policy?.daty_rat, parseInt(policy?.ilosc_rat ?? '1')));

	// Resize array when fpRaty changes
	$effect(() => {
		const n = parseInt(fpRaty) || 1;
		if (fpDatyRatArr.length !== n) {
			fpDatyRatArr = Array.from({ length: n }, (_, i) => fpDatyRatArr[i] ?? '');
		}
	});
	let fpSklPrzyp = $state(policy?.skladka_przypisana?.toString() ?? '');
	let fpSklZaliczkowa = $state(policy?.skladka_zaliczkowa?.toString() ?? '0');
	let fpProwPct = $state(policy?.prowizja_pct?.toString() ?? '');
	let fpProwPrzyp = $state(policy?.prowizja_przypisana?.toString() ?? '');

	// Auto-fill data_do (+1 rok) when data_od changes
	$effect(() => {
		if (fpOd && !fpDo) {
			const d = new Date(fpOd);
			d.setFullYear(d.getFullYear() + 1);
			d.setDate(d.getDate() - 1);
			fpDo = d.toISOString().split('T')[0];
		}
	});

	// Auto-recalculate commission when % or premium changes
	$effect(() => {
		const sklad = parseFloat(fpSklPrzyp) || 0;
		const pct = parseFloat(fpProwPct) || 0;
		if (pct > 0 && sklad > 0) {
			fpProwPrzyp = ((sklad * pct) / 100).toFixed(2);
		}
	});

	export function getValues() {
		const sklPrzyp = parseFloat(fpSklPrzyp) || 0;
		const prowPct = parseFloat(fpProwPct) || 0;
		const prowPrzyp = parseFloat(fpProwPrzyp) || (sklPrzyp * prowPct / 100);

		return {
			klient_id: fpKlient, tu_id: fpTu, nr_polisy: fpNr,
			rodzaj: fpTypUmowy === 'generalna' ? `umowa_generalna_${fpUgPodtyp}` : fpRodzaj,
			typ_umowy: fpTypUmowy,
			ug_podtyp: fpTypUmowy === 'generalna' ? fpUgPodtyp || null : null,
			parent_id: fpParentId || null,
			przedmiot: fpPrzedmiot || null,
			data_od: fpOd, data_do: fpDo,
			data_zawarcia: fpZawarcia || null,
			ilosc_rat: fpRaty, daty_rat: fpDatyRatArr.filter(Boolean).join(', ') || null,
			skladka_przypisana: sklPrzyp,
			skladka_zainkasowana: sklPrzyp,
			skladka_zaliczkowa: parseFloat(fpSklZaliczkowa) || 0,
			prowizja_pct: prowPct,
			prowizja_przypisana: prowPrzyp,
			prowizja_zainkasowana: 0
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

	// Client search
	let clientSearch = $state('');
	const filteredClients = $derived(
		clientSearch.trim()
			? appState.clients.filter(c => c.nazwa.toLowerCase().includes(clientSearch.toLowerCase()))
			: appState.clients
	);
	let clientDropOpen = $state(false);
	const selectedClientName = $derived(appState.clients.find(c => c.id === fpKlient)?.nazwa ?? '');

	// TU search
	let tuSearch = $state('');
	const filteredTU = $derived(
		tuSearch.trim()
			? appState.insurers.filter(t => t.nazwa.toLowerCase().includes(tuSearch.toLowerCase()))
			: appState.insurers
	);
	let tuDropOpen = $state(false);
	const selectedTU = $derived(appState.insurers.find(t => t.id === fpTu));
	const selectedTUName = $derived(selectedTU ? (selectedTU.skrot ? `${selectedTU.skrot} — ${selectedTU.nazwa}` : selectedTU.nazwa) : '');
</script>

<div class="space-y-4">
	<!-- Typ umowy toggle -->
	<div class="flex gap-3">
		{#each [['jednostkowa', 'Polisa jednostkowa'], ['generalna', 'Umowa Generalna']] as [val, label]}
			<button
				type="button"
				onclick={() => { fpTypUmowy = val; }}
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
				{#each [['flota','Flota (pojazdy)'],['gwarancje','Gwarancje ubezpieczeniowe'],['cpm','Maszyny budowlane (CPM)'],['car_ear','Budowy-Montaż (CAR/EAR)'],['oc_beauty','OC Branża Beauty (WA50/003353/24/A)']] as [val, label]}
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
				<option value="grupowe_medyczne">Grupowe Medyczne</option>
				<option value="grupowe_życie">Grupowe życie</option>
				<option value="utrata_dochodu">Ubezpieczenie utraty dochodu</option>
				<option value="komunikacja">Komunikacja</option>
				<option value="flota">Flota</option>
				<option value="finansowa">Finansowa (Gwarancje)</option>
				<option value="OC">OC (Zawodowe / Działalności)</option>
				<option value="techniczna">Techniczna</option>
				<option value="polisa_obca">Polisa Obca (poza KNF)</option>
			</select>
		</div>
	{/if}

	<!-- Klient — searchable -->
	<div>
		<label class={labelCls}>Klient *</label>
		<div class="relative">
			<input
				type="text"
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
							onmousedown={() => { fpKlient = c.id; clientSearch = ''; clientDropOpen = false; }}>
							{c.nazwa}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- TU — searchable -->
	<div>
		<label class={labelCls}>Towarzystwo (TU) *</label>
		<div class="relative">
			<input
				type="text"
				placeholder={selectedTUName || '— wyszukaj TU —'}
				value={tuSearch || selectedTUName}
				oninput={(e) => { tuSearch = (e.target as HTMLInputElement).value; tuDropOpen = true; }}
				onfocus={() => { tuSearch = ''; tuDropOpen = true; }}
				onblur={() => setTimeout(() => tuDropOpen = false, 150)}
				class={inputCls}
			/>
			{#if tuDropOpen && filteredTU.length > 0}
				<div class="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
					{#each filteredTU as t}
						<button type="button" class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
							onmousedown={() => { fpTu = t.id; tuSearch = ''; tuDropOpen = false; }}>
							{#if t.skrot}<span class="font-mono font-semibold text-blue-700 mr-1">{t.skrot}</span>{/if}{t.nazwa}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label class={labelCls}>Nr Polisy / UG *</label>
			<input bind:value={fpNr} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Przedmiot ubezpieczenia</label>
			<input bind:value={fpPrzedmiot} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Data zawarcia</label>
			<input type="date" bind:value={fpZawarcia} class={inputCls} />
		</div>
		<div></div>
		<div>
			<label class={labelCls}>Data od *</label>
			<input type="date" bind:value={fpOd} class={inputCls} />
		</div>
		<div>
			<label class={labelCls}>Data do *</label>
			<input type="date" bind:value={fpDo} class={inputCls} />
		</div>
		{#if fpTypUmowy !== 'generalna'}
		<div class="col-span-2">
			<label class={labelCls}>Liczba rat</label>
			<div class="flex gap-2">
				{#each [['1','Jednorazowo'],['2','2 raty'],['4','4 raty'],['12','12 rat']] as [val, lbl]}
					<button type="button" onclick={() => fpRaty = val}
						class="flex-1 py-1.5 rounded-lg text-sm border transition-colors
							{fpRaty === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}">
						{lbl}
					</button>
				{/each}
			</div>
		</div>
		{#if parseInt(fpRaty) > 1}
		<div class="col-span-2">
			<label class={labelCls}>Terminy płatności rat</label>
			<div class="grid grid-cols-{Math.min(parseInt(fpRaty), 4)} gap-2">
				{#each fpDatyRatArr as _, i}
					<div>
						<div class="text-[11px] text-slate-400 mb-1">Rata {i + 1}</div>
						<input type="date" bind:value={fpDatyRatArr[i]} class={inputCls} />
					</div>
				{/each}
			</div>
		</div>
		{/if}
		{/if}
	</div>

	<hr class="border-slate-200" />
	<p class="text-sm font-semibold text-blue-600">Dane Finansowe</p>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label class={labelCls}>Składka (PLN) *</label>
			<input type="number" step="0.01" bind:value={fpSklPrzyp} class={inputCls} />
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
	</div>
</div>
