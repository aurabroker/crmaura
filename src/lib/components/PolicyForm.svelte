<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import { untrack } from 'svelte';
	import type { Policy } from '$lib/types/database';
	import { assignedPolicyFor } from '$lib/utils';

	interface Props {
		policy?: Policy | null;
		presetKlient?: string;
		presetRodzaj?: string;
		presetPrzedmiot?: string;
		presetPojazdId?: string;
		onchange?: (field: string, value: unknown) => void;
	}
	let { policy = null, presetKlient = '', presetRodzaj = '', presetPrzedmiot = '', presetPojazdId = '', onchange }: Props = $props();

	let fpKlient = $state(policy?.klient_id ?? presetKlient);
	let fpUbezpieczony = $state(policy?.ubezpieczony_id ?? '');
	let showUbezpieczony = $state(!!policy?.ubezpieczony_id);
	let fpTu = $state(policy?.tu_id ?? '');
	let fpNr = $state(policy?.nr_polisy ?? '');
	let fpRodzaj = $state((policy?.rodzaj ?? presetRodzaj) || 'majątkowa');
	const fpTypUmowy = 'jednostkowa';
	let fpParentId = $state(policy?.parent_id ?? '');
	let fpPrzedmiot = $state(policy?.przedmiot ?? presetPrzedmiot);
	let fpPojazdId = $state(policy?.pojazd_id ?? presetPojazdId ?? '');
	let fpLeasingId = $state(policy?.leasing_id ?? '');
	let fpNrUmowyLeasingowej = $state(policy?.nr_umowy_leasingowej ?? '');
	let fpHasLeasing = $state(!!(policy?.leasing_id));

	// Utrata dochodu: parse existing przedmiot JSON or start empty
	function parseUD(raw: string) {
		try { const p = JSON.parse(raw); if (p.__ud) return p; } catch {}
		return { __ud: true, ctn: '', ctc: '', si: '' };
	}
	let fpUD = $state(parseUD(policy?.przedmiot ?? ''));
	const isUD = $derived(fpRodzaj === 'utrata_dochodu');
	const isKomunikacja = $derived(fpRodzaj === 'komunikacja');
	const isFlota = $derived(fpRodzaj === 'flota');
	const clientVehicles = $derived(
		fpKlient ? appState.vehicles.filter(v => v.klient_id === fpKlient) : []
	);
	// Vehicles of this client not already assigned to a different active policy.
	const availableVehicles = $derived(
		clientVehicles.filter(v => !assignedPolicyFor(v.id, appState.policies, policy?.id))
	);

	$effect(() => {
		if (!isKomunikacja || !fpPojazdId) return;
		const v = appState.vehicles.find(x => x.id === fpPojazdId);
		if (v) fpPrzedmiot = `${v.nr_rejestracyjny}${v.vin ? ' / ' + v.vin : ''} — ${v.marka_model}`;
	});

	let fpOd = $state(policy?.data_od ?? '');
	let fpDo = $state(policy?.data_do ?? '');
	let fpZawarcia = $state((policy as any)?.data_zawarcia ?? '');
	let fpRaty = $state(policy?.ilosc_rat ?? '1');

	function parseDatyRat(raw: string | null | undefined, count: number): string[] {
		const parts = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
		return Array.from({ length: count }, (_, i) => parts[i] ?? '');
	}
	function parseKwotyRat(raw: string | null | undefined, count: number, skladka: number): string[] {
		const parts = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
		const equal = count > 0 ? (skladka / count).toFixed(2) : '0.00';
		return Array.from({ length: count }, (_, i) => parts[i] ?? equal);
	}

	let fpSklPrzyp = $state(policy?.skladka_przypisana?.toString() ?? '');
	let fpSklZaliczkowa = $state(policy?.skladka_zaliczkowa?.toString() ?? '0');
	let fpProwPct = $state(policy?.prowizja_pct?.toString() ?? '');
	let fpProwPrzyp = $state(policy?.prowizja_przypisana?.toString() ?? '');
	let fpDatyRatArr = $state<string[]>(parseDatyRat(policy?.daty_rat, parseInt(policy?.ilosc_rat ?? '1')));
	let fpKwotypRatArr = $state<string[]>(parseKwotyRat(
		(policy as any)?.kwoty_rat,
		parseInt(policy?.ilosc_rat ?? '1'),
		parseFloat(policy?.skladka_przypisana?.toString() ?? '0') || 0
	));

	function calcDate(start: Date, i: number, n: number): string {
		if (n === 1) {
			const d = new Date(start);
			d.setDate(d.getDate() + 14);
			return d.toISOString().split('T')[0];
		}
		// Rata i+1: 25-ty miesiąca start+i (zawsze w przód od daty_od)
		const d = new Date(start.getFullYear(), start.getMonth() + i, 25);
		// Jeśli 25-ty tego miesiąca już minął względem data_od, idź miesiąc dalej
		if (i === 0 && d <= start) {
			d.setMonth(d.getMonth() + 1);
		}
		return d.toISOString().split('T')[0];
	}

	// Śledź poprzednią liczbę rat (zwykła zmienna, nie $state)
	let _prevN = parseInt(policy?.ilosc_rat ?? '1');

	// Daty rat: przy zmianie liczby rat → przelicz wszystkie; przy zmianie data_od → wypełnij puste
	$effect(() => {
		const n = parseInt(fpRaty) || 1;
		const start = fpOd ? new Date(fpOd) : null;
		const prevN = _prevN;
		_prevN = n;

		if (n !== prevN) {
			// Liczba rat zmieniona — przelicz wszystkie daty od nowa
			fpDatyRatArr = Array.from({ length: n }, (_, i) =>
				start ? calcDate(start, i, n) : ''
			);
		} else {
			// Tylko data_od zmieniona — wypełnij puste sloty
			const current = untrack(() => [...fpDatyRatArr]);
			fpDatyRatArr = Array.from({ length: n }, (_, i) =>
				current[i] || (start ? calcDate(start, i, n) : '')
			);
		}
	});

	// Kwoty rat: zawsze przelicz równo (składka / n) przy zmianie składki lub liczby rat
	$effect(() => {
		const n = parseInt(fpRaty) || 1;
		const sklad = parseFloat(fpSklPrzyp) || 0;
		const eq = n > 0 ? (sklad / n).toFixed(2) : '0.00';
		fpKwotypRatArr = Array.from({ length: n }, () => eq);
	});

	// Auto data_do from data_od — string-based to avoid timezone year-shift bugs
	$effect(() => {
		if (fpOd && !fpDo) {
			const parts = fpOd.split('-');
			if (parts.length !== 3) return;
			const y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
			if (!y || y < 2000 || !m || !d) return;
			let ey = y + 1, em = m, ed = d - 1;
			if (ed === 0) {
				em--;
				if (em === 0) { em = 12; ey--; }
				ed = new Date(ey, em, 0).getDate();
			}
			fpDo = `${ey}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;
		}
	});

	// Auto prowizja_przypisana from %
	$effect(() => {
		const sklad = parseFloat(fpSklPrzyp) || 0;
		const pct = parseFloat(fpProwPct) || 0;
		if (pct > 0 && sklad > 0) fpProwPrzyp = ((sklad * pct) / 100).toFixed(2);
	});

	function onParentUgChange() {
		const parent = appState.policies.find(p => p.id === fpParentId);
		if (parent) {
			fpTu = parent.tu_id;
			if (parent.ug_default_prowizja_pct) {
				fpProwPct = parent.ug_default_prowizja_pct.toString();
				const sklad = parseFloat(fpSklPrzyp) || 0;
				if (sklad > 0) fpProwPrzyp = ((sklad * parent.ug_default_prowizja_pct) / 100).toFixed(2);
			}
		}
	}

	export function getValues() {
		const sklPrzyp = parseFloat(fpSklPrzyp) || 0;
		const prowPct = parseFloat(fpProwPct) || 0;
		const prowPrzyp = parseFloat(fpProwPrzyp) || (sklPrzyp * prowPct / 100);
		return {
			klient_id: fpKlient, tu_id: fpTu, nr_polisy: fpNr,
			rozliczaj_platnosci: null,
			rodzaj: fpRodzaj,
			typ_umowy: 'jednostkowa',
			ug_podtyp: null,
			ug_default_prowizja_pct: null,
			parent_id: fpParentId || null,
			ubezpieczony_id: (showUbezpieczony && fpUbezpieczony) ? fpUbezpieczony : null,
			przedmiot: isUD ? JSON.stringify({ __ud: true, ctn: fpUD.ctn, ctc: fpUD.ctc, si: fpUD.si }) : (fpPrzedmiot || null),
			pojazd_id: (isKomunikacja || isFlota) ? (fpPojazdId || null) : null,
			leasing_id: (isKomunikacja || isFlota) && fpHasLeasing ? (fpLeasingId || null) : null,
			nr_umowy_leasingowej: (isKomunikacja || isFlota) && fpHasLeasing ? (fpNrUmowyLeasingowej || null) : null,
			data_od: fpOd, data_do: fpDo,
			data_zawarcia: fpZawarcia || null,
			ilosc_rat: fpRaty,
			daty_rat: fpDatyRatArr.filter(Boolean).join(', ') || null,
			kwoty_rat: fpKwotypRatArr.filter(Boolean).join(', ') || null,
			skladka_przypisana: sklPrzyp,
			skladka_zainkasowana: policy?.skladka_zainkasowana ?? 0,
			skladka_zaliczkowa: parseFloat(fpSklZaliczkowa) || 0,
			prowizja_pct: prowPct,
			prowizja_przypisana: prowPrzyp,
			prowizja_zainkasowana: 0
		};
	}

	export function getDatyRat(): { nr: number; data: string; kwota: number }[] {
		const sklPrzyp = parseFloat(fpSklPrzyp) || 0;
		const n = parseInt(fpRaty) || 1;
		const defaultKwota = n > 0 ? sklPrzyp / n : sklPrzyp;
		return fpDatyRatArr
			.map((d, i) => ({ nr: i + 1, data: d.trim(), kwota: parseFloat(fpKwotypRatArr[i]) || defaultKwota }))
			.filter(r => r.data);
	}

	export function shouldCreatePayments(): boolean {
		return true;
	}

	export function isValid(): string | null {
		if (!fpKlient) return 'Wybierz klienta';
		if (!fpTu) return 'Wybierz Towarzystwo';
		if (!fpNr.trim()) return 'Podaj numer polisy';
		if (!fpOd || !fpDo) return 'Podaj daty obowiązywania';
		if (fpOd < '2024-01-01') return 'Data od nie może być wcześniejsza niż 2024-01-01';
		if (isKomunikacja && availableVehicles.length > 0 && !fpPojazdId) return 'Wybierz pojazd dla polisy komunikacyjnej';
		return null;
	}

	const generalPolicies = $derived(appState.policies.filter(p => p.typ_umowy === 'generalna'));

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	let clientSearch = $state('');
	let clientOpen = $state(false);
	const filteredClients = $derived(
		clientSearch.trim()
			? appState.clients.filter(c => c.nazwa.toLowerCase().includes(clientSearch.toLowerCase()) || (c.nazwa_skrocona ?? '').toLowerCase().includes(clientSearch.toLowerCase()))
			: appState.clients
	);
	const selectedClientName = $derived(appState.clients.find(c => c.id === fpKlient)?.nazwa ?? '');

	let ubezpieczonySearch = $state('');
	let ubezpieczonyOpen = $state(false);
	const filteredUbezpieczeni = $derived(
		ubezpieczonySearch.trim()
			? appState.clients.filter(c => c.nazwa.toLowerCase().includes(ubezpieczonySearch.toLowerCase()) || (c.nazwa_skrocona ?? '').toLowerCase().includes(ubezpieczonySearch.toLowerCase()))
			: appState.clients
	);
	const selectedUbezpieczonyName = $derived(appState.clients.find(c => c.id === fpUbezpieczony)?.nazwa ?? '');

	let tuSearch = $state('');
	let tuOpen = $state(false);
	const udTU = ['ceu', 'leadenhall'];
	const availableTU = $derived(
		isUD
			? appState.insurers.filter(t => udTU.some(k => t.nazwa.toLowerCase().includes(k) || (t.skrot ?? '').toLowerCase().includes(k)))
			: appState.insurers
	);
	const filteredTU = $derived(
		tuSearch.trim()
			? availableTU.filter(t => t.nazwa.toLowerCase().includes(tuSearch.toLowerCase()) || (t.skrot ?? '').toLowerCase().includes(tuSearch.toLowerCase()))
			: availableTU
	);
	const selectedTU = $derived(appState.insurers.find(t => t.id === fpTu));
	const selectedTUName = $derived(selectedTU ? (selectedTU.skrot ? `${selectedTU.skrot} — ${selectedTU.nazwa}` : selectedTU.nazwa) : '');

	const ratyCount = $derived(parseInt(fpRaty) || 1);
	const RATY_OPCJE = ['1','2','3','4','6','12','24'];
	const RODZAJE = [
		['majątkowa','Majątkowa'],['życie','Życie'],['grupowe_medyczne','Grupowe Medyczne'],
		['grupowe_życie','Grupowe Życie'],['utrata_dochodu','Utrata dochodu'],
		['komunikacja','Komunikacja'],['flota','Flota'],['finansowa','Finansowa (Gwarancje)'],
		['OC','OC Zawodowe / Działalności'],['techniczna','Techniczna'],['karno_skarbowa','Polisa Karno-Skarbowa'],['polisa_obca','Polisa Obca']
	];
</script>

<div class="space-y-5">

	<!-- Wiersz 1: Rodzaj / UG -->
	<div class="grid grid-cols-2 gap-4">
		{#if generalPolicies.length > 0}
		<div>
			<label class={lbl}>Powiąż z Umową Generalną</label>
			<select bind:value={fpParentId} onchange={onParentUgChange} class={inp}>
				<option value="">— bez UG —</option>
				{#each generalPolicies as ug}
					<option value={ug.id}>{ug.nr_polisy} ({ug.ug_podtyp})</option>
				{/each}
			</select>
			{#if fpParentId}
				{@const parentUg = generalPolicies.find(p => p.id === fpParentId)}
				{#if parentUg?.ug_default_prowizja_pct}
					<p class="text-[11px] text-blue-600 mt-1">Domyślna prowizja UG: {parentUg.ug_default_prowizja_pct}%</p>
				{/if}
			{/if}
		</div>
		{/if}
		<div>
			<label class={lbl}>Rodzaj polisy *</label>
			<select bind:value={fpRodzaj} class={inp}>
				{#each RODZAJE as [val, label]}
					<option value={val}>{label}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Wiersz 2: Klient | TU -->
	<div class="grid grid-cols-2 gap-4">
		<!-- Klient -->
		<div>
			<label class={lbl}>Klient *</label>
			<div class="relative"
				onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { clientOpen = false; clientSearch = ''; } }}>
				<input type="text"
					value={clientOpen ? clientSearch : (selectedClientName || '')}
					placeholder={selectedClientName || '— wpisz nazwę klienta —'}
					oninput={(e) => { clientSearch = (e.target as HTMLInputElement).value; }}
					onfocus={() => { clientOpen = true; clientSearch = ''; }}
					class={inp}
				/>
				{#if clientOpen}
					<div class="absolute z-[200] left-0 right-0 top-full mt-0.5 bg-white border border-slate-300 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
						{#if filteredClients.length === 0}
							<div class="px-3 py-2 text-sm text-slate-400">Brak wyników</div>
						{:else}
							{#each filteredClients as c}
								<button tabindex="0" type="button"
									class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
									onclick={() => { fpKlient = c.id; clientOpen = false; clientSearch = ''; }}>
									<span class="font-medium">{c.nazwa_skrocona ?? c.nazwa}</span>
									{#if c.nazwa_skrocona}<span class="text-xs text-slate-400 ml-2">{c.nazwa}</span>{/if}
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
			{#if fpKlient && !clientOpen}
				<p class="text-[11px] text-emerald-600 mt-1">✓ {selectedClientName}</p>
			{/if}
		</div>

		<!-- TU -->
		<div>
			<label class={lbl}>Towarzystwo Ubezpieczeń *</label>
			{#if fpParentId}
				<div class="{inp} bg-slate-50 text-slate-500 cursor-not-allowed flex items-center gap-2">
					<span class="text-xs text-slate-400">🔒</span>
					{selectedTUName || '—'}
				</div>
				<p class="text-[11px] text-slate-400 mt-1">TU przypisane z UG — zmień w panelu UG</p>
			{:else}
				<div class="relative"
					onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { tuOpen = false; tuSearch = ''; } }}>
					<input type="text"
						value={tuOpen ? tuSearch : (selectedTUName || '')}
						placeholder={selectedTUName || '— wpisz nazwę lub skrót TU —'}
						oninput={(e) => { tuSearch = (e.target as HTMLInputElement).value; }}
						onfocus={() => { tuOpen = true; tuSearch = ''; }}
						class={inp}
					/>
					{#if tuOpen}
						<div class="absolute z-[200] left-0 right-0 top-full mt-0.5 bg-white border border-slate-300 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
							{#if filteredTU.length === 0}
								<div class="px-3 py-2 text-sm text-slate-400">Brak wyników</div>
							{:else}
								{#each filteredTU as t}
									<button tabindex="0" type="button"
										class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
										onclick={() => { fpTu = t.id; tuOpen = false; tuSearch = ''; }}>
										{#if t.skrot}<span class="font-mono font-bold text-blue-700 mr-2">{t.skrot}</span>{/if}{t.nazwa}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
				{#if fpTu && !tuOpen}
					<p class="text-[11px] text-emerald-600 mt-1">✓ {selectedTUName}</p>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Ubezpieczony (drugi podmiot) -->
	{#if showUbezpieczony}
		<div class="border border-blue-200 bg-blue-50 rounded-xl p-4">
			<div class="flex items-center justify-between mb-3">
				<p class="text-xs font-semibold text-blue-700 uppercase tracking-wide">Ubezpieczony (drugi podmiot)</p>
				<button type="button"
					onclick={() => { showUbezpieczony = false; fpUbezpieczony = ''; ubezpieczonySearch = ''; }}
					class="text-xs text-slate-400 hover:text-red-500 transition-colors">
					✕ Usuń
				</button>
			</div>
			<div>
				<label class={lbl}>Ubezpieczony</label>
				<div class="relative"
					onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { ubezpieczonyOpen = false; ubezpieczonySearch = ''; } }}>
					<input type="text"
						value={ubezpieczonyOpen ? ubezpieczonySearch : (selectedUbezpieczonyName || '')}
						placeholder={selectedUbezpieczonyName || '— wpisz nazwę klienta —'}
						oninput={(e) => { ubezpieczonySearch = (e.target as HTMLInputElement).value; }}
						onfocus={() => { ubezpieczonyOpen = true; ubezpieczonySearch = ''; }}
						class={inp}
					/>
					{#if ubezpieczonyOpen}
						<div class="absolute z-[200] left-0 right-0 top-full mt-0.5 bg-white border border-slate-300 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
							{#if filteredUbezpieczeni.length === 0}
								<div class="px-3 py-2 text-sm text-slate-400">Brak wyników</div>
							{:else}
								{#each filteredUbezpieczeni as c}
									<button tabindex="0" type="button"
										class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
										onclick={() => { fpUbezpieczony = c.id; ubezpieczonyOpen = false; ubezpieczonySearch = ''; }}>
										<span class="font-medium">{c.nazwa_skrocona ?? c.nazwa}</span>
										{#if c.nazwa_skrocona}<span class="text-xs text-slate-400 ml-2">{c.nazwa}</span>{/if}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
				{#if fpUbezpieczony && !ubezpieczonyOpen}
					<p class="text-[11px] text-emerald-600 mt-1">✓ {selectedUbezpieczonyName}</p>
				{/if}
			</div>
		</div>
	{:else}
		<div>
			<button type="button"
				onclick={() => { showUbezpieczony = true; }}
				class="inline-flex items-center gap-2 px-4 py-2 text-sm border border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-colors">
				<span class="text-base leading-none">+</span> Dodaj ubezpieczonego
			</button>
			<p class="text-[11px] text-slate-400 mt-1">Opcjonalny drugi podmiot ubezpieczony na polisie</p>
		</div>
	{/if}

	<!-- Wiersz 3: Nr polisy | Przedmiot -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Nr Polisy *</label>
			<input bind:value={fpNr} class={inp} placeholder="np. 436000436385" />
		</div>
		<div>
			<label class={lbl}>Przedmiot ubezpieczenia</label>
			{#if isUD}
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<span class="text-xs text-slate-500 w-56 shrink-0">Całkowita trwała niezdolność</span>
						<input type="number" step="0.01" bind:value={fpUD.ctn} class={inp} placeholder="kwota PLN" />
					</div>
					<div class="flex items-center gap-2">
						<span class="text-xs text-slate-500 w-56 shrink-0">Całkowita czasowa niezdolność</span>
						<input type="number" step="0.01" bind:value={fpUD.ctc} class={inp} placeholder="kwota PLN" />
					</div>
					<div class="flex items-center gap-2">
						<span class="text-xs text-slate-500 w-56 shrink-0">Śmierć i inwalidztwo</span>
						<input type="number" step="0.01" bind:value={fpUD.si} class={inp} placeholder="kwota PLN" />
					</div>
				</div>
			{:else if isKomunikacja || isFlota}
				{#if fpKlient && clientVehicles.length === 0}
					<div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
						⚠️ Brak pojazdów przypisanych do klienta. Najpierw dodaj pojazd w karcie klienta.
					</div>
				{:else if fpKlient}
					<select bind:value={fpPojazdId} class={inp}>
						<option value="">— wybierz pojazd —</option>
						{#each availableVehicles as v}
							<option value={v.id}>{v.nr_rejestracyjny}{v.vin ? ' / ' + v.vin : ''} — {v.marka_model}</option>
						{/each}
					</select>
					{#if availableVehicles.length === 0}
						<p class="text-[11px] text-amber-700 mt-1">Wszystkie pojazdy klienta są już przypisane do innych polis.</p>
					{:else}
						<p class="text-[11px] text-slate-400 mt-1">Pojazdy już przypisane do innych polis nie są widoczne na liście.</p>
					{/if}
				{:else}
					<select class={inp} disabled><option>Najpierw wybierz klienta</option></select>
				{/if}
			{:else}
				<input bind:value={fpPrzedmiot} class={inp} placeholder="np. budynek, pojazd, OC..." />
			{/if}
		</div>
	</div>

	<!-- Leasing (dla komunikacja / flota) -->
	{#if isKomunikacja || isFlota}
	<div class="border border-slate-200 rounded-xl p-4 bg-slate-50">
		<label class="flex items-center gap-3 cursor-pointer mb-3">
			<input type="checkbox" bind:checked={fpHasLeasing} class="w-4 h-4 rounded accent-blue-600" />
			<span class="text-sm font-semibold text-slate-700">Finansowanie leasingowe</span>
		</label>
		{#if fpHasLeasing}
		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class={lbl}>Firma leasingowa</label>
				<select bind:value={fpLeasingId} class={inp}>
					<option value="">— wybierz —</option>
					{#each appState.leasings as l}
						<option value={l.id}>{l.nazwa}</option>
					{/each}
				</select>
				{#if appState.leasings.length === 0}
					<p class="text-[11px] text-amber-600 mt-1">Brak firm leasingowych — dodaj w Administracji.</p>
				{/if}
			</div>
			<div>
				<label class={lbl}>Nr umowy leasingowej</label>
				<input bind:value={fpNrUmowyLeasingowej} class={inp} placeholder="np. LS/2025/001" />
			</div>
		</div>
		{/if}
	</div>
	{/if}

	<!-- Wiersz 4: Data od | Data do | Data zawarcia -->
	<div class="grid grid-cols-3 gap-4">
		<div>
			<label class={lbl}>Data od *</label>
			<input type="date" bind:value={fpOd} min="2024-01-01" class={inp} />
		</div>
		<div>
			<label class={lbl}>Data do *</label>
			<input type="date" bind:value={fpDo} min="2024-01-01" class={inp} />
		</div>
		<div>
			<label class={lbl}>Data zawarcia</label>
			<input type="date" bind:value={fpZawarcia} min="2024-01-01" class={inp} />
		</div>
	</div>

	<!-- Finansowe -->
	<div class="border-t border-slate-100 pt-4">
		<p class="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">Dane Finansowe</p>
		<div class="grid grid-cols-3 gap-4">
			<div>
				<label class={lbl}>Składka przypisana (PLN) *</label>
				<input type="number" step="0.01" bind:value={fpSklPrzyp} class={inp} />
			</div>
			<div>
				<label class={lbl}>% Prowizji</label>
				<input type="number" step="0.01" bind:value={fpProwPct} class={inp} />
			</div>
			<div>
				<label class={lbl}>Prowizja przypisana (PLN)</label>
				<input type="number" step="0.01" bind:value={fpProwPrzyp} placeholder="Auto z %" class={inp} />
			</div>
		</div>
	</div>

	<!-- Liczba rat + terminy -->
	<div>
		<div class="flex items-center gap-4 mb-3">
			<label class={lbl + ' mb-0'}>Liczba rat</label>
			<select bind:value={fpRaty} class="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40">
				{#each RATY_OPCJE as opt}
					<option value={opt}>{opt === '1' ? 'Jednorazowo' : `${opt} rat`}</option>
				{/each}
			</select>
		</div>
		<div class="border border-slate-200 rounded-lg overflow-hidden">
			<div class="grid grid-cols-[80px_1fr_1fr] bg-slate-50 border-b border-slate-200 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
				<div>{ratyCount === 1 ? 'Płatność' : 'Rata'}</div>
				<div>Termin płatności</div>
				<div>Kwota (PLN)</div>
			</div>
			{#each fpDatyRatArr as _, i}
				<div class="grid grid-cols-[80px_1fr_1fr] items-center gap-3 px-4 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
					<div class="text-sm font-semibold text-slate-600">{ratyCount === 1 ? '—' : `Rata ${i + 1}`}</div>
					<input type="date" bind:value={fpDatyRatArr[i]}
						class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
					<input type="number" step="0.01" bind:value={fpKwotypRatArr[i]} placeholder="0.00"
						class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
				</div>
			{/each}
		</div>
	</div>

</div>
