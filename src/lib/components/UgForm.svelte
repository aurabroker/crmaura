<script lang="ts">
	import { appState } from '$lib/stores/app.svelte';
	import { untrack } from 'svelte';
	import type { Policy } from '$lib/types/database';

	interface Props {
		policy?: Policy | null;
		presetKlient?: string;
		onchange?: (field: string, value: unknown) => void;
	}
	let { policy = null, presetKlient = '', onchange }: Props = $props();

	let fpKlient = $state(policy?.klient_id ?? presetKlient);
	let fpTu = $state(policy?.tu_id ?? '');
	let fpNr = $state(policy?.nr_polisy ?? '');
	let fpUgPodtyp = $state(policy?.ug_podtyp ?? '');
	let fpUgDefaultProwizja = $state(policy?.ug_default_prowizja_pct?.toString() ?? '');
	let fpPrzedmiot = $state(policy?.przedmiot ?? '');

	let fpOd = $state(policy?.data_od ?? '');
	let fpDo = $state(policy?.data_do ?? '');
	let fpZawarcia = $state((policy as any)?.data_zawarcia ?? '');
	let fpRaty = $state(policy?.ilosc_rat ?? '1');
	let fpRozliczajPlatnosci = $state(policy?.rozliczaj_platnosci ?? false);

	let fpSklPrzyp = $state(policy?.skladka_przypisana?.toString() ?? '');
	let fpSklZaliczkowa = $state(policy?.skladka_zaliczkowa?.toString() ?? '0');
	let fpProwPct = $state(policy?.prowizja_pct?.toString() ?? '');
	let fpProwPrzyp = $state(policy?.prowizja_przypisana?.toString() ?? '');

	function parseDatyRat(raw: string | null | undefined, count: number): string[] {
		const parts = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
		return Array.from({ length: count }, (_, i) => parts[i] ?? '');
	}
	function parseKwotyRat(raw: string | null | undefined, count: number, skladka: number): string[] {
		const parts = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
		const equal = count > 0 ? (skladka / count).toFixed(2) : '0.00';
		return Array.from({ length: count }, (_, i) => parts[i] ?? equal);
	}

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
		const d = new Date(start.getFullYear(), start.getMonth() + i, 25);
		if (i === 0 && d <= start) {
			d.setMonth(d.getMonth() + 1);
		}
		return d.toISOString().split('T')[0];
	}

	let _prevN = parseInt(policy?.ilosc_rat ?? '1');

	$effect(() => {
		const n = parseInt(fpRaty) || 1;
		const start = fpOd ? new Date(fpOd) : null;
		const prevN = _prevN;
		_prevN = n;

		if (n !== prevN) {
			fpDatyRatArr = Array.from({ length: n }, (_, i) =>
				start ? calcDate(start, i, n) : ''
			);
		} else {
			const current = untrack(() => [...fpDatyRatArr]);
			fpDatyRatArr = Array.from({ length: n }, (_, i) =>
				current[i] || (start ? calcDate(start, i, n) : '')
			);
		}
	});

	$effect(() => {
		const n = parseInt(fpRaty) || 1;
		const sklad = parseFloat(fpSklPrzyp) || 0;
		const eq = n > 0 ? (sklad / n).toFixed(2) : '0.00';
		fpKwotypRatArr = Array.from({ length: n }, () => eq);
	});

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

	$effect(() => {
		const sklad = parseFloat(fpSklPrzyp) || 0;
		const pct = parseFloat(fpProwPct) || 0;
		if (pct > 0 && sklad > 0) fpProwPrzyp = ((sklad * pct) / 100).toFixed(2);
	});

	$effect(() => {
		if (fpUgPodtyp === 'beauty_tax') {
			const colonnade = appState.insurers.find(t =>
				(t.skrot ?? t.nazwa).toLowerCase().includes('colonnade') ||
				t.nazwa.toLowerCase().includes('colonnade')
			);
			if (colonnade) fpTu = colonnade.id;
		}
	});

	export function getValues() {
		const sklPrzyp = parseFloat(fpSklPrzyp) || 0;
		const prowPct = parseFloat(fpProwPct) || 0;
		const prowPrzyp = parseFloat(fpProwPrzyp) || (sklPrzyp * prowPct / 100);
		const rodzaj = fpUgPodtyp === 'beauty_tax' ? 'karno_skarbowa' : `umowa_generalna_${fpUgPodtyp}`;
		return {
			klient_id: fpKlient,
			tu_id: fpTu,
			nr_polisy: fpNr,
			typ_umowy: 'generalna' as const,
			rodzaj,
			ug_podtyp: fpUgPodtyp || null,
			ug_default_prowizja_pct: parseFloat(fpUgDefaultProwizja) || null,
			parent_id: null,
			przedmiot: fpPrzedmiot || null,
			data_od: fpOd,
			data_do: fpDo,
			data_zawarcia: fpZawarcia || null,
			ilosc_rat: fpRaty,
			daty_rat: fpDatyRatArr.filter(Boolean).join(', ') || null,
			kwoty_rat: fpKwotypRatArr.filter(Boolean).join(', ') || null,
			skladka_przypisana: sklPrzyp,
			skladka_zaliczkowa: parseFloat(fpSklZaliczkowa) || 0,
			skladka_zainkasowana: policy?.skladka_zainkasowana ?? 0,
			rozliczaj_platnosci: fpRozliczajPlatnosci,
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
		return fpRozliczajPlatnosci;
	}

	export function isValid(): string | null {
		if (!fpKlient) return 'Wybierz klienta';
		if (!fpTu) return 'Wybierz Towarzystwo';
		if (!fpNr.trim()) return 'Podaj numer umowy generalnej';
		if (!fpOd || !fpDo) return 'Podaj daty obowiązywania';
		if (fpOd < '2024-01-01') return 'Data od nie może być wcześniejsza niż 2024-01-01';
		if (!fpUgPodtyp) return 'Wybierz podtyp Umowy Generalnej';
		if (fpRozliczajPlatnosci) {
			if (fpDatyRatArr.filter(Boolean).length === 0) return 'Podaj terminy płatności rat';
		}
		return null;
	}

	const isAuraTenant = $derived(appState.tenantNazwa.toLowerCase().includes('aura'));

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

	let tuSearch = $state('');
	let tuOpen = $state(false);
	const filteredTU = $derived(
		tuSearch.trim()
			? appState.insurers.filter(t => t.nazwa.toLowerCase().includes(tuSearch.toLowerCase()) || (t.skrot ?? '').toLowerCase().includes(tuSearch.toLowerCase()))
			: appState.insurers
	);
	const selectedTU = $derived(appState.insurers.find(t => t.id === fpTu));
	const selectedTUName = $derived(selectedTU ? (selectedTU.skrot ? `${selectedTU.skrot} — ${selectedTU.nazwa}` : selectedTU.nazwa) : '');

	const ratyCount = $derived(parseInt(fpRaty) || 1);
	const RATY_OPCJE = ['1','2','3','4','6','12','24'];
</script>

<div class="space-y-5">

	<!-- Podtyp UG -->
	<div>
		<label class={lbl}>Podtyp Umowy Generalnej *</label>
		<div class="grid grid-cols-3 gap-1.5">
			{#each [['flota','Flota'],['gwarancje','Gwarancje'],['cpm','CPM'],['car_ear','CAR/EAR'],['beauty_tax','BeautyTAX'], ...(isAuraTenant ? [['oc_beauty','OC Beauty']] : [])] as [val, label]}
				<button type="button" onclick={() => fpUgPodtyp = val}
					class="py-2 px-3 rounded-lg text-sm border text-left transition-colors
						{fpUgPodtyp === val ? 'bg-blue-50 text-blue-700 border-blue-400' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
					{label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Klient | TU -->
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
			{#if fpUgPodtyp === 'beauty_tax'}
				<div class="{inp} bg-slate-50 text-slate-500 cursor-not-allowed flex items-center gap-2">
					<span class="text-xs text-slate-400">🔒</span>
					{selectedTUName || '—'}
				</div>
				<p class="text-[11px] text-slate-400 mt-1">Polisa podatkowa — TU: Colonnade (stałe)</p>
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

	<!-- Nr umowy | Domyślna prowizja UG -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Nr Umowy Generalnej *</label>
			<input bind:value={fpNr} class={inp} placeholder="np. UG/2025/001" />
		</div>
		<div>
			<label class={lbl}>Domyślna prowizja dla polis (%)</label>
			<input type="number" step="0.01" bind:value={fpUgDefaultProwizja} placeholder="np. 15" class={inp} />
		</div>
	</div>

	<!-- Daty -->
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

	<!-- Przedmiot -->
	<div>
		<label class={lbl}>Przedmiot / opis</label>
		<textarea bind:value={fpPrzedmiot} class="{inp} min-h-[80px]" placeholder="Opis przedmiotu umowy generalnej..."></textarea>
	</div>

	<!-- Rozliczaj płatności -->
	<div class="border-t border-slate-100 pt-3">
		<label class="flex items-center gap-3 cursor-pointer">
			<input type="checkbox" bind:checked={fpRozliczajPlatnosci}
				class="w-4 h-4 rounded accent-blue-600" />
			<div>
				<span class="text-sm font-semibold text-slate-700">Rozliczaj płatności na poziomie UG</span>
				<p class="text-xs text-slate-400 mt-0.5">Domyślnie płatności rozliczane są per certyfikat/polisa. Zaznacz tylko dla UG z własnym harmonogramem płatności.</p>
			</div>
		</label>
	</div>

	<!-- Finansowe -->
	{#if fpRozliczajPlatnosci}
	<div class="border-t border-slate-100 pt-4">
		<p class="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3">Dane Finansowe</p>
		<div class="grid grid-cols-3 gap-4">
			<div>
				<label class={lbl}>Składka przypisana (PLN)</label>
				<input type="number" step="0.01" bind:value={fpSklPrzyp} class={inp} />
			</div>
			<div>
				<label class={lbl}>Składka zaliczkowa</label>
				<input type="number" step="0.01" bind:value={fpSklZaliczkowa} class={inp} />
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
			<label class="{lbl} mb-0">Liczba rat</label>
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
	{/if}

</div>
